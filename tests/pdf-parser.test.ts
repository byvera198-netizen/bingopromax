import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_PATTERNS,
  cardProgress,
  isWinningCard,
  numberSheetFormForGrid,
  patternForCard,
  referenceCatalogPatterns,
  winningPatternsForCard,
  type BingoCard,
  type BingoPattern,
} from "../lib/bingo";
import {
  assignSequentialCardNumbers,
  detectCompactRectangles,
  detectGridRectangles,
  compactIdentifierFamily,
  extractNumberSheetGridFromKnownOcrBlocks,
  extractGridFromKnownOcrBlocks,
  extractCardsFromTextItems,
  identifierFamilyFromOcrText,
  numberSheetMetadataFromOcrText,
  type OcrBlock,
  type PdfTextItem,
} from "../lib/pdf-parser";

test("reconstruye la serie compacta aunque el OCR confunda ceros y cincos", () => {
  assert.equal(
    compactIdentifierFamily(
      [
        "09556341",
        "995563-2",
        "055503-3",
        "995503-4",
        "995543-5",
        "995503 0",
        "995583-7",
        "",
      ],
      "055504",
    ),
    "055503",
  );
  assert.equal(
    compactIdentifierFamily(
      [
        "0955041",
        "955504-2",
        "055504-3",
        "995504-4",
        "995544-5",
        "995504 0",
        "995504-7",
        "",
      ],
      "055504",
    ),
    "055504",
  );
});

test("reconstruye la serie de una hoja aunque el OCR mezcle guiones y letras", () => {
  const text = "PLAN PREMIO 17000 10000 N TABLA #87020 Tab#87020-1 Tab#87020-2";
  assert.equal(identifierFamilyFromOcrText(text), "87020");
  assert.equal(identifierFamilyFromOcrText("Tab#87O21-3"), "87021");
});

const baseGrid = [
  1, 16, 31, 46, 61,
  2, 17, 32, 47, 62,
  3, 18, 0, 48, 63,
  4, 19, 34, 49, 64,
  5, 20, 35, 50, 65,
];

const horizontalPattern: BingoPattern = {
  id: "linea-horizontal-prueba",
  name: "Línea horizontal de prueba",
  description: "Valida una fila completa.",
  color: "#d7ff3f",
  category: "Prueba",
  difficulty: "Fácil",
  cells: [0, 1, 2, 3, 4],
  variants: [[0, 1, 2, 3, 4]],
};

const verticalPattern: BingoPattern = {
  id: "linea-vertical-prueba",
  name: "Línea vertical de prueba",
  description: "Valida una columna completa.",
  color: "#77e8c9",
  category: "Prueba",
  difficulty: "Fácil",
  cells: [0, 5, 10, 15, 20],
  variants: [[0, 5, 10, 15, 20]],
};

test("conserva exactamente el catálogo de patrones de referencia", () => {
  assert.equal(BUILTIN_PATTERNS.length, 36);
  assert.deepEqual(
    BUILTIN_PATTERNS.map((pattern) => pattern.name),
    [
      "Letra E", "Letra D", "Letra C", "Letra B",
      "Letra A", "Número 10", "Número 9", "Número 8",
      "Número 4", "Número 3", "Número 2", "Número 1",
      "Letra H", "Letra T", "Letra X", "X",
      "Letra W", "Letra V", "Letra U", "Letra S",
      "Letra R", "Letra Q", "Letra P", "Letra O",
      "Letra N", "Letra M", "Letra L", "Letra K",
      "Letra J", "Letra I", "Letra G", "Letra F",
      "Letra O", "Tabla llena", "Letra Z", "Letra Y",
    ],
  );
  assert.ok(BUILTIN_PATTERNS.every((pattern) => pattern.category === "Personalizado"));
});

