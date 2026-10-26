import { env } from "cloudflare:workers";
import {
  cardLayoutFor,
  validateBingoCard,
  type BingoCard,
  type BingoPattern,
  type Game,
  type Membership,
  type Winner,
} from "@/lib/bingo";

export const dynamic = "force-dynamic";

type D1Result<T> = { results?: T[]; success: boolean };
type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<D1Result<T>>;
  run: () => Promise<unknown>;
};
type D1 = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown>;
};

const getDb = () => (env as unknown as { DB: D1 }).DB;
const now = () => new Date().toISOString();
const ADMIN_EMAIL = "byvera198@gmail.com";
const ADMIN_EMAILS = new Set(["byvera198@gmail.com", "bveraalvear@gmail.com"]);
const SUPABASE_URL = "https://qidfcahfwvdbysaszfhl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_YMUMwP2WAwEow03fi-nlJA_gYu0-uTK";

function mapMembership(row: Record<string, unknown>): Membership {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name ?? ""),
    plan: String(row.plan) as Membership["plan"],
    status: String(row.status) as Membership["status"],
    requestedAt: String(row.requested_at),
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    deviceBound: Boolean(row.device_id),
    receiptNumber: row.receipt_number ? String(row.receipt_number) : "",
    contactChannel: row.contact_channel === "whatsapp" ? "whatsapp" : "email",
    activationCode: row.activation_code ? String(row.activation_code) : null,
    phone: row.phone ? String(row.phone) : "",
  };
}

