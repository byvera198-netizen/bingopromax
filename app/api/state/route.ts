import { env } from "cloudflare:workers";
import type { BingoCard, BingoPattern, Game, Winner } from "@/lib/bingo";

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

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
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
];

async function ensureSchema(db: D1) {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
}

async function audit(db: D1, gameId: string | null, action: string, detail: string, actor: string) {
  await db
    .prepare(
      "INSERT INTO audit_logs (id, game_id, action, detail, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), gameId, action, detail, actor, now())
    .run();
}

async function getOrCreateGame(db: D1) {
  let game = await db
    .prepare("SELECT * FROM games ORDER BY created_at DESC LIMIT 1")
    .first<Record<string, unknown>>();
  if (!game) {
    const createdAt = now();
    const id = crypto.randomUUID();
    const date = createdAt.slice(0, 10);
    await db
      .prepare(
        `INSERT INTO games (
          id, name, date, prize, status, notes, active_pattern_id, active_pattern_name,
          active_pattern_cells, auto_pause, started_at, created_at, updated_at
        ) VALUES (?, ?, ?, '', 'ready', '', 'linea-horizontal', 'Línea horizontal', ?, 1, NULL, ?, ?)`,
      )
      .bind(id, "Noche de Bingo", date, JSON.stringify([10, 11, 12, 13, 14]), createdAt, createdAt)
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

export async function GET() {
  try {
    const db = getDb();
    await ensureSchema(db);
    const gameRow = await getOrCreateGame(db);
    const game = mapGame(gameRow);
    const [cardRows, drawRows, winnerRows, patternRows, fileRows] = await Promise.all([
      db.prepare("SELECT * FROM cards WHERE game_id = ? ORDER BY created_at DESC").bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM draws WHERE game_id = ? ORDER BY drawn_at ASC").bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM winners WHERE game_id = ? ORDER BY validated_at DESC").bind(game.id).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM patterns ORDER BY created_at DESC").all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM files WHERE game_id = ? ORDER BY created_at DESC").bind(game.id).all<Record<string, unknown>>(),
    ]);

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
      files: (fileRows.results ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        size: Number(row.size),
        checksum: String(row.checksum),
        pages: Number(row.pages),
        cards: Number(row.cards),
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
    const actor = request.headers.get("oai-authenticated-user-email") || "Operador local";
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const gameId = body.gameId ? String(body.gameId) : null;

    if (action === "saveCards") {
      const cards = (body.cards ?? []) as BingoCard[];
      if (!gameId || !Array.isArray(cards) || !cards.length) {
        return Response.json({ error: "No hay cartones válidos para guardar." }, { status: 400 });
      }
      const existing = await db
        .prepare("SELECT number FROM cards WHERE game_id = ?")
        .bind(gameId)
        .all<{ number: string }>();
      const numbers = new Set((existing.results ?? []).map((row) => row.number));
      const accepted = cards.filter((card) => !numbers.has(card.number));
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
      await audit(db, gameId, "IMPORT_CARDS", `${accepted.length} guardados; ${duplicates} duplicados`, actor);
      return Response.json({ accepted: accepted.length, duplicates });
    }

    if (action === "saveDraw") {
      const number = Number(body.number);
      if (!gameId || !Number.isInteger(number) || number < 1 || number > 90) {
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
           active_pattern_cells = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(pattern.id, pattern.name, JSON.stringify(pattern.cells), changedAt, gameId)
        .run();
      await audit(db, gameId, "SET_PATTERN", pattern.name, actor);
      return Response.json({ ok: true });
    }

    if (action === "savePattern") {
      const pattern = body.pattern as BingoPattern;
      if (!pattern?.id || !pattern.name || !Array.isArray(pattern.cells) || !pattern.cells.length) {
        return Response.json({ error: "Completa el nombre y selecciona casillas." }, { status: 400 });
      }
      await db
        .prepare(
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
        )
        .run();
      await audit(db, gameId, "CREATE_PATTERN", pattern.name, actor);
      return Response.json({ ok: true });
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
            id, name, date, prize, status, notes, active_pattern_id, active_pattern_name,
            active_pattern_cells, auto_pause, started_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'ready', '', 'linea-horizontal', 'Línea horizontal', ?, 1, NULL, ?, ?)`,
        )
        .bind(id, name, date, prize, JSON.stringify([10, 11, 12, 13, 14]), createdAt, createdAt)
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