test("oculta patrones ajenos al catálogo y conserva los reemplazos editados", () => {
  const reference = BUILTIN_PATTERNS[0];
  const replacement: BingoPattern = {
    ...reference,
    id: `custom-${reference.id}-prueba`,
    name: "Letra E editada",
    custom: true,
  };
  const unrelated: BingoPattern = {
    ...reference,
    id: "custom-piramide-antigua",
    name: "Pirámide",
    custom: true,
  };

  const catalog = referenceCatalogPatterns(
    [unrelated, replacement],
    [reference.id],
  );

  assert.equal(catalog.length, BUILTIN_PATTERNS.length);
  assert.equal(catalog[0].id, replacement.id);
  assert.equal(catalog.some((pattern) => pattern.id === unrelated.id), false);
});

function rowText(grid: number[], row: number) {
  return grid
    .slice(row * 5, row * 5 + 5)
    .filter((value) => value !== 0)
    .join(" ");
}

test("detecta cuatro cartones cuando cada fila del PDF es un solo bloque de texto", () => {
  const items: PdfTextItem[] = [];
  const placements = [
    { x: 40, y: 700, id: "101" },
    { x: 330, y: 700, id: "102" },
    { x: 40, y: 380, id: "103" },
    { x: 330, y: 380, id: "104" },
  ];

  placements.forEach((placement, cardIndex) => {
    const grid = baseGrid.map((value) => {
      if (!value) return 0;
      const column = baseGrid.indexOf(value) % 5;
      const minimum = column * 15 + 1;
      return minimum + ((value - minimum + cardIndex) % 15);
    });
    items.push({
      str: `Cartón #${placement.id}`,
      transform: [1, 0, 0, 1, placement.x, placement.y + 34],
      width: 75,
      height: 12,
    });
    for (let row = 0; row < 5; row += 1) {
      items.push({
        str: rowText(grid, row),
        transform: [1, 0, 0, 1, placement.x, placement.y - row * 28],
        width: 150,
        height: 12,
      });
    }
  });

  const cards = extractCardsFromTextItems(items, "lote.pdf", 1);

  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((card) => card.number), ["101", "102", "103", "104"]);
  cards.forEach((card) => {
    assert.equal(card.grid.length, 25);
    assert.equal(card.grid[12], 0);
  });
});

test("conserva la numeración Tab# del PDF aunque el texto venga separado", () => {
  const items: PdfTextItem[] = [];
  [
    { x: 40, number: "87019-1" },
    { x: 330, number: "87019-2" },
  ].forEach((placement, cardIndex) => {
    items.push(
      { str: "Tab#", transform: [1, 0, 0, 1, placement.x, 734], width: 28, height: 12 },
      { str: placement.number, transform: [1, 0, 0, 1, placement.x + 30, 734], width: 52, height: 12 },
    );
    const grid = baseGrid.map((value) => value ? value + (cardIndex && value < 15 ? 1 : 0) : 0);
    for (let row = 0; row < 5; row += 1) {
      items.push({
        str: rowText(grid, row),
        transform: [1, 0, 0, 1, placement.x, 700 - row * 28],
        width: 150,
        height: 12,
      });
    }
  });

  const cards = extractCardsFromTextItems(items, "tabs.pdf", 1);
  assert.deepEqual(cards.map((card) => card.number), ["87019-1", "87019-2"]);
});

test("usa la numeración impresa del borde aunque no incluya la palabra Tab", () => {
  const items: PdfTextItem[] = [
    { str: "87021-1", transform: [1, 0, 0, 1, 40, 734], width: 58, height: 12 },
  ];
  for (let row = 0; row < 5; row += 1) {
    items.push({
      str: rowText(baseGrid, row),
      transform: [1, 0, 0, 1, 40, 700 - row * 28],
      width: 150,
      height: 12,
    });
  }
  const cards = extractCardsFromTextItems(items, "CamScanner 07-30-2026.pdf", 1);
  assert.equal(cards[0]?.number, "87021-1");
  assert.doesNotMatch(cards[0]?.number ?? "", /CamScanner/i);
});