async function authorize(db: D1, request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return { allowed: false, role: "anonymous" as const, email: "", reason: "Inicia sesión para continuar." };
  }
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization,
    },
  });
  if (!userResponse.ok) {
    return { allowed: false, role: "anonymous" as const, email: "", reason: "La sesión no es válida o ha expirado." };
  }
  const user = (await userResponse.json()) as { email?: string };
  const email = (user.email || "").toLowerCase();
  if (!email) return { allowed: false, role: "anonymous" as const, email: "", reason: "La cuenta no tiene un correo válido." };
  if (ADMIN_EMAILS.has(email)) {
    return { allowed: true, role: "admin" as const, email };
  }
  const row = await db
    .prepare("SELECT * FROM memberships WHERE email = ?")
    .bind(email)
    .first<Record<string, unknown>>();
  if (!row) return { allowed: false, role: "anonymous" as const, email, reason: "Solicita una membresía para continuar." };
  const membership = mapMembership(row);
  if (membership.status !== "approved") {
    return { allowed: false, role: "pending" as const, email, reason: "Tu solicitud está pendiente de aprobación.", membership };
  }
  if (!membership.expiresAt || new Date(membership.expiresAt).getTime() <= Date.now()) {
    await db.prepare("UPDATE memberships SET status = 'expired' WHERE id = ?").bind(membership.id).run();
    return { allowed: false, role: "pending" as const, email, reason: "Tu membresía ha vencido.", membership: { ...membership, status: "expired" as const } };
  }
  const deviceId = request.headers.get("x-device-id") || "";
  const storedDevice = String(row.device_id ?? "");
  if (!deviceId) return { allowed: false, role: "pending" as const, email, reason: "No se pudo identificar este dispositivo.", membership };
  if (!storedDevice) {
    await db.prepare("UPDATE memberships SET device_id = ? WHERE id = ?").bind(deviceId, membership.id).run();
  } else if (storedDevice !== deviceId) {
    return { allowed: false, role: "pending" as const, email, reason: "Esta cuenta ya está vinculada a otro dispositivo.", membership };
  }
  return { allowed: true, role: "member" as const, email, membership: { ...membership, deviceBound: true } };
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    prize TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ready',
    notes TEXT NOT NULL DEFAULT '',
    active_pattern_id TEXT NOT NULL DEFAULT 'linea-horizontal',
    active_pattern_name TEXT NOT NULL DEFAULT 'Línea horizontal',
    active_pattern_cells TEXT NOT NULL DEFAULT '[]',
    auto_pause INTEGER NOT NULL DEFAULT 1,
    started_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    number TEXT NOT NULL,
    serial TEXT NOT NULL DEFAULT '',
    grid_json TEXT NOT NULL,
    card_type TEXT NOT NULL DEFAULT 'classic-5x5',
    layout_json TEXT NOT NULL DEFAULT '{}',
    source_file TEXT NOT NULL DEFAULT 'Manual',
    source_page INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    UNIQUE(game_id, number)
  )`,
  `CREATE TABLE IF NOT EXISTS draws (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    drawn_at TEXT NOT NULL,
    UNIQUE(game_id, number)
  )`,
  `CREATE TABLE IF NOT EXISTS patterns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#d7ff3f',
    category TEXT NOT NULL DEFAULT 'Personalizado',
    difficulty TEXT NOT NULL DEFAULT 'Media',
    cells_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_patterns (
    game_id TEXT NOT NULL,
    pattern_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    custom INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(game_id, pattern_id)
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    device_id TEXT,
    requested_at TEXT NOT NULL,
    approved_at TEXT,
    expires_at TEXT,
    receipt_number TEXT,
    contact_channel TEXT NOT NULL DEFAULT 'email',
    activation_code TEXT,
    phone TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS winners (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    card_number TEXT NOT NULL,
    pattern_id TEXT NOT NULL,
    pattern_name TEXT NOT NULL,
    validated_at TEXT NOT NULL,
    UNIQUE(game_id, card_id, pattern_id)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    game_id TEXT,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT 'Operador local',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS presence (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    game_id TEXT,
    session_id TEXT NOT NULL DEFAULT '',
    visible INTEGER NOT NULL DEFAULT 1,
    last_seen TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS member_messages (
    id TEXT PRIMARY KEY,
    sender_email TEXT NOT NULL,
    recipient_email TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS cards_game_status_idx ON cards(game_id, status)",
  "CREATE UNIQUE INDEX IF NOT EXISTS cards_game_number_ci_idx ON cards(game_id, number COLLATE NOCASE)",
  "CREATE INDEX IF NOT EXISTS draws_game_idx ON draws(game_id, drawn_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS draws_game_number_idx ON draws(game_id, number)",
  "CREATE INDEX IF NOT EXISTS winners_game_idx ON winners(game_id, validated_at)",
  "CREATE INDEX IF NOT EXISTS game_patterns_game_idx ON game_patterns(game_id, enabled)",
  "CREATE INDEX IF NOT EXISTS memberships_status_idx ON memberships(status)",
  "CREATE INDEX IF NOT EXISTS presence_last_seen_idx ON presence(last_seen)",
];

async function ensureSchema(db: D1) {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  for (const statement of [
    "ALTER TABLE games ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE cards ADD COLUMN card_type TEXT NOT NULL DEFAULT 'classic-5x5'",
    "ALTER TABLE cards ADD COLUMN layout_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE member_messages ADD COLUMN read_at TEXT",
    "ALTER TABLE game_patterns ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE memberships ADD COLUMN receipt_number TEXT",
    "ALTER TABLE memberships ADD COLUMN contact_channel TEXT NOT NULL DEFAULT 'email'",
    "ALTER TABLE memberships ADD COLUMN activation_code TEXT",
    "ALTER TABLE memberships ADD COLUMN phone TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      await db.prepare(statement).run();
    } catch {
      // Existing installations already have these columns after the first request.
    }
  }
  try { await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS memberships_receipt_unique_idx ON memberships(receipt_number) WHERE receipt_number IS NOT NULL AND receipt_number <> ''").run(); } catch { /* legacy D1 may not support partial indexes */ }
  // Create this optimization index only after the compatibility migration.
  // Older D1 databases may have member_messages without read_at.
  try {
    await db
      .prepare(
        "CREATE INDEX IF NOT EXISTS member_messages_recipient_idx ON member_messages(recipient_email, read_at, created_at)",
      )
      .run();
  } catch {
    // Queries remain valid without this non-essential index.
  }
  // Legacy games predate per-user ownership; keep them with the administrator.
  await db.prepare("UPDATE games SET owner_email = ? WHERE owner_email = ''").bind(ADMIN_EMAIL).run();
}

async function audit(db: D1, gameId: string | null, action: string, detail: string, actor: string) {
  await db
    .prepare(
      "INSERT INTO audit_logs (id, game_id, action, detail, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), gameId, action, detail, actor, now())
    .run();
}

async function getOrCreateGame(db: D1, ownerEmail: string) {
  let game = await db
    .prepare("SELECT * FROM games WHERE owner_email = ? ORDER BY created_at DESC LIMIT 1")
    .bind(ownerEmail)
    .first<Record<string, unknown>>();
  if (!game) {
    const createdAt = now();
    const id = crypto.randomUUID();
    const date = createdAt.slice(0, 10);
    await db
      .prepare(
        `INSERT INTO games (
          id, owner_email, name, date, prize, status, notes, active_pattern_id, active_pattern_name,
          active_pattern_cells, auto_pause, started_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '', 'ready', '', 'linea-horizontal', 'Línea horizontal', ?, 1, NULL, ?, ?)`,
      )
      .bind(id, ownerEmail, "Noche de Bingo", date, JSON.stringify([10, 11, 12, 13, 14]), createdAt, createdAt)
      .run();
    game = await db.prepare("SELECT * FROM games WHERE id = ?").bind(id).first<Record<string, unknown>>();
  }
  return game!;
}

function mapGame(row: Record<string, unknown>): Game {
  return {
    id: String(row.id),
    name: String(row.name),
    date: String(row.date),
    prize: String(row.prize ?? ""),
    status: String(row.status) as Game["status"],
    notes: String(row.notes ?? ""),
    activePatternId: String(row.active_pattern_id),
    activePatternName: String(row.active_pattern_name),
    activePatternCells: JSON.parse(String(row.active_pattern_cells ?? "[]")),
    autoPause: Boolean(row.auto_pause),
    startedAt: row.started_at ? String(row.started_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function communityState(db: D1, actor: string, role: string) {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM presence WHERE last_seen < ?").bind(cutoff).run();
  const [presenceRows, messageRows, sentRows] = await Promise.all([
    db
      .prepare(
        `SELECT email, name, game_id, visible
         FROM presence
         WHERE visible = 1 AND last_seen >= ?
         ORDER BY name COLLATE NOCASE, email COLLATE NOCASE`,
      )
      .bind(cutoff)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, body, created_at
         FROM member_messages
         WHERE read_at IS NULL AND (recipient_email = '' OR lower(recipient_email) = lower(?))
         ORDER BY created_at DESC`,
      )
      .bind(actor)
      .all<Record<string, unknown>>(),
    role === "admin"
      ? db
          .prepare(
            `SELECT id, recipient_email, body, created_at
             FROM member_messages
             WHERE lower(sender_email) = lower(?)
             ORDER BY created_at DESC LIMIT 50`,
          )
          .bind(actor)
          .all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] }),
  ]);
  return {
    online: (presenceRows.results ?? []).map((row) => ({
      email: String(row.email),
      name: String(row.name || row.email),
      playing: Boolean(row.game_id),
    })),
    messages: (messageRows.results ?? []).map((row) => ({
      id: String(row.id),
      body: String(row.body),
      createdAt: String(row.created_at),
    })),
    sent: (sentRows.results ?? []).map((row) => ({
      id: String(row.id),
      recipient: String(row.recipient_email || "Todos los usuarios"),
      body: String(row.body),
      createdAt: String(row.created_at),
    })),
  };
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    await ensureSchema(db);
    const access = await authorize(db, request);
    if (!access.allowed) return Response.json({ access }, { status: 403 });
    if (new URL(request.url).searchParams.get("scope") === "community") {
      return Response.json(await communityState(db, access.email, access.role));
    }
    const gameRow = await getOrCreateGame(db, access.email);
    const game = mapGame(gameRow);
    const gameCount = await db.prepare("SELECT COUNT(*) AS total FROM games").first<{ total: number }>();
    if (Number(gameCount?.total ?? 0) === 1) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO game_patterns (game_id, pattern_id, enabled, custom, created_at)
           SELECT ?, id, 1, 1, created_at FROM patterns`,
        )
        .bind(game.id)
        .run();
    }
    const [cardRows, drawRows, winnerRows, patternRows, gamePatternRows] = await Promise.all([
      db.prepare("SELECT * FROM cards WHERE game_id = ? ORDER BY created_at DESC").bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM draws WHERE game_id = ? ORDER BY drawn_at ASC").bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM winners WHERE game_id = ? ORDER BY validated_at DESC").bind(game.id).all<Record<string, unknown>>(),
      db.prepare(
        `SELECT p.* FROM patterns p
         INNER JOIN game_patterns gp ON gp.pattern_id = p.id
         WHERE gp.game_id = ? AND gp.custom = 1
         ORDER BY p.created_at DESC`,
      ).bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT pattern_id, enabled, deleted FROM game_patterns WHERE game_id = ?").bind(game.id).all<Record<string, unknown>>(),
    ]);

    const membershipRows = access.role === "admin"
      ? await db.prepare("SELECT * FROM memberships ORDER BY requested_at DESC").all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };
    return Response.json({
      game,
      cards: (cardRows.results ?? []).map((row) => {
        const grid = JSON.parse(String(row.grid_json)) as number[];
        let layout: BingoCard["layout"];
        try {
          layout = JSON.parse(String(row.layout_json ?? "{}"));
        } catch {
          layout = undefined;
        }
        return {
          id: String(row.id),
          gameId: String(row.game_id),
          number: String(row.number),
          serial: String(row.serial ?? ""),
          grid,
          // Older clients persisted sparse 5×5 additional cards without a
          // layout object. Preserve their detected form from serial/source
          // metadata when rebuilding the state instead of treating them as
          // traditional 5×5 tickets.
          layout: cardLayoutFor({
            grid,
            layout,
            serial: String(row.serial ?? ""),
            sourceFile: String(row.source_file ?? ""),
          }),
          sourceFile: String(row.source_file),
          sourcePage: Number(row.source_page),
          status: String(row.status) as BingoCard["status"],
          createdAt: String(row.created_at),
        };
      }),
      draws: (drawRows.results ?? []).map((row) => ({
        id: String(row.id),
        number: Number(row.number),
        drawnAt: String(row.drawn_at),
      })),
      winners: (winnerRows.results ?? []).map((row) => ({
        id: String(row.id),
        cardId: String(row.card_id),
        cardNumber: String(row.card_number),
        patternId: String(row.pattern_id),
        patternName: String(row.pattern_name),
        validatedAt: String(row.validated_at),
      })),
      customPatterns: (patternRows.results ?? []).map((row) => {
        const cells = JSON.parse(String(row.cells_json));
        return {
          id: String(row.id),
          name: String(row.name),
          description: String(row.description),
          color: String(row.color),
          category: String(row.category),
          difficulty: String(row.difficulty),
          cells,
          variants: [cells],
          custom: true,
        };
      }),
      disabledPatternIds: (gamePatternRows.results ?? [])
        .filter((row) => !Boolean(row.enabled) && !Boolean(row.deleted))
        .map((row) => String(row.pattern_id)),
      deletedPatternIds: (gamePatternRows.results ?? [])
        .filter((row) => Boolean(row.deleted))
        .map((row) => String(row.pattern_id)),
      files: [],
      access,
      memberships: (membershipRows.results ?? []).map(mapMembership),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo recuperar la partida." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const db = getDb();
    await ensureSchema(db);
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    // The client can briefly hold the id of a game that was replaced in
    // another tab (or by the new-game action). Keep the id mutable so we can
    // transparently rebind that stale request to the user's current game.
    let gameId = body.gameId ? String(body.gameId) : null;

    if (action === "requestMembership") {
      const authorization = request.headers.get("authorization") || "";
      if (!authorization.startsWith("Bearer ")) {
        return Response.json({ error: "Inicia sesión antes de solicitar acceso." }, { status: 401 });
      }
      const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization },
      });
      if (!userResponse.ok) {
        return Response.json({ error: "La sesión no es válida o ha expirado." }, { status: 401 });
      }
      const user = (await userResponse.json()) as { email?: string };
      const email = (user.email || "").trim().toLowerCase();
      const name = String(body.name ?? "").trim();
      const plan = body.plan === "annual" || body.plan === "six-months" ? body.plan : "monthly";
      const receiptNumber = String(body.receiptNumber ?? "").trim().replace(/\s+/g, "");
      const contactChannel = body.contactChannel === "whatsapp" ? "whatsapp" : "email";
      const phone = String(body.phone ?? "").trim();
      const disposableDomains = new Set(["mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "yopmail.com", "sharklasers.com", "getnada.com", "emailondeck.com", "trashmail.com"]);
      if (!email || !email.includes("@")) return Response.json({ error: "Correo inválido." }, { status: 400 });
      if (disposableDomains.has(email.split("@").pop() || "")) return Response.json({ error: "Usa tu correo personal real; no se aceptan correos temporales." }, { status: 400 });
      if (!receiptNumber) return Response.json({ error: "Ingresa el número de comprobante." }, { status: 400 });
      const duplicateReceipt = await db.prepare("SELECT email FROM memberships WHERE receipt_number = ? AND lower(email) <> lower(?)").bind(receiptNumber, email).first<{ email: string }>();
      if (duplicateReceipt) return Response.json({ error: "Ese comprobante ya fue registrado por otra cuenta." }, { status: 409 });
      await db
        .prepare(
          `INSERT INTO memberships (id, email, name, plan, status, requested_at, receipt_number, contact_channel, phone)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET name = excluded.name, plan = excluded.plan,
             status = 'pending', requested_at = excluded.requested_at,
             receipt_number = excluded.receipt_number, contact_channel = excluded.contact_channel,
             phone = excluded.phone,
             activation_code = NULL`,
        )
        .bind(crypto.randomUUID(), email, name, plan, now(), receiptNumber, contactChannel, phone)
        .run();
      return Response.json({
        ok: true,
        adminEmail: ADMIN_EMAIL,
        subject: `Solicitud de membresía Bingo Control - ${email}`,
        receiptNumber,
        contactChannel,
      });
    }

    const access = await authorize(db, request);
    if (!access.allowed) return Response.json({ error: access.reason, access }, { status: 403 });
    const actor = access.email;

    // Pattern configuration belongs to the current game. Approved members
    // may create, edit, enable/disable and remove patterns for their own
    // play session; only the Studio package import remains administrative.
    const adminOnlyActions = new Set(["syncPatterns"]);
    if (adminOnlyActions.has(action) && access.role !== "admin") {
      return Response.json({ error: "Solo un administrador puede administrar los patrones de la partida." }, { status: 403 });
    }

    // The preserved 05:58 interface periodically reports presence and reads
    // the community inbox. These actions must not be blocked by a stale game
    // id from another tab because they do not mutate the bingo game itself.
    if (action === "presence") {
      const currentGame = await getOrCreateGame(db, actor);
      const visible = body.visible === false ? 0 : 1;
      await db
        .prepare(
          `INSERT INTO presence (email, name, game_id, session_id, visible, last_seen)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             name = excluded.name, game_id = excluded.game_id, session_id = excluded.session_id,
             visible = excluded.visible, last_seen = excluded.last_seen`,
        )
        .bind(
          actor,
          actor,
          visible ? String(currentGame.id) : null,
          String(body.sessionId ?? ""),
          visible,
          now(),
        )
        .run();
      return Response.json({ ok: true });
    }

    if (action === "readMemberMessage") {
      const messageId = String(body.messageId ?? "");
      if (!messageId) return Response.json({ error: "Mensaje no encontrado." }, { status: 400 });
      await db
        .prepare(
          `UPDATE member_messages SET read_at = ?
           WHERE id = ? AND (recipient_email = '' OR lower(recipient_email) = lower(?))`,
        )
        .bind(now(), messageId, actor)
        .run();
      return Response.json({ ok: true });
    }

    if (action === "sendMemberMessage") {
      if (access.role !== "admin") return Response.json({ error: "Solo el administrador puede enviar mensajes." }, { status: 403 });
      const messageId = String(body.messageId || crypto.randomUUID());
      const message = String(body.message ?? "").trim();
      const recipient = String(body.recipient ?? "").trim().toLowerCase();
      if (!message) return Response.json({ error: "Escribe un mensaje antes de enviarlo." }, { status: 400 });
      await db
        .prepare(
          `INSERT OR IGNORE INTO member_messages (id, sender_email, recipient_email, body, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(messageId, actor, recipient, message.slice(0, 2000), now())
        .run();
      return Response.json({ ok: true, id: messageId });
    }

    if (gameId) {
      const ownedGame = await db
        .prepare("SELECT id FROM games WHERE id = ? AND owner_email = ?")
        .bind(gameId, actor)
        .first<{ id: string }>();
      if (!ownedGame) {
        // A deleted/replaced game id is a stale client reference, not an
        // ownership violation. Only reject when the id still belongs to a
        // different user; otherwise use the actor's latest game.
        const existingGame = await db
          .prepare("SELECT id, owner_email FROM games WHERE id = ?")
          .bind(gameId)
          .first<{ id: string; owner_email: string }>();
        if (existingGame && String(existingGame.owner_email).toLowerCase() !== actor) {
          return Response.json({ error: "Esta partida pertenece a otro usuario." }, { status: 403 });
        }
        const currentGame = await getOrCreateGame(db, actor);
        gameId = String(currentGame.id);
      }
    }

    if (action === "approveMembership") {
      if (access.role !== "admin") return Response.json({ error: "Solo el administrador puede aprobar usuarios." }, { status: 403 });
      const membershipId = String(body.membershipId ?? "");
      const membership = await db.prepare("SELECT * FROM memberships WHERE id = ?").bind(membershipId).first<Record<string, unknown>>();
      if (!membership) return Response.json({ error: "Solicitud no encontrada." }, { status: 404 });
      const months = String(membership.plan) === "annual" ? 12 : String(membership.plan) === "six-months" ? 6 : 1;
      const approvedAt = new Date();
      const expiresAt = new Date(approvedAt);
      expiresAt.setMonth(expiresAt.getMonth() + months);
      let activationCode = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = String(Math.floor(100000 + Math.random() * 900000));
        const used = await db.prepare("SELECT id FROM memberships WHERE activation_code = ? AND id <> ?").bind(candidate, membershipId).first<{ id: string }>();
        if (!used) { activationCode = candidate; break; }
      }
      if (!activationCode) return Response.json({ error: "No se pudo generar un código de activación único." }, { status: 500 });
      await db
        .prepare("UPDATE memberships SET status = 'approved', approved_at = ?, expires_at = ?, device_id = NULL, activation_code = ? WHERE id = ?")
        .bind(approvedAt.toISOString(), expiresAt.toISOString(), activationCode, membershipId)
        .run();
      return Response.json({ ok: true, email: String(membership.email), phone: String(membership.phone ?? ""), expiresAt: expiresAt.toISOString(), activationCode, contactChannel: String(membership.contact_channel ?? "email") });
    }

    if (action === "rejectMembership") {
      if (access.role !== "admin") return Response.json({ error: "Solo el administrador puede rechazar usuarios." }, { status: 403 });
      await db.prepare("UPDATE memberships SET status = 'rejected' WHERE id = ?").bind(String(body.membershipId ?? "")).run();
      return Response.json({ ok: true });
    }

    if (action === "resetMembershipDevice") {
      if (access.role !== "admin") return Response.json({ error: "Solo el administrador puede restablecer dispositivos." }, { status: 403 });
      await db.prepare("UPDATE memberships SET device_id = NULL WHERE id = ?").bind(String(body.membershipId ?? "")).run();
      return Response.json({ ok: true });
    }

    if (action === "saveCards") {
      if (String(body.source ?? "") === "studio-package" && access.role !== "admin") {
        return Response.json({ error: "Solo un administrador puede importar paquetes generados por Studio." }, { status: 403 });
      }
      const cards = (body.cards ?? []) as BingoCard[];
      if (!gameId || !Array.isArray(cards) || !cards.length) {
        return Response.json({ error: "No hay cartones válidos para guardar." }, { status: 400 });
      }
      const existing = await db
        .prepare("SELECT number FROM cards WHERE game_id = ?")
        .bind(gameId)
        .all<{ number: string }>();
      const numbers = new Set((existing.results ?? []).map((row) => row.number.toLowerCase()));
      const rejected = cards.filter(
        (card) =>
          !card.number.trim() ||
          card.reviewStatus === "needs-review" ||
          validateBingoCard(card).length > 0,
      );
      const accepted: BingoCard[] = [];
      let duplicates = 0;
      for (const card of cards) {
        const number = card.number.trim();
        if (!number || rejected.includes(card)) continue;
        if (numbers.has(number.toLowerCase())) {
          duplicates += 1;
          continue;
        }
        numbers.add(number.toLowerCase());
        accepted.push({ ...card, number, layout: cardLayoutFor(card), reviewStatus: "ready" });
      }
      if (accepted.length) {
        // D1 batches have a statement limit. Imports commonly contain 120+
        // cards, so split the write into bounded batches instead of failing
        // the whole import after the PDF was successfully parsed.
        const chunkSize = 50;
        for (let offset = 0; offset < accepted.length; offset += chunkSize) {
          const chunk = accepted.slice(offset, offset + chunkSize);
          await db.batch(
            chunk.map((card) =>
              db
                .prepare(
                  `INSERT INTO cards (
                    id, game_id, number, serial, grid_json, card_type, layout_json, source_file, source_page, status, created_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .bind(
                  card.id,
                  gameId,
                  card.number,
                  card.serial ?? "",
                  JSON.stringify(card.grid),
                  card.layout?.type ?? "custom",
                  JSON.stringify(card.layout),
                  card.sourceFile,
                  card.sourcePage,
                  card.status,
                  now(),
                ),
            ),
          );
        }
      }
      await audit(db, gameId, "IMPORT_CARDS", `${accepted.length} guardados; ${duplicates} duplicados; ${rejected.length} pendientes`, actor);
      return Response.json({ accepted: accepted.length, duplicates, rejected: rejected.length });
    }

    if (action === "saveDraw") {
      const number = Number(body.number);
      if (!gameId || !Number.isInteger(number) || number < 1 || number > 90) {
        return Response.json({ error: "Bolilla inválida." }, { status: 400 });
      }

      // A tab can keep a previous game id after the user creates a new game
      // in another tab. Draws must always be recorded in the user's latest
      // game; otherwise a valid number can be rejected because it already
      // exists in that stale game's history.
      const latestGame = await getOrCreateGame(db, actor);
      if (String(latestGame.id) !== gameId) gameId = String(latestGame.id);

      const duplicate = await db
        .prepare("SELECT id FROM draws WHERE game_id = ? AND number = ?")
        .bind(gameId, number)
        .first<{ id: string }>();
      if (duplicate) return Response.json({ error: "Esta bolilla ya fue registrada." }, { status: 409 });
      const drawnAt = now();
      const id = crypto.randomUUID();
      await db.batch([
        db
          .prepare("INSERT INTO draws (id, game_id, number, drawn_at) VALUES (?, ?, ?, ?)")
          .bind(id, gameId, number, drawnAt),
        db
          .prepare(
            "UPDATE games SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?",
          )
          .bind(drawnAt, drawnAt, gameId),
      ]);
      await audit(db, gameId, "DRAW_NUMBER", String(number), actor);
      return Response.json({ draw: { id, number, drawnAt } });
    }

    if (action === "undoDraw") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const latest = await db
        .prepare("SELECT id, number FROM draws WHERE game_id = ? ORDER BY drawn_at DESC LIMIT 1")
        .bind(gameId)
        .first<{ id: string; number: number }>();
      if (latest) {
        await db.batch([
          db.prepare("DELETE FROM draws WHERE id = ?").bind(latest.id),
          db.prepare("DELETE FROM winners WHERE game_id = ?").bind(gameId),
        ]);
        await audit(db, gameId, "UNDO_DRAW", String(latest.number), actor);
      }
      return Response.json({ removed: latest?.number ?? null });
    }

    if (action === "resetGame") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const changedAt = now();
      await db.batch([
        db.prepare("DELETE FROM draws WHERE game_id = ?").bind(gameId),
        db.prepare("DELETE FROM winners WHERE game_id = ?").bind(gameId),
        db
          .prepare("UPDATE games SET status = 'ready', started_at = NULL, updated_at = ? WHERE id = ?")
          .bind(changedAt, gameId),
      ]);
      await audit(db, gameId, "RESET_GAME", "Historial de bolillas y ganadores reiniciado", actor);
      return Response.json({ ok: true });
    }

    if (action === "setPattern") {
      const pattern = body.pattern as BingoPattern;
      if (!gameId || !pattern?.id || !Array.isArray(pattern.cells)) {
        return Response.json({ error: "Patrón inválido." }, { status: 400 });
      }
      const changedAt = now();
      await db
        .prepare(
          `UPDATE games SET active_pattern_id = ?, active_pattern_name = ?,
           active_pattern_cells = ?,
           status = CASE WHEN status = 'paused' THEN 'running' ELSE status END,
           updated_at = ? WHERE id = ?`,
        )
        .bind(pattern.id, pattern.name, JSON.stringify(pattern.cells), changedAt, gameId)
        .run();
      await audit(db, gameId, "SET_PATTERN", pattern.name, actor);
      return Response.json({ ok: true });
    }

    if (action === "syncPatterns") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const rawPatterns = Array.isArray(body.patterns) ? body.patterns : [];
      const normalized = rawPatterns.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const source = value as Record<string, unknown>;
        const sourceId = String(source.id ?? "").trim();
        const name = String(source.name ?? "").trim();
        const cells = Array.isArray(source.cells)
          ? [...new Set(source.cells.filter((cell): cell is number => typeof cell === "number" && Number.isInteger(cell) && cell >= 0 && cell < 25))]
          : [];
        if (!sourceId || !name || !cells.length) return [];
        const safeId = sourceId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
        if (!safeId) return [];
        return [{
          id: `studio-${safeId}`,
          name: name.slice(0, 120),
          description: String(source.description ?? "Patrón importado desde Bingo ProMax Studio").trim().slice(0, 500),
          color: /^#[0-9a-f]{6}$/i.test(String(source.color ?? "")) ? String(source.color) : "#d7ff3f",
          // Preserve Studio's group so additional-only forms stay isolated
          // from classic 5×5 tickets after synchronization.
          category: String(source.group ?? "Studio").trim().slice(0, 80) || "Studio",
          difficulty: cells.length > 12 ? "Alta" : cells.length > 7 ? "Media" : "Fácil",
          cells,
          active: source.active === true,
        }];
      });

      const uniquePatterns = Array.from(new Map(normalized.map((pattern) => [pattern.id, pattern])).values());
      if (!uniquePatterns.length) return Response.json({ synced: 0, activePatternId: null });
      const statements = uniquePatterns.flatMap((pattern) => [
        db.prepare(
          `INSERT INTO patterns (id, name, description, color, category, difficulty, cells_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, description = excluded.description, color = excluded.color,
             category = excluded.category, difficulty = excluded.difficulty, cells_json = excluded.cells_json`,
        ).bind(
          pattern.id,
          pattern.name,
          pattern.description,
          pattern.color,
          pattern.category,
          pattern.difficulty,
          JSON.stringify(pattern.cells),
          now(),
        ),
        db.prepare(
          `INSERT INTO game_patterns (game_id, pattern_id, enabled, custom, deleted, created_at)
           VALUES (?, ?, ?, 1, 0, ?)
           ON CONFLICT(game_id, pattern_id) DO UPDATE SET
             enabled = excluded.enabled, custom = 1, deleted = 0`,
        ).bind(gameId, pattern.id, pattern.active ? 1 : 0, now()),
      ]);
      await db.batch(statements);

      const requestedActiveId = String(body.activePatternId ?? "").trim();
      const safeActiveId = requestedActiveId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      const activeSource = uniquePatterns.find((pattern) => pattern.id === `studio-${safeActiveId}`);
      if (activeSource) {
        await db
          .prepare(
            `UPDATE games SET active_pattern_id = ?, active_pattern_name = ?, active_pattern_cells = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(activeSource.id, activeSource.name, JSON.stringify(activeSource.cells), now(), gameId)
          .run();
      }
      await audit(db, gameId, "SYNC_PATTERNS", `${uniquePatterns.length} patrones importados desde Studio`, actor);
      return Response.json({ synced: uniquePatterns.length, activePatternId: activeSource?.id ?? null });
    }

    if (action === "savePattern") {
      const pattern = body.pattern as BingoPattern;
      if (!gameId || !pattern?.id || !pattern.name || !Array.isArray(pattern.cells) || !pattern.cells.length) {
        return Response.json({ error: "Completa el nombre y selecciona casillas." }, { status: 400 });
      }
      await db.batch([
        db.prepare(
          `INSERT INTO patterns (
            id, name, description, color, category, difficulty, cells_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          pattern.id,
          pattern.name,
          pattern.description,
          pattern.color,
          pattern.category,
          pattern.difficulty,
          JSON.stringify(pattern.cells),
          now(),
        ),
        db.prepare(
          `INSERT INTO game_patterns (game_id, pattern_id, enabled, custom, deleted, created_at)
           VALUES (?, ?, 1, 1, 0, ?)`,
        ).bind(gameId, pattern.id, now()),
      ]);
      await audit(db, gameId, "CREATE_PATTERN", pattern.name, actor);
      return Response.json({ ok: true });
    }

    if (action === "updatePattern") {
      const pattern = body.pattern as BingoPattern;
      if (!gameId || !pattern?.id || !pattern.name || !Array.isArray(pattern.cells) || !pattern.cells.length) {
        return Response.json({ error: "Completa el nombre y selecciona casillas." }, { status: 400 });
      }
      const linked = await db
        .prepare("SELECT custom, deleted FROM game_patterns WHERE game_id = ? AND pattern_id = ? LIMIT 1")
        .bind(gameId, pattern.id)
        .first<{ custom: number; deleted: number }>();
      if (!linked || Number(linked.custom) !== 1 || Number(linked.deleted) === 1) {
        return Response.json({ error: "Solo puedes editar patrones personalizados de esta partida." }, { status: 403 });
      }
      await db
        .prepare(
          `UPDATE patterns SET name = ?, description = ?, color = ?, difficulty = ?, cells_json = ?
           WHERE id = ?`,
        )
        .bind(
          pattern.name,
          pattern.description,
          pattern.color,
          pattern.difficulty,
          JSON.stringify(pattern.cells),
          pattern.id,
        )
        .run();
      await audit(db, gameId, "UPDATE_PATTERN", pattern.name, actor);
      return Response.json({ ok: true });
    }

    if (action === "replacePattern") {
      const pattern = body.pattern as BingoPattern;
      const replacesPatternId = String(body.replacesPatternId ?? "").trim();
      if (!gameId || !replacesPatternId || !pattern?.id || !pattern.name || !Array.isArray(pattern.cells) || !pattern.cells.length) {
        return Response.json({ error: "Completa el nombre y selecciona casillas." }, { status: 400 });
      }
      if (pattern.id === replacesPatternId) {
        return Response.json({ error: "El patrón editado necesita un identificador nuevo." }, { status: 400 });
      }
      const changedAt = now();
      // Editing an official figure creates a per-game custom replacement.
      // The catalogue and every other game keep using the original figure.
      await db.batch([
        db.prepare(
          `INSERT INTO patterns (
            id, name, description, color, category, difficulty, cells_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          pattern.id,
          pattern.name,
          pattern.description,
          pattern.color,
          pattern.category,
          pattern.difficulty,
          JSON.stringify(pattern.cells),
          changedAt,
        ),
        db.prepare(
          `INSERT INTO game_patterns (game_id, pattern_id, enabled, custom, deleted, created_at)
           VALUES (?, ?, 1, 1, 0, ?)`
        ).bind(gameId, pattern.id, changedAt),
        db.prepare(
          `INSERT INTO game_patterns (game_id, pattern_id, enabled, custom, deleted, created_at)
           VALUES (?, ?, 0, 0, 1, ?)
           ON CONFLICT(game_id, pattern_id) DO UPDATE SET enabled = 0, deleted = 1`
        ).bind(gameId, replacesPatternId, changedAt),
        db.prepare(
          `UPDATE games
           SET active_pattern_id = ?, active_pattern_name = ?, active_pattern_cells = ?, updated_at = ?
           WHERE id = ? AND active_pattern_id = ?`
        ).bind(
          pattern.id,
          pattern.name,
          JSON.stringify(pattern.cells),
          changedAt,
          gameId,
          replacesPatternId,
        ),
      ]);
      await audit(db, gameId, "REPLACE_PATTERN", `${replacesPatternId} → ${pattern.name}`, actor);
      return Response.json({ ok: true });
    }

    if (action === "togglePattern") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const patternId = String(body.patternId ?? "");
      const enabled = body.enabled !== false;
      await db
        .prepare(
          `INSERT INTO game_patterns (game_id, pattern_id, enabled, custom, deleted, created_at)
           VALUES (?, ?, ?, 0, 0, ?)
           ON CONFLICT(game_id, pattern_id) DO UPDATE SET enabled = excluded.enabled, deleted = 0`,
        )
        .bind(gameId, patternId, enabled ? 1 : 0, now())
        .run();
      await audit(db, gameId, enabled ? "ENABLE_PATTERN" : "DISABLE_PATTERN", patternId, actor);
      return Response.json({ ok: true });
    }

    if (action === "deletePattern") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const patternId = String(body.patternId ?? "");
      if (!patternId) return Response.json({ error: "Patrón no encontrado." }, { status: 400 });
      await db
        .prepare(
          `INSERT INTO game_patterns (game_id, pattern_id, enabled, custom, deleted, created_at)
           VALUES (?, ?, 0, 0, 1, ?)
           ON CONFLICT(game_id, pattern_id) DO UPDATE SET enabled = 0, deleted = 1`,
        )
        .bind(gameId, patternId, now())
        .run();
      await audit(db, gameId, "DELETE_PATTERN", patternId, actor);
      return Response.json({ ok: true });
    }

    if (action === "deletePatterns") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const patternIds = [...new Set(Array.isArray(body.patternIds) ? body.patternIds.map(String).filter(Boolean) : [])];
      if (!patternIds.length) return Response.json({ deleted: 0 });
      // Los patrones oficiales también pueden retirarse de la partida actual.
      // Se conserva el catálogo global y la operación queda limitada al juego
      // indicado; así la selección masiva funciona aunque no existiera aún
      // una fila de game_patterns para un patrón oficial.
      await db.batch(patternIds.map((patternId) =>
        db.prepare(
          `INSERT INTO game_patterns (game_id, pattern_id, enabled, custom, deleted, created_at)
           VALUES (?, ?, 0, 0, 1, ?)
           ON CONFLICT(game_id, pattern_id) DO UPDATE SET enabled = 0, deleted = 1`,
        ).bind(gameId, patternId, now()),
      ));
      await audit(db, gameId, "DELETE_PATTERNS", patternIds.join(","), actor);
      return Response.json({ deleted: patternIds.length });
    }

    if (action === "deleteCard") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const cardId = String(body.cardId ?? "");
      await db.batch([
        db.prepare("DELETE FROM winners WHERE game_id = ? AND card_id = ?").bind(gameId, cardId),
        db.prepare("DELETE FROM cards WHERE game_id = ? AND id = ?").bind(gameId, cardId),
      ]);
      await audit(db, gameId, "DELETE_CARD", cardId, actor);
      return Response.json({ ok: true });
    }

    if (action === "deleteCards") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const cardIds = [...new Set(Array.isArray(body.cardIds) ? body.cardIds.map(String).filter(Boolean) : [])];
      if (!cardIds.length) return Response.json({ deleted: 0 });
      const placeholders = cardIds.map(() => "?").join(", ");
      const cardRows = await db
        .prepare(`SELECT id FROM cards WHERE game_id = ? AND id IN (${placeholders})`)
        .bind(gameId, ...cardIds)
        .all<{ id: string }>();
      const ownedIds = (cardRows.results ?? []).map((row) => String(row.id));
      if (!ownedIds.length) return Response.json({ deleted: 0 });
      const ownedPlaceholders = ownedIds.map(() => "?").join(", ");
      await db.batch([
        db
          .prepare(`DELETE FROM winners WHERE game_id = ? AND card_id IN (${ownedPlaceholders})`)
          .bind(gameId, ...ownedIds),
        db
          .prepare(`DELETE FROM cards WHERE game_id = ? AND id IN (${ownedPlaceholders})`)
          .bind(gameId, ...ownedIds),
      ]);
      await audit(db, gameId, "DELETE_CARDS", String(ownedIds.length), actor);
      return Response.json({ ok: true, deleted: ownedIds.length });
    }

    if (action === "deleteVoidCards") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const voided = await db
        .prepare("SELECT id FROM cards WHERE game_id = ? AND status = 'void'")
        .bind(gameId)
        .all<{ id: string }>();
      const ids = (voided.results ?? []).map((row) => row.id);
      if (ids.length) {
        await db.batch(
          ids.flatMap((cardId) => [
            db.prepare("DELETE FROM winners WHERE game_id = ? AND card_id = ?").bind(gameId, cardId),
            db.prepare("DELETE FROM cards WHERE game_id = ? AND id = ?").bind(gameId, cardId),
          ]),
        );
      }
      await audit(db, gameId, "DELETE_VOID_CARDS", String(ids.length), actor);
      return Response.json({ deleted: ids.length });
    }

    if (action === "updateCard") {
      const card = body.card as BingoCard;
      if (!gameId || !card?.id || !card.number?.trim()) {
        return Response.json({ error: "Completa el número del cartón antes de guardarlo." }, { status: 400 });
      }
      const normalized: BingoCard = {
        ...card,
        number: card.number.trim(),
        serial: card.serial?.trim() ?? "",
        layout: cardLayoutFor(card),
        reviewStatus: "ready",
      };
      const errors = validateBingoCard(normalized);
      if (errors.length) return Response.json({ error: errors[0] }, { status: 400 });
      const duplicate = await db
        .prepare("SELECT id FROM cards WHERE game_id = ? AND lower(number) = lower(?) AND id <> ?")
        .bind(gameId, normalized.number, normalized.id)
        .first<{ id: string }>();
      if (duplicate) return Response.json({ error: "Ya existe un cartón con esa numeración." }, { status: 409 });
      await db.batch([
        db
          .prepare(
            `UPDATE cards SET number = ?, serial = ?, grid_json = ?, card_type = ?, layout_json = ?, status = ?
             WHERE game_id = ? AND id = ?`,
          )
          .bind(
            normalized.number,
            normalized.serial ?? "",
            JSON.stringify(normalized.grid),
            normalized.layout!.type,
            JSON.stringify(normalized.layout!),
            normalized.status,
            gameId,
            normalized.id,
          ),
        db.prepare("DELETE FROM winners WHERE game_id = ? AND card_id = ?").bind(gameId, normalized.id),
      ]);
      await audit(db, gameId, "UPDATE_CARD", normalized.number, actor);
      return Response.json({ card: normalized });
    }

    if (action === "updateCardStatus") {
      const cardId = String(body.cardId ?? "");
      const status = body.status === "void" ? "void" : "active";
      await db.prepare("UPDATE cards SET status = ? WHERE game_id = ? AND id = ?").bind(status, gameId, cardId).run();
      await audit(db, gameId, "CARD_STATUS", `${cardId}: ${status}`, actor);
      return Response.json({ ok: true });
    }

    if (action === "updateCardStatusBulk") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const cardIds = [...new Set(Array.isArray(body.cardIds) ? body.cardIds.map(String).filter(Boolean) : [])];
      if (!cardIds.length) return Response.json({ updated: 0 });
      const status = body.status === "void" ? "void" : "active";
      const placeholders = cardIds.map(() => "?").join(", ");
      const result = await db
        .prepare(`UPDATE cards SET status = ? WHERE game_id = ? AND id IN (${placeholders})`)
        .bind(status, gameId, ...cardIds)
        .run() as { meta?: { changes?: number } };
      const updated = Number(result?.meta?.changes ?? 0);
      await audit(db, gameId, "CARD_STATUS_BULK", `${updated}: ${status}`, actor);
      return Response.json({ ok: true, updated });
    }

    if (action === "recordWinners") {
      const winners = (body.winners ?? []) as Winner[];
      if (!gameId || !winners.length) return Response.json({ ok: true });
      const existing = await db
        .prepare("SELECT card_id, pattern_id FROM winners WHERE game_id = ?")
        .bind(gameId)
        .all<{ card_id: string; pattern_id: string }>();
      const keys = new Set((existing.results ?? []).map((row) => `${row.card_id}:${row.pattern_id}`));
      const newWinners = winners.filter((winner) => !keys.has(`${winner.cardId}:${winner.patternId}`));
      const statements = newWinners.map((winner) =>
        db
          .prepare(
            `INSERT INTO winners (
              id, game_id, card_id, card_number, pattern_id, pattern_name, validated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            winner.id,
            gameId,
            winner.cardId,
            winner.cardNumber,
            winner.patternId,
            winner.patternName,
            winner.validatedAt,
          ),
      );
      if (body.autoPause) {
        statements.push(
          db.prepare("UPDATE games SET status = 'paused', updated_at = ? WHERE id = ?").bind(now(), gameId),
        );
      }
      if (statements.length) await db.batch(statements);
      if (newWinners.length) {
        await audit(db, gameId, "WINNERS", newWinners.map((winner) => winner.cardNumber).join(", "), actor);
      }
      return Response.json({ inserted: newWinners.length });
    }

    if (action === "updateGame") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const fields = body.fields as Partial<Game>;
      await db
        .prepare(
          `UPDATE games SET name = ?, date = ?, prize = ?, notes = ?, auto_pause = ?,
           status = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          fields.name ?? "Noche de Bingo",
          fields.date ?? now().slice(0, 10),
          fields.prize ?? "",
          fields.notes ?? "",
          fields.autoPause === false ? 0 : 1,
          fields.status ?? "ready",
          now(),
          gameId,
        )
        .run();
      await audit(db, gameId, "UPDATE_GAME", String(fields.name ?? ""), actor);
      return Response.json({ ok: true });
    }

    if (action === "createGame") {
      const id = crypto.randomUUID();
      const createdAt = now();
      const name = String(body.name || "Nueva partida");
      const date = String(body.date || createdAt.slice(0, 10));
      const prize = String(body.prize || "");
      // A new game is a clean workspace. Remove all data owned by the
      // previous game before creating the replacement so old cards cannot
      // reappear after the next synchronization or consume D1 storage.
      const oldGames = await db
        .prepare("SELECT id FROM games WHERE owner_email = ? ORDER BY created_at DESC")
        .bind(actor)
        .all<{ id: string }>();
      const sourceGameId = oldGames.results?.[0]?.id;
      const savedPatternDefaults = sourceGameId
        ? await db.prepare(
            `SELECT gp.pattern_id, gp.enabled, gp.custom, gp.deleted,
                    p.name, p.description, p.color, p.category, p.difficulty, p.cells_json, p.created_at AS pattern_created_at
             FROM game_patterns gp LEFT JOIN patterns p ON p.id = gp.pattern_id
             WHERE gp.game_id = ?`,
          ).bind(sourceGameId).all<Record<string, unknown>>()
        : { results: [] as Record<string, unknown>[] };
      // D1 limits the number of statements in a single batch.  A user may
      // have accumulated many old games, so clean each game in a small batch
      // and only insert the replacement after every old record is gone.
      for (const oldGame of oldGames.results ?? []) {
        await db.batch([
          db.prepare("DELETE FROM winners WHERE game_id = ?").bind(oldGame.id),
          db.prepare("DELETE FROM draws WHERE game_id = ?").bind(oldGame.id),
          db.prepare("DELETE FROM cards WHERE game_id = ?").bind(oldGame.id),
          db.prepare("DELETE FROM game_patterns WHERE game_id = ?").bind(oldGame.id),
          db.prepare("DELETE FROM audit_logs WHERE game_id = ?").bind(oldGame.id),
          db.prepare("DELETE FROM games WHERE id = ?").bind(oldGame.id),
        ]);
      }
      await db
        .prepare(
          `INSERT INTO games (
            id, owner_email, name, date, prize, status, notes, active_pattern_id, active_pattern_name,
            active_pattern_cells, auto_pause, started_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'ready', '', 'linea-horizontal', 'Línea horizontal', ?, 1, NULL, ?, ?)`,
        )
        .bind(id, actor, name, date, prize, JSON.stringify([10, 11, 12, 13, 14]), createdAt, createdAt)
        .run();
      const defaultRows = savedPatternDefaults.results ?? [];
      const copyStatements = defaultRows.flatMap((row) => {
        const patternId = String(row.pattern_id);
        const custom = Boolean(row.custom);
        const statements = [];
        if (custom && row.name) {
          statements.push(db.prepare(
            `INSERT OR REPLACE INTO patterns (id, name, description, color, category, difficulty, cells_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            patternId,
            String(row.name),
            String(row.description ?? ""),
            String(row.color ?? "#d7ff3f"),
            String(row.category ?? "Personalizado"),
            String(row.difficulty ?? "Media"),
            String(row.cells_json ?? "[]"),
            String(row.pattern_created_at ?? createdAt),
          ));
        }
        statements.push(db.prepare(
          `INSERT INTO game_patterns (game_id, pattern_id, enabled, custom, deleted, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(id, patternId, Boolean(row.enabled) ? 1 : 0, custom ? 1 : 0, Boolean(row.deleted) ? 1 : 0, createdAt));
        return statements;
      });
      for (let offset = 0; offset < copyStatements.length; offset += 40) {
        await db.batch(copyStatements.slice(offset, offset + 40));
      }
      await db.prepare("DELETE FROM patterns WHERE id NOT IN (SELECT pattern_id FROM game_patterns)").run();
      await audit(db, id, "CREATE_GAME", name, actor);
      return Response.json({ id });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar el cambio." },
      { status: 500 },
    );
  }
}
