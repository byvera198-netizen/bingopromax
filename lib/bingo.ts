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
  auditLogs?: ImportAuditEntry[];
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
  C: ["11111", "10000", "10000", "10000", "11111"],
  D: ["11110", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "11111", "10000", "11111"],
  F: ["11111", "10000", "11110", "10000", "10000"],
  G: ["01111", "10000", "10111", "10001", "01111"],
  H: ["10001", "10001", "11111", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "11111"],
  J: ["11111", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "11100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001"],
  O: ["01110", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "11110", "10000", "10000"],
  Q: ["01110", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "11110", "10100", "10001"],
  S: ["11111", "10000", "11111", "00001", "11111"],
  T: ["11111", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10101", "10101", "10001"],
  X: ["10001", "01010", "00100", "01010", "10001"],
  Y: ["10001", "01010", "00100", "00100", "00100"],
  Z: ["11111", "00010", "00100", "01000", "11111"],
  "1": ["00100", "01100", "00100", "00100", "11111"],
  "2": ["11111", "00001", "11111", "10000", "11111"],
  "3": ["11111", "00001", "11111", "00001", "11111"],
  "4": ["10010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "11110"],
  "6": ["01111", "10000", "11110", "10001", "01110"],
  "7": ["11111", "00010", "00100", "01000", "01000"],
  "8": ["01110", "10001", "01110", "10001", "01110"],
  "9": ["11111", "10001", "11111", "00001", "11111"],
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
  { id: "patron-b", name: "Letra B", description: "Figura con forma de B", color: "#77e8c9", difficulty: "Alta", glyph: "B" },
  { id: "patron-a", name: "Letra A", description: "Figura con forma de A", color: "#d7ff3f", difficulty: "Alta", glyph: "A" },
  { id: "patron-10", name: "Número 10", description: "Figura con forma de 10", color: "#d6a6ff", difficulty: "Alta", glyph: "10" },
  { id: "patron-9", name: "Número 9", description: "Figura con forma de 9", color: "#79b8ff", difficulty: "Alta", glyph: "9" },
  { id: "patron-8", name: "Número 8", description: "Figura con forma de 8", color: "#ffc857", difficulty: "Alta", glyph: "8" },
  { id: "patron-4", name: "Número 4", description: "Figura con forma de 4", color: "#79b8ff", difficulty: "Media", glyph: "4" },
  { id: "patron-3", name: "Número 3", description: "Figura con forma de 3", color: "#ffc857", difficulty: "Alta", glyph: "3" },
  { id: "patron-2", name: "Número 2", description: "Figura con forma de 2", color: "#77e8c9", difficulty: "Alta", glyph: "2" },
  { id: "patron-1", name: "Número 1", description: "Número 1", color: "#d7ff3f", difficulty: "Media", glyph: "1" },
  { id: "letra-h", name: "Letra H", description: "Columnas laterales y fila central.", color: "#77e8c9", difficulty: "Media", glyph: "H" },
  { id: "letra-t", name: "Letra T", description: "Fila superior y columna central.", color: "#a6c8ff", difficulty: "Media", glyph: "T" },
  { id: "letra-x", name: "Letra X", description: "Las dos diagonales forman una X.", color: "#ff7f96", difficulty: "Media", glyph: "X" },
  { id: "diagonal-x", name: "X", description: "Diagonal principal y secundaria.", color: "#ff7f96", difficulty: "Fácil", glyph: "X" },
  { id: "patron-w", name: "Letra W", description: "Figura con forma de W", color: "#d7ff3f", difficulty: "Alta", glyph: "W" },
  { id: "patron-v", name: "Letra V", description: "Figura con forma de V", color: "#d6a6ff", difficulty: "Media", glyph: "V" },
  { id: "patron-u", name: "Letra U", description: "Figura con forma de U", color: "#79b8ff", difficulty: "Alta", glyph: "U" },
  { id: "patron-s", name: "Letra S", description: "Figura con forma de S", color: "#ffc857", difficulty: "Alta", glyph: "S" },
  { id: "patron-r", name: "Letra R", description: "Figura con forma de R", color: "#77e8c9", difficulty: "Alta", glyph: "R" },
  { id: "patron-q", name: "Letra Q", description: "Figura con forma de Q", color: "#d7ff3f", difficulty: "Alta", glyph: "Q" },
  { id: "patron-p", name: "Letra P", description: "Figura con forma de P", color: "#d6a6ff", difficulty: "Alta", glyph: "P" },
  { id: "patron-o", name: "Letra O", description: "Figura con forma de O", color: "#79b8ff", difficulty: "Media", glyph: "O" },
  { id: "patron-n", name: "Letra N", description: "Figura con forma de N", color: "#ffc857", difficulty: "Media", glyph: "N" },
  { id: "patron-m", name: "Letra M", description: "Figura con forma de M", color: "#77e8c9", difficulty: "Alta", glyph: "M" },
  { id: "patron-l", name: "Letra L", description: "Figura con forma de L", color: "#d7ff3f", difficulty: "Media", glyph: "L" },
  { id: "patron-k", name: "Letra K", description: "Figura con forma de K", color: "#d6a6ff", difficulty: "Media", glyph: "K" },
  { id: "patron-j", name: "Letra J", description: "Figura con forma de J", color: "#79b8ff", difficulty: "Media", glyph: "J" },
  { id: "patron-i", name: "Letra I", description: "Figura con forma de I", color: "#ffc857", difficulty: "Media", glyph: "I" },
  { id: "patron-g", name: "Letra G", description: "Figura con forma de G", color: "#77e8c9", difficulty: "Alta", glyph: "G" },
  { id: "patron-f", name: "Letra F", description: "Figura con forma de F", color: "#d7ff3f", difficulty: "Alta", glyph: "F" },
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

export function referenceCatalogPatterns(
  customPatterns: BingoPattern[],
  removedPatternIds: string[],
) {
  const removed = new Set(removedPatternIds);
  const usedCustomIds = new Set<string>();
  const normalizeName = (value: string) =>
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

  const patterns = BUILTIN_PATTERNS.flatMap((reference) => {
    if (!removed.has(reference.id)) return [reference];

    const replacement = customPatterns.find(
      (pattern) =>
        !usedCustomIds.has(pattern.id) &&
        (pattern.id.startsWith(`custom-${reference.id}-`) ||
          normalizeName(pattern.name) === normalizeName(reference.name)),
    );

    if (!replacement) return [];
    usedCustomIds.add(replacement.id);
    return [replacement];
  });

  return patterns;
}

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

export type NumberSheetForm = "1" | "3" | "5" | "9";

const normalizeGameName = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

export const NUMBER_SHEET_FORM_CELLS: Record<NumberSheetForm, number[]> = {
  "1": [2, 6, 7, 10, 17, 20, 21, 22, 23, 24],
  "3": [0, 1, 2, 3, 4, 9, 10, 11, 13, 14, 19, 20, 21, 22, 23, 24],
  "5": [0, 1, 2, 3, 4, 5, 10, 11, 13, 14, 19, 20, 21, 22, 23, 24],
  "9": [0, 1, 2, 3, 4, 5, 9, 10, 11, 13, 14, 19, 20, 21, 22, 23, 24],
};

export const NUMBER_SHEET_PATTERNS: Record<NumberSheetForm, BingoPattern> =
  Object.fromEntries(
    (Object.entries(NUMBER_SHEET_FORM_CELLS) as Array<[NumberSheetForm, number[]]>).map(
      ([form, cells]) => [
        form,
        {
          id: `forma-${form}-completa`,
          name: `Forma #${form} completa`,
          description: `Todos los números impresos de la Forma #${form}.`,
          color: "#d7ff3f",
          category: "Hoja de números",
          difficulty: "Especial",
          cells,
          variants: [cells],
        } satisfies BingoPattern,
      ],
    ),
  ) as Record<NumberSheetForm, BingoPattern>;

export function numberSheetFormForGrid(grid: number[]): NumberSheetForm | null {
  if (grid.length !== 25) return null;
  const filled = grid
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value > 0)
    .map(({ index }) => index);
  return (
    (Object.entries(NUMBER_SHEET_FORM_CELLS) as Array<[NumberSheetForm, number[]]>).find(
      ([, cells]) =>
        cells.length === filled.length &&
        cells.every((cell, index) => cell === filled[index]),
    )?.[0] ?? null
  );
}

export function specialCardPatternForGrid(grid: number[], serial = "") {
  if (grid.length === 5) return COMPACT_CARD_PATTERN;
  if (grid.length >= 6 && grid.length < 25) {
    const cells = range(0, grid.length - 1);
    const metadata: Record<number, { id: string; name: string; variants?: number[][] }> = {
      6: { id: "keke-keke-completo", name: "Keke Keke completo" },
      7: { id: "leche-completo", name: "Eche Leche completo" },
      8: { id: "bom-bom-completo", name: "Bom Bom Bum completo" },
      9: { id: "yapa-completo", name: "Yapa completo" },
      10: { id: "loco-completo", name: "Loco completo" },
      16: {
        id: "linea-completa",
        name: "Línea completa",
        variants: [
          [2, 3, 4, 5, 6],
          [9, 10, 11, 12, 13],
          [0, 3, 7, 10, 14],
          [1, 5, 8, 12, 15],
        ],
      },
    };
    const normalizedSerial = normalizeGameName(serial);
    const serialPattern = normalizedSerial.includes("linea") && grid.length === 16
      ? metadata[16]
      : normalizedSerial.includes("loco") && grid.length === 10
        ? metadata[10]
        : null;
    const requiresNamedGame = grid.length === 10 || grid.length === 16;
    const special = serialPattern ?? (
      requiresNamedGame && normalizedSerial
        ? null
        : metadata[grid.length]
    ) ?? {
      id: `carton-especial-${grid.length}`,
      name: "Cartón especial completo",
    };
    return {
      id: special.id,
      name: special.name,
      description: special.id === "yapa-completo"
        ? "Los nueve números de la cuadrícula 3×3 del juego Yapa."
        : special.id === "linea-completa"
        ? "Cinco números en cualquiera de las líneas impresas del juego Línea."
        : special.id === "loco-completo"
          ? "Los diez números impresos del juego Loco."
          : "Todos los números impresos del cartón especial.",
      color: "#d7ff3f",
      category: "Especial",
      difficulty: "Especial",
      cells,
      variants: special.variants ?? [cells],
    } satisfies BingoPattern;
  }
  const form = numberSheetFormForGrid(grid);
  return form ? NUMBER_SHEET_PATTERNS[form] : null;
}

export function patternForCard(card: BingoCard, activePattern: BingoPattern) {
  return specialCardPatternForGrid(card.grid, card.serial) ?? activePattern;
}

export function patternsForCard(
  card: BingoCard,
  activePatterns: BingoPattern[],
) {
  const specialPattern = specialCardPatternForGrid(card.grid, card.serial);
  return specialPattern
    ? [specialPattern]
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

export interface ImportAuditEntry {
  id: string;
  gameId?: string;
  timestamp: string;
  file: string;
  page?: number;
  cardIdentifier?: string;
  type: "error" | "warning" | "duplicate" | "info";
  reason: string;
  gridSnippet?: number[];
}

export function validateCardGrid(grid: number[]) {
  const errors: string[] = [];
  const isSpecialCard = grid.length >= 5 && grid.length < 25;
  if (grid.length !== 25 && !isSpecialCard) {
    errors.push("La cuadrícula debe tener 25 casillas o corresponder a un cartón especial.");
  }
  const nonFree = grid.filter((number) => number !== 0);
  if (nonFree.some((number) => !Number.isInteger(number) || number < 1 || number > 75)) {
    const invalidValues = nonFree.filter((n) => !Number.isInteger(n) || n < 1 || n > 75);
    errors.push(`Los números deben estar entre 1 y 75 (valores inválidos: ${invalidValues.join(", ")}).`);
  }
  if (new Set(nonFree).size !== nonFree.length) {
    const counts = new Map<number, number>();
    nonFree.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
    const dupes = Array.from(counts.entries()).filter(([, c]) => c > 1).map(([n]) => n);
    errors.push(`El cartón contiene números repetidos (${dupes.join(", ")}).`);
  }
  const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
  const colLetters = ["B", "I", "N", "G", "O"];
  if (grid.length === 25) {
    const invalidCols: string[] = [];
    grid.forEach((number, index) => {
      if (number !== 0) {
        const colIdx = index % 5;
        const [minVal, maxVal] = ranges[colIdx];
        if (number < minVal || number > maxVal) {
          invalidCols.push(`Columna ${colLetters[colIdx]} (valor ${number} fuera de ${minVal}-${maxVal})`);
        }
      }
    });
    if (invalidCols.length > 0) {
      errors.push(`Inconsistencia en columnas BINGO: ${invalidCols.join("; ")}.`);
    }
  }
  return errors;
}

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export interface ShapePreset {
  id: string;
  name: string;
  category: "Líneas" | "Diagonales" | "Cuadros" | "Letras" | "Especiales";
  description: string;
  cells: number[];
  color: string;
}

export const SHAPE_PRESETS: ShapePreset[] = [
  { id: "row-1", name: "Fila 1 (Horizontal)", category: "Líneas", description: "B1, I1, N1, G1, O1", cells: [0, 1, 2, 3, 4], color: "#d7ff3f" },
  { id: "row-2", name: "Fila 2 (Horizontal)", category: "Líneas", description: "Fila 2 completa", cells: [5, 6, 7, 8, 9], color: "#d7ff3f" },
  { id: "row-3", name: "Fila 3 (Central)", category: "Líneas", description: "Fila 3 con casilla Libre", cells: [10, 11, 12, 13, 14], color: "#d7ff3f" },
  { id: "row-4", name: "Fila 4 (Horizontal)", category: "Líneas", description: "Fila 4 completa", cells: [15, 16, 17, 18, 19], color: "#d7ff3f" },
  { id: "row-5", name: "Fila 5 (Horizontal)", category: "Líneas", description: "Fila 5 completa inferior", cells: [20, 21, 22, 23, 24], color: "#d7ff3f" },

  { id: "col-b", name: "Columna B (Vertical)", category: "Líneas", description: "Columna B (1-15)", cells: [0, 5, 10, 15, 20], color: "#77e8c9" },
  { id: "col-i", name: "Columna I (Vertical)", category: "Líneas", description: "Columna I (16-30)", cells: [1, 6, 11, 16, 21], color: "#77e8c9" },
  { id: "col-n", name: "Columna N (Vertical)", category: "Líneas", description: "Columna N (31-45)", cells: [2, 7, 12, 17, 22], color: "#77e8c9" },
  { id: "col-g", name: "Columna G (Vertical)", category: "Líneas", description: "Columna G (46-60)", cells: [3, 8, 13, 18, 23], color: "#77e8c9" },
  { id: "col-o", name: "Columna O (Vertical)", category: "Líneas", description: "Columna O (61-75)", cells: [4, 9, 14, 19, 24], color: "#77e8c9" },

  { id: "diag-main", name: "Diagonal Principal (\\)", category: "Diagonales", description: "Esquina superior izquierda a inferior derecha", cells: [0, 6, 12, 18, 24], color: "#ffc857" },
  { id: "diag-inv", name: "Diagonal Invertida (/)", category: "Diagonales", description: "Esquina superior derecha a inferior izquierda", cells: [4, 8, 12, 16, 20], color: "#ffc857" },
  { id: "diag-x", name: "Diagonales en X", category: "Diagonales", description: "Ambas diagonales cruzadas por el centro", cells: [0, 4, 6, 8, 12, 16, 18, 20, 24], color: "#ff7f96" },

  { id: "frame-outer", name: "Marco Exterior (Cuadro Grande)", category: "Cuadros", description: "Las 16 casillas del borde exterior", cells: [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24], color: "#79b8ff" },
  { id: "box-inner", name: "Cuadro Interior (3x3)", category: "Cuadros", description: "Centro 3x3 alrededor de casilla Libre", cells: [6, 7, 8, 11, 12, 13, 16, 17, 18], color: "#d6a6ff" },
  { id: "four-corners", name: "Cuatro Esquinas", category: "Cuadros", description: "Las 4 casillas de las esquinas", cells: [0, 4, 20, 24], color: "#77e8c9" },
  { id: "small-center-box", name: "Cuadro Chico Centro", category: "Cuadros", description: "4 casillas adyacentes a la casilla Libre", cells: [7, 8, 12, 13], color: "#d7ff3f" },

  { id: "letter-l", name: "Letra L", category: "Letras", description: "Columna B y Fila 5", cells: [0, 5, 10, 15, 20, 21, 22, 23, 24], color: "#d7ff3f" },
  { id: "letter-t", name: "Letra T", category: "Letras", description: "Fila 1 superior y Columna N central", cells: [0, 1, 2, 3, 4, 7, 12, 17, 22], color: "#a6c8ff" },
  { id: "letter-h", name: "Letra H", category: "Letras", description: "Columnas B y O con Fila 3 central", cells: [0, 5, 10, 15, 20, 4, 9, 14, 19, 24, 11, 12, 13], color: "#77e8c9" },
  { id: "letter-c", name: "Letra C", category: "Letras", description: "Fila 1, Columna B y Fila 5", cells: [0, 1, 2, 3, 4, 5, 10, 15, 20, 21, 22, 23, 24], color: "#ffc857" },
  { id: "cross-plus", name: "Cruz (+)", category: "Letras", description: "Columna N y Fila 3 cruzadas", cells: [2, 7, 12, 17, 22, 10, 11, 13, 14], color: "#d6a6ff" },

  { id: "sabrosito", name: "Sabrosito", category: "Especiales", description: "Cuatro esquinas + casilla Libre central", cells: [0, 4, 12, 20, 24], color: "#ff7f96" },
  { id: "blackout-full", name: "Cartón Lleno (Tabla Llena)", category: "Especiales", description: "Las 25 casillas del cartón", cells: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24], color: "#ff8f70" },
];
