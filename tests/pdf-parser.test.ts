import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_PATTERNS,
  COMPACT_CARD_PATTERN,
  additionalPatternForCard,
  cardProgress,
  cardLayoutFor,
  deduplicateBingoCards,
  validateBingoCard,
  isWinningCard,
  patternForCard,
  patternsForCard,
  winningPatternsForCard,
  type BingoCard,
} from "../lib/bingo";
import {
  detectCompactRectangles,
  detectGridRectangles,
  extractGridFromKnownOcrBlocks,
  extractCardsFromTextItems,
  effectiveClassicGridCount,
  hasAdditionalGameMarker,
  isExplicitSpecialSheetHeading,
  isNumberPatternSheetHeading,
  isSabrositoSheetHeading,
  mergeDetectedCards,
  numberPatternCellIndexes,
  normalizePdfPageSelection,
  removeSabrositoCardsFromClassicSheets,
  shouldReadSpecialSheetRegions,
  shouldProbeSabrositoGeometryFallback,
  specialLayoutNameForCellRows,
  type OcrBlock,
  type PdfTextItem,
} from "../lib/pdf-parser";
import { parseProMaxPackage } from "../lib/promax-package";

const baseGrid = [
  1, 16, 31, 46, 61,
  2, 17, 32, 47, 62,
  3, 18, 0, 48, 63,
  4, 19, 34, 49, 64,
  5, 20, 35, 50, 65,
];

test("la selección de páginas PDF incluye todas por defecto y normaliza las elegidas", () => {
  assert.deepEqual(normalizePdfPageSelection(5), [1, 2, 3, 4, 5]);
  assert.deepEqual(normalizePdfPageSelection(5, [5, 4, 4, 0, 6, 2.5]), [4, 5]);
  assert.deepEqual(normalizePdfPageSelection(5, []), []);
});

test("clasifica hojas adicionales por las casillas ocupadas, no por OCR unido", () => {
  const smile = Array.from({ length: 5 }, () => Array(5).fill(0));
  smile[1][1] = 15; smile[1][3] = 49;
  smile[2][0] = 1; smile[2][4] = 62;
  smile[3][1] = 16; smile[3][2] = 28; smile[3][3] = 57;
  assert.equal(specialLayoutNameForCellRows(smile), "Sonrisa");

  const cross = Array.from({ length: 5 }, () => Array(5).fill(0));
  cross[0][2] = 24;
  cross[1] = [8, 12, 27, 67, 72];
  cross[3][2] = 35;
  cross[4][2] = 49;
  assert.equal(specialLayoutNameForCellRows(cross), "Cruz");
});

test("no clasifica una tabla completa 5×5 como juego adicional", () => {
  const classic = Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, column) => row * 5 + column + 1),
  );
  assert.equal(specialLayoutNameForCellRows(classic), null);
});

test("usa geometría para activar OCR regional en hojas especiales con OCR escaso", () => {
  assert.equal(shouldReadSpecialSheetRegions({
    forceFullPageOcr: true,
    pageComplete: false,
    classicRectangleCount: 0,
    compactRectangleCount: 10,
  }), true);
  assert.equal(shouldReadSpecialSheetRegions({
    forceFullPageOcr: true,
    pageComplete: false,
    classicRectangleCount: 4,
    compactRectangleCount: 10,
  }), false);
  assert.equal(shouldReadSpecialSheetRegions({
    forceFullPageOcr: true,
    pageComplete: true,
    classicRectangleCount: 0,
    compactRectangleCount: 10,
  }), false);
  assert.equal(shouldReadSpecialSheetRegions({
    forceFullPageOcr: true,
    pageComplete: true,
    classicRectangleCount: 4,
    compactRectangleCount: 10,
    explicitSpecialMarker: true,
  }), true);
  assert.equal(shouldReadSpecialSheetRegions({
    forceFullPageOcr: true,
    pageComplete: false,
    classicRectangleCount: 0,
    compactRectangleCount: 45,
  }), false);
  assert.equal(shouldReadSpecialSheetRegions({
    forceFullPageOcr: true,
    pageComplete: false,
    classicRectangleCount: 0,
    compactRectangleCount: 45,
    explicitSpecialMarker: true,
  }), true);
});

