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
const columns = range(0, 4).map((column) => range(0, 4).map((row) => row * 5 + column));
const mainDiagonal = [0, 6, 12, 18, 24];
const secondaryDiagonal = [4, 8, 12, 16, 20];
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

const alphanumericPatterns: BingoPattern[] = Object.entries(glyphs)
  .filter(([name]) => !["H", "T", "X"].includes(name))
  .map(([name, glyph], index) => {
    const cells = cellsFromGlyph(glyph);
    const letter = /^[A-Z]$/.test(name);
    return {
      id: `patron-${name.toLowerCase()}`,
      name: letter ? `Letra ${name}` : `Número ${name}`,
      description: `Figura con forma de ${name} en la cuadrícula 5×5.`,
      color: ["#d7ff3f", "#77e8c9", "#ffc857", "#79b8ff", "#d6a6ff"][index % 5],
      category: letter ? "Letras" : "Números",
      difficulty: cells.length >= 15 ? "Máxima" : cells.length >= 11 ? "Alta" : "Media",
      cells,
      variants: [cells],
    };
  });

export const BUILTIN_PATTERNS: BingoPattern[] = [
  {
    id: "linea-horizontal",
    name: "Línea horizontal",
    description: "Cualquier fila completa del cartón.",
    color: "#d7ff3f",
    category: "Líneas",
    difficulty: "Fácil",
    cells: rows[2],
    variants: rows,
  },
  {
    id: "linea-vertical",
    name: "Línea vertical",
    description: "Cualquier columna completa del cartón.",
    color: "#77e8c9",
    category: "Líneas",
    difficulty: "Fácil",
    cells: columns[2],
    variants: columns,
  },
  {
    id: "diagonal-principal",
    name: "Diagonal principal",
    description: "De la esquina superior izquierda a la inferior derecha.",
    color: "#ffc857",
    category: "Diagonales",
    difficulty: "Media",
    cells: mainDiagonal,
    variants: [mainDiagonal],
  },
  {
    id: "diagonal-secundaria",
    name: "Diagonal secundaria",
    description: "De la esquina superior derecha a la inferior izquierda.",
    color: "#ff8f70",
    category: "Diagonales",
    difficulty: "Media",
    cells: secondaryDiagonal,
    variants: [secondaryDiagonal],
  },
  {
    id: "dos-diagonales",
    name: "Dos diagonales",
    description: "Las dos diagonales completas.",
    color: "#d6a6ff",
    category: "Figuras",
    difficulty: "Alta",
    cells: [...new Set([...mainDiagonal, ...secondaryDiagonal])],
    variants: [[...new Set([...mainDiagonal, ...secondaryDiagonal])]],
  },
  {
    id: "cuatro-esquinas",
    name: "Cuatro esquinas",
    description: "Las cuatro esquinas del cartón.",
    color: "#79b8ff",
    category: "Figuras",
    difficulty: "Fácil",
    cells: [0, 4, 20, 24],
    variants: [[0, 4, 20, 24]],
  },
  {
    id: "marco",
    name: "Marco",
    description: "Todo el borde exterior.",
    color: "#ffc857",
    category: "Figuras",
    difficulty: "Alta",
    cells: frame,
    variants: [frame],
  },
  {
    id: "letra-x",
    name: "Letra X",
    description: "Las dos diagonales forman una X.",
    color: "#ff7f96",
    category: "Letras",
    difficulty: "Alta",
    cells: [...new Set([...mainDiagonal, ...secondaryDiagonal])],
    variants: [[...new Set([...mainDiagonal, ...secondaryDiagonal])]],
  },
  {
    id: "letra-t",
    name: "Letra T",
    description: "Fila superior y columna central.",
    color: "#a6c8ff",
    category: "Letras",
    difficulty: "Alta",
    cells: [...new Set([...rows[0], ...columns[2]])],
    variants: [[...new Set([...rows[0], ...columns[2]])]],
  },
  {
    id: "letra-h",
    name: "Letra H",
    description: "Columnas laterales y fila central.",
    color: "#77e8c9",
    category: "Letras",
    difficulty: "Alta",
    cells: [...new Set([...columns[0], ...columns[4], ...rows[2]])],
    variants: [[...new Set([...columns[0], ...columns[4], ...rows[2]])]],
  },
  {
    id: "diamante",
    name: "Diamante",
    description: "Silueta de diamante alrededor del centro.",
    color: "#62d5ff",
    category: "Figuras",
    difficulty: "Media",
    cells: [2, 6, 8, 10, 14, 16, 18, 22],
    variants: [[2, 6, 8, 10, 14, 16, 18, 22]],
  },
  {
    id: "cruz",
    name: "Cruz",
    description: "Fila y columna centrales.",
    color: "#d7ff3f",
    category: "Figuras",
    difficulty: "Media",
    cells: [...new Set([...rows[2], ...columns[2]])],
    variants: [[...new Set([...rows[2], ...columns[2]])]],
  },
  {
    id: "piramide",
    name: "Pirámide",
    description: "Figura escalonada con base completa.",
    color: "#ffc857",
    category: "Figuras",
    difficulty: "Alta",
    cells: [2, 6, 8, 10, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
    variants: [[2, 6, 8, 10, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]],
  },
  ...alphanumericPatterns,
  {
    id: "blackout",
    name: "Tabla llena",
    description: "Todos los números de la tabla.",
    color: "#ff8f70",
    category: "Especial",
    difficulty: "Máxima",
    cells: range(0, 24),
    variants: [range(0, 24)],
  },
];

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
  if (nonFree.some((number) => !Number.isInteger(number) || number < 1 || number > 90)) {
    errors.push("Los números deben estar entre 1 y 90.");
  }
  if (new Set(nonFree).size !== nonFree.length) errors.push("El cartón contiene números repetidos.");
  return errors;
}

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
