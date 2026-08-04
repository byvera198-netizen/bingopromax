import { env } from "cloudflare:workers";
import { validateCardGrid, type BingoCard, type BingoPattern, type Game, type Membership, type Winner } from "@/lib/bingo";

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
const SUPABASE_URL = "https://mnshvsxhntqsmzbvomhe.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_DBOaxRwgSRDSmdBtTEKTsQ_GB_sT8ZA";

function mapMembership(row: Record<string, unknown>, includeCode = false): Membership {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name ?? ""),
    plan: String(row.plan) as Membership["plan"],
    months: Number(row.membership_months ?? 1),
    accessCode: includeCode && row.access_code ? String(row.access_code) : undefined,
    activationVerified: Boolean(row.activation_verified),
    status: String(row.status) as Membership["status"],
    requestedAt: String(row.requested_at),
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    deviceBound: Boolean(row.device_id),
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
  if (email === ADMIN_EMAIL) {
    return { allowed: true, role: "admin" as const, email, isPrimaryAdmin: true };
  }
  const blocked = await db.prepare("SELECT email FROM blocked_users WHERE email = ?").bind(email).first<{ email: string }>();
  if (blocked) return { allowed: false, role: "anonymous" as const, email, reason: "Esta cuenta fue eliminada por el administrador." };
  const admin = await db.prepare("SELECT email FROM admins WHERE email = ?").bind(email).first<{ email: string }>();
  if (admin) return { allowed: true, role: "admin" as const, email, isPrimaryAdmin: false };
  const row = await db
    .prepare("SELECT * FROM memberships WHERE email = ?")
    .bind(email)
    .first<Record<string, unknown>>();
  if (!row) return { allowed: false, role: "anonymous" as const, email, reason: "Solicita una membresía para continuar." };
  const membership = mapMembership(row);
  if (membership.status !== "approved") {
    return { allowed: false, role: "pending" as const, email, reason: "Tu solicitud está pendiente de aprobación.", membership };
  }
  if (!membership.activationVerified) {
    return { allowed: false, role: "pending" as const, email, reason: "Tu membresía fue aprobada. Ingresa el código de acceso enviado por el administrador.", membership };
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
    created_at TEXT NOT NULL,
    UNIQUE(game_id, pattern_id)
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL,
    membership_months INTEGER NOT NULL DEFAULT 1,
    access_code TEXT,
    activation_verified INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    device_id TEXT,
    requested_at TEXT NOT NULL,
    approved_at TEXT,
    expires_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS admins (
    email TEXT PRIMARY KEY,
    added_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS blocked_users (
    email TEXT PRIMARY KEY,
    blocked_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS removed_patterns (
    game_id TEXT NOT NULL,
    pattern_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(game_id, pattern_id)
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
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    size INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    pages INTEGER NOT NULL DEFAULT 0,
    cards INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(game_id, checksum)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    game_id TEXT,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT 'Operador local',
    created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS cards_game_status_idx ON cards(game_id, status)",
  "CREATE INDEX IF NOT EXISTS draws_game_idx ON draws(game_id, drawn_at)",
  "CREATE INDEX IF NOT EXISTS winners_game_idx ON winners(game_id, validated_at)",
  "CREATE INDEX IF NOT EXISTS game_patterns_game_idx ON game_patterns(game_id, enabled)",
  "CREATE INDEX IF NOT EXISTS memberships_status_idx ON memberships(status)",
];

async function ensureSchema(db: D1) {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  for (const statement of [
    "ALTER TABLE memberships ADD COLUMN membership_months INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE memberships ADD COLUMN access_code TEXT",
    "ALTER TABLE memberships ADD COLUMN activation_verified INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE games ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      await db.prepare(statement).run();
    } catch {
      // The column already exists.
    }
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS games_owner_created_idx ON games(owner_email, created_at)").run();
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

export async function GET(request: Request) {
  try {
    const db = getDb();
    await ensureSchema(db);
    const access = await authorize(db, request);
    if (!access.allowed) return Response.json({ access }, { status: 403 });
    const gameRow = await getOrCreateGame(db, access.email);
    const game = mapGame(gameRow);
    const gameCount = await db.prepare("SELECT COUNT(*) AS total FROM games WHERE owner_email = ?").bind(access.email).first<{ total: number }>();
    if (Number(gameCount?.total ?? 0) === 1) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO game_patterns (game_id, pattern_id, enabled, custom, created_at)
           SELECT ?, id, 1, 1, created_at FROM patterns`,
        )
        .bind(game.id)
        .run();
    }
    const [cardRows, drawRows, winnerRows, patternRows, gamePatternRows, removedPatternRows, fileRows] = await Promise.all([
      db.prepare("SELECT * FROM cards WHERE game_id = ? ORDER BY created_at DESC").bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM draws WHERE game_id = ? ORDER BY drawn_at ASC").bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM winners WHERE game_id = ? ORDER BY validated_at DESC").bind(game.id).all<Record<string, unknown>>(),
      db.prepare(
        `SELECT p.* FROM patterns p
         INNER JOIN game_patterns gp ON gp.pattern_id = p.id
         WHERE gp.game_id = ? AND gp.custom = 1
         ORDER BY p.created_at DESC`,
      ).bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT pattern_id, enabled FROM game_patterns WHERE game_id = ?").bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT pattern_id FROM removed_patterns WHERE game_id = ?").bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM files WHERE game_id = ? ORDER BY created_at DESC").bind(game.id).all<Record<string, unknown>>(),
    ]);

    const membershipRows = access.role === "admin"
      ? await db.prepare("SELECT * FROM memberships ORDER BY requested_at DESC").all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };
    const adminRows = access.role === "admin"
      ? await db.prepare("SELECT * FROM admins ORDER BY created_at DESC").all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };
    return Response.json({
      game,
      cards: (cardRows.results ?? []).map((row) => ({
        id: String(row.id),
        gameId: String(row.game_id),
        number: String(row.number),
        serial: String(row.serial ?? ""),
        grid: JSON.parse(String(row.grid_json)),
        sourceFile: String(row.source_file),
        sourcePage: Number(row.source_page),
        status: String(row.status),
        createdAt: String(row.created_at),
      })),
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
        .filter((row) => !Boolean(row.enabled))
        .map((row) => String(row.pattern_id)),
      removedPatternIds: (removedPatternRows.results ?? []).map((row) => String(row.pattern_id)),
      files: (fileRows.results ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        size: Number(row.size),
        checksum: String(row.checksum),
        pages: Number(row.pages),
        cards: Number(row.cards),
        createdAt: String(row.created_at),
      })),
      access,
      memberships: (membershipRows.results ?? []).map((row) => mapMembership(row, true)),
      admins: (adminRows.results ?? []).map((row) => ({
        email: String(row.email),
        addedBy: String(row.added_by),
        createdAt: String(row.created_at),
      })),
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
    const gameId = body.gameId ? String(body.gameId) : null;

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
      const accessCode = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      if (!email || !email.includes("@")) return Response.json({ error: "Correo inválido." }, { status: 400 });
      const blocked = await db.prepare("SELECT email FROM blocked_users WHERE email = ?").bind(email).first<{ email: string }>();
      if (blocked) return Response.json({ error: "Esta cuenta fue eliminada. Contacta al administrador." }, { status: 403 });
      await db
        .prepare(
          `INSERT INTO memberships (
             id, email, name, plan, membership_months, access_code,
             activation_verified, status, requested_at
           )
           VALUES (?, ?, ?, 'custom', 1, ?, 0, 'pending', ?)
           ON CONFLICT(email) DO UPDATE SET name = excluded.name,
             access_code = excluded.access_code, activation_verified = 0,
             status = 'pending', requested_at = excluded.requested_at`,
        )
        .bind(crypto.randomUUID(), email, name, accessCode, now())
        .run();
      return Response.json({
        ok: true,
        adminEmail: ADMIN_EMAIL,
        accessCode,
        subject: `Solicitud de membresía Bingo Control - ${email}`,
      });
    }

    if (action === "activateMembership") {
      const authorization = request.headers.get("authorization") || "";
      if (!authorization.startsWith("Bearer ")) {
        return Response.json({ error: "Inicia sesión para activar tu membresía." }, { status: 401 });
      }
      const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization },
      });
      if (!userResponse.ok) return Response.json({ error: "La sesión ha expirado." }, { status: 401 });
      const user = (await userResponse.json()) as { email?: string };
      const email = (user.email || "").trim().toLowerCase();
      const accessCode = String(body.accessCode ?? "").trim();
      const membership = await db
        .prepare("SELECT status, access_code FROM memberships WHERE email = ?")
        .bind(email)
        .first<{ status: string; access_code: string | null }>();
      if (!membership || membership.status !== "approved") {
        return Response.json({ error: "El administrador aún no ha aprobado tu membresía." }, { status: 403 });
      }
      if (!membership.access_code || membership.access_code !== accessCode) {
        return Response.json({ error: "El código de acceso no es correcto." }, { status: 400 });
      }
      await db.prepare("UPDATE memberships SET activation_verified = 1 WHERE email = ?").bind(email).run();
      return Response.json({ ok: true });
    }

    const access = await authorize(db, request);
    if (!access.allowed) return Response.json({ error: access.reason, access }, { status: 403 });
    const actor = access.email;
    if (gameId) {
      const ownedGame = await db.prepare("SELECT owner_email FROM games WHERE id = ?").bind(gameId).first<{ owner_email: string }>();
      if (!ownedGame || ownedGame.owner_email !== actor) {
        return Response.json({ error: "Esta partida pertenece a otro usuario." }, { status: 403 });
      }
    }

    if (action === "addAdmin" || action === "removeAdmin") {
      if (access.role !== "admin" || !access.isPrimaryAdmin) {
        return Response.json({ error: "Solo el administrador principal puede gestionar administradores." }, { status: 403 });
      }
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!email.includes("@") || email === ADMIN_EMAIL) {
        return Response.json({ error: "Escribe el correo válido de otro usuario." }, { status: 400 });
      }
      if (action === "addAdmin") {
        await db.prepare("INSERT OR REPLACE INTO admins (email, added_by, created_at) VALUES (?, ?, ?)").bind(email, access.email, now()).run();
        await db.prepare("DELETE FROM blocked_users WHERE email = ?").bind(email).run();
      } else {
        await db.prepare("DELETE FROM admins WHERE email = ?").bind(email).run();
      }
      return Response.json({ ok: true });
    }

    if (action === "deleteMembershipUser") {
      if (access.role !== "admin") return Response.json({ error: "Solo un administrador puede eliminar usuarios." }, { status: 403 });
      const membershipId = String(body.membershipId ?? "");
      const membership = await db.prepare("SELECT email FROM memberships WHERE id = ?").bind(membershipId).first<{ email: string }>();
      if (!membership) return Response.json({ error: "Usuario no encontrado." }, { status: 404 });
      await db.batch([
        db.prepare("DELETE FROM memberships WHERE id = ?").bind(membershipId),
        db.prepare("INSERT OR REPLACE INTO blocked_users (email, blocked_by, created_at) VALUES (?, ?, ?)").bind(membership.email, access.email, now()),
      ]);
      return Response.json({ ok: true });
    }

    if (action === "approveMembership") {
      if (access.role !== "admin") return Response.json({ error: "Solo el administrador puede aprobar usuarios." }, { status: 403 });
      const membershipId = String(body.membershipId ?? "");
      const membership = await db.prepare("SELECT * FROM memberships WHERE id = ?").bind(membershipId).first<Record<string, unknown>>();
      if (!membership) return Response.json({ error: "Solicitud no encontrada." }, { status: 404 });
      const months = Math.max(1, Math.min(120, Math.trunc(Number(body.months) || 1)));
      const approvedAt = new Date();
      const expiresAt = new Date(approvedAt);
      expiresAt.setMonth(expiresAt.getMonth() + months);
      await db
        .prepare("UPDATE memberships SET status = 'approved', membership_months = ?, approved_at = ?, expires_at = ?, activation_verified = 0, device_id = NULL WHERE id = ?")
        .bind(months, approvedAt.toISOString(), expiresAt.toISOString(), membershipId)
        .run();
      return Response.json({ ok: true, email: String(membership.email), accessCode: String(membership.access_code ?? ""), months, expiresAt: expiresAt.toISOString() });
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

    if (action === "resendMembershipCode") {
      if (access.role !== "admin") return Response.json({ error: "Solo el administrador puede generar códigos." }, { status: 403 });
      const membershipId = String(body.membershipId ?? "");
      const membership = await db
        .prepare("SELECT email, name, status, membership_months, access_code, expires_at FROM memberships WHERE id = ?")
        .bind(membershipId)
        .first<Record<string, unknown>>();
      if (!membership) return Response.json({ error: "Usuario no encontrado." }, { status: 404 });
      if (String(membership.status) !== "approved") {
        return Response.json({ error: "Aprueba primero la membresía del usuario." }, { status: 400 });
      }
      const accessCode = membership.access_code
        ? String(membership.access_code)
        : String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      if (!membership.access_code) {
        await db.prepare("UPDATE memberships SET access_code = ? WHERE id = ?").bind(accessCode, membershipId).run();
      }
      return Response.json({
        ok: true,
        email: String(membership.email),
        name: String(membership.name ?? ""),
        accessCode,
        months: Number(membership.membership_months ?? 1),
        expiresAt: membership.expires_at ? String(membership.expires_at) : null,
      });
    }

    if (action === "saveCards") {
      const cards = (body.cards ?? []) as BingoCard[];
      const importSource = typeof body.importSource === "string" ? body.importSource : null;
      if (!gameId || !Array.isArray(cards) || !cards.length) {
        return Response.json({ error: "No hay cartones válidos para guardar." }, { status: 400 });
      }
      if (importSource && cards.some((card) => card.sourceFile !== importSource)) {
        return Response.json(
          { error: "La importación contiene cartones que no pertenecen al archivo seleccionado." },
          { status: 400 },
        );
      }
      const existing = await db
        .prepare("SELECT number FROM cards WHERE game_id = ?")
        .bind(gameId)
        .all<{ number: string }>();
      const numbers = new Set(
        (existing.results ?? []).map((row) => row.number.trim().toLowerCase()),
      );
      let renamed = 0;
      const accepted = cards.flatMap((card) => {
        if (validateCardGrid(card.grid).length > 0) return [];
        const original = card.number.trim();
        let candidate = original.startsWith("SIN-ID-") ? "" : original;
        if (!candidate) candidate = String(numbers.size + 1);
        if (numbers.has(candidate.toLowerCase())) {
          const base = candidate;
          let suffix = 2;
          while (numbers.has(`${base}-${suffix}`.toLowerCase())) suffix += 1;
          candidate = `${base}-${suffix}`;
          renamed += 1;
        }
        numbers.add(candidate.toLowerCase());
        return [{ ...card, number: candidate }];
      });
      const duplicates = cards.length - accepted.length;
      if (accepted.length) {
        await db.batch(
          accepted.map((card) =>
            db
              .prepare(
                `INSERT INTO cards (
                  id, game_id, number, serial, grid_json, source_file, source_page, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                card.id,
                gameId,
                card.number,
                card.serial ?? "",
                JSON.stringify(card.grid),
                card.sourceFile,
                card.sourcePage,
                card.status,
                now(),
              ),
          ),
        );
      }
      await audit(
        db,
        gameId,
        "IMPORT_CARDS",
        `${accepted.length} guardados; ${duplicates} invÃ¡lidos; ${renamed} renumerados`,
        actor,
      );
      return Response.json({ accepted: accepted.length, duplicates, renamed });
    }

    if (action === "saveDraw") {
      const number = Number(body.number);
      if (!gameId || !Number.isInteger(number) || number < 1 || number > 75) {
        return Response.json({ error: "Bolilla inválida." }, { status: 400 });
      }
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
          `INSERT INTO game_patterns (game_id, pattern_id, enabled, custom, created_at)
           VALUES (?, ?, 1, 1, ?)`,
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
      const ownedPattern = await db.prepare("SELECT pattern_id FROM game_patterns WHERE game_id = ? AND pattern_id = ? AND custom = 1").bind(gameId, pattern.id).first<{ pattern_id: string }>();
      if (!ownedPattern) return Response.json({ error: "Solo puedes editar patrones personalizados de esta partida." }, { status: 403 });
      await db.prepare("UPDATE patterns SET name = ?, description = ?, color = ?, category = ?, difficulty = ?, cells_json = ? WHERE id = ?")
        .bind(pattern.name, pattern.description, pattern.color, pattern.category, pattern.difficulty, JSON.stringify(pattern.cells), pattern.id)
        .run();
      await audit(db, gameId, "UPDATE_PATTERN", pattern.name, actor);
      return Response.json({ ok: true });
    }

    if (action === "togglePattern") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const patternId = String(body.patternId ?? "");
      const enabled = body.enabled !== false;
      await db
        .prepare(
          `INSERT INTO game_patterns (game_id, pattern_id, enabled, custom, created_at)
           VALUES (?, ?, ?, 0, ?)
           ON CONFLICT(game_id, pattern_id) DO UPDATE SET enabled = excluded.enabled`,
        )
        .bind(gameId, patternId, enabled ? 1 : 0, now())
        .run();
      await audit(db, gameId, enabled ? "ENABLE_PATTERN" : "DISABLE_PATTERN", patternId, actor);
      return Response.json({ ok: true });
    }

    if (action === "deletePattern") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const patternId = String(body.patternId ?? "");
      await db
        .prepare("DELETE FROM game_patterns WHERE game_id = ? AND pattern_id = ? AND custom = 1")
        .bind(gameId, patternId)
        .run();
      const remaining = await db
        .prepare("SELECT pattern_id FROM game_patterns WHERE pattern_id = ? LIMIT 1")
        .bind(patternId)
        .first<{ pattern_id: string }>();
      if (!remaining) await db.prepare("DELETE FROM patterns WHERE id = ?").bind(patternId).run();
      await audit(db, gameId, "DELETE_PATTERN", patternId, actor);
      return Response.json({ ok: true });
    }

    if (action === "removeBuiltinPattern") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const patternId = String(body.patternId ?? "");
      await db.prepare("INSERT OR IGNORE INTO removed_patterns (game_id, pattern_id, created_at) VALUES (?, ?, ?)").bind(gameId, patternId, now()).run();
      await audit(db, gameId, "REMOVE_PATTERN", patternId, actor);
      return Response.json({ ok: true });
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

    if (action === "updateCardNumber") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const cardId = String(body.cardId ?? "");
      const number = String(body.number ?? "").trim().replace(/^Tab#?/i, "");
      if (!number || number.length > 40) return Response.json({ error: "Número de cartón inválido." }, { status: 400 });
      const duplicate = await db.prepare("SELECT id FROM cards WHERE game_id = ? AND number = ? AND id <> ?").bind(gameId, number, cardId).first<{ id: string }>();
      if (duplicate) return Response.json({ error: "Ya existe otro cartón con ese número." }, { status: 409 });
      await db.batch([
        db.prepare("UPDATE cards SET number = ? WHERE game_id = ? AND id = ?").bind(number, gameId, cardId),
        db.prepare("UPDATE winners SET card_number = ? WHERE game_id = ? AND card_id = ?").bind(number, gameId, cardId),
      ]);
      await audit(db, gameId, "UPDATE_CARD_NUMBER", number, actor);
      return Response.json({ ok: true, number });
    }

    if (action === "updateCard") {
      if (!gameId) return Response.json({ error: "Partida no encontrada." }, { status: 400 });
      const card = body.card as BingoCard;
      if (!card?.id || !card.number?.trim() || validateCardGrid(card.grid).length) {
        return Response.json({ error: "El cartón contiene datos inválidos." }, { status: 400 });
      }
      const duplicate = await db
        .prepare("SELECT id FROM cards WHERE game_id = ? AND number = ? AND id <> ?")
        .bind(gameId, card.number.trim(), card.id)
        .first<{ id: string }>();
      if (duplicate) return Response.json({ error: "Ya existe otro cartón con ese número." }, { status: 409 });
      await db.batch([
        db
          .prepare("UPDATE cards SET number = ?, serial = ?, grid_json = ? WHERE game_id = ? AND id = ?")
          .bind(card.number.trim(), card.serial ?? "", JSON.stringify(card.grid), gameId, card.id),
        db.prepare("DELETE FROM winners WHERE game_id = ? AND card_id = ?").bind(gameId, card.id),
      ]);
      await audit(db, gameId, "UPDATE_CARD", card.number.trim(), actor);
      return Response.json({ ok: true });
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

    if (action === "updateCardStatus") {
      const cardId = String(body.cardId ?? "");
      const status = body.status === "void" ? "void" : "active";
      await db.prepare("UPDATE cards SET status = ? WHERE id = ?").bind(status, cardId).run();
      await audit(db, gameId, "CARD_STATUS", `${cardId}: ${status}`, actor);
      return Response.json({ ok: true });
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
      await db
        .prepare(
          `INSERT INTO games (
            id, owner_email, name, date, prize, status, notes, active_pattern_id, active_pattern_name,
            active_pattern_cells, auto_pause, started_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'ready', '', 'linea-horizontal', 'Línea horizontal', ?, 1, NULL, ?, ?)`,
        )
        .bind(id, actor, name, date, prize, JSON.stringify([10, 11, 12, 13, 14]), createdAt, createdAt)
        .run();
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