test("no confunde la mención de Sabrosito del encabezado con una hoja especial", () => {
  assert.equal(
    hasAdditionalGameMarker([{ str: "2 H. SABROSITO", transform: [1, 0, 0, 1, 10, 10] }]),
    false,
  );
  assert.equal(
    hasAdditionalGameMarker([{ str: "HOJA DE SABROSITO", transform: [1, 0, 0, 1, 10, 10] }]),
    true,
  );
});

test("solo usa el fallback de Sabrositos cuando hay un encabezado explícito", () => {
  assert.equal(isSabrositoSheetHeading("HOJA DE SABROSITO · 5 SABROSITOS DE 30"), true);
  assert.equal(isSabrositoSheetHeading("Bingo tradicional · 2 H. SABROSITO"), false);
});

test("distingue la geometría 2×5 de Sabrositos de una hoja 5×5", () => {
  assert.equal(shouldProbeSabrositoGeometryFallback({
    explicitHeading: false,
    classicRectangleCount: 0,
    compactRectangleCount: 10,
  }), true);
  assert.equal(shouldProbeSabrositoGeometryFallback({
    explicitHeading: false,
    classicRectangleCount: 0,
    compactRectangleCount: 45,
  }), false);
  assert.equal(shouldProbeSabrositoGeometryFallback({
    explicitHeading: true,
    classicRectangleCount: 2,
    compactRectangleCount: 10,
  }), false);
});

test("usa muchos marcos compactos como evidencia de página clásica 5×5", () => {
  assert.equal(effectiveClassicGridCount(0, 45), 2);
  assert.equal(effectiveClassicGridCount(0, 10), 0);
  assert.equal(effectiveClassicGridCount(4, 10), 4);
});

test("detecta encabezados OCR de juegos adicionales sin leer promociones comunes", () => {
  assert.equal(isExplicitSpecialSheetHeading("HOJA DE ADICIONAL"), true);
  assert.equal(isExplicitSpecialSheetHeading("HOJADEADICIONA"), true);
  assert.equal(isExplicitSpecialSheetHeading("ADL1 #015263"), true);
  assert.equal(isExplicitSpecialSheetHeading("2 H. SABROSITO"), false);
});

test("reconoce el encabezado de páginas escaneadas con formas numéricas", () => {
  assert.equal(isNumberPatternSheetHeading("HOJA DE NÚMEROS"), true);
  assert.equal(isNumberPatternSheetHeading("HOJA DE NUMEROS"), true);
  assert.equal(isNumberPatternSheetHeading("BINGO 1 2 3 4 5"), false);
});

test("no clasifica como Sabrosito una página con varios cartones 5×5", () => {
  const items: PdfTextItem[] = [];
  for (let card = 0; card < 4; card += 1) {
    const x = card % 2 === 0 ? 60 : 430;
    const top = card < 2 ? 700 : 350;
    for (let row = 0; row < 5; row += 1) {
      const offset = card;
      const values = [
        1 + row + offset,
        16 + row + offset,
        31 + row + offset,
        46 + row + offset,
        61 + row + offset,
      ];
      items.push({
        str: values.join(" "),
        transform: [1, 0, 0, 1, x, top - row * 42],
        width: 150,
        height: 20,
      });
    }
  }
  // Simulate unrelated prize/ad copy that happens to form a 3+2 OCR signature.
  items.push(
    { str: "15 9 4", transform: [1, 0, 0, 1, 260, 820], width: 90, height: 18 },
    { str: "2 1", transform: [1, 0, 0, 1, 275, 772], width: 60, height: 18 },
  );

  assert.ok(
    extractCardsFromTextItems(items.slice(-2), "anuncio.pdf", 1)
      .some((card) => card.layout?.type === "sabrosito-5"),
    "la muestra debe reproducir la falsa firma 3+2 que se elimina con la geometría 5×5",
  );
  const cards = extractCardsFromTextItems(items, "hoja-5x5-con-anuncio.pdf", 1);
  assert.equal(cards.filter((card) => card.layout?.type === "classic-5x5").length, 4);
  assert.equal(cards.some((card) => card.layout?.type === "sabrosito-5"), false);
  const falseSabrosito: BingoCard = {
    id: "s",
    number: "s",
    grid: [1, 2, 3, 4, 5],
    sourceFile: "scan.pdf",
    sourcePage: 1,
    status: "active",
    layout: cardLayoutFor({ grid: [1, 2, 3, 4, 5] }),
  };
  assert.equal(
    removeSabrositoCardsFromClassicSheets([falseSabrosito], 4).length,
    0,
  );
});

