export type CardStatus = "active" | "void";
export type GameStatus = "ready" | "running" | "paused" | "finished";
export type CardType =
  | "classic-5x5"
  | "linea-5"
  | "loco-10"
  | "loco-11"
  | "yapa-3x3"
  | "sabrosito-5"
  | "eche-leche-7"
  | "bom-bom-8"
  | "keke-keke-6"
  | "avion-9"
  | "flecha-9"
  | "espada-7"
  | "pesa-7"
  | "rombo-8"
  | "bomba-8"
  | "custom";
export type CardReviewStatus = "ready" | "needs-review";

export interface CardCellPosition {
  row: number;
  column: number;
}

export interface CardLayout {
  type: CardType;
  name: string;
  rows: number;
  columns: number;
  cells: CardCellPosition[];
  cellShape?: "square" | "circle" | "diamond";
}

export interface BingoCard {
  id: string;
  gameId?: string;
  number: string;
  serial?: string;
  grid: number[];
  sourceFile: string;
  sourcePage: number;
  status: CardStatus;
  layout?: CardLayout;
  reviewStatus?: CardReviewStatus;
  reviewNotes?: string[];
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

export interface ImportedFile {
  id: string;
  name: string;
  size: number;
  checksum: string;
  pages: number;
  cards: number;
  createdAt: string;
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

export interface Membership {
  id: string;
  email: string;
  name: string;
  plan: "monthly" | "six-months" | "annual";
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: string;
  approvedAt?: string | null;
  expiresAt?: string | null;
  deviceBound: boolean;
  receiptNumber?: string;
  contactChannel?: "email" | "whatsapp";
  activationCode?: string | null;
  phone?: string;
}

export interface AccessState {
  allowed: boolean;
  role: "admin" | "member" | "pending" | "anonymous";
  email: string;
  reason?: string;
  membership?: Membership | null;
}

export interface AppState {
  game: Game;
  cards: BingoCard[];
  draws: Draw[];
  winners: Winner[];
  customPatterns: BingoPattern[];
  disabledPatternIds: string[];
  deletedPatternIds: string[];
  files: ImportedFile[];
  access: AccessState;
  memberships?: Membership[];
}

const cellsForRectangle = (rows: number, columns: number) =>
  Array.from({ length: rows * columns }, (_, index) => ({
    row: Math.floor(index / columns),
    column: index % columns,
  }));

const CARD_LAYOUTS: Record<Exclude<CardType, "custom">, CardLayout> = {
  "classic-5x5": {
    type: "classic-5x5",
    name: "Tradicional 5×5",
    rows: 5,
    columns: 5,
    cells: cellsForRectangle(5, 5),
  },
  "linea-5": {
    type: "linea-5",
    name: "Línea de 5 números",
    rows: 5,
    columns: 5,
    cells: [
      { row: 0, column: 1 }, { row: 0, column: 3 },
      { row: 1, column: 0 }, { row: 1, column: 1 }, { row: 1, column: 2 }, { row: 1, column: 3 }, { row: 1, column: 4 },
      { row: 2, column: 1 }, { row: 2, column: 3 },
      { row: 3, column: 0 }, { row: 3, column: 1 }, { row: 3, column: 2 }, { row: 3, column: 3 }, { row: 3, column: 4 },
      { row: 4, column: 1 }, { row: 4, column: 3 },
    ],
  },
  "loco-10": {
    type: "loco-10",
    name: "Llena el loco",
    rows: 4,
    columns: 5,
    cells: [
      { row: 0, column: 2 },
      { row: 1, column: 0 }, { row: 1, column: 1 }, { row: 1, column: 2 }, { row: 1, column: 3 }, { row: 1, column: 4 },
      { row: 2, column: 2 },
      { row: 3, column: 1 }, { row: 3, column: 2 }, { row: 3, column: 3 },
    ],
  },
  "loco-11": {
    type: "loco-11",
    name: "Llena el loco (11 números)",
    rows: 5,
    columns: 5,
    // The provider's Loco sheet has one top cell, a full second row,
    // one centre cell, one lower centre cell and three cells at the base.
    cells: [
      { row: 0, column: 2 },
      { row: 1, column: 0 }, { row: 1, column: 1 }, { row: 1, column: 2 }, { row: 1, column: 3 }, { row: 1, column: 4 },
      { row: 2, column: 2 },
      { row: 3, column: 2 },
      { row: 4, column: 2 }, { row: 4, column: 3 }, { row: 4, column: 4 },
    ],
  },
  "yapa-3x3": {
    type: "yapa-3x3",
    name: "Yapa 3×3",
    rows: 3,
    columns: 3,
    cells: cellsForRectangle(3, 3),
  },
  "sabrosito-5": {
    type: "sabrosito-5",
    name: "Sabrosito (5 números)",
    rows: 2,
    columns: 3,
    cells: [
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 0, column: 2 },
      { row: 1, column: 0 },
      { row: 1, column: 2 },
    ],
    cellShape: "circle",
  },
  "eche-leche-7": {
    type: "eche-leche-7",
    name: "Eche leche (7 números)",
    rows: 2,
    columns: 4,
    cells: [
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 0, column: 2 },
      { row: 0, column: 3 },
      { row: 1, column: 0 },
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ],
  },
  "bom-bom-8": {
    type: "bom-bom-8",
    name: "Bom bom bum (8 números)",
    rows: 2,
    columns: 4,
    cells: cellsForRectangle(2, 4),
    cellShape: "diamond",
  },
  "keke-keke-6": {
    type: "keke-keke-6",
    name: "Keke Keke (6 números)",
    rows: 3,
    columns: 2,
    cells: cellsForRectangle(3, 2),
    cellShape: "circle",
  },
  "avion-9": {
    type: "avion-9",
    name: "Avión",
    rows: 5,
    columns: 5,
    cells: [
      { row: 0, column: 2 },
      { row: 1, column: 0 }, { row: 1, column: 3 },
      { row: 2, column: 0 }, { row: 2, column: 1 }, { row: 2, column: 4 },
      { row: 3, column: 0 }, { row: 3, column: 3 },
      { row: 4, column: 2 },
    ],
  },
  "flecha-9": {
    type: "flecha-9",
    name: "Flecha",
    rows: 5,
    columns: 5,
    cells: [
      { row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 },
      { row: 1, column: 0 }, { row: 1, column: 1 },
      { row: 2, column: 0 }, { row: 2, column: 2 },
      { row: 3, column: 3 },
      { row: 4, column: 4 },
    ],
  },
  "espada-7": {
    type: "espada-7",
    name: "Espada",
    rows: 5,
    columns: 5,
    cells: [
      { row: 0, column: 0 },
      { row: 1, column: 1 },
      { row: 2, column: 2 }, { row: 2, column: 4 },
      { row: 3, column: 3 },
      { row: 4, column: 2 }, { row: 4, column: 4 },
    ],
  },
  "pesa-7": {
    type: "pesa-7",
    name: "Pesa",
    rows: 3,
    columns: 5,
    cells: [
      { row: 0, column: 1 }, { row: 0, column: 3 },
      { row: 1, column: 0 }, { row: 1, column: 2 }, { row: 1, column: 4 },
      { row: 2, column: 1 }, { row: 2, column: 3 },
    ],
  },
  "rombo-8": {
    type: "rombo-8",
    name: "Rombo",
    rows: 5,
    columns: 5,
    cells: [
      { row: 0, column: 2 },
      { row: 1, column: 1 }, { row: 1, column: 3 },
      { row: 2, column: 0 }, { row: 2, column: 4 },
      { row: 3, column: 1 }, { row: 3, column: 3 },
      { row: 4, column: 2 },
    ],
  },
  "bomba-8": {
    type: "bomba-8",
    name: "Bomba",
    rows: 5,
    columns: 5,
    cells: [
      { row: 0, column: 0 }, { row: 0, column: 4 },
      { row: 1, column: 2 },
      { row: 2, column: 1 }, { row: 2, column: 3 },
      { row: 3, column: 2 },
      { row: 4, column: 0 }, { row: 4, column: 4 },
    ],
  },
};

