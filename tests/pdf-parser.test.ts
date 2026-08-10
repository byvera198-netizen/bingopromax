import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_PATTERNS,
  cardProgress,
  isWinningCard,
  numberSheetFormForGrid,
  patternForCard,
  referenceCatalogPatterns,
  specialCardPatternForGrid,
  validateCardGrid,
  winningPatternsForCard,
  type BingoCard,
  type BingoPattern,
} from "../lib/bingo";
import {
  assignSequentialCardNumbers,
  ensureUniqueImportIdentifiers,
  reconcilePlainSequentialCardNumbers,
  detectCompactRectangles,
  detectGridRectangles,
  decodeYapaRowDigits,
  decodeBingoRowDigits,
  compactIdentifierFamily,
  extractNumberSheetGridFromKnownOcrBlocks,
  extractGridFromKnownOcrBlocks,
  extractCardsFromTextItems,
  identifierFamilyConsensus,
  identifierFamilyFromOcrText,
  identifiersForDetectedGrids,
  isSupportedBingoImportFile,
  needsImportReview,
  validateBingoImportFileContent,
  numberSheetMetadataFromOcrText,
  orderCardsByPdfPosition,
  recommendedOcrConcurrency,
  reconcileTwoCardPageNumbers,
  selectGridRectangles,
  specialPageLayoutFromOcrText,
  shouldRereadBingoCell,
  type OcrBlock,
  type PdfTextItem,
} from "../lib/pdf-parser";

test("limita el OCR paralelo segun el dispositivo y la cantidad de paginas", () => {
  assert.equal(recommendedOcrConcurrency(3, 16, 8, false), 1);
  assert.equal(recommendedOcrConcurrency(12, 2, 8, false), 1);
  assert.equal(recommendedOcrConcurrency(12, 8, 8, false), 3);
  assert.equal(recommendedOcrConcurrency(12, 6, 6, true), 2);
  assert.equal(recommendedOcrConcurrency(12, 4, 4, true), 1);
});

test("prioriza la cuadricula completa sobre lineas publicitarias superpuestas", () => {
  const rectangle = (x: number, y: number, score: number) => ({
    x,
    y,
    width: 420,
    height: 250,
    verticalLines: [0, 1, 2, 3, 4, 5].map((index) => x + index * 84),
    horizontalLines: [0, 1, 2, 3, 4, 5].map((index) => y + index * 50),
    score,
  });
  const selected = selectGridRectangles([
    rectangle(35, 189, 73),
    rectangle(535, 189, 72),
    rectangle(35, 302, 92),
    rectangle(535, 302, 91),
    rectangle(35, 707, 92),
    rectangle(535, 707, 88),
  ]).sort((a, b) => a.y - b.y || a.x - b.x);

  assert.deepEqual(
    selected.map(({ x, y }) => [x, y]),
    [[35, 302], [535, 302], [35, 707], [535, 707]],
  );
});

test("repara una secuencia numÃ©rica simple cuando el OCR repite un cartÃ³n", () => {
  const cards = ["0311297", "0311298", "0311298", "0311300"].map((number, index) => ({
    id: String(index),
    number,
    serial: "",
    grid: Array.from({ length: 25 }, (_, cell) => cell === 12 ? 0 : cell + 1),
    sourceFile: "lote.pdf",
    sourcePage: 1,
    status: "active" as const,
  }));
  assert.deepEqual(
    reconcilePlainSequentialCardNumbers(cards).map((card) => card.number),
    ["0311297", "0311298", "0311299", "0311300"],
  );
});

test("conserva la numeración impresa y completa solo los cartones ilegibles", () => {
  const cards = [
    { id: "a", number: "94238-1", serial: "", grid: Array(25).fill(1), sourceFile: "lote.pdf", sourcePage: 1, status: "active" as const },
    { id: "b", number: "SIN-ID-001-2", serial: "", grid: Array(25).fill(1), sourceFile: "lote.pdf", sourcePage: 1, status: "active" as const },
    { id: "c", number: "SIN-ID-001-3", serial: "", grid: Array(25).fill(1), sourceFile: "lote.pdf", sourcePage: 1, status: "active" as const },
    { id: "d", number: "94238-4", serial: "", grid: Array(25).fill(1), sourceFile: "lote.pdf", sourcePage: 1, status: "active" as const },
  ];
  assert.deepEqual(
    assignSequentialCardNumbers(cards).map((card) => card.number),
    ["94238-1", "94238-2", "94238-3", "94238-4"],
  );
});