test("importa patrones del paquete de Bingo ProMax Studio", () => {
  const result = parseProMaxPackage(JSON.stringify({
    schemaVersion: "1.1",
    source: "bingo-promax-studio",
    cards: [{ number: "STUDIO-001", grid: baseGrid }],
    patterns: [
      { id: "studio-cross", name: "Cruz Studio", cells: [2, 7, 12, 12, 17, 22], active: true },
      { id: "invalid", name: "Sin casillas", cells: [] },
    ],
  }));

  assert.equal(result.cards.length, 1);
  assert.equal(result.patterns.length, 1);
  assert.deepEqual(result.patterns[0].cells, [2, 7, 12, 17, 22]);
  assert.equal(result.patterns[0].active, true);
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

test("recupera identificadores impresos bajo cartones 5×5 sin etiqueta", () => {
  const items: PdfTextItem[] = [];
  const ids = ["BP-2026-000000-003-H000081-C1", "BP-2026-000000-003-H000081-C2"];
  ids.forEach((id, cardIndex) => {
    const x = cardIndex * 300 + 40;
    const grid = baseGrid.map((value) => {
      if (!value) return 0;
      const column = baseGrid.indexOf(value) % 5;
      const minimum = column * 15 + 1;
      return minimum + ((value - minimum + cardIndex) % 15);
    });
    items.push({ str: id, transform: [1, 0, 0, 1, x, 735], width: 230, height: 12 });
    for (let row = 0; row < 5; row += 1) {
      items.push({
        str: rowText(grid, row),
        transform: [1, 0, 0, 1, x, 700 - row * 28],
        width: 150,
        height: 12,
      });
    }
  });

  const cards = extractCardsFromTextItems(items, "bp-2026.pdf", 1);

  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((card) => card.number), ids);
  assert.ok(cards.every((card) => card.reviewStatus === "ready"));
});

test("guarda un 5×5 válido aunque el PDF no tenga número legible", () => {
  const items: PdfTextItem[] = Array.from({ length: 5 }, (_, row) => ({
    str: rowText(baseGrid, row),
    transform: [1, 0, 0, 1, 40, 700 - row * 28],
    width: 150,
    height: 12,
  }));

  const cards = extractCardsFromTextItems(items, "hoja-escaneada.pdf", 3);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].grid.length, 25);
  assert.equal(cards[0].reviewStatus, "ready");
  assert.equal(cards[0].number, "hoja-escaneada-p3-c1-5x5");
});

test("recupera la forma adicional enviada por el cliente antiguo sin alterar 5×5", () => {
  const sparseAvion = Array.from({ length: 25 }, () => 0);
  [2, 5, 8, 10, 11, 14, 15, 18, 22].forEach((index, value) => {
    sparseAvion[index] = value + 1;
  });

  assert.equal(
    cardLayoutFor({ grid: sparseAvion, serial: "Avión", sourceFile: "hoja.pdf" }).type,
    "avion-9",
  );
  assert.deepEqual(
    validateBingoCard({ grid: sparseAvion, serial: "Avión" } as BingoCard),
    [],
  );
  assert.equal(
    cardLayoutFor({ grid: Array.from({ length: 25 }, (_, index) => index + 1), serial: "Avión" }).type,
    "classic-5x5",
  );
  const sparseYapa = Array.from({ length: 25 }, () => 0);
  [0, 2, 4, 10, 12, 14, 20, 22, 24].forEach((index, value) => {
    sparseYapa[index] = value + 1;
  });
  const yapaLayout = cardLayoutFor({ grid: sparseYapa, serial: "Yapa" });
  assert.equal(yapaLayout.type, "yapa-3x3");
  assert.equal(yapaLayout.rows, 5);
  assert.deepEqual(validateBingoCard({ grid: sparseYapa, serial: "Yapa" } as BingoCard), []);
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
  const horizontal = BUILTIN_PATTERNS.find((pattern) => pattern.id === "linea-horizontal");
  const vertical = BUILTIN_PATTERNS.find((pattern) => pattern.id === "linea-vertical");
  assert.ok(horizontal);
  assert.ok(vertical);

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
  const horizontal = BUILTIN_PATTERNS.find(
    (pattern) => pattern.id === "linea-horizontal",
  );
  const vertical = BUILTIN_PATTERNS.find(
    (pattern) => pattern.id === "linea-vertical",
  );
  assert.ok(horizontal);
  assert.ok(vertical);

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
    new Set(["linea-horizontal"]),
  );

  assert.deepEqual(
    firstPass.map((pattern) => pattern.id),
    ["linea-horizontal", "linea-vertical"],
  );
  assert.deepEqual(
    secondPass.map((pattern) => pattern.id),
    ["linea-vertical"],
  );
});

