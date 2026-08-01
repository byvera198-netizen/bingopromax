export type CardStatus = "active" | "void";
export type GameStatus = "ready" | "running" | "paused" | "finished";

export interface BingoCard {
  id: string;
  gameId?: string;
  number: string;
  serial?: string;
  grid: number[];
  sourceFile: string;
  sourcePage: number;
  status: CardStatus;
  createdAt?: string;
}

export interface BingoPattern {
  id: string;
  name: string;
  description: string;
  color: string;
  category: string;
  difficulty: string;
  cells: number[];
  variants: number[][];
  custom?: boolean;
}

export interface Draw {
  id: string;
  number: number;
  drawnAt: string;
}

export interface Winner {
  id: string;
  cardId: string;
  cardNumber: string;
  patternId: string;
  patternName: string;
  validatedAt: string;
}

export interface Game {
  id: string;
  name: string;
  date: string;
  prize: string;
  status: GameStatus;
  notes: string;
  activePatternId: string;
  activePatternName: string;
  activePatternCells: number[];
  autoPause: boolean;
  startedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportedFile {
  id: string;
  name: string;
  size: number;
  checksum: string;
  pages: number;
  cards: number;
  createdAt: string;
}

export interface Membership {
  id: string;
  email: string;
  name: string;
  plan: "six-months" | "annual" | "custom";
  months: number;
  accessCode?: string;
  activationVerified: boolean;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: string;
  approvedAt?: string | null;
  expiresAt?: string | null;
  deviceBound: boolean;
}

export interface AccessState {
  allowed: boolean;
  role: "admin" | "member" | "pending" | "anonymous";
  email: string;
  reason?: string;
  membership?: Membership | null;
  isPrimaryAdmin?: boolean;
}

export interface AdminAccount {
  email: string;
  addedBy: string;
  createdAt: string;
}

export interface AppState {
  game: Game;
  cards: BingoCard[];
  draws: Draw[];
  winners: Winner[];
  customPatterns: BingoPattern[];
  disabledPatternIds: string[];
  removedPatternIds: string[];
  files: ImportedFile[];
  access: AccessState;
  memberships?: Membership[];
  admins?: AdminAccount[];
}

const range = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index);
const rows = range(0, 4).map((row) => range(row * 5, row * 5 + 4));
const frame = range(0, 24).filter((cell) => {
  const row = Math.floor(cell / 5);
  const column = cell % 5;
  return row === 0 || row === 4 || column === 0 || column === 4;
});

