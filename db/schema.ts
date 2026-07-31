import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  date: text("date").notNull(),
  prize: text("prize").notNull().default(""),
  status: text("status").notNull().default("ready"),
  notes: text("notes").notNull().default(""),
  activePatternId: text("active_pattern_id").notNull().default("linea-horizontal"),
  activePatternName: text("active_pattern_name").notNull().default("Línea horizontal"),
  activePatternCells: text("active_pattern_cells").notNull().default("[]"),
  autoPause: integer("auto_pause", { mode: "boolean" }).notNull().default(true),
  startedAt: text("started_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id").notNull(),
    number: text("number").notNull(),
    serial: text("serial").notNull().default(""),
    gridJson: text("grid_json").notNull(),
    sourceFile: text("source_file").notNull().default("Manual"),
    sourcePage: integer("source_page").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("cards_game_number_unique").on(table.gameId, table.number)],
);

export const draws = sqliteTable(
  "draws",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id").notNull(),
    number: integer("number").notNull(),
    drawnAt: text("drawn_at").notNull(),
  },
  (table) => [uniqueIndex("draws_game_number_unique").on(table.gameId, table.number)],
);

export const patterns = sqliteTable("patterns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("#d7ff3f"),
  category: text("category").notNull().default("Personalizado"),
  difficulty: text("difficulty").notNull().default("Media"),
  cellsJson: text("cells_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const gamePatterns = sqliteTable(
  "game_patterns",
  {
    gameId: text("game_id").notNull(),
    patternId: text("pattern_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    custom: integer("custom", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("game_patterns_game_pattern_unique").on(
      table.gameId,
      table.patternId,
    ),
  ],
);

export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  plan: text("plan").notNull(),
  months: integer("membership_months").notNull().default(1),
  accessCode: text("access_code"),
  activationVerified: integer("activation_verified", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("pending"),
  deviceId: text("device_id"),
  requestedAt: text("requested_at").notNull(),
  approvedAt: text("approved_at"),
  expiresAt: text("expires_at"),
});

export const winners = sqliteTable(
  "winners",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id").notNull(),
    cardId: text("card_id").notNull(),
    cardNumber: text("card_number").notNull(),
    patternId: text("pattern_id").notNull(),
    patternName: text("pattern_name").notNull(),
    validatedAt: text("validated_at").notNull(),
  },
  (table) => [uniqueIndex("winners_game_card_pattern_unique").on(table.gameId, table.cardId, table.patternId)],
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id").notNull(),
    name: text("name").notNull(),
    storageKey: text("storage_key").notNull(),
    size: integer("size").notNull(),
    checksum: text("checksum").notNull(),
    pages: integer("pages").notNull().default(0),
    cards: integer("cards").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("files_game_checksum_unique").on(table.gameId, table.checksum)],
);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  gameId: text("game_id"),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  actor: text("actor").notNull().default("Operador local"),
  createdAt: text("created_at").notNull(),
});
