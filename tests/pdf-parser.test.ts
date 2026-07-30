import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_PATTERNS,
  isWinningCard,
  type BingoCard,
} from "../lib/bingo";
import {
  extractCardsFromTextItems,
  type PdfTextItem,
} from "../lib/pdf-parser";

const baseGrid = [
  1, 16, 31, 46, 61,
  2, 17, 32, 47, 62,
  3, 18, 0, 48, 63,
  4, 19, 34, 49, 64,
  5, 20, 35, 50, 65,
];

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