test("conserva todos los cartones y completa identificadores repetidos antes de guardar", () => {
  const cards: BingoCard[] = [
    { id: "a", number: "069138-3", serial: "", grid: Array(25).fill(1), sourceFile: "lote.pdf", sourcePage: 1, status: "active" },
    { id: "a", number: "069138-3", serial: "Yapa", grid: Array(9).fill(2), sourceFile: "lote.pdf", sourcePage: 1, status: "active" },
    { id: "c", number: "069138-6", serial: "", grid: Array(25).fill(3), sourceFile: "lote.pdf", sourcePage: 2, status: "active" },
    { id: "d", number: "069138-6", serial: "Eche Leche", grid: Array(7).fill(4), sourceFile: "lote.pdf", sourcePage: 2, status: "active" },
  ];
  const prepared = ensureUniqueImportIdentifiers(cards, ["069138-7"]);
  assert.deepEqual(
    prepared.cards.map((card) => card.number),
    ["069138-3", "069138-8", "069138-6", "069138-9"],
  );
  assert.equal(new Set(prepared.cards.map((card) => card.id)).size, cards.length);
  assert.equal(prepared.adjustedNumbers, 2);
  assert.equal(prepared.adjustedIds, 1);
});

test("acepta PDF e imágenes compatibles para importación y cámara", () => {
  assert.equal(isSupportedBingoImportFile({ name: "cartones.pdf", type: "application/pdf" }), true);
  assert.equal(isSupportedBingoImportFile({ name: "foto.JPG", type: "" }), true);
  assert.equal(isSupportedBingoImportFile({ name: "captura.webp", type: "image/webp" }), true);
  assert.equal(isSupportedBingoImportFile({ name: "notas.txt", type: "text/plain" }), false);
});

test("valida el contenido real y no solo la extensión del archivo", async () => {
  const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "cartones.pdf", { type: "application/pdf" });
  assert.equal(await validateBingoImportFileContent(pdf), "pdf");
  const fakePdf = new File(["esto no es un PDF"], "cartones.pdf", { type: "application/pdf" });
  await assert.rejects(() => validateBingoImportFileContent(fakePdf), /PDF válido/);
  const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "carton.png", { type: "image/png" });
  assert.equal(await validateBingoImportFileContent(image), "image");
});

test("no confunde una hoja clásica de cuatro cartones con juegos especiales", () => {
  assert.equal(
    specialPageLayoutFromOcrText(
      "FECHA MARTES - 20 LETRAS A JUGARSE - SORTEO 0058 - BINGO",
      true,
      4,
      0.17,
    ),
    null,
  );
  assert.equal(
    specialPageLayoutFromOcrText("YAPA 30 - ECHE LECHE - BOM BOM BUM", true, 4, 0.2),
    "gordito",
  );
  assert.equal(
    specialPageLayoutFromOcrText("KEKE KEKE - FORMA #1 - FORMA #3", true, 4, 0.4),
    "number-sheet",
  );
});

test("reconoce Línea y Loco en una hoja vertical y relee cifras B que pueden estar truncadas", () => {
  assert.equal(
    specialPageLayoutFromOcrText("1 LINEA JUEGO 22154 1 LOCO LLENA 10 NUMEROS", true, 0, 0),
    "line-loco",
  );
  assert.equal(shouldRereadBingoCell(1, 0), true);
  assert.equal(shouldRereadBingoCell(9, 20), true);
  assert.equal(shouldRereadBingoCell(11, 0), false);
  assert.equal(shouldRereadBingoCell(1, 1), false);
});