test("incluye las formas adicionales numeradas de la hoja de números", () => {
  const additional = BUILTIN_PATTERNS.filter(
    (pattern) => pattern.category === "Juegos adicionales",
  );

  assert.deepEqual(
    additional.map((pattern) => pattern.id),
    [
      "adicional-avion",
      "adicional-flecha",
      "adicional-espada",
      "adicional-pesa",
      "adicional-rombo",
      "adicional-bomba",
      "adicional-sonrisa",
      "adicional-mini-o",
      "adicional-perrito",
      "adicional-cruz-adicional",
      "adicional-mas",
      "adicional-martillo",
      "adicional-forma-1",
      "adicional-forma-3",
      "adicional-forma-4",
      "adicional-forma-5",
      "adicional-forma-7",
      "adicional-forma-9",
      "adicional-forma-mas",
      "adicional-forma-igual",
    ],
  );
  additional.forEach((pattern) => {
    assert.equal(pattern.cells.length, pattern.variants[0].length);
    assert.ok(pattern.cells.every((cell) => cell >= 0 && cell < 25));
  });
  const numericForms = BUILTIN_PATTERNS.filter((pattern) => pattern.category === "Números");
  assert.deepEqual(
    numericForms.filter((pattern) => pattern.id.startsWith("forma-adicional-")).map((pattern) => pattern.id),
    ["forma-adicional-1", "forma-adicional-3", "forma-adicional-5", "forma-adicional-9"],
    "las formas numéricas #1, #3, #5 y #9 pertenecen al filtro Números, no a Adicionales",
  );
});

test("incluye el catálogo de letras y números sin patrones repetidos", () => {
  const expectedLetters = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", (letter) => `Letra ${letter}`);
  const expectedNumbers = Array.from({ length: 9 }, (_, index) => `Número ${index + 1}`);
  const names = new Set(BUILTIN_PATTERNS.map((pattern) => pattern.name));
  const ids = new Set(BUILTIN_PATTERNS.map((pattern) => pattern.id));

  expectedLetters.concat(expectedNumbers).forEach((name) => assert.ok(names.has(name), name));
  assert.equal(ids.size, BUILTIN_PATTERNS.length, "no debe haber IDs repetidos");

  const glyphs = BUILTIN_PATTERNS.filter(
    (pattern) => pattern.category === "Letras" || pattern.category === "Números",
  );
  const glyphShapes = new Set(glyphs.map((pattern) => pattern.cells.join(",")));
  assert.equal(glyphShapes.size, glyphs.length, "no debe haber geometrías repetidas en el catálogo nuevo");
  glyphs.forEach((pattern) => {
    assert.ok(pattern.cells.length > 0);
    assert.ok(pattern.cells.every((cell) => cell >= 0 && cell < 25));
    assert.deepEqual(pattern.variants, [pattern.cells]);
  });
});

test("no confunde formas seleccionables de 5×5 con juegos adicionales", () => {
  for (const patternName of ["Letra A", "Letra Z", "Número 4", "Número 9"]) {
    const pattern = BUILTIN_PATTERNS.find((item) => item.name === patternName);
    assert.ok(pattern);
    const grid = Array(25).fill(0);
    pattern.cells.forEach((cell, index) => { grid[cell] = index + 1; });
    assert.equal(additionalPatternForCard({ grid }), null);
    assert.ok(patternsForCard({ grid } as BingoCard, [pattern]).some((item) => item.id === pattern.id));
  }
});

