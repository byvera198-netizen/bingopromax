import type { AccessState } from "./bingo";

export interface MemberDbStatement {
  bind: (...values: unknown[]) => MemberDbStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[]; success: boolean }>;
  run: () => Promise<unknown>;
}
export interface MemberDb { prepare: (query: string) => MemberDbStatement }
export const PRESENCE_TTL_MS = 120_000;
export const MEMBERSHIP_WARNING_DAYS = 7;

export interface MemberMessage {
  id: string; body: string; sender: string; recipient: string | null; createdAt: string;
}
export interface OnlineMember {
  email: string; name: string; playing: boolean; lastSeen: string;
}
export interface CommunityState {
  messages: MemberMessage[];
  online?: OnlineMember[];
  sent?: MemberMessage[];
}

export function membershipNotice(expiresAt: string | null | undefined, timestamp = Date.now()) {
  if (!expiresAt) return null;
  const remaining = Date.parse(expiresAt) - timestamp;
  if (!Number.isFinite(remaining)) return null;
  const days = Math.ceil(remaining / 86_400_000);
  if (days > MEMBERSHIP_WARNING_DAYS) return null;
  return {
    expired: remaining <= 0,
    text: remaining <= 0 ? "Tu membresía ha vencido. Contacta al administrador para renovarla."
      : `Tu membresía vence ${days === 1 ? "en menos de 24 horas" : `en ${days} días`}. Solicita tu renovación para seguir jugando.`,
  };
}

const mapMessage = (row: Record<string, unknown>): MemberMessage => ({
  id: String(row.id), body: String(row.body), sender: String(row.sender_email),
  recipient: row.recipient_email ? String(row.recipient_email) : null, createdAt: String(row.created_at),
});

export async function readCommunity(db: MemberDb, access: AccessState, timestamp = Date.now()): Promise<CommunityState> {
  if (!access.allowed) throw new Error("Acceso no autorizado.");
  if (access.role === "admin") {
    const [presence, sent] = await Promise.all([
      db.prepare(`SELECT p.email, COALESCE(m.name, p.email) AS name,
        MAX(CASE WHEN g.status = 'running' THEN 1 ELSE 0 END) AS playing, MAX(p.last_seen) AS last_seen
        FROM user_presence p INNER JOIN memberships m ON m.email = p.email
        LEFT JOIN games g ON g.id = p.game_id AND g.owner_email = p.email
        WHERE p.last_seen > ? AND p.role = 'member' AND m.status = 'approved' AND m.expires_at > ?
        GROUP BY p.email ORDER BY playing DESC, name COLLATE NOCASE`).bind(new Date(timestamp - PRESENCE_TTL_MS).toISOString(), new Date(timestamp).toISOString()).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM member_messages WHERE sender_email = ? ORDER BY created_at DESC LIMIT 10").bind(access.email).all<Record<string, unknown>>(),
    ]);
    return {
      messages: [],
      online: (presence.results ?? []).map((row) => ({ email: String(row.email), name: String(row.name), playing: Boolean(row.playing), lastSeen: String(row.last_seen) })),
      sent: (sent.results ?? []).map(mapMessage),
    };
  }
  const messages = await db.prepare(`SELECT m.* FROM member_messages m
    LEFT JOIN member_message_reads r ON r.message_id = m.id AND r.email = ?
    WHERE r.message_id IS NULL AND (m.recipient_email = ? OR (m.recipient_email IS NULL AND
      m.created_at >= COALESCE((SELECT requested_at FROM memberships WHERE email = ?), '9999')))
    ORDER BY m.created_at ASC LIMIT 50`).bind(access.email, access.email, access.email).all<Record<string, unknown>>();
  return { messages: (messages.results ?? []).map(mapMessage) };
}

export async function communityAction(db: MemberDb, access: AccessState, body: Record<string, unknown>, timestamp = Date.now()): Promise<Response | null> {
  if (!["presence", "sendMemberMessage", "readMemberMessage"].includes(String(body.action))) return null;
  if (!access.allowed) return Response.json({ error: "Acceso no autorizado." }, { status: 403 });
  const createdAt = new Date(timestamp).toISOString();
  if (body.action === "presence") {
    const sessionId = String(body.sessionId ?? "");
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(sessionId)) return Response.json({ error: "Sesión inválida." }, { status: 400 });
    if (body.visible !== true) {
      await db.prepare("DELETE FROM user_presence WHERE email = ? AND session_id = ?").bind(access.email, sessionId).run();
    } else {
      // Never trust a game id or a playing flag supplied by another account.
      const game = await db.prepare("SELECT id FROM games WHERE id = ? AND owner_email = ?").bind(String(body.gameId ?? ""), access.email).first<{ id: string }>();
      await db.prepare(`INSERT INTO user_presence (email, session_id, role, game_id, last_seen) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(email, session_id) DO UPDATE SET role = excluded.role, game_id = excluded.game_id, last_seen = excluded.last_seen`)
        .bind(access.email, sessionId, access.role, game?.id ?? null, createdAt).run();
      await db.prepare("DELETE FROM user_presence WHERE last_seen < ?").bind(new Date(timestamp - PRESENCE_TTL_MS).toISOString()).run();
    }
    return Response.json({ ok: true });
  }
  if (body.action === "readMemberMessage") {
    const id = String(body.messageId ?? "");
    await db.prepare(`INSERT OR IGNORE INTO member_message_reads (message_id, email, read_at)
      SELECT id, ?, ? FROM member_messages WHERE id = ? AND
      (recipient_email = ? OR (recipient_email IS NULL AND created_at >=
        COALESCE((SELECT requested_at FROM memberships WHERE email = ?), '9999')))`)
      .bind(access.email, createdAt, id, access.email, access.email).run();
    return Response.json({ ok: true });
  }
  if (access.role !== "admin") return Response.json({ error: "Solo un administrador puede enviar mensajes." }, { status: 403 });
  const id = String(body.messageId ?? "");
  const message = String(body.message ?? "").trim();
  const recipient = String(body.recipient ?? "").trim().toLowerCase() || null;
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(id) || !message || message.length > 2000) return Response.json({ error: "Escribe un mensaje de 1 a 2000 caracteres." }, { status: 400 });
  const existing = await db.prepare("SELECT * FROM member_messages WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (existing) {
    if (existing.sender_email === access.email && existing.body === message && existing.recipient_email === recipient) return Response.json({ ok: true });
    return Response.json({ error: "El identificador ya fue utilizado. Intenta un nuevo envío." }, { status: 409 });
  }
  if (recipient && !await db.prepare("SELECT email FROM memberships WHERE email = ?").bind(recipient).first()) return Response.json({ error: "El usuario ya no está registrado." }, { status: 404 });
  const recent = await db.prepare("SELECT id FROM member_messages WHERE sender_email = ? AND created_at > ? LIMIT 1").bind(access.email, new Date(timestamp - 5000).toISOString()).first();
  if (recent) return Response.json({ error: "Espera cinco segundos antes de enviar otro mensaje." }, { status: 429 });
  await db.prepare("INSERT INTO member_messages (id, sender_email, recipient_email, body, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, access.email, recipient, message, createdAt).run();
  return Response.json({ ok: true });
}