test("separa las tres cifras de una fila Yapa aunque el OCR las una", () => {
  assert.deepEqual(decodeYapaRowDigits("1040 62"), [10, 40, 62]);
  assert.deepEqual(decodeYapaRowDigits("224365"), [22, 43, 65]);
  assert.deepEqual(decodeYapaRowDigits("234574"), [23, 45, 74]);
});

test("conserva el orden visual de los cartones y juegos especiales del PDF", () => {
  const makeCard = (number: string, serial = ""): BingoCard => ({
    id: number,
    number,
    serial,
    grid: baseGrid,
    sourceFile: "hoja.pdf",
    sourcePage: 1,
    status: "active",
  });
  const gordito = [
    makeCard("23729-1"), makeCard("23729-2"),
    makeCard("23729-3"), makeCard("23729-4"),
    makeCard("23729-7", "Yapa"),
    makeCard("23729-5", "Eche Leche"),
    makeCard("23729-6", "Bom Bom Bum"),
  ];
  assert.deepEqual(
    orderCardsByPdfPosition(gordito).map((card) => card.number),
    ["23729-7", "23729-1", "23729-2", "23729-5", "23729-6", "23729-3", "23729-4"],
  );

  const numberSheet = [
    makeCard("40136-3"), makeCard("40136-4"),
    makeCard("40136-5"), makeCard("40136-6"),
    makeCard("40136-1", "Keke Keke"),
  ];
  assert.deepEqual(
    orderCardsByPdfPosition(numberSheet).map((card) => card.number),
    ["40136-1", "40136-3", "40136-4", "40136-5", "40136-6"],
  );
});

test("reconstruye filas BINGO cuando el OCR entrega los dígitos unidos", () => {
  assert.deepEqual(decodeBingoRowDigits("316335270"), [3, 16, 33, 52, 70]);
  assert.deepEqual(decodeBingoRowDigits("1235764", true), [1, 23, 0, 57, 64]);
});

test("acepta cartones especiales y hojas de números sin tratarlos como 5×5 normales", () => {
  const special = [7, 70, 27, 41, 10, 71];
  assert.equal(validateCardGrid(special).length, 0);
  assert.equal(specialCardPatternForGrid(special)?.id, "keke-keke-completo");

  const numberSheet = Array(25).fill(0);
  const values = [1, 25, 40, 56, 72, 8, 9, 27, 55, 64, 74, 5, 16, 36, 46, 68];
  const cells = [0, 1, 2, 3, 4, 5, 10, 11, 13, 14, 19, 20, 21, 22, 23, 24];
  cells.forEach((cell, index) => { numberSheet[cell] = values[index]; });
  assert.equal(numberSheetFormForGrid(numberSheet), "5");
  assert.equal(validateCardGrid(numberSheet).length, 0);
});