test("nunca acepta texto OCR como número de cartón", () => {
  const items: PdfTextItem[] = [
    { str: "Tab#es", transform: [1, 0, 0, 1, 40, 734], width: 58, height: 12 },
  ];
  for (let row = 0; row < 5; row += 1) {
    items.push({ str: rowText(baseGrid, row), transform: [1, 0, 0, 1, 40, 700 - row * 28], width: 150, height: 12 });
  }
  const cards = extractCardsFromTextItems(items, "escaneo.pdf", 1);
  assert.equal(cards.length, 1);
  assert.match(cards[0].number, /^SIN-ID-/);
});

test("completa la numeración ilegible con la secuencia de los cartones vecinos", () => {
  const cards: BingoCard[] = [
    { id: "1", number: "87021-1", serial: "", grid: baseGrid, sourceFile: "lote.pdf", sourcePage: 1, status: "active" },
    { id: "2", number: "SIN-ID-001-2", serial: "", grid: [...baseGrid], sourceFile: "lote.pdf", sourcePage: 1, status: "active" },
    { id: "3", number: "SIN-ID-001-3", serial: "", grid: [...baseGrid], sourceFile: "lote.pdf", sourcePage: 1, status: "active" },
    { id: "4", number: "87021-4", serial: "", grid: [...baseGrid], sourceFile: "lote.pdf", sourcePage: 1, status: "active" },
  ];

  assert.deepEqual(
    assignSequentialCardNumbers(cards).map((card) => card.number),
    ["87021-1", "87021-2", "87021-3", "87021-4"],
  );
});

test("rechaza una cuadrícula OCR que mezcla las columnas BINGO", () => {
  const mixed = [
    41, 32, 11, 8, 15,
    24, 26, 69, 35, 71,
    6, 19, 0, 53, 67,
    5, 59, 49, 54, 46,
    40, 51, 7, 25, 10,
  ];
  const items: PdfTextItem[] = [];
  for (let row = 0; row < 5; row += 1) {
    items.push({ str: rowText(mixed, row), transform: [1, 0, 0, 1, 40, 700 - row * 28], width: 150, height: 12 });
  }
  assert.equal(extractCardsFromTextItems(items, "inconsistente.pdf", 1).length, 0);
});

test("un cartón ganador permanece elegible para un patrón distinto", () => {
  const card: BingoCard = {
    id: "card-1",
    number: "101",
    serial: "",
    grid: baseGrid,
    sourceFile: "manual",
    sourcePage: 0,
    status: "active",
  };
  const horizontal = horizontalPattern;
  const vertical = verticalPattern;

  const called = new Set([1, 16, 31, 46, 61]);
  assert.equal(isWinningCard(card, called, horizontal), true);
  assert.equal(isWinningCard(card, called, vertical), false);

  [2, 3, 4, 5].forEach((number) => called.add(number));
  assert.equal(isWinningCard(card, called, vertical), true);
  assert.equal(card.status, "active");
});

test("todos los patrones se evalúan simultáneamente sin repetir victorias", () => {
  const card: BingoCard = {
    id: "card-all-patterns",
    number: "202",
    serial: "",
    grid: baseGrid,
    sourceFile: "manual",
    sourcePage: 0,
    status: "active",
  };
  const horizontal = horizontalPattern;
  const vertical = verticalPattern;

  const called = new Set([1, 16, 31, 46, 61, 2, 3, 4, 5]);
  const firstPass = winningPatternsForCard(
    card,
    called,
    [horizontal, vertical],
  );
  const secondPass = winningPatternsForCard(
    card,
    called,
    [horizontal, vertical],
    new Set([horizontal.id]),
  );

  assert.deepEqual(
    firstPass.map((pattern) => pattern.id),
    [horizontal.id, vertical.id],
  );
  assert.deepEqual(
    secondPass.map((pattern) => pattern.id),
    [vertical.id],
  );
});