test("detecta las formas numéricas de las hojas de números", () => {
  const pattern = BUILTIN_PATTERNS.find((item) => item.id === "numero-3");
  assert.ok(pattern);
  const rows = Array.from({ length: 5 }, (_, row) =>
    pattern.cells
      .filter((cell) => Math.floor(cell / 5) === row)
      .map((cell) => cell % 5),
  );
  const items: PdfTextItem[] = rows.map((columns, row) => ({
    str: columns.map((column) => String(row * 10 + column + 1)).join(" "),
    transform: [1, 0, 0, 1, 100, 700 - row * 45],
    width: Math.max(20, columns.length * 30),
    height: 20,
  }));
  const cards = extractCardsFromTextItems(items, "hoja-de-numeros.pdf", 1);
  assert.ok(cards.some((card) => card.layout?.name === "Número 3"));
});

test("mapea todas las casillas impresas de las formas 1, 3, 5 y 9", () => {
  assert.equal(numberPatternCellIndexes(1).length, 10);
  assert.equal(numberPatternCellIndexes(3).length, 16);
  assert.equal(numberPatternCellIndexes(5).length, 16);
  assert.equal(numberPatternCellIndexes(9).length, 17);
  assert.ok(numberPatternCellIndexes(5).includes(19)); // Forma 5: borde exterior derecho.
  assert.ok(numberPatternCellIndexes(9).includes(1)); // Forma 9: segunda casilla superior.
  assert.ok(numberPatternCellIndexes(9).includes(3)); // Forma 9: cuarta casilla superior.
});