test("reconstruye la serie compacta aunque el OCR confunda ceros y cincos", () => {
  assert.equal(
    compactIdentifierFamily(["", "90", "", "", "", "", "2", "-8"], "3 0064544"),
    "064544",
  );
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

test("recupera la familia de cuatro cartones aunque el OCR confunda 9 con 0", () => {
  assert.equal(
    identifierFamilyConsensus(["04238", "04238", "94238", "494238"]),
    "94238",
  );
});

test("numera en secuencia los dos cartones independientes de una hoja horizontal", () => {
  assert.deepEqual(
    identifiersForDetectedGrids("162017", 2, true),
    ["162017-1", "162018-1"],
  );
  assert.deepEqual(
    identifiersForDetectedGrids("87020", 4),
    ["87020-1", "87020-2", "87020-3", "87020-4"],
  );
});

test("recupera identificadores dudosos usando la secuencia de hojas vecinas", () => {
  const makeCard = (number: string, page: number): BingoCard => ({
    id: `${page}-${number}`,
    number,
    serial: "",
    grid: baseGrid,
    sourceFile: "cartones.pdf",
    sourcePage: page,
    status: "active",
  });
  const cards = [
    makeCard("162017-1", 1), makeCard("162018-1", 1),
    makeCard("162019-1", 2), makeCard("162020-1", 2),
    makeCard("16202-1", 3), makeCard("16203-1", 3),
  ];
  assert.deepEqual(
    reconcileTwoCardPageNumbers(cards).map((card) => card.number),
    ["162017-1", "162018-1", "162019-1", "162020-1", "162021-1", "162022-1"],
  );
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
  assert.equal(BUILTIN_PATTERNS.length, 38);
  assert.deepEqual(
    BUILTIN_PATTERNS.map((pattern) => pattern.name),
    [
      "Letra A", "Letra B", "Letra C", "Letra D",
      "Letra E", "Letra EE", "Letra F", "Letra G",
      "Letra H", "Letra I", "Letra J", "Letra K",
      "Letra L", "Doble LL", "Letra M", "Letra N",
      "Letra O", "Letra P", "Letra Q", "Letra R",
      "Letra S", "Letra T", "Letra U", "Letra V",
      "Letra W", "Letra X", "Letra Y", "Letra Z",
      "Número 1", "Número 2", "Número 3", "Número 4",
      "Número 8", "Número 9", "Número 10", "Número 23",
      "Número 51", "Tabla llena",
    ],
  );
  assert.ok(BUILTIN_PATTERNS.every((pattern) => pattern.category === "Personalizado"));
  assert.equal(new Set(BUILTIN_PATTERNS.map((pattern) => pattern.id)).size, 38);
  assert.equal(BUILTIN_PATTERNS.filter((pattern) => pattern.name === "Letra O").length, 1);
  assert.equal(BUILTIN_PATTERNS.filter((pattern) => pattern.name === "Letra X").length, 1);
});

test("conserva las formas nuevas EE, Doble LL, 23 y 51", () => {
  const cells = (id: string) => BUILTIN_PATTERNS.find((pattern) => pattern.id === id)?.cells;

  assert.deepEqual(cells("letra-ee"), [0, 1, 3, 4, 5, 8, 10, 11, 13, 14, 15, 18, 20, 21, 23, 24]);
  assert.deepEqual(cells("doble-ll"), [0, 3, 5, 8, 10, 13, 15, 18, 20, 21, 23, 24]);
  assert.deepEqual(cells("patron-23"), [0, 1, 3, 4, 6, 9, 10, 11, 13, 14, 15, 19, 20, 21, 23, 24]);
  assert.deepEqual(cells("patron-51"), [0, 1, 2, 4, 5, 9, 10, 11, 12, 14, 17, 19, 20, 21, 22, 24]);
});

test("usa globalmente las formas editadas por el administrador", () => {
  const expected: Record<string, number[]> = {
    "patron-a": [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15, 19, 20, 24],
    "patron-b": [1, 2, 3, 6, 9, 11, 12, 13, 16, 19, 21, 22, 23],
    "patron-c": [0, 1, 2, 3, 4, 5, 10, 15, 20, 21, 22, 23, 24],
    "patron-d": [0, 1, 2, 3, 4, 6, 9, 11, 14, 16, 19, 20, 21, 22, 23, 24],
    "patron-g": [1, 2, 3, 4, 6, 11, 12, 13, 14, 16, 19, 21, 22, 23, 24],
    "patron-j": [0, 1, 2, 3, 4, 7, 12, 15, 17, 20, 21, 22],
    "patron-o": [1, 2, 3, 5, 9, 10, 14, 15, 19, 21, 22, 23],
    "patron-p": [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15, 20],
    "patron-q": [0, 1, 2, 3, 5, 8, 10, 13, 15, 16, 17, 18, 24],
    "patron-r": [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15, 18, 20, 24],
    "patron-s": [0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24],
    "patron-u": [0, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24],
    "patron-1": [2, 6, 7, 10, 12, 17, 20, 21, 22, 23, 24],
    "patron-2": [0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24],
    "patron-3": [0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24],
    "patron-4": [0, 4, 5, 9, 10, 11, 12, 13, 14, 19, 24],
    "patron-8": [1, 2, 3, 6, 8, 11, 12, 13, 16, 18, 21, 22, 23],
    "patron-9": [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24],
    "patron-51": [0, 1, 2, 4, 5, 9, 10, 11, 12, 14, 17, 19, 20, 21, 22, 24],
  };

  for (const [id, cells] of Object.entries(expected)) {
    assert.deepEqual(BUILTIN_PATTERNS.find((pattern) => pattern.id === id)?.cells, cells, id);
  }
});

test("oculta patrones ajenos al catálogo y conserva los reemplazos editados", () => {
  const reference = BUILTIN_PATTERNS[0];
  const replacement: BingoPattern = {
    ...reference,
    id: `custom-${reference.id}-prueba`,
    name: "Letra A editada",
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

test("prioriza el cartón posterior de la misma página y conserva el nombre del PDF como respaldo", () => {
  const cards: BingoCard[] = [
    { id: "1", number: "999-9", serial: "", grid: baseGrid, sourceFile: "Anterior.pdf", sourcePage: 1, status: "active" },
    { id: "2", number: "SIN-ID-002-1", serial: "", grid: [...baseGrid], sourceFile: "Nuevo lote.pdf", sourcePage: 2, status: "active" },
    { id: "3", number: "SIN-ID-002-2", serial: "", grid: [...baseGrid], sourceFile: "Nuevo lote.pdf", sourcePage: 2, status: "active" },
    { id: "4", number: "1000-3", serial: "", grid: [...baseGrid], sourceFile: "Nuevo lote.pdf", sourcePage: 2, status: "active" },
  ];
  assert.deepEqual(
    assignSequentialCardNumbers(cards).map((card) => card.number),
    ["999-9", "1000-1", "1000-2", "1000-3"],
  );

  const withoutReferences = assignSequentialCardNumbers([
    { id: "5", number: "SIN-ID-004-7", serial: "", grid: [...baseGrid], sourceFile: "New Doc 07-30-2026.pdf", sourcePage: 4, status: "active" },
  ]);
  assert.equal(withoutReferences[0].number, "New Doc 07-30-2026-P004-7");
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

test("Línea gana solo con una línea impresa y Loco exige los diez números", () => {
  const activePattern = BUILTIN_PATTERNS[0];
  const linea: BingoCard = {
    id: "linea-1",
    number: "11132-1",
    serial: "Línea",
    grid: [19, 47, 3, 25, 41, 56, 63, 29, 57, 6, 17, 36, 52, 75, 16, 51],
    sourceFile: "linea-loco.pdf",
    sourcePage: 1,
    status: "active",
  };
  const loco: BingoCard = {
    id: "loco-1",
    number: "11132-2",
    serial: "Loco",
    grid: [39, 8, 17, 45, 57, 72, 31, 30, 38, 56],
    sourceFile: "linea-loco.pdf",
    sourcePage: 1,
    status: "active",
  };

  assert.equal(isWinningCard(linea, new Set([3, 25, 41, 56]), activePattern), false);
  assert.equal(isWinningCard(linea, new Set([3, 25, 41, 56, 63]), activePattern), true);
  assert.equal(patternForCard(linea, activePattern).id, "linea-completa");
  assert.equal(isWinningCard(loco, new Set(loco.grid.slice(0, 9)), activePattern), false);
  assert.equal(isWinningCard(loco, new Set(loco.grid), activePattern), true);
  assert.equal(patternForCard(loco, activePattern).id, "loco-completo");
  assert.deepEqual(
    winningPatternsForCard(loco, new Set(loco.grid), [activePattern]).map((pattern) => pattern.id),
    ["loco-completo"],
  );
});

test("Yapa usa una cuadrícula 3×3 y gana únicamente con sus nueve números", () => {
  const yapa: BingoCard = {
    id: "yapa-1",
    number: "23727-7",
    serial: "Yapa",
    grid: [6, 33, 54, 17, 41, 66, 18, 46, 69],
    sourceFile: "yapa.pdf",
    sourcePage: 1,
    status: "active",
  };
  const activePattern = BUILTIN_PATTERNS[0];

  assert.equal(yapa.grid.length, 9);
  assert.equal(patternForCard(yapa, activePattern).id, "yapa-completo");
  assert.equal(isWinningCard(yapa, new Set(yapa.grid.slice(0, 8)), activePattern), false);
  assert.equal(isWinningCard(yapa, new Set(yapa.grid), activePattern), true);
});

test("un juego especial inhabilitado deja de producir ganadores", () => {
  const yapa: BingoCard = {
    id: "yapa-disabled",
    number: "23727-7",
    serial: "Yapa",
    grid: [6, 33, 54, 17, 41, 66, 18, 46, 69],
    sourceFile: "yapa.pdf",
    sourcePage: 1,
    status: "active",
  };

  const winners = winningPatternsForCard(
    yapa,
    new Set(yapa.grid),
    BUILTIN_PATTERNS,
    new Set<string>(),
    new Set(["yapa-completo"]),
  );

  assert.deepEqual(winners, []);
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
    const card: BingoCard = {
      id: `forma-${form}`,
      number: `37506-${form}`,
      serial: `Forma #${form}`,
      grid,
      sourceFile: "formas.pdf",
      sourcePage: 1,
      status: "active",
    };
    const called = new Set(grid.filter((value) => value > 0));
    const pattern = patternForCard(card, BUILTIN_PATTERNS[0]);
    assert.equal(pattern.id, `forma-${form}-completa`);
    assert.equal(isWinningCard(card, called, pattern), true);
    called.delete(grid[cells[0]]);
    assert.equal(isWinningCard(card, called, pattern), false);
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

test("detecta cuatro cartones aunque el escaneo deforme progresivamente las filas", () => {
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
  const drawGrid = (vertical: number[], horizontal: number[]) => {
    for (const x of vertical) {
      for (let thickness = -1; thickness <= 1; thickness += 1) {
        for (let y = horizontal[0]; y <= horizontal[5]; y += 1) drawPixel(x + thickness, y);
      }
    }
    for (const y of horizontal) {
      for (let thickness = -1; thickness <= 1; thickness += 1) {
        for (let x = vertical[0]; x <= vertical[5]; x += 1) drawPixel(x, y + thickness);
      }
    }
  };
  const left = [24, 119, 208, 299, 390, 478];
  const right = left.map((value) => value + 476);
  const top = [230, 325, 414, 500, 591, 679];
  const bottom = top.map((value) => value + 450);
  drawGrid(left, top);
  drawGrid(right, top);
  drawGrid(left, bottom);
  drawGrid(right, bottom);

  const rectangles = detectGridRectangles(pixels, width, height);

  assert.equal(rectangles.length, 4);
  assert.deepEqual(rectangles.map((rectangle) => rectangle.x), [24, 500, 24, 500]);
  assert.ok(rectangles.slice(0, 2).every((rectangle) => Math.abs(rectangle.y - 230) <= 3));
  assert.ok(rectangles.slice(2).every((rectangle) => Math.abs(rectangle.y - 680) <= 3));
});

test("detecta cuadrículas impresas con tinta naranja", () => {
  const width = 700;
  const height = 700;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const orange = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    pixels[offset] = 205;
    pixels[offset + 1] = 92;
    pixels[offset + 2] = 16;
    pixels[offset + 3] = 255;
  };
  const lines = [90, 180, 270, 360, 450, 540];
  for (const x of lines) for (let y = lines[0]; y <= lines[5]; y += 1) orange(x, y);
  for (const y of lines) for (let x = lines[0]; x <= lines[5]; x += 1) orange(x, y);

  const rectangles = detectGridRectangles(pixels, width, height);

  assert.equal(rectangles.length, 1);
  assert.deepEqual(rectangles[0].verticalLines, lines);
  assert.deepEqual(rectangles[0].horizontalLines, lines);
});

test("marca un cartón sin identificador o con lectura incompleta para revisión", () => {
  assert.equal(needsImportReview({
    id: "pending", number: "SIN-ID-001-1", serial: "", grid: baseGrid,
    sourceFile: "lote.pdf", sourcePage: 1, status: "active",
  }), true);
  assert.equal(needsImportReview({
    id: "complete", number: "71248-1", serial: "", grid: baseGrid,
    sourceFile: "lote.pdf", sourcePage: 1, status: "active",
  }), false);
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