test("un cartón Sabrosito gana al completar sus cinco números", () => {
  const card: BingoCard = {
    id: "compact-1",
    number: "094575-1",
    serial: "",
    grid: [27, 45, 61, 12, 56],
    sourceFile: "sabrosito.pdf",
    sourcePage: 1,
    status: "active",
  };
  const activePattern = BUILTIN_PATTERNS[0];
  const almostComplete = new Set([27, 45, 61, 12]);
  const complete = new Set([27, 45, 61, 12, 56]);

  assert.equal(isWinningCard(card, almostComplete, activePattern), false);
  assert.equal(isWinningCard(card, complete, activePattern), true);
  assert.deepEqual(cardProgress(card, almostComplete, activePattern), {
    completed: 4,
    total: 5,
    progress: 0.8,
  });
  assert.equal(patternForCard(card, activePattern).id, "sabrosito-completo");
});

test("una hoja de números gana únicamente al completar su forma impresa", () => {
  const grid = [
    0, 0, 37, 0, 0,
    0, 25, 38, 0, 0,
    15, 0, 0, 0, 0,
    0, 0, 44, 0, 0,
    9, 22, 34, 53, 63,
  ];
  const card: BingoCard = {
    id: "forma-1",
    number: "24146-3",
    serial: "",
    grid,
    sourceFile: "hoja-numeros.pdf",
    sourcePage: 13,
    status: "active",
  };
  const activePattern = BUILTIN_PATTERNS[0];
  const required = grid.filter((value) => value > 0);
  const incomplete = new Set(required.slice(0, -1));
  const complete = new Set(required);

  assert.equal(numberSheetFormForGrid(grid), "1");
  assert.equal(patternForCard(card, activePattern).id, "forma-1-completa");
  assert.equal(isWinningCard(card, incomplete, activePattern), false);
  assert.equal(isWinningCard(card, complete, activePattern), true);
  assert.deepEqual(
    winningPatternsForCard(card, complete, BUILTIN_PATTERNS).map((pattern) => pattern.id),
    ["forma-1-completa"],
  );
});

test("identifica las cuatro formas especiales 1, 3, 5 y 9", () => {
  const layouts = {
    "1": [2, 6, 7, 10, 17, 20, 21, 22, 23, 24],
    "3": [0, 1, 2, 3, 4, 9, 10, 11, 13, 14, 19, 20, 21, 22, 23, 24],
    "5": [0, 1, 2, 3, 4, 5, 10, 11, 13, 14, 19, 20, 21, 22, 23, 24],
    "9": [0, 1, 2, 3, 4, 5, 9, 10, 11, 13, 14, 19, 20, 21, 22, 23, 24],
  } as const;

  for (const [form, cells] of Object.entries(layouts)) {
    const required = new Set<number>(cells);
    const grid = baseGrid.map((value, index) => required.has(index) ? value : 0);
    assert.equal(numberSheetFormForGrid(grid), form);
  }
});

test("conserva el número impreso y la forma leídos en la casilla central", () => {
  assert.deepEqual(numberSheetMetadataFromOcrText("1\n24146-3"), {
    form: "1",
    identifier: "24146-3",
  });
  assert.deepEqual(numberSheetMetadataFromOcrText("FORMA #9\n24146_6"), {
    form: "9",
    identifier: "24146-6",
  });
});