const glyphs: Record<string, string[]> = {
  A: ["01110", "10001", "11111", "10001", "10001"],
  B: ["11110", "10001", "11110", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "11110", "10000", "11111"],
  F: ["11111", "10000", "11110", "10000", "10000"],
  G: ["01111", "10000", "10111", "10001", "01111"],
  H: ["10001", "10001", "11111", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "11100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001"],
  O: ["01110", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "11110", "10000", "10000"],
  Q: ["01110", "10001", "10101", "10011", "01111"],
  R: ["11110", "10001", "11110", "10010", "10001"],
  S: ["01111", "10000", "01110", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10101", "11011", "10001"],
  X: ["10001", "01010", "00100", "01010", "10001"],
  Y: ["10001", "01010", "00100", "00100", "00100"],
  Z: ["11111", "00010", "00100", "01000", "11111"],
  "1": ["00100", "01100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00010", "00100", "11111"],
  "3": ["11110", "00001", "01110", "00001", "11110"],
  "4": ["10010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "11110"],
  "6": ["01111", "10000", "11110", "10001", "01110"],
  "7": ["11111", "00010", "00100", "01000", "01000"],
  "8": ["01110", "10001", "01110", "10001", "01110"],
  "9": ["01110", "10001", "01111", "00001", "11110"],
  "10": ["10111", "10101", "10101", "10101", "10111"],
};

const cellsFromGlyph = (glyph: string[]) =>
  glyph.flatMap((row, rowIndex) =>
    [...row].flatMap((value, columnIndex) =>
      value === "1" ? [rowIndex * 5 + columnIndex] : [],
    ),
  );

interface PatternPreset {
  id: string;
  name: string;
  description: string;
  color: string;
  difficulty: string;
  glyph?: keyof typeof glyphs;
  cells?: number[];
}

const patternPresets: PatternPreset[] = [
  { id: "patron-e", name: "Letra E", description: "Figura con forma de E", color: "#d6a6ff", difficulty: "Alta", glyph: "E" },
  { id: "patron-d", name: "Letra D", description: "Figura con forma de D", color: "#79b8ff", difficulty: "Alta", glyph: "D" },
  { id: "patron-c", name: "Letra C", description: "Figura con forma de C", color: "#ffc857", difficulty: "Alta", glyph: "C" },
  { id: "patron-b", name: "Letra B", description: "Figura con forma de B", color: "#77e8c9", difficulty: "Media", glyph: "B" },
  { id: "patron-a", name: "Letra A", description: "Figura con forma de A", color: "#d7ff3f", difficulty: "Alta", glyph: "A" },
  { id: "patron-10", name: "Número 10", description: "Figura con forma de 10", color: "#d6a6ff", difficulty: "Alta", glyph: "10" },
  { id: "patron-9", name: "Número 9", description: "Figura con forma de 9", color: "#79b8ff", difficulty: "Alta", glyph: "9" },
  { id: "patron-8", name: "Número 8", description: "Figura con forma de 8", color: "#ffc857", difficulty: "Media", glyph: "8" },
  { id: "patron-4", name: "Número 4", description: "Figura con forma de 4", color: "#79b8ff", difficulty: "Media", glyph: "4" },
  { id: "patron-3", name: "Número 3", description: "Figura con forma de 3", color: "#ffc857", difficulty: "Alta", glyph: "3" },
  { id: "patron-2", name: "Número 2", description: "Figura con forma de 2", color: "#77e8c9", difficulty: "Alta", glyph: "2" },
  { id: "patron-1", name: "Número 1", description: "Número 1", color: "#d7ff3f", difficulty: "Media", glyph: "1" },
  { id: "letra-h", name: "Letra H", description: "Columnas laterales y fila central.", color: "#77e8c9", difficulty: "Media", glyph: "H" },
  { id: "letra-t", name: "Letra T", description: "Fila superior y columna central.", color: "#a6c8ff", difficulty: "Media", glyph: "T" },
  { id: "letra-x", name: "Letra X", description: "Las dos diagonales forman una X.", color: "#ff7f96", difficulty: "Media", glyph: "X" },
  { id: "patron-x", name: "X", description: "Letra X", color: "#d6a6ff", difficulty: "Media", glyph: "X" },
  { id: "patron-w", name: "Letra W", description: "Figura con forma de W", color: "#d7ff3f", difficulty: "Media", glyph: "W" },
  { id: "patron-v", name: "Letra V", description: "Figura con forma de V", color: "#d6a6ff", difficulty: "Media", glyph: "V" },
  { id: "patron-u", name: "Letra U", description: "Figura con forma de U", color: "#79b8ff", difficulty: "Media", glyph: "U" },
  { id: "patron-s", name: "Letra S", description: "Figura con forma de S", color: "#ffc857", difficulty: "Media", glyph: "S" },
  { id: "patron-r", name: "Letra R", description: "Figura con forma de R", color: "#77e8c9", difficulty: "Alta", glyph: "R" },
  { id: "patron-q", name: "Letra Q", description: "Figura con forma de Q", color: "#d7ff3f", difficulty: "Alta", glyph: "Q" },
  { id: "patron-p", name: "Letra P", description: "Figura con forma de P", color: "#d6a6ff", difficulty: "Alta", glyph: "P" },
  { id: "patron-o", name: "Letra O", description: "Figura con forma de O", color: "#79b8ff", difficulty: "Media", glyph: "O" },
  { id: "patron-n", name: "Letra N", description: "Figura con forma de N", color: "#ffc857", difficulty: "Media", glyph: "N" },
  { id: "patron-m", name: "Letra M", description: "Figura con forma de M", color: "#77e8c9", difficulty: "Media", glyph: "M" },
  { id: "patron-l", name: "Letra L", description: "Figura con forma de L", color: "#d7ff3f", difficulty: "Media", glyph: "L" },
  { id: "patron-k", name: "Letra K", description: "Figura con forma de K", color: "#d6a6ff", difficulty: "Media", glyph: "K" },
  { id: "patron-j", name: "Letra J", description: "Figura con forma de J", color: "#79b8ff", difficulty: "Media", glyph: "J" },
  { id: "patron-i", name: "Letra I", description: "Figura con forma de I", color: "#ffc857", difficulty: "Media", glyph: "I" },
  { id: "patron-g", name: "Letra G", description: "Figura con forma de G", color: "#77e8c9", difficulty: "Alta", glyph: "G" },
  { id: "patron-f", name: "Letra F", description: "Figura con forma de F", color: "#d7ff3f", difficulty: "Media", glyph: "F" },
  { id: "marco", name: "Letra O", description: "Letra O", color: "#ffc857", difficulty: "Alta", cells: frame },
  { id: "blackout", name: "Tabla llena", description: "Tabla llena", color: "#ff8f70", difficulty: "Alta", cells: range(0, 24) },
  { id: "patron-z", name: "Letra Z", description: "Figura con forma de Z", color: "#ffc857", difficulty: "Media", glyph: "Z" },
  { id: "patron-y", name: "Letra Y", description: "Figura con forma de Y", color: "#77e8c9", difficulty: "Fácil", glyph: "Y" },
];

export const BUILTIN_PATTERNS: BingoPattern[] = patternPresets.map((preset) => {
  const cells = preset.cells ?? cellsFromGlyph(glyphs[preset.glyph!]);
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    color: preset.color,
    category: "Personalizado",
    difficulty: preset.difficulty,
    cells,
    variants: [cells],
  };
});

export const COMPACT_CARD_PATTERN: BingoPattern = {
  id: "sabrosito-completo",
  name: "Sabrosito completo",
  description: "Los cinco números del cartón Sabrosito.",
  color: "#d7ff3f",
  category: "Especial",
  difficulty: "Media",
  cells: [0, 1, 2, 3, 4],
  variants: [[0, 1, 2, 3, 4]],
};

export function patternForCard(card: BingoCard, activePattern: BingoPattern) {
  return card.grid.length === 5 ? COMPACT_CARD_PATTERN : activePattern;
}

export function patternsForCard(
  card: BingoCard,
  activePatterns: BingoPattern[],
) {
  return card.grid.length === 5
    ? activePatterns.filter((pattern) => pattern.id === COMPACT_CARD_PATTERN.id)
    : activePatterns.filter((pattern) => pattern.id !== COMPACT_CARD_PATTERN.id);
}

export function getActivePattern(game: Game, customPatterns: BingoPattern[]) {
  const found = [...BUILTIN_PATTERNS, ...customPatterns].find(
    (pattern) => pattern.id === game.activePatternId,
  );
  if (found) return found;
  const cells = game.activePatternCells.length ? game.activePatternCells : rows[2];
  return {
    id: game.activePatternId,
    name: game.activePatternName,
    description: "Patrón guardado para esta partida.",
    color: "#d7ff3f",
    category: "Personalizado",
    difficulty: "Media",
    cells,
    variants: [cells],
    custom: true,
  } satisfies BingoPattern;
}

export function cardProgress(card: BingoCard, called: Set<number>, pattern: BingoPattern) {
  const cardPattern = patternForCard(card, pattern);
  const results = cardPattern.variants.map((variant) => {
    const required = variant.filter((cell) => card.grid[cell] !== 0);
    const completed = required.filter((cell) => called.has(card.grid[cell])).length;
    return {
      completed,
      total: required.length,
      progress: required.length ? completed / required.length : 0,
    };
  });
  return results.sort((a, b) => b.progress - a.progress)[0] ?? {
    completed: 0,
    total: 0,
    progress: 0,
  };
}

export function isWinningCard(card: BingoCard, called: Set<number>, pattern: BingoPattern) {
  if (card.status !== "active") return false;
  const cardPattern = patternForCard(card, pattern);
  return cardPattern.variants.some((variant) =>
    variant.every((cell) => card.grid[cell] === 0 || called.has(card.grid[cell])),
  );
}

export function winningPatternsForCard(
  card: BingoCard,
  called: Set<number>,
  activePatterns: BingoPattern[],
  alreadyWonPatternIds = new Set<string>(),
) {
  return patternsForCard(card, activePatterns).filter(
    (pattern) =>
      !alreadyWonPatternIds.has(pattern.id) &&
      isWinningCard(card, called, pattern),
  );
}

export function validateCardGrid(grid: number[]) {
  const errors: string[] = [];
  if (grid.length !== 25) errors.push("La cuadrícula debe tener 25 casillas.");
  const nonFree = grid.filter((number) => number !== 0);
  if (nonFree.some((number) => !Number.isInteger(number) || number < 1 || number > 75)) {
    errors.push("Los números deben estar entre 1 y 75.");
  }
  if (new Set(nonFree).size !== nonFree.length) errors.push("El cartón contiene números repetidos.");
  const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
  if (grid.length === 25 && grid.some((number, index) => number !== 0 && (number < ranges[index % 5][0] || number > ranges[index % 5][1]))) {
    errors.push("Las columnas deben respetar los rangos B, I, N, G y O.");
  }
  return errors;
}

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