export function createCardLayout(
  type: CardType,
  rows?: number,
  columns?: number,
): CardLayout {
  if (type !== "custom") return structuredClone(CARD_LAYOUTS[type]);
  const safeRows = Math.max(1, Math.min(12, Math.round(rows || 1)));
  const safeColumns = Math.max(1, Math.min(12, Math.round(columns || 1)));
  return {
    type,
    name: "Formato personalizado",
    rows: safeRows,
    columns: safeColumns,
    cells: cellsForRectangle(safeRows, safeColumns),
  };
}

type CardLayoutMetadata = Pick<BingoCard, "grid" | "layout"> &
  Partial<Pick<BingoCard, "serial" | "sourceFile">>;

/**
 * The 05:58 client did not send a `layout` object when saving an imported
 * card.  It did, however, preserve the detected form in `serial` (for
 * example, "Avión" or "Loco").  D1 used to fall back only by cell count,
 * which made every 9-cell card a Yapa, every 8-cell card a Bom bom bum, etc.
 * Keep the traditional 5×5 path untouched and recover the explicit form for
 * additional cards from that metadata before applying the legacy count
 * fallback.
 */
function additionalLayoutFromMetadata(card: CardLayoutMetadata): CardLayout | null {
  // A complete 5×5 grid is always the traditional card.  Sparse 5×5 grids
  // are different: the old client represented additional forms as a 25-cell
  // array with zeroes in the unprinted positions.
  if (card.grid.length === 25 && card.grid.every((value) => value !== 0)) return null;
  const metadata = `${card.serial ?? ""} ${card.sourceFile ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const has = (...tokens: string[]) => tokens.some((token) => metadata.includes(token));

  const sparseGrid = card.grid.length === 25 && card.grid.some((value) => value === 0);
  const occupied = card.grid.filter((value) => value !== 0).length;
  const namedLayout = (type: Exclude<CardType, "custom">) => {
    const layout = createCardLayout(type);
    // The legacy importer stores compact games (Yapa, Eche Leche, Bom bom
    // and Keke Keke) in their original 5×5 positions with zeroes elsewhere.
    // Keep the form type but describe those positions on a 5×5 canvas so the
    // sparse grid can be validated and rendered correctly.
    return sparseGrid
      ? {
          ...layout,
          rows: 5,
          columns: 5,
          cells: card.grid
            .map((value, index) => (value === 0 ? null : { row: Math.floor(index / 5), column: index % 5 }))
            .filter((cell): cell is { row: number; column: number } => cell !== null),
        }
      : layout;
  };
  const matchesCellCount = (type: Exclude<CardType, "custom">) => {
    const expected = createCardLayout(type).cells.length;
    return sparseGrid ? occupied === expected : card.grid.length === expected;
  };
  if (has("avion", "avión") && matchesCellCount("avion-9")) return namedLayout("avion-9");
  if (has("flecha") && matchesCellCount("flecha-9")) return namedLayout("flecha-9");
  if (has("espada") && matchesCellCount("espada-7")) return namedLayout("espada-7");
  if (has("pesa") && matchesCellCount("pesa-7")) return namedLayout("pesa-7");
  if (has("rombo") && matchesCellCount("rombo-8")) return namedLayout("rombo-8");
  if (has("bomba") && matchesCellCount("bomba-8")) return namedLayout("bomba-8");
  const shape = additionalGamePatterns.find((pattern) => {
    const name = pattern.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return metadata.includes(name) || (name === "cruz adicional" && metadata.includes("cruz"));
  });
  if (shape && shape.cells.length === occupied) {
    return {
      type: "custom",
      name: shape.name,
      rows: 5,
      columns: 5,
      cells: shape.cells.map((index) => ({ row: Math.floor(index / 5), column: index % 5 })),
    };
  }
  // If a scan lost the printed title, the exact occupied cells are still a
  // reliable discriminator for the 5×5 sparse forms.
  if (sparseGrid) {
    const occupied = card.grid
      .map((value, index) => (value === 0 ? -1 : index))
      .filter((index) => index >= 0);
    const sameCells = (cells: CardCellPosition[]) =>
      cells.length === occupied.length &&
      cells.every((cell) => occupied.includes(cell.row * 5 + cell.column));
    const byShape = additionalGamePatterns.find((pattern) =>
      sameCells(pattern.cells.map((index) => ({ row: Math.floor(index / 5), column: index % 5 }))),
    );
    if (byShape) {
      return {
        type: "custom",
        name: byShape.name,
        rows: 5,
        columns: 5,
        cells: byShape.cells.map((index) => ({ row: Math.floor(index / 5), column: index % 5 })),
      };
    }
    const sparseTypes: Exclude<CardType, "classic-5x5" | "custom">[] = [
      "linea-5", "loco-10", "loco-11", "yapa-3x3", "eche-leche-7",
      "bom-bom-8", "keke-keke-6", "avion-9", "flecha-9", "espada-7",
      "pesa-7", "rombo-8", "bomba-8",
    ];
    const byLayout = sparseTypes.find((type) => sameCells(CARD_LAYOUTS[type].cells));
    if (byLayout) return namedLayout(byLayout);
  }
  if (has("linea", "línea") && matchesCellCount("linea-5")) return namedLayout("linea-5");
  if (has("loco") && matchesCellCount(card.grid.length === 10 ? "loco-10" : "loco-11")) {
    return namedLayout(card.grid.length === 10 ? "loco-10" : "loco-11");
  }
  if (has("eche leche", "eche-leche") && matchesCellCount("eche-leche-7")) return namedLayout("eche-leche-7");
  if (has("bom bom", "bom-bom", "bombom") && matchesCellCount("bom-bom-8")) return namedLayout("bom-bom-8");
  if (has("keke") && matchesCellCount("keke-keke-6")) return namedLayout("keke-keke-6");
  if (has("yapa") && matchesCellCount("yapa-3x3")) return namedLayout("yapa-3x3");
  if (has("sabrosito") && matchesCellCount("sabrosito-5")) return namedLayout("sabrosito-5");
  return null;
}

export function cardLayoutFor(card: CardLayoutMetadata): CardLayout {
  const metadataLayout = additionalLayoutFromMetadata(card);
  if (metadataLayout) return metadataLayout;

  const layout = card.layout;
  if (
    layout &&
    layout.rows > 0 &&
    layout.columns > 0 &&
    Array.isArray(layout.cells) &&
    (layout.cells.length === card.grid.length ||
      (card.grid.length === layout.rows * layout.columns &&
        layout.cells.length === card.grid.filter((value) => value !== 0).length))
  ) {
    return layout;
  }
  if (card.grid.length === 25) return createCardLayout("classic-5x5");
  if (card.grid.length === 16) return createCardLayout("linea-5");
  if (card.grid.length === 10) return createCardLayout("loco-10");
  if (card.grid.length === 11) return createCardLayout("loco-11");
  if (card.grid.length === 9) return createCardLayout("yapa-3x3");
  if (card.grid.length === 7) return createCardLayout("eche-leche-7");
  if (card.grid.length === 8) return createCardLayout("bom-bom-8");
  if (card.grid.length === 6) return createCardLayout("keke-keke-6");
  if (card.grid.length === 5) return createCardLayout("sabrosito-5");
  return createCardLayout("custom", 1, Math.max(1, card.grid.length));
}

export function isClassicCard(card: Pick<BingoCard, "grid" | "layout">) {
  return cardLayoutFor(card).type === "classic-5x5";
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

// Juegos adicionales de las hojas del proveedor. Se expresan sobre la
// cuadrícula 5×5 para que puedan activarse y verificarse igual que los
// patrones tradicionales cuando el cartón conserva sus casillas vacías.
const additionalGamePatterns: BingoPattern[] = ([
  ["avion", "Avión", [2, 5, 8, 10, 11, 14, 15, 18, 22]],
  ["flecha", "Flecha", [0, 1, 2, 5, 6, 10, 12, 18, 24]],
  ["espada", "Espada", [0, 6, 12, 14, 18, 22, 24]],
  ["pesa", "Pesa", [6, 8, 10, 12, 14, 16, 18]],
  ["rombo", "Rombo", [2, 6, 8, 10, 14, 16, 18, 22]],
  ["bomba", "Bomba", [0, 4, 7, 11, 13, 17, 20, 24]],
  ["sonrisa", "Sonrisa", [1, 3, 5, 9, 21, 22, 23]],
  ["mini-o", "Mini O", [1, 2, 3, 6, 8, 11, 12, 13]],
  ["perrito", "Perrito", [5, 6, 11, 13, 16, 17, 18, 21, 23]],
  ["cruz-adicional", "Cruz adicional", [2, 5, 6, 7, 8, 9, 12, 17]],
  ["mas", "Más", [2, 7, 10, 11, 13, 14, 17, 22]],
  ["martillo", "Martillo", [3, 7, 10, 11, 13, 15, 16, 19]],
  // Formas numeradas que aparecen en las hojas adicionales del proveedor.
  // Se representan como una matriz de 5×5 para conservar las posiciones
  // vacías del PDF y permitir su verificación junto con el resto de figuras.
  ["forma-1", "Forma 1", [2, 7, 12, 17, 22]],
  ["forma-3", "Forma 3", [0, 1, 2, 7, 12, 17, 20, 21, 22]],
  ["forma-4", "Forma 4", [0, 4, 5, 9, 10, 11, 12, 13, 14, 19, 24]],
  ["forma-5", "Forma 5", [0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24]],
  ["forma-7", "Forma 7", [0, 1, 2, 3, 4, 9, 14, 19, 24]],
  ["forma-9", "Forma 9", [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24]],
  ["forma-mas", "Forma +", [2, 7, 10, 11, 12, 13, 14, 17, 22]],
  ["forma-igual", "Forma =", [5, 6, 7, 8, 9, 15, 16, 17, 18, 19]],
 ] as Array<[string, string, number[]]>).map(([id, name, cells]) => ({
  id: `adicional-${id}`,
  name,
  description: `Todos los números impresos del juego ${name}.`,
  color: "#d7ff3f",
  category: "Juegos adicionales",
  difficulty: "Especial",
  cells,
  variants: [cells],
}));

// Glifos 5×5 que aparecen como juegos adicionales en las hojas del
// proveedor.  Se mantienen como patrones oficiales (no personalizados) para
// que estén disponibles en cada partida y puedan compararse con los cartones
// importados.  La representación textual facilita revisar las figuras sin
// mantener largas listas de índices a mano.
function bitmapCells(bitmap: readonly string[]) {
  if (bitmap.length !== 5 || bitmap.some((row) => row.length !== 5)) {
    throw new Error("Un patrón bitmap debe tener una matriz de 5×5.");
  }
  return bitmap.flatMap((row, rowIndex) =>
    [...row].flatMap((cell, columnIndex) =>
      cell === "#" ? [rowIndex * 5 + columnIndex] : [],
    ),
  );
}

const letterGlyphs: Array<[string, readonly string[]]> = [
  ["A", [".###.", "#...#", "#####", "#...#", "#...#"]],
  ["B", ["####.", "#...#", "####.", "#...#", "####."]],
  ["C", [".####", "#....", "#....", "#....", ".####"]],
  ["D", ["####.", "#...#", "#...#", "#...#", "####."]],
  ["E", ["#####", "#....", "####.", "#....", "#####"]],
  ["F", ["#####", "#....", "####.", "#....", "#...."]],
  ["G", [".####", "#....", "#.###", "#...#", ".###."]],
  ["I", ["#####", "..#..", "..#..", "..#..", "#####"]],
  ["J", ["..###", "...#.", "...#.", "#..#.", ".##.."]],
  ["K", ["#...#", "#..#.", "###..", "#..#.", "#...#"]],
  ["L", ["#....", "#....", "#....", "#....", "#####"]],
  ["M", ["#...#", "##.##", "#.#.#", "#...#", "#...#"]],
  ["N", ["#...#", "##..#", "#.#.#", "#..##", "#...#"]],
  ["O", [".###.", "#...#", "#...#", "#...#", ".###."]],
  ["P", ["####.", "#...#", "####.", "#....", "#...."]],
  ["Q", [".###.", "#...#", "#...#", "#.###", ".####"]],
  ["R", ["####.", "#...#", "####.", "#..#.", "#...#"]],
  ["S", [".####", "#....", ".###.", "....#", "####."]],
  ["U", ["#...#", "#...#", "#...#", "#...#", ".###."]],
  ["V", ["#...#", "#...#", "#...#", ".#.#.", "..#.."]],
  ["W", ["#...#", "#...#", "#.#.#", "##.##", "#...#"]],
  ["Y", ["#...#", ".#.#.", "..#..", "..#..", "..#.."]],
  ["Z", ["#####", "...#.", "..#..", ".#...", "#####"]],
];

const numberGlyphs: Array<[string, readonly string[]]> = [
  ["1", ["..#..", ".##..", "..#..", "..#..", ".###."]],
  ["2", [".###.", "#...#", "...#.", "..#..", "#####"]],
  ["3", ["####.", "....#", ".###.", "....#", "####."]],
  ["4", ["#..#.", "#..#.", "#####", "...#.", "...#."]],
  ["5", ["#####", "#....", "####.", "....#", "####."]],
  ["6", [".###.", "#....", "####.", "#...#", ".###."]],
  ["7", ["#####", "....#", "...#.", "..#..", ".#..."]],
  ["8", [".###.", "#...#", ".###.", "#...#", ".###."]],
  ["9", [".###.", "#...#", ".####", "....#", ".###."]],
];

const glyphPatterns: BingoPattern[] = [
  ...letterGlyphs.map(([letter, bitmap], index) => {
    const cells = bitmapCells(bitmap);
    return {
      id: `letra-${letter.toLowerCase()}`,
      name: `Letra ${letter}`,
      description: `Figura con forma de la letra ${letter}.`,
      color: ["#d7ff3f", "#77e8c9", "#a6c8ff", "#ff7f96", "#ffc857"][index % 5],
      category: "Letras",
      difficulty: "Alta",
      cells,
      variants: [cells],
    } satisfies BingoPattern;
  }),
  ...numberGlyphs.map(([number, bitmap], index) => {
    const cells = bitmapCells(bitmap);
    return {
      id: `numero-${number}`,
      name: `Número ${number}`,
      description: `Figura con forma del número ${number}.`,
      color: ["#62d5ff", "#d6a6ff", "#ff8f70", "#d7ff3f", "#77e8c9"][index % 5],
      category: "Números",
      difficulty: "Alta",
      cells,
      variants: [cells],
    } satisfies BingoPattern;
  }),
];

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
  ...additionalGamePatterns,
  ...glyphPatterns,
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
  {
    id: "blackout",
    name: "Cartón completo",
    description: "Todos los números del cartón.",
    color: "#ff8f70",
    category: "Especial",
    difficulty: "Máxima",
    cells: range(0, 24),
    variants: [range(0, 24)],
  },
  // Figuras adicionales identificadas en la hoja de números del proveedor
  // (página 15: numeraciones centrales #1, #3, #5 y #9). Son patrones
  // sobre cartones 5×5; no cambian la estructura ni la validación del cartón.
  {
    id: "forma-adicional-1",
    name: "Forma adicional #1",
    description: "Figura especial asociada a la numeración #1.",
    color: "#ff4fd8",
    category: "Juegos adicionales",
    difficulty: "Alta",
    cells: [2, 6, 7, 10, 12, 17, 20, 21, 22, 23, 24],
    variants: [[2, 6, 7, 10, 12, 17, 20, 21, 22, 23, 24]],
  },
  {
    id: "forma-adicional-3",
    name: "Forma adicional #3",
    description: "Figura especial asociada a la numeración #3.",
    color: "#62d5ff",
    category: "Juegos adicionales",
    difficulty: "Alta",
    cells: [0, 1, 2, 3, 4, 9, 10, 11, 14, 19, 20, 21, 22, 23, 24],
    variants: [[0, 1, 2, 3, 4, 9, 10, 11, 14, 19, 20, 21, 22, 23, 24]],
  },
  {
    id: "forma-adicional-5",
    name: "Forma adicional #5",
    description: "Figura especial asociada a la numeración #5.",
    color: "#d7ff3f",
    category: "Juegos adicionales",
    difficulty: "Alta",
    cells: [0, 1, 2, 3, 4, 5, 10, 11, 13, 14, 17, 20, 21, 22, 23, 24],
    variants: [[0, 1, 2, 3, 4, 5, 10, 11, 13, 14, 17, 20, 21, 22, 23, 24]],
  },
  {
    id: "forma-adicional-9",
    name: "Forma adicional #9",
    description: "Figura especial asociada a la numeración #9.",
    color: "#ffc857",
    category: "Juegos adicionales",
    difficulty: "Alta",
    cells: [0, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24],
    variants: [[0, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24]],
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

/**
 * Returns the named additional game represented by the occupied cells of a
 * traditional 5×5 card. Scanned sheets frequently omit or corrupt the game
 * title, so recognition is based on the figure itself.
 */
export function additionalPatternForCard(
  card: Pick<BingoCard, "grid">,
) {
  if (card.grid.length !== 25) return null;
  const occupied = card.grid
    .map((value, index) => (value > 0 ? index : -1))
    .filter((index) => index >= 0);
  return BUILTIN_PATTERNS.find(
    (pattern) =>
      ["Juegos adicionales", "Letras", "Números"].includes(pattern.category) &&
      pattern.cells.length === occupied.length &&
      pattern.cells.every((cell, index) => cell === occupied[index]),
  ) ?? null;
}

function completionPatternFor(card: BingoCard): BingoPattern {
  const layout = cardLayoutFor(card);
  if (layout.type === "sabrosito-5") return COMPACT_CARD_PATTERN;
  const cells = card.grid
    .map((value, index) => (value > 0 ? index : -1))
    .filter((index) => index >= 0);
  const name = layout.type === "yapa-3x3" ? "Yapa completa" : `${layout.name} completo`;
  return {
    id: `${layout.type}-completo`,
    name,
    description: `Todos los números del ${layout.name}.`,
    color: "#d7ff3f",
    category: "Especial",
    difficulty: "Media",
    cells,
    variants: [cells],
  };
}

export function patternForCard(card: BingoCard, activePattern: BingoPattern) {
  const additional = additionalPatternForCard(card);
  if (additional) return additional;
  return isClassicCard(card) ? activePattern : completionPatternFor(card);
}

export function patternsForCard(
  card: BingoCard,
  activePatterns: BingoPattern[],
) {
  const additional = additionalPatternForCard(card);
  if (additional) {
    return activePatterns.filter((pattern) => pattern.id === additional.id);
  }
  return isClassicCard(card)
    ? activePatterns.filter((pattern) => {
        const category = pattern.category.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        // Additional sheets (including Sabrositos, letters and numbered
        // figures) must never be evaluated on a traditional 5×5 ticket.
        return pattern.id !== COMPACT_CARD_PATTERN.id &&
          category !== "juegos adicionales" &&
          category !== "letras" &&
          category !== "numeros";
      })
    : [completionPatternFor(card)];
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

export function validateBingoCard(card: Pick<BingoCard, "grid" | "layout">) {
  const errors: string[] = [];
  const layout = cardLayoutFor(card);
  const occupiedCells = card.grid.filter((number) => number !== 0).length;
  const compactSparseGrid =
    card.grid.length === layout.rows * layout.columns &&
    layout.cells.length === occupiedCells;
  if (card.grid.length !== layout.cells.length && !compactSparseGrid) {
    errors.push("La cantidad de casillas no coincide con la estructura del cartón.");
  }
  if (
    layout.cells.some(
      (cell) =>
        !Number.isInteger(cell.row) ||
        !Number.isInteger(cell.column) ||
        cell.row < 0 ||
        cell.column < 0 ||
        cell.row >= layout.rows ||
        cell.column >= layout.columns,
    )
  ) {
    errors.push("La posición de una casilla no coincide con la estructura del cartón.");
  }
  const zeroIndexes = card.grid
    .map((number, index) => (number === 0 ? index : -1))
    .filter((index) => index >= 0);
  if (
    zeroIndexes.some(
      (index) => layout.type === "classic-5x5" && index !== 12,
    )
  ) {
    errors.push("Solo el centro del cartón tradicional puede ser una casilla libre.");
  }
  const nonFree = card.grid.filter((number) => number !== 0);
  if (nonFree.some((number) => !Number.isInteger(number) || number < 1 || number > 90)) {
    errors.push("Los números deben estar entre 1 y 90.");
  }
  if (new Set(nonFree).size !== nonFree.length) errors.push("El cartón contiene números repetidos.");
  return errors;
}

export function validateCardGrid(grid: number[]) {
  return validateBingoCard({ grid, layout: createCardLayout("classic-5x5") });
}

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