test("ignora marcas de agua fuera de las casillas de una Forma #3", () => {
  const expected = [
    14, 25, 45, 59, 74,
    0, 0, 0, 0, 65,
    15, 22, 0, 57, 62,
    0, 0, 0, 0, 71,
    13, 17, 33, 51, 69,
  ];
  const noisy = [...expected];
  noisy[5] = 7;
  noisy[6] = 20;
  noisy[7] = 40;
  noisy[8] = 55;
  const words: OcrBlock["paragraphs"][number]["lines"][number]["words"] = [];
  noisy.forEach((value, index) => {
    if (!value) return;
    const row = Math.floor(index / 5);
    const column = index % 5;
    const text = String(value);
    const symbols = [...text].map((digit, digitIndex) => ({
      text: digit,
      confidence: 98,
      bbox: {
        x0: column * 100 + 32 + digitIndex * 18,
        y0: row * 100 + 24,
        x1: column * 100 + 47 + digitIndex * 18,
        y1: row * 100 + 78,
      },
    }));
    words.push({
      text,
      confidence: 98,
      bbox: {
        x0: symbols[0].bbox.x0,
        y0: symbols[0].bbox.y0,
        x1: symbols[symbols.length - 1].bbox.x1,
        y1: symbols[0].bbox.y1,
      },
      symbols,
    });
  });
  const blocks: OcrBlock[] = [{ paragraphs: [{ lines: [{ words }] }] }];

  assert.deepEqual(
    extractNumberSheetGridFromKnownOcrBlocks(blocks, 500, 500, "3"),
    expected,
  );
});

test("separa dos cuadrículas escaneadas por sus líneas", () => {
  const width = 1_000;
  const height = 800;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const drawPixel = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 255;
  };
  const drawGrid = (left: number) => {
    for (let line = 0; line <= 5; line += 1) {
      const x = left + line * 80;
      const y = 50 + line * 100;
      for (let thickness = -1; thickness <= 1; thickness += 1) {
        for (let row = 50; row <= 550; row += 1) drawPixel(x + thickness, row);
        for (let column = left; column <= left + 400; column += 1) {
          drawPixel(column, y + thickness);
        }
      }
    }
  };
  drawGrid(50);
  drawGrid(550);

  const rectangles = detectGridRectangles(pixels, width, height);

  assert.equal(rectangles.length, 2);
  assert.deepEqual(rectangles.map((rectangle) => rectangle.x), [50, 550]);
});

test("detecta los ocho cartones compactos de una hoja escaneada", () => {
  const width = 1_000;
  const height = 1_400;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const drawPixel = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 255;
  };
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const left = 70 + column * 455;
      const top = 260 + row * 260;
      const rectangleWidth = 405;
      const rectangleHeight = 225;
      for (let x = left; x <= left + rectangleWidth; x += 1) {
        drawPixel(x, top);
        drawPixel(x, top + rectangleHeight);
      }
      for (let y = top; y <= top + rectangleHeight; y += 1) {
        drawPixel(left, y);
        drawPixel(left + rectangleWidth, y);
      }
    }
  }

  const rectangles = detectCompactRectangles(pixels, width, height);

  assert.equal(rectangles.length, 8);
});

test("reconstruye una tabla desde símbolos OCR ubicados por celda", () => {
  const words: OcrBlock["paragraphs"][number]["lines"][number]["words"] = [];
  baseGrid.forEach((value, index) => {
    if (!value) return;
    const row = Math.floor(index / 5);
    const column = index % 5;
    const text = String(value);
    const symbols = [...text].map((digit, digitIndex) => ({
      text: digit,
      confidence: 98,
      bbox: {
        x0: column * 100 + 32 + digitIndex * 18,
        y0: row * 100 + 24,
        x1: column * 100 + 47 + digitIndex * 18,
        y1: row * 100 + 78,
      },
    }));
    words.push({
      text,
      confidence: 98,
      bbox: {
        x0: symbols[0].bbox.x0,
        y0: symbols[0].bbox.y0,
        x1: symbols[symbols.length - 1].bbox.x1,
        y1: symbols[0].bbox.y1,
      },
      symbols,
    });
  });
  const blocks: OcrBlock[] = [{ paragraphs: [{ lines: [{ words }] }] }];

  const grid = extractGridFromKnownOcrBlocks(blocks, 500, 500);

  assert.deepEqual(grid, baseGrid);
});