test("reconoce un juego adicional por la figura aunque falte el título", () => {
  const grid = Array(25).fill(0);
  const avion = BUILTIN_PATTERNS.find((pattern) => pattern.id === "adicional-avion");
  assert.ok(avion);
  avion.cells.forEach((cell, index) => { grid[cell] = index + 1; });
  assert.equal(additionalPatternForCard({ grid })?.id, "adicional-avion");
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

test("Sabrosito está en el catálogo por defecto y solo valida su propio cartón cuando está habilitado", () => {
  const card = { grid: [27, 45, 61, 12, 56] } as BingoCard;
  assert.equal(COMPACT_CARD_PATTERN.category, "Sabrositos");
  assert.deepEqual(patternsForCard(card, [BUILTIN_PATTERNS[0]]), []);
  assert.deepEqual(patternsForCard(card, [COMPACT_CARD_PATTERN]).map((pattern) => pattern.id), ["sabrosito-completo"]);
  assert.deepEqual(patternsForCard({ grid: baseGrid } as BingoCard, [COMPACT_CARD_PATTERN]), []);
});

test("un cartón 5×5 admite letras/números seleccionados y excluye juegos adicionales", () => {
  const active = BUILTIN_PATTERNS;
  const ids = new Set(patternsForCard({ grid: baseGrid } as BingoCard, active).map((pattern) => pattern.id));
  assert.equal(ids.has("adicional-avion"), false);
  assert.equal(ids.has("letra-a"), true);
  assert.equal(ids.has("numero-1"), true);
  assert.equal(ids.has("linea-horizontal"), true);
});

test("un juego adicional solo se valida en la forma de hoja que le corresponde", () => {
  const avion = BUILTIN_PATTERNS.find((pattern) => pattern.id === "adicional-avion");
  const espada = BUILTIN_PATTERNS.find((pattern) => pattern.id === "adicional-espada");
  assert.ok(avion && espada);
  const grid = Array(25).fill(0);
  avion.cells.forEach((cell, index) => { grid[cell] = index + 1; });
  const card = { grid } as BingoCard;
  const matches = patternsForCard(card, [avion, espada]);
  assert.deepEqual(matches.map((pattern) => pattern.id), [avion.id]);
});

test("omite un cartón repetido por número o por contenido, aunque cambie de página y archivo", () => {
  const layout = cardLayoutFor({ grid: baseGrid });
  const first: BingoCard = {
    id: "card-1", number: "C-001", serial: "", grid: baseGrid,
    sourceFile: "hoja-a.pdf", sourcePage: 1, status: "active", layout,
  };
  const sameContent = { ...first, id: "card-2", number: "OTRO-ID", sourceFile: "hoja-b.pdf", sourcePage: 34 };
  const sameNumber = { ...first, id: "card-3", number: "c-001", grid: [...baseGrid].reverse() };
  const unique = { ...first, id: "card-4", number: "C-002", grid: [...baseGrid].reverse() };

  const result = deduplicateBingoCards([first, sameContent, sameNumber, unique]);
  assert.deepEqual(result.cards.map((card) => card.id), ["card-1", "card-4"]);
  assert.equal(result.duplicates, 2);
});

test("conserva los patrones de adicionales sincronizados desde Studio y los aísla por geometría", () => {
  const avion = BUILTIN_PATTERNS.find((pattern) => pattern.id === "adicional-avion");
  assert.ok(avion);
  const studioAvion = { ...avion, id: "studio-avion", category: "Juegos adicionales", custom: true };
  const grid = Array(25).fill(0);
  avion.cells.forEach((cell, index) => { grid[cell] = index + 1; });
  assert.deepEqual(patternsForCard({ grid } as BingoCard, [studioAvion]).map((pattern) => pattern.id), ["studio-avion"]);
  assert.equal(patternsForCard({ grid: baseGrid } as BingoCard, [studioAvion]).length, 0);
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

test("detecta los diez cartones Sabrosito de una hoja completa", () => {
  const width = 1_000;
  const height = 1_650;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const drawPixel = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 255;
  };
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const left = 70 + column * 455;
      const top = 240 + row * 270;
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

  assert.equal(rectangles.length, 10);
});

test("detecta cartones Sabrosito alargados de una hoja A4", () => {
  const width = 1_000;
  const height = 1_650;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const drawPixel = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 255;
  };
  for (let column = 0; column < 2; column += 1) {
    const left = 70 + column * 455;
    const top = 300;
    const rectangleWidth = 405;
    const rectangleHeight = 165;
    for (let x = left; x <= left + rectangleWidth; x += 1) {
      drawPixel(x, top);
      drawPixel(x, top + rectangleHeight);
    }
    for (let y = top; y <= top + rectangleHeight; y += 1) {
      drawPixel(left, y);
      drawPixel(left + rectangleWidth, y);
    }
  }
  const rectangles = detectCompactRectangles(pixels, width, height);
  assert.equal(rectangles.length, 2);
});

test("reconoce un formato adicional Mini O con centro libre", () => {
  const items: PdfTextItem[] = [
    { str: "4 61 64", transform: [1, 0, 0, 1, 120, 500], width: 120, height: 20 },
    { str: "41 71", transform: [1, 0, 0, 1, 120, 450], width: 120, height: 20 },
    { str: "53 63 73", transform: [1, 0, 0, 1, 120, 400], width: 120, height: 20 },
  ];
  const cards = extractCardsFromTextItems(items, "adicional.pdf", 16);
  const miniO = cards.find((card) => card.layout?.name === "Mini O");
  assert.ok(miniO);
  assert.equal(miniO.grid.length, 9);
  assert.equal(miniO.grid[4], 0);
  assert.deepEqual(miniO.grid.filter((value) => value !== 0), [4, 61, 64, 41, 71, 53, 63, 73]);
});

test("reconoce las seis formas adicionales de las páginas 12 a 15", () => {
  const forms: Array<[string, number[][]]> = [
    ["Sonrisa", [[11, 29], [4, 50], [20, 25, 41]]],
    ["Mini O", [[12, 30, 42], [24, 45], [28, 31, 48]]],
    ["Perrito", [[2, 16], [18, 53], [27, 45, 61], [42, 70]]],
    ["Cruz", [[27], [18, 20, 42, 50, 60], [44], [46]]],
    ["Más", [[10], [26], [1, 6, 58, 68], [46], [51]]],
    ["Martillo", [[41], [33], [4, 12, 44], [5, 26, 57]]],
  ];

  for (const [name, rows] of forms) {
    const items: PdfTextItem[] = rows.map((row, index) => ({
      str: row.join(" "),
      transform: [1, 0, 0, 1, 100, 500 - index * 50],
      width: Math.max(40, row.length * 30),
      height: 20,
    }));
    const cards = extractCardsFromTextItems(items, "formas-07-10.pdf", 12);
    const card = cards.find((candidate) => candidate.layout?.name === name);
    assert.ok(card, `No se reconoció la forma ${name}`);
    assert.equal(card.layout?.name, name);
  }
});

test("reconoce los formatos adicionales de la nueva hoja", () => {
  const forms: Array<[string, number[][], number]> = [
    ["Línea de 5 números", [[16, 56], [15, 27, 36, 58, 67], [20, 53], [14, 26, 32, 50, 62], [25, 51]], 16],
    ["Llena el loco", [[36], [12, 25, 44, 55, 73], [31], [17, 42, 59]], 10],
    ["Eche leche (7 números)", [[4, 18, 27, 37], [11, 19, 33]], 7],
    ["Bom bom bum (8 números)", [[1, 26, 36, 69], [15, 35, 61, 73]], 8],
    ["Keke Keke (6 números)", [[28, 57], [44, 49], [27, 69]], 6],
    ["Yapa 3×3", [[28, 39, 68], [32, 47, 72], [33, 49, 74]], 9],
  ];

  for (const [name, rows, count] of forms) {
    const items: PdfTextItem[] = rows.map((row, index) => ({
      str: row.join(" "),
      transform: [1, 0, 0, 1, 100, 700 - index * 55],
      width: Math.max(40, row.length * 30),
      height: 20,
    }));
    const cards = extractCardsFromTextItems(items, "adicional-nueva-hoja.pdf", 1);
    const card = cards.find((candidate) => candidate.layout?.name === name);
    assert.ok(card, `No se reconoció la forma ${name}`);
    assert.equal(card.grid.length, count);
  }
});

test("reconoce la variante completa de Loco con once números", () => {
  const items: PdfTextItem[] = [
    [36],
    [12, 25, 44, 55, 73],
    [31],
    [17],
    [42, 59, 68],
  ].map((row, index) => ({
    str: row.join(" "),
    transform: [1, 0, 0, 1, 100, 700 - index * 55],
    width: Math.max(40, row.length * 30),
    height: 20,
  }));
  const card = extractCardsFromTextItems(items, "loco-11.pdf", 1)
    .find((candidate) => candidate.layout?.type === "loco-11");
  assert.ok(card);
  assert.equal(card.grid.length, 11);
  assert.equal(card.layout?.name, "Llena el loco (11 números)");
});

test("reconoce las seis formas de juego de la hoja de adicionales", () => {
  const forms: Array<[string, number[][], number]> = [
    ["Avión", [[41], [2, 52], [14, 37, 70], [17, 55], [50]], 9],
    ["Flecha", [[9, 20, 44], [15, 28], [19, 54], [63], [67]], 9],
    ["Espada", [[50], [53], [56, 68], [64], [61, 72]], 7],
    ["Pesa", [[21, 49], [13, 41, 54], [36, 51]], 7],
    ["Rombo", [[22], [20, 37], [4, 44], [21, 38], [26]], 8],
    ["Bomba", [[12, 64], [30], [27, 56], [43], [18, 72]], 8],
  ];

  for (const [name, rows, count] of forms) {
    const items: PdfTextItem[] = rows.map((row, index) => ({
      str: row.join(" "),
      transform: [1, 0, 0, 1, 100, 700 - index * 55],
      width: Math.max(40, row.length * 30),
      height: 20,
    }));
    const cards = extractCardsFromTextItems(items, "formas-adicionales.pdf", 1);
    const card = cards.find((candidate) => candidate.layout?.name === name);
    assert.ok(card, `No se reconoció la forma ${name}`);
    assert.equal(card.grid.length, count);
    assert.equal(card.grid.filter((value) => value > 0).length, count);
  }
});

test("recupera las seis formas mezcladas en una sola hoja de adicionales", () => {
  const forms: Array<[string, number[][], number, number]> = [
    ["Avión", [[41], [2, 52], [14, 37, 70], [17, 55], [50]], 80, 730],
    ["Flecha", [[9, 20, 44], [15, 28], [19, 54], [63], [67]], 420, 730],
    ["Espada", [[50], [53], [56, 68], [64], [61, 72]], 80, 470],
    ["Pesa", [[21, 49], [13, 41, 54], [36, 51]], 420, 470],
    ["Rombo", [[22], [20, 37], [4, 44], [21, 38], [26]], 80, 230],
    ["Bomba", [[12, 64], [30], [27, 56], [43], [18, 72]], 420, 230],
  ];
  const items: PdfTextItem[] = forms.flatMap(([, rows, x, y]) =>
    rows.map((row, index) => ({
      str: row.join(" "),
      transform: [1, 0, 0, 1, x, y - index * 28],
      width: Math.max(40, row.length * 30),
      height: 20,
    })),
  );
  const cards = extractCardsFromTextItems(items, "hoja-adicional-mixta.pdf", 1);
  const names = cards.map((card) => card.layout?.name);
  for (const [name] of forms) assert.ok(names.includes(name), `Falta ${name}`);
});

test("recupera diez Sabrositos dispuestos en dos columnas y cinco filas", () => {
  const expected = [
    [24, 38, 50, 21, 73], [28, 44, 56, 18, 62],
    [3, 41, 55, 28, 51], [11, 40, 46, 2, 75],
    [7, 42, 52, 22, 59], [28, 37, 74, 5, 49],
    [19, 34, 74, 3, 57], [18, 31, 51, 26, 61],
    [13, 40, 47, 4, 74], [18, 33, 62, 14, 67],
  ];
  const items: PdfTextItem[] = expected.flatMap((values, index) => {
    const x = index % 2 === 0 ? 80 : 420;
    const y = 760 - Math.floor(index / 2) * 150;
    return [
      { str: values.slice(0, 3).join(" "), transform: [1, 0, 0, 1, x, y], width: 150, height: 22 },
      { str: values.slice(3).join(" "), transform: [1, 0, 0, 1, x, y - 48], width: 100, height: 22 },
    ];
  });
  const allCards = extractCardsFromTextItems(items, "hoja-sabrosito.pdf", 1);
  assert.deepEqual(allCards.map((card) => [card.layout?.type, card.grid]), expected.map((grid) => ["sabrosito-5", grid]));
});

test("conserva mini-cartones que comparten el identificador impreso", () => {
  const avionRows = [[41], [2, 52], [14, 37, 70], [17, 55], [50]];
  const flechaRows = [[9, 20, 44], [15, 28], [19, 54], [63], [67]];
  const items: PdfTextItem[] = [
    { str: "ADI-1 #015263", transform: [1, 0, 0, 1, 100, 760], width: 120, height: 20 },
    ...avionRows.map((row, index) => ({
      str: row.join(" "),
      transform: [1, 0, 0, 1, 100, 700 - index * 45],
      width: Math.max(40, row.length * 30),
      height: 20,
    })),
    { str: "ADI-2 #015263", transform: [1, 0, 0, 1, 400, 760], width: 120, height: 20 },
    ...flechaRows.map((row, index) => ({
      str: row.join(" "),
      transform: [1, 0, 0, 1, 400, 700 - index * 45],
      width: Math.max(40, row.length * 30),
      height: 20,
    })),
  ];
  const cards = extractCardsFromTextItems(items, "hoja-adicional.pdf", 1)
    .filter((card) => card.layout?.name === "Avión" || card.layout?.name === "Flecha");
  assert.equal(cards.length, 2);
  assert.equal(new Set(cards.map((card) => card.number)).size, 2);
  assert.ok(cards.every((card) => card.number.includes("015263-")));
});

test("fusiona detecciones repetidas y conserva el formato específico", () => {
  const generic: BingoCard = {
    id: "generic",
    number: "015263",
    grid: [41, 2, 52, 14, 37, 70, 17, 55, 50],
    sourceFile: "hoja.pdf",
    sourcePage: 1,
    status: "active",
  };
  const specific: BingoCard = {
    ...generic,
    id: "specific",
    layout: { type: "avion-9", name: "Avión", rows: 5, columns: 5, cells: [
      { row: 0, column: 2 }, { row: 1, column: 0 }, { row: 1, column: 3 },
      { row: 2, column: 0 }, { row: 2, column: 1 }, { row: 2, column: 4 },
      { row: 3, column: 0 }, { row: 3, column: 3 }, { row: 4, column: 2 },
    ] },
  };
  const merged = mergeDetectedCards([generic], [specific]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].layout?.name, "Avión");
});

test("reconoce Sabrositos en hojas sin recuadros externos", () => {
  const items: PdfTextItem[] = [
    { str: "12 41 75", transform: [1, 0, 0, 1, 120, 500], width: 120, height: 20 },
    { str: "8 63", transform: [1, 0, 0, 1, 120, 450], width: 80, height: 20 },
  ];
  const cards = extractCardsFromTextItems(items, "sabrositos-sin-recuadro.pdf", 18);
  const sabrosito = cards.find((card) => card.layout?.type === "sabrosito-5");
  assert.ok(sabrosito);
  assert.deepEqual(sabrosito.grid, [12, 41, 75, 8, 63]);
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
