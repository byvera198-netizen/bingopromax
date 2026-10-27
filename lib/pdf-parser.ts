"use client";

import {
  BUILTIN_PATTERNS,
  cardLayoutFor,
  createCardLayout,
  additionalPatternForCard,
  type BingoCard,
  type CardLayout,
} from "./bingo";

export interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
}

interface PositionedNumber {
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  order: number;
}

interface RowSegment {
  values: PositionedNumber[];
  xStart: number;
  xEnd: number;
  xCenter: number;
  y: number;
  width: number;
  rowId: string;
}

interface DetectedGrid {
  grid: number[];
  x: number;
  y: number;
  score: number;
  rowIds: string[];
  layout?: CardLayout;
  reviewNotes?: string[];
}

interface Identifier {
  value: string;
  x: number;
  y: number;
}

interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface OcrSymbol {
  text: string;
  confidence: number;
  bbox: OcrBox;
}

interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrBox;
  symbols?: OcrSymbol[];
}

export interface OcrBlock {
  paragraphs: Array<{
    lines: Array<{
      words: OcrWord[];
    }>;
  }>;
}

type OcrWorker = {
  setParameters: (parameters: Record<string, string>) => Promise<unknown>;
  recognize: (
    image: HTMLCanvasElement,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ) => Promise<{
    data: {
      text: string;
      tsv: string | null;
      blocks: OcrBlock[] | null;
    };
  }>;
  terminate: () => Promise<unknown>;
};

export interface PdfParseProgress {
  page: number;
  pages: number;
  stage: "Leyendo texto" | "Aplicando OCR" | "Validando";
  percent: number;
}

export interface PdfParseResult {
  cards: BingoCard[];
  pages: number;
  warnings: string[];
}

export function normalizePdfPageSelection(pageCount: number, selectedPages?: number[]) {
  const validPageCount = Math.max(0, Math.floor(pageCount));
  if (selectedPages === undefined) {
    return Array.from({ length: validPageCount }, (_, index) => index + 1);
  }
  return [...new Set(selectedPages
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= validPageCount))]
    .sort((left, right) => left - right);
}

export interface GridRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  verticalLines: number[];
  horizontalLines: number[];
  score: number;
}

export interface CompactRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

function sabrositoFallbackRectangles(width: number, height: number): CompactRectangle[] {
  // CamScanner Sabrosito sheets have a stable 2×5 layout even when the
  // printed borders are broken by a watermark. Keep the crop inside each
  // ticket so OCR never sees the neighbouring ticket or the page header.
  const left = width * 0.045;
  const right = width * 0.535;
  const cardWidth = width * 0.42;
  const top = height * 0.15;
  const cardHeight = height * 0.155;
  const pitch = height * 0.165;
  return Array.from({ length: 5 }, (_, row) => [
    { x: left, y: top + row * pitch, width: cardWidth, height: cardHeight },
    { x: right, y: top + row * pitch, width: cardWidth, height: cardHeight },
  ]).flat().map((rectangle) => ({ ...rectangle, score: 70 }));
}

function additionalSheetRectangles(
  width: number,
  height: number,
  hasDedicatedHeader = false,
): CompactRectangle[] {
  const xPositions = [0.045, 0.535];
  // The supplied additional sheets use two common layouts: older pages put
  // the cards directly below their game titles, while "HOJA DE ADICIONAL"
  // pages have a taller masthead. These bands are the card body, not the
  // title/receipt area that used to contaminate regional OCR.
  const yPositions = hasDedicatedHeader ? [0.16, 0.47, 0.77] : [0.1, 0.42, 0.75];
  return yPositions.flatMap((y) => xPositions.map((x) => ({
    x: width * x,
    y: height * y,
    width: width * 0.42,
    height: height * (hasDedicatedHeader ? 0.22 : 0.23),
    score: 65,
  })));
}

function numberPatternSheetRectangles(width: number, height: number): CompactRectangle[] {
  // The supplied "HOJA DE NÚMEROS" is a two-by-two sheet of 5×5 grids.
  // Unlike additional tickets, each numeric glyph occupies a subset of one
  // full grid, so keep the four ticket regions separate from the page header.
  return [0.262, 0.676].flatMap((y) => [0.045, 0.535].map((x) => ({
    x: width * x,
    y: height * y,
    width: width * 0.42,
    height: height * 0.275,
    score: 70,
  })));
}

export function numberPatternCellIndexes(id: 1 | 3 | 5 | 9) {
  const cells: Record<1 | 3 | 5 | 9, number[]> = {
    1: [2, 6, 7, 10, 17, 20, 21, 22, 23, 24],
    3: [0, 1, 2, 3, 4, 9, 10, 11, 13, 14, 19, 20, 21, 22, 23, 24],
    5: [0, 1, 2, 3, 4, 5, 10, 11, 13, 14, 19, 20, 21, 22, 23, 24],
    9: [0, 1, 2, 3, 4, 5, 9, 10, 11, 13, 14, 19, 20, 21, 22, 23, 24],
  };
  return cells[id];
}

export function isNumberPatternSheetHeading(text: string) {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return /\bhoja\s+de\s+numer(?:o|os|0|05)\b/.test(normalized) || /hojadenumer/.test(compact);
}

function countGridValues(cards: BingoCard[]) {
  return cards.reduce(
    (total, card) => total + card.grid.filter((value) => value > 0).length,
    0,
  );
}

function hasCompletePageRead(cards: BingoCard[], observedNumbers: number) {
  if (!cards.length) return false;
  const namedCards = cards.filter((card) => card.layout?.type !== "classic-5x5");
  // Sabrosito cards are also non-classic layouts, so don't let six partially
  // detected Sabrositos satisfy the six-game additional-sheet threshold.
  const sabrositos = namedCards.filter(
    (card) => card.layout?.type === "sabrosito-5",
  );
  const additionalGames = namedCards.length - sabrositos.length;
  // These supplier sheets have stable counts. A partial set must continue to
  // the regional fallback instead of prematurely returning its first cards.
  if (sabrositos.length >= 10) return true;
  if (additionalGames >= 6 && sabrositos.length === 0) return true;
  return countGridValues(cards) >= Math.max(12, observedNumbers * 0.77);
}

export function shouldReadSpecialSheetRegions({
  forceFullPageOcr,
  pageComplete,
  classicRectangleCount,
  compactRectangleCount,
  explicitSpecialMarker = false,
}: {
  forceFullPageOcr: boolean;
  pageComplete: boolean;
  classicRectangleCount: number;
  compactRectangleCount: number;
  explicitSpecialMarker?: boolean;
}) {
  if (!forceFullPageOcr || (pageComplete && !explicitSpecialMarker)) return false;
  if (classicRectangleCount >= 2 && !explicitSpecialMarker) return false;
  // Image uploads often have too few high-confidence page-wide OCR tokens to
  // reach the normal threshold. Inspect regional templates only when the
  // page marker or compact-form geometry identifies a special sheet. Without
  // this gate, every scanned 5×5 page paid for six unnecessary OCR crops.
  const specialSheetGeometry =
    compactRectangleCount >= 6 && compactRectangleCount <= 35;
  return explicitSpecialMarker || specialSheetGeometry;
}

export function effectiveClassicGridCount(
  classicRectangleCount: number,
  compactRectangleCount: number,
) {
  // Many interrupted 5×5 scans do not satisfy the strict 6×6 line detector,
  // but their dozens of repeated cell frames still identify a regular card
  // sheet. Use that evidence to reject coincidental 3+2 Sabrosito signatures.
  return classicRectangleCount >= 2 || compactRectangleCount > 35
    ? Math.max(classicRectangleCount, 2)
    : classicRectangleCount;
}

function removeMisclassifiedClassicCards(cards: BingoCard[]) {
  const namedCards = cards.filter((card) => card.layout?.type !== "classic-5x5");
  if (!namedCards.length) return cards;
  return cards.filter((card) => {
    if (card.layout?.type !== "classic-5x5") return true;
    const values = new Set(card.grid.filter((value) => value > 0));
    const overlapsNamedCard = namedCards.some((named) => {
      const namedValues = new Set(named.grid.filter((value) => value > 0));
      const overlap = [...values].filter((value) => namedValues.has(value)).length;
      return overlap >= Math.min(5, Math.ceil(values.size * 0.55));
    });
    return !overlapsNamedCard;
  });
}

export function removeSabrositoCardsFromClassicSheets(
  cards: BingoCard[],
  classicGridCount: number,
) {
  // A Sabrosito sheet contains compact 3+2-number tickets, while these scan
  // pages contain several full B-I-N-G-O 5×5 grids. OCR can accidentally
  // stitch partial rows inside those grids into a 3+2 signature; the sheet's
  // repeated 5×5 geometry is stronger evidence than that coincidental shape.
  if (classicGridCount < 2) return cards;
  return cards.filter((card) => card.layout?.type !== "sabrosito-5");
}

function longestDarkRun(
  length: number,
  isDark: (index: number) => boolean,
  allowedGap = 2,
) {
  let best = 0;
  let start = 0;
  let lastDark = -1;
  let gap = 0;
  for (let index = 0; index < length; index += 1) {
    if (isDark(index)) {
      if (lastDark < 0 || gap > allowedGap) start = index;
      lastDark = index;
      gap = 0;
      best = Math.max(best, lastDark - start + 1);
    } else if (lastDark >= 0) {
      gap += 1;
    }
  }
  return best;
}

function groupLineBands(values: Array<{ position: number; strength: number }>) {
  const groups: Array<Array<{ position: number; strength: number }>> = [];
  for (const value of values) {
    const current = groups.at(-1);
    if (
      current &&
      value.position - current[current.length - 1].position <= 3
    ) {
      current.push(value);
    } else {
      groups.push([value]);
    }
  }
  return groups.map((group) =>
    group.sort((a, b) => b.strength - a.strength)[0],
  );
}

function lineSequences(
  lines: Array<{ position: number; strength: number }>,
  fullSize: number,
) {
  const sequences: number[][] = [];
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 1; second < lines.length; second += 1) {
      const spacing = lines[second].position - lines[first].position;
      const span = spacing * 5;
      if (
        spacing < fullSize * 0.025 ||
        span < fullSize * 0.14 ||
        span > fullSize * 0.72
      ) {
        continue;
      }
      const positions = [lines[first].position, lines[second].position];
      let valid = true;
      for (let index = 2; index < 6; index += 1) {
        const expected = lines[first].position + spacing * index;
        const match = lines
          .filter((line) => line.position > positions[positions.length - 1])
          .map((line) => ({
            position: line.position,
            distance: Math.abs(line.position - expected),
          }))
          .filter((line) => line.distance <= spacing * 0.16)
          .sort((a, b) => a.distance - b.distance)[0];
        if (!match) {
          valid = false;
          break;
        }
        positions.push(match.position);
      }
      if (!valid) continue;
      const key = positions.join(",");
      if (!sequences.some((sequence) => sequence.join(",") === key)) {
        sequences.push(positions);
      }
    }
  }
  return sequences;
}

export function detectGridRectangles(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
) {
  const isDark = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    return red * 0.3 + green * 0.59 + blue * 0.11 < 112;
  };
  const horizontal = groupLineBands(
    Array.from({ length: height }, (_, y) => ({
      position: y,
      strength: longestDarkRun(width, (x) => isDark(x, y), 3),
    })).filter((line) => line.strength >= width * 0.16),
  );
  const vertical = groupLineBands(
    Array.from({ length: width }, (_, x) => ({
      position: x,
      strength: longestDarkRun(height, (y) => isDark(x, y), 3),
    })).filter((line) => line.strength >= height * 0.1),
  );
  const horizontalSequences = lineSequences(horizontal, height);
  const verticalSequences = lineSequences(vertical, width);
  const rectangles: GridRectangle[] = [];

  for (const horizontalLines of horizontalSequences) {
    for (const verticalLines of verticalSequences) {
      const rectangleWidth = verticalLines[5] - verticalLines[0];
      const rectangleHeight = horizontalLines[5] - horizontalLines[0];
      const ratio = rectangleWidth / Math.max(rectangleHeight, 1);
      if (ratio < 0.72 || ratio > 1.7) continue;
      const radius = Math.max(2, Math.round(Math.min(width, height) * 0.002));
      let intersections = 0;
      for (const y of horizontalLines) {
        for (const x of verticalLines) {
          let found = false;
          for (let offsetY = -radius; offsetY <= radius && !found; offsetY += 1) {
            for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
              const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
              const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
              if (isDark(sampleX, sampleY)) {
                found = true;
                break;
              }
            }
          }
          if (found) intersections += 1;
        }
      }
      if (intersections < 29) continue;
      const verticalDensity =
        verticalLines.reduce((sum, x) => {
          let darkPixels = 0;
          for (let y = horizontalLines[0]; y <= horizontalLines[5]; y += 1) {
            if (isDark(x, y)) darkPixels += 1;
          }
          return sum + darkPixels / Math.max(1, rectangleHeight);
        }, 0) / 6;
      const horizontalDensity =
        horizontalLines.reduce((sum, y) => {
          let darkPixels = 0;
          for (let x = verticalLines[0]; x <= verticalLines[5]; x += 1) {
            if (isDark(x, y)) darkPixels += 1;
          }
          return sum + darkPixels / Math.max(1, rectangleWidth);
        }, 0) / 6;
      rectangles.push({
        x: verticalLines[0],
        y: horizontalLines[0],
        width: rectangleWidth,
        height: rectangleHeight,
        verticalLines,
        horizontalLines,
        score:
          intersections +
          verticalDensity * 28 +
          horizontalDensity * 28,
      });
    }
  }

  const selected: GridRectangle[] = [];
  for (const rectangle of rectangles.sort((a, b) => b.score - a.score)) {
    const duplicate = selected.some((other) => {
      const intersectionWidth = Math.max(
        0,
        Math.min(rectangle.x + rectangle.width, other.x + other.width) -
          Math.max(rectangle.x, other.x),
      );
      const intersectionHeight = Math.max(
        0,
        Math.min(rectangle.y + rectangle.height, other.y + other.height) -
          Math.max(rectangle.y, other.y),
      );
      const intersection = intersectionWidth * intersectionHeight;
      const smallerArea = Math.min(
        rectangle.width * rectangle.height,
        other.width * other.height,
      );
      return intersection / Math.max(1, smallerArea) > 0.38;
    });
    if (!duplicate) selected.push(rectangle);
  }
  return selected.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function detectCompactRectangles(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
) {
  const isDark = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return (
      rgba[offset] * 0.3 +
        rgba[offset + 1] * 0.59 +
        rgba[offset + 2] * 0.11 <
      112
    );
  };
  const horizontal = groupLineBands(
    Array.from({ length: height }, (_, y) => ({
      position: y,
      strength: longestDarkRun(width, (x) => isDark(x, y), 3),
    // Watermarks interrupt the printed frame, so accept shorter continuous
    // runs while the corner and edge-density checks below still reject noise.
    })).filter((line) => line.strength >= width * 0.16),
  );
  const vertical = groupLineBands(
    Array.from({ length: width }, (_, x) => ({
      position: x,
      strength: longestDarkRun(height, (y) => isDark(x, y), 3),
    })).filter((line) => line.strength >= height * 0.055),
  );
  const candidates: CompactRectangle[] = [];
  for (let leftIndex = 0; leftIndex < vertical.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < vertical.length;
      rightIndex += 1
    ) {
      const left = vertical[leftIndex].position;
      const right = vertical[rightIndex].position;
      const rectangleWidth = right - left;
      if (
        rectangleWidth < width * 0.25 ||
        rectangleWidth > width * 0.55
      ) {
        continue;
      }
      for (let topIndex = 0; topIndex < horizontal.length; topIndex += 1) {
        for (
          let bottomIndex = topIndex + 1;
          bottomIndex < horizontal.length;
          bottomIndex += 1
        ) {
          const top = horizontal[topIndex].position;
          const bottom = horizontal[bottomIndex].position;
          const rectangleHeight = bottom - top;
          if (
            top < height * 0.14 ||
            // Sabrosito cards are short 3+2 cards; on A4 scans their
            // height is commonly close to 8–11% of the page.
            rectangleHeight < height * 0.065 ||
            rectangleHeight > height * 0.3
          ) {
            continue;
          }
          const ratio = rectangleWidth / rectangleHeight;
          // The printed Sabrosito frame is wider than the synthetic compact
          // fixtures used by older tests (roughly 2.4–2.8:1).
          if (ratio < 1.25 || ratio > 3.2) continue;
          const radius = Math.max(2, Math.round(Math.min(width, height) * 0.002));
          const corners = [
            [left, top],
            [right, top],
            [left, bottom],
            [right, bottom],
          ];
          const cornerCount = corners.filter(([x, y]) => {
            for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
              for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
                const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
                const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
                if (isDark(sampleX, sampleY)) return true;
              }
            }
            return false;
          }).length;
          if (cornerCount < 4) continue;
          const edgeDensity = [
            [left, top, left, bottom],
            [right, top, right, bottom],
            [left, top, right, top],
            [left, bottom, right, bottom],
          ].reduce((sum, [x0, y0, x1, y1]) => {
            const samples = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
            let dark = 0;
            for (let sample = 0; sample <= samples; sample += 1) {
              const x = Math.round(x0 + ((x1 - x0) * sample) / samples);
              const y = Math.round(y0 + ((y1 - y0) * sample) / samples);
              if (isDark(x, y)) dark += 1;
            }
            return sum + dark / Math.max(1, samples);
          }, 0) / 4;
          if (edgeDensity < 0.32) continue;
          candidates.push({
            x: left,
            y: top,
            width: rectangleWidth,
            height: rectangleHeight,
            score: edgeDensity * 100,
          });
        }
      }
    }
  }
  const selected: CompactRectangle[] = [];
  for (const rectangle of candidates.sort((a, b) => b.score - a.score)) {
    const overlaps = selected.some((other) => {
      const intersectionWidth = Math.max(
        0,
        Math.min(rectangle.x + rectangle.width, other.x + other.width) -
          Math.max(rectangle.x, other.x),
      );
      const intersectionHeight = Math.max(
        0,
        Math.min(rectangle.y + rectangle.height, other.y + other.height) -
          Math.max(rectangle.y, other.y),
      );
      const intersection = intersectionWidth * intersectionHeight;
      const smaller = Math.min(
        rectangle.width * rectangle.height,
        other.width * other.height,
      );
      return intersection / Math.max(1, smaller) > 0.55;
    });
    if (!overlaps) selected.push(rectangle);
  }
  return selected.sort((a, b) => a.y - b.y || a.x - b.x);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function coefficientOfVariation(values: number[]) {
  if (!values.length) return 1;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!average) return 1;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance) / average;
}

function isPlausibleGrid(grid: number[]) {
  if (grid.length !== 25) return false;
  const values = grid.filter((value) => value !== 0);
  if (values.length < 24 || new Set(values).size !== values.length) return false;
  return values.every((value) => Number.isInteger(value) && value >= 1 && value <= 90);
}

function gridQuality(grid: number[]) {
  if (!isPlausibleGrid(grid)) return -1;
  let score = 8;
  if (grid[12] === 0) score += 1;
  const standardRanges = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75],
  ];
  let standardMatches = 0;
  let standardTotal = 0;
  for (let index = 0; index < grid.length; index += 1) {
    if (grid[index] === 0) continue;
    const [minimum, maximum] = standardRanges[index % 5];
    standardTotal += 1;
    if (grid[index] >= minimum && grid[index] <= maximum) standardMatches += 1;
  }
  score += standardTotal ? (standardMatches / standardTotal) * 7 : 0;
  return score;
}

function numberMatches(text: string) {
  return [...text.matchAll(/(?<![\d])(?:[1-9]|[1-8]\d|90)(?![\d])/g)];
}

function tokensFromTextItems(items: PdfTextItem[]) {
  const tokens: PositionedNumber[] = [];
  items.forEach((item, itemIndex) => {
    const matches = numberMatches(item.str);
    if (!matches.length || item.transform.length < 6) return;
    const fullWidth = Math.max(Number(item.width) || item.str.length * 7, matches.length * 7);
    const height = Math.max(Number(item.height) || Math.abs(item.transform[3]) || 8, 6);
    for (const [matchIndex, match] of matches.entries()) {
      const characterIndex = match.index ?? 0;
      const characterWidth = fullWidth / Math.max(item.str.length, 1);
      const value = Number(match[0]);
      tokens.push({
        value,
        x: item.transform[4] + characterIndex * characterWidth,
        y: item.transform[5],
        width: Math.max(match[0].length * characterWidth, 5),
        height,
        order: itemIndex * 100 + matchIndex,
      });
    }
  });
  return tokens;
}

function identifiersFromTextItems(items: PdfTextItem[]) {
  const identifiers: Identifier[] = [];
  const tabExpression = /(?:tab(?:la)?|ticket|serie)\s*#?\s*([a-z0-9][a-z0-9._-]{0,23})/giu;
  const bareNumber = /#\s*([0-9]{3,}(?:[-_][a-z0-9]{1,8})?)/giu;
  // Bingo-generated 5×5 sheets commonly print the ticket identifier alone
  // below each grid (for example BP-2026-...-C1), without the word “cartón”.
  // Capture only identifiers ending in a card suffix so page/batch headers do
  // not become ticket numbers.
  const printedCardId = /\b([a-z]{1,8}-\d{4}(?:[-_][a-z0-9]{1,18}){2,}[-_]c\d{1,4})\b/giu;
  const expression =
    /(?:cart[oó]n|tabla|ticket|serie)\s*(?:n(?:úm(?:ero)?)?\.?|n[°ºo]?|#)?\s*[:\-]?\s*([a-z0-9][a-z0-9._-]{0,23})/giu;
  for (const item of items) {
    if (item.transform.length < 6) continue;
    for (const match of item.str.matchAll(expression)) {
      identifiers.push({
        value: match[1],
        x: item.transform[4],
        y: item.transform[5],
      });
    }
    for (const match of item.str.matchAll(tabExpression)) {
      identifiers.push({ value: match[1], x: item.transform[4], y: item.transform[5] });
    }
    for (const match of item.str.matchAll(bareNumber)) {
      identifiers.push({ value: match[1], x: item.transform[4] + (match.index ?? 0), y: item.transform[5] });
    }
    for (const match of item.str.matchAll(printedCardId)) {
      identifiers.push({ value: match[1], x: item.transform[4] + (match.index ?? 0), y: item.transform[5] });
    }
  }
  return identifiers.filter(
    (identifier, index, all) =>
      all.findIndex(
        (other) =>
          other.value === identifier.value &&
          Math.abs(other.x - identifier.x) < 2 &&
          Math.abs(other.y - identifier.y) < 2,
      ) === index,
  );
}

export function hasAdditionalGameMarker(items: PdfTextItem[]) {
  const text = items.map((item) => item.str).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Only force OCR for pages explicitly identified as special sheets. A
  // generic "línea" or "número" mention appears in ordinary 5×5 headers and
  // used to trigger a second full-page OCR pass for every already-readable
  // page, making large PDFs unnecessarily slow.
  // A regular 5×5 sheet often mentions the Sabrosito prize in its header
  // (for example “2 H. SABROSITO”).  That text must not force the expensive
  // special-sheet OCR path; only an explicit sheet heading identifies a
  // Sabrosito/additional page.
  return /\bhoja\s+de\s+(?:adicional|numero(?:s)?)\b|\bhoja\s+de\s+sabrosit(?:o|os)\b/.test(text);
}

export function isSabrositoSheetHeading(text: string) {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\bhoja\s+de\s+sabrosit/.test(normalized) ||
    /\b5\s+sabrositos?\s+de\s+30\b/.test(normalized);
}

export function isExplicitSpecialSheetHeading(text: string) {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return /\bhoja\s+de\s+(?:adiciona(?:l|1)?|numeros?|sabrosit)/.test(normalized) ||
    /hojade(?:adiciona(?:l|1)?|numeros?|sabrosit)/.test(compact) ||
    /\bad[i1l][\s-]*\d\s*#?\d{4,}/.test(normalized);
}

export function shouldProbeSabrositoGeometryFallback({
  explicitHeading,
  classicRectangleCount,
  compactRectangleCount,
}: {
  explicitHeading: boolean;
  classicRectangleCount: number;
  compactRectangleCount: number;
}) {
  if (classicRectangleCount >= 2) return false;
  // A genuine ten-ticket sheet produces about ten compact frames. Ordinary
  // 5×5 pages produce many more small cell/frame candidates, and should not
  // be sampled as if they were two columns of Sabrositos.
  return explicitHeading ||
    (compactRectangleCount >= 8 && compactRectangleCount <= 16);
}

function expectedSpecialCardCount(items: PdfTextItem[]) {
  const text = items.map((item) => item.str).join(" ").toLocaleLowerCase("es");
  if (/hoja\s+de\s+sabrosit/.test(text)) return 10;
  if (/hoja\s+de\s+adicional/.test(text)) return 6;
  if (/hoja\s+de\s+numero/.test(text)) return 8;
  return 0;
}

function groupIntoRows(numbers: PositionedNumber[]) {
  const ordered = [...numbers].sort((a, b) => b.y - a.y || a.x - b.x);
  const typicalHeight = median(numbers.map((number) => number.height)) || 8;
  const tolerance = Math.max(3, Math.min(10, typicalHeight * 0.58));
  const rows: PositionedNumber[][] = [];
  for (const number of ordered) {
    const closest = rows
      .map((row, index) => ({
        index,
        distance: Math.abs(
          row.reduce((sum, item) => sum + item.y, 0) / row.length - number.y,
        ),
      }))
      .filter((candidate) => candidate.distance <= tolerance)
      .sort((a, b) => a.distance - b.distance)[0];
    if (closest) rows[closest.index].push(number);
    else rows.push([number]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

function splitAtLargeGaps(row: PositionedNumber[]) {
  if (row.length <= 5) return [row];
  const gaps = row.slice(1).map((item, index) => item.x - (row[index].x + row[index].width));
  const positiveGaps = gaps.filter((gap) => gap > 1).sort((a, b) => a - b);
  const typicalGap = median(positiveGaps.slice(0, Math.max(1, Math.ceil(positiveGaps.length * 0.65)))) || 8;
  const typicalWidth = median(row.map((item) => item.width)) || 8;
  const threshold = Math.max(typicalGap * 2.25, typicalWidth * 2.3, 16);
  const groups: PositionedNumber[][] = [];
  let current: PositionedNumber[] = [];
  row.forEach((item, index) => {
    if (index > 0 && gaps[index - 1] > threshold && current.length >= 4) {
      groups.push(current);
      current = [];
    }
    current.push(item);
  });
  if (current.length) groups.push(current);
  return groups;
}

function chunkRowGroup(group: PositionedNumber[]) {
  if (group.length < 4) return [];
  if (group.length <= 5) return [group];
  const candidates: PositionedNumber[][] = [];
  if (group.length % 5 === 0) {
    for (let index = 0; index < group.length; index += 5) {
      candidates.push(group.slice(index, index + 5));
    }
    return candidates;
  }
  for (let index = 0; index + 4 < group.length; index += 5) {
    candidates.push(group.slice(index, index + 5));
  }
  const remainder = group.length % 5;
  if (remainder === 4) candidates.push(group.slice(-4));
  return candidates;
}

function normalizeRow(values: PositionedNumber[]) {
  const sorted = [...values].sort((a, b) => a.x - b.x);
  if (sorted.length === 5) return sorted.map((item) => item.value);
  if (sorted.length !== 4) return [];
  const centers = sorted.map((item) => item.x + item.width / 2);
  const gaps = centers.slice(1).map((center, index) => center - centers[index]);
  const typicalGap = median(gaps) || 1;
  const largestGap = Math.max(...gaps);
  const insertion =
    largestGap > typicalGap * 1.45 ? gaps.indexOf(largestGap) + 1 : 2;
  const result = sorted.map((item) => item.value);
  result.splice(insertion, 0, 0);
  return result;
}

function rowSegments(numbers: PositionedNumber[]) {
  return groupIntoRows(numbers).flatMap((row, rowIndex) =>
    splitAtLargeGaps(row).flatMap((group, groupIndex) =>
      chunkRowGroup(group)
        .filter((chunk) => chunk.length >= 4)
        .map((chunk, chunkIndex) => {
          const xStart = Math.min(...chunk.map((item) => item.x));
          const xEnd = Math.max(...chunk.map((item) => item.x + item.width));
          return {
            values: chunk,
            xStart,
            xEnd,
            xCenter: (xStart + xEnd) / 2,
            y: chunk.reduce((sum, item) => sum + item.y, 0) / chunk.length,
            width: xEnd - xStart,
            rowId: `${rowIndex}:${groupIndex}:${chunkIndex}`,
          } satisfies RowSegment;
        }),
    ),
  );
}

function clusterSegments(segments: RowSegment[]) {
  const clusters: RowSegment[][] = [];
  for (const segment of [...segments].sort((a, b) => a.xCenter - b.xCenter)) {
    const best = clusters
      .map((cluster, index) => {
        const center = median(cluster.map((item) => item.xCenter));
        const width = median(cluster.map((item) => item.width)) || segment.width;
        const overlap = Math.max(
          0,
          Math.min(segment.xEnd, Math.max(...cluster.map((item) => item.xEnd))) -
            Math.max(segment.xStart, Math.min(...cluster.map((item) => item.xStart))),
        );
        const overlapRatio = overlap / Math.max(1, Math.min(width, segment.width));
        return {
          index,
          distance: Math.abs(center - segment.xCenter),
          acceptable:
            overlapRatio > 0.42 ||
            Math.abs(center - segment.xCenter) < Math.max(28, width * 0.28),
        };
      })
      .filter((candidate) => candidate.acceptable)
      .sort((a, b) => a.distance - b.distance)[0];
    if (best) clusters[best.index].push(segment);
    else clusters.push([segment]);
  }
  return clusters;
}

function detectPositionedGrids(numbers: PositionedNumber[]) {
  const detected: DetectedGrid[] = [];
  for (const cluster of clusterSegments(rowSegments(numbers))) {
    const ordered = [...cluster].sort((a, b) => b.y - a.y);
    const candidates: DetectedGrid[] = [];
    for (let index = 0; index + 4 < ordered.length; index += 1) {
      const group = ordered.slice(index, index + 5);
      const grid = group.flatMap((segment) => normalizeRow(segment.values));
      const quality = gridQuality(grid);
      if (quality < 8) continue;
      const verticalGaps = group
        .slice(1)
        .map((segment, gapIndex) => Math.abs(group[gapIndex].y - segment.y));
      const spacingScore = Math.max(0, 3 - coefficientOfVariation(verticalGaps) * 4);
      const horizontalScore = Math.max(
        0,
        2 -
          coefficientOfVariation(group.map((segment) => segment.xCenter)) * 5,
      );
      candidates.push({
        grid,
        x: median(group.map((segment) => segment.xCenter)),
        y: Math.max(...group.map((segment) => segment.y)),
        score: quality + spacingScore + horizontalScore,
        rowIds: group.map((segment) => segment.rowId),
      });
    }
    const usedRows = new Set<string>();
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      if (candidate.rowIds.some((rowId) => usedRows.has(rowId))) continue;
      candidate.rowIds.forEach((rowId) => usedRows.add(rowId));
      detected.push(candidate);
    }
  }
  return detected.filter(
    (candidate, index, all) =>
      all.findIndex((other) => other.grid.join(",") === candidate.grid.join(",")) ===
      index,
  );
}

function detectSequentialGrids(numbers: PositionedNumber[]) {
  const ordered = [...numbers].sort((a, b) => a.order - b.order);
  const candidates: Array<DetectedGrid & { start: number; length: number }> = [];
  for (let start = 0; start + 23 < ordered.length; start += 1) {
    for (const length of [25, 24]) {
      if (start + length > ordered.length) continue;
      const values = ordered.slice(start, start + length).map((item) => item.value);
      const grid =
        length === 24
          ? [...values.slice(0, 12), 0, ...values.slice(12)]
          : values;
      const quality = gridQuality(grid);
      if (quality < 8) continue;
      candidates.push({
        grid,
        x: ordered[start].x,
        y: ordered[start].y,
        score: quality,
        rowIds: [],
        start,
        length,
      });
    }
  }
  const selected: typeof candidates = [];
  const occupied = new Set<number>();
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const indexes = Array.from(
      { length: candidate.length },
      (_, offset) => candidate.start + offset,
    );
    if (indexes.some((index) => occupied.has(index))) continue;
    indexes.forEach((index) => occupied.add(index));
    selected.push(candidate);
  }
  return selected
    .sort((a, b) => a.start - b.start)
    .filter(
      (candidate, index, all) =>
        all.findIndex((other) => other.grid.join(",") === candidate.grid.join(",")) ===
        index,
    );
}

function cardsFromDetectedGrids(
  grids: DetectedGrid[],
  fileName: string,
  page: number,
  identifiers: Identifier[] = [],
) {
  const orderedGrids = [...grids].sort((a, b) => b.y - a.y || a.x - b.x);
  const orderedIdentifiers = [...identifiers].sort(
    (a, b) => b.y - a.y || a.x - b.x,
  );
  const usedNumbers = new Set<string>();
  return orderedGrids.map((detected, index) => {
    const positionalIdentifier =
      orderedIdentifiers.length === orderedGrids.length
        ? orderedIdentifiers[index]
        : undefined;
    const nearestIdentifier = positionalIdentifier ?? orderedIdentifiers
      .map((identifier) => ({
        identifier,
        distance:
          Math.abs(identifier.x - detected.x) +
          Math.abs(identifier.y - detected.y) * 1.8,
      }))
      .filter(({ identifier }) => identifier.y >= detected.y - 90)
      .sort((a, b) => a.distance - b.distance)[0]?.identifier;
    const layout = detected.layout ?? cardLayoutFor({ grid: detected.grid });
    const reviewNotes = [...(detected.reviewNotes ?? [])];
    let number = nearestIdentifier?.value ?? "";
    // A sheet of additional games normally prints the same batch number on
    // every mini-card (for example ``#015263`` appears six times).  Keeping
    // that value verbatim makes the first card save and all remaining cards
    // look like duplicates.  Include the detected form in the identifier so
    // every additional card from the sheet is persisted independently while
    // retaining the original number for ordinary 5×5 tickets.
    const isAdditionalCard =
      layout.type !== "classic-5x5" ||
      detected.grid.length !== 25 ||
      Boolean(additionalPatternForCard({ grid: detected.grid }));
    if (isAdditionalCard && number) {
      const form = layout.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      number = `${number}-${form || "adicional"}`;
    }
    // Image-only sheets often have no machine-readable ticket number at all.
    // Give those valid additional cards a deterministic local identifier so
    // they can still be saved and played instead of being stranded in the
    // review queue with an empty number.
    if (isAdditionalCard && !number) {
      const form = layout.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      const sourceStem = fileName
        .replace(/\.[^.]+$/i, "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 18)
        .toLowerCase() || "pdf";
      number = `${sourceStem}-p${page}-c${index + 1}-${form || "adicional"}`;
    }
    // Some scanned 5×5 sheets have no machine-readable ticket number at all.
    // Do not strand an otherwise valid grid in the review queue: assign a
    // deterministic local identifier that the user can edit after import.
    if (!number) {
      const sourceStem = fileName
        .replace(/\.[^.]+$/i, "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 18)
        .toLowerCase() || "pdf";
      number = `${sourceStem}-p${page}-c${index + 1}-5x5`;
    }
    const baseNumber = number;
    let suffix = 2;
    while (number && usedNumbers.has(number.toLowerCase())) {
      number = `${baseNumber}-${suffix}`;
      suffix += 1;
    }
    if (number) usedNumbers.add(number.toLowerCase());
    return {
      id: crypto.randomUUID(),
      number,
      serial: "",
      grid: detected.grid,
      sourceFile: fileName,
      sourcePage: page,
      status: "active" as const,
      layout,
      reviewStatus: reviewNotes.length ? "needs-review" as const : "ready" as const,
      reviewNotes,
    };
  });
}

function detectionKey(card: Pick<BingoCard, "grid">) {
  return card.grid.join(",");
}

/**
 * OCR can find the same card through the line detector, token grouping and
 * the special-form detector.  Merge those results before showing the review
 * dialog.  A named layout always wins over a generic length-based fallback.
 */
export function mergeDetectedCards(...groups: BingoCard[][]) {
  const merged = new Map<string, BingoCard>();
  const quality = (card: BingoCard) => {
    const layout = card.layout;
    const named = layout && layout.type !== "classic-5x5" && layout.type !== "custom";
    const notes = card.reviewNotes?.length ?? 0;
    return (named ? 100 : 0) + (layout?.type === "custom" ? 40 : 0) + card.grid.length - notes;
  };
  for (const group of groups) {
    for (const card of group) {
      const key = detectionKey(card);
      const current = merged.get(key);
      if (!current || quality(card) > quality(current)) merged.set(key, card);
    }
  }
  return [...merged.values()];
}

function cardsFromTokens(
  tokens: PositionedNumber[],
  fileName: string,
  page: number,
  identifiers: Identifier[] = [],
) {
  const positioned = detectPositionedGrids(tokens);
  const grids =
    positioned.length > 0 ? positioned : detectSequentialGrids(tokens);
  return cardsFromDetectedGrids(grids, fileName, page, identifiers);
}

type SpecialCardDefinition = {
  layout: CardLayout;
  rowLengths: number[];
  /** Zero-based positions to insert for the printed centre/free cells. */
  freeIndexes?: number[];
};

function additionalLayout(
  name: string,
  cells: Array<{ row: number; column: number }>,
  options: { rows?: number; columns?: number; cellShape?: CardLayout["cellShape"] } = {},
): CardLayout {
  return {
    type: "custom",
    name,
    rows: options.rows ?? 5,
    columns: options.columns ?? 5,
    cells,
    cellShape: options.cellShape,
  };
}

const specialCardDefinitions: SpecialCardDefinition[] = [
  // Some Sabrosito sheets (especially scanned/back pages) do not preserve
  // their outer card rectangles. The five values remain arranged as 3 + 2,
  // so keep a text/OCR fallback for the existing Sabrosito layout as well.
  { layout: createCardLayout("sabrosito-5"), rowLengths: [3, 2] },
  {
    layout: createCardLayout("linea-5"),
    rowLengths: [2, 5, 2, 5, 2],
  },
  {
    layout: createCardLayout("loco-10"),
    rowLengths: [1, 5, 1, 3],
  },
  {
    layout: createCardLayout("loco-11"),
    rowLengths: [1, 5, 1, 1, 3],
  },
  {
    layout: additionalLayout("Mini O", [
      { row: 0, column: 1 }, { row: 0, column: 2 }, { row: 0, column: 3 },
      { row: 1, column: 1 }, { row: 1, column: 2 }, { row: 1, column: 3 },
      { row: 2, column: 1 }, { row: 2, column: 2 }, { row: 2, column: 3 },
    ]),
    rowLengths: [3, 2, 3],
    freeIndexes: [4],
  },
  {
    layout: additionalLayout("Sonrisa", [
      { row: 0, column: 1 }, { row: 0, column: 3 },
      { row: 1, column: 0 }, { row: 1, column: 4 },
      { row: 2, column: 1 }, { row: 2, column: 2 }, { row: 2, column: 3 },
    ]),
    rowLengths: [2, 2, 3],
  },
  {
    layout: additionalLayout("Perrito", [
      { row: 0, column: 1 }, { row: 0, column: 2 },
      { row: 1, column: 2 }, { row: 1, column: 3 },
      { row: 2, column: 1 }, { row: 2, column: 2 }, { row: 2, column: 3 },
      { row: 3, column: 1 }, { row: 3, column: 3 },
    ]),
    rowLengths: [2, 2, 3, 2],
  },
  {
    layout: additionalLayout("Cruz", [
      { row: 0, column: 2 },
      { row: 1, column: 0 }, { row: 1, column: 1 }, { row: 1, column: 2 }, { row: 1, column: 3 }, { row: 1, column: 4 },
      { row: 2, column: 2 },
      { row: 3, column: 2 },
    ]),
    rowLengths: [1, 5, 1, 1],
  },
  {
    layout: additionalLayout("Más", [
      { row: 0, column: 2 }, { row: 1, column: 2 },
      { row: 2, column: 0 }, { row: 2, column: 1 }, { row: 2, column: 2 }, { row: 2, column: 3 }, { row: 2, column: 4 },
      { row: 3, column: 2 }, { row: 4, column: 2 },
    ]),
    rowLengths: [1, 1, 4, 1, 1],
    freeIndexes: [4],
  },
  {
    layout: additionalLayout("Martillo", [
      { row: 0, column: 3 }, { row: 1, column: 2 },
      { row: 2, column: 0 }, { row: 2, column: 1 }, { row: 2, column: 3 },
      { row: 3, column: 0 }, { row: 3, column: 1 }, { row: 3, column: 4 },
    ]),
    rowLengths: [1, 1, 3, 3],
  },
  { layout: createCardLayout("avion-9"), rowLengths: [1, 2, 3, 2, 1] },
  { layout: createCardLayout("flecha-9"), rowLengths: [3, 2, 2, 1, 1] },
  { layout: createCardLayout("espada-7"), rowLengths: [1, 1, 2, 1, 2] },
  { layout: createCardLayout("pesa-7"), rowLengths: [2, 3, 2] },
  { layout: createCardLayout("rombo-8"), rowLengths: [1, 2, 2, 2, 1] },
  { layout: createCardLayout("bomba-8"), rowLengths: [2, 1, 2, 1, 2] },
  { layout: createCardLayout("yapa-3x3"), rowLengths: [3, 3, 3] },
  { layout: createCardLayout("eche-leche-7"), rowLengths: [4, 3] },
  { layout: createCardLayout("bom-bom-8"), rowLengths: [4, 4] },
  { layout: createCardLayout("keke-keke-6"), rowLengths: [2, 2, 2] },
  // Numeric sheets use the same five-row 5×5 canvas as the letter sheets,
  // but only the cells that draw the glyph contain numbers.  They used to be
  // present in the catalog but absent from the OCR shape detector, so the
  // importer returned zero cards for pages containing Número 1, 3, 4, 5, 7,
  // 9, + or =.  Build their row signatures directly from the canonical
  // pattern definitions so recognition stays in sync with the UI catalog.
  ...BUILTIN_PATTERNS
    .filter((pattern) =>
      pattern.category === "Números" ||
      ["adicional-forma-mas", "adicional-forma-igual"].includes(pattern.id),
    )
    .map((pattern) => {
      const rowLengths = Array.from({ length: 5 }, (_, row) =>
        pattern.cells.filter((cell) => Math.floor(cell / 5) === row).length,
      );
      return {
        layout: additionalLayout(pattern.name, pattern.cells.map((cell) => ({
          row: Math.floor(cell / 5),
          column: cell % 5,
        }))),
        rowLengths,
      } satisfies SpecialCardDefinition;
    }),
];

function specialRowSignatureDistance(actual: number[], expected: number[]) {
  const costs = Array.from({ length: actual.length + 1 }, () =>
    Array<number>(expected.length + 1).fill(0),
  );
  for (let row = 1; row <= actual.length; row += 1) costs[row][0] = costs[row - 1][0] + actual[row - 1];
  for (let column = 1; column <= expected.length; column += 1) costs[0][column] = costs[0][column - 1] + expected[column - 1];
  for (let row = 1; row <= actual.length; row += 1) {
    for (let column = 1; column <= expected.length; column += 1) {
      costs[row][column] = Math.min(
        costs[row - 1][column] + actual[row - 1],
        costs[row][column - 1] + expected[column - 1],
        costs[row - 1][column - 1] + Math.abs(actual[row - 1] - expected[column - 1]),
      );
    }
  }
  return costs[actual.length][expected.length];
}

function specialCellMatchScore(matrix: number[][], definition: SpecialCardDefinition) {
  const free = new Set(definition.freeIndexes ?? []);
  const expectedRows = Array.from({ length: definition.layout.rows }, (_, row) =>
    definition.layout.cells
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell, index }) => cell.row === row && !free.has(index))
      .map(({ cell }) => cell.column),
  ).filter((columns) => columns.length);
  const observedRows = matrix
    .map((row) => row.map((value, column) => ({ value, column })).filter(({ value }) => value > 0))
    .filter((row) => row.length);
  if (!observedRows.length || !expectedRows.length) return Number.NEGATIVE_INFINITY;

  const rowDistance = specialRowSignatureDistance(
    observedRows.map((row) => row.length),
    definition.rowLengths,
  );
  if (rowDistance > 2) return Number.NEGATIVE_INFINITY;

  let matched = 0;
  let extras = 0;
  const pairedRows = Math.min(observedRows.length, expectedRows.length);
  for (let row = 0; row < pairedRows; row += 1) {
    const available = [...observedRows[row]];
    for (const expectedColumn of expectedRows[row]) {
      const candidateIndex = available
        .map((candidate, index) => ({ index, distance: Math.abs(candidate.column - expectedColumn) }))
        .filter((candidate) => candidate.distance <= (definition.layout.columns < 5 ? 1 : 1))
        .sort((a, b) => a.distance - b.distance)[0]?.index;
      if (candidateIndex === undefined) {
        continue;
      } else {
        matched += 1;
        available.splice(candidateIndex, 1);
      }
    }
    extras += available.length;
  }
  extras += observedRows.slice(pairedRows).reduce((sum, row) => sum + row.length, 0);
  const observedCount = matrix.flat().filter((value) => value > 0).length;
  return matched * 2 - rowDistance * 1.5 - Math.abs(definition.rowLengths.reduce((a, b) => a + b, 0) - observedCount) * 0.5 - extras;
}

/** Select the known additional-game layout from the occupied row/cell map. */
export function specialLayoutNameForCellRows(matrix: number[][]) {
  const observedRows = matrix.map((row) => row.filter((value) => value > 0)).filter((row) => row.length);
  const observedCount = observedRows.reduce((sum, row) => sum + row.length, 0);
  if (observedCount < 5) return null;
  const candidates = specialCardDefinitions
    .filter((definition) => definition.layout.type !== "sabrosito-5")
    .map((definition) => ({
      definition,
      distance: specialRowSignatureDistance(
        observedRows.map((row) => row.length),
        definition.rowLengths,
      ),
      score: specialCellMatchScore(matrix, definition),
    }))
    .filter(({ distance, score }) => distance <= 2 && Number.isFinite(score))
    .sort((a, b) => b.score - a.score || a.distance - b.distance);
  const best = candidates[0];
  if (!best || best.score < 5 || best.distance > 2) return null;
  return best.definition.layout.name;
}

function flexibleRowSegments(numbers: PositionedNumber[]) {
  return groupIntoRows(numbers).flatMap((row, rowIndex) => {
    // Additional games such as Sonrisa, Cruz and Martillo contain rows with
    // one or two numbers, so they must remain eligible for shape matching.
    if (row.length < 1) return [];
    const gaps = row.slice(1).map((item, index) => item.x - (row[index].x + row[index].width));
    const positiveGaps = gaps.filter((gap) => gap > 0).sort((a, b) => a - b);
    const usualGap = median(positiveGaps.slice(0, Math.max(1, Math.ceil(positiveGaps.length * 0.65)))) || 8;
    const usualWidth = median(row.map((item) => item.width)) || 8;
    // A page can contain two additional cards on the same horizontal band.
    // When a row has only one value per card, its only gap is the inter-card
    // gap; using that gap as the local median made the threshold enormous and
    // merged both cards into one segment.  Cap the threshold relative to the
    // OCR glyph width so clearly separated columns are split reliably while
    // normal spacing inside one card remains intact.
    const threshold = Math.min(
      Math.max(usualGap * 2.2, usualWidth * 2.35, 22),
      Math.max(usualWidth * 6.5, 50),
    );
    const groups: PositionedNumber[][] = [];
    let current: PositionedNumber[] = [];
    row.forEach((item, index) => {
      if (index > 0 && gaps[index - 1] >= threshold && current.length) {
        groups.push(current);
        current = [];
      }
      current.push(item);
    });
    if (current.length) groups.push(current);
    return groups.flatMap((group, groupIndex) => {
      if (group.length < 1) return [];
      // Keep each detected row as one segment. Sliding windows over a normal
      // five-number bingo row made the special-format detector reinterpret
      // classic cards as several additional cards. Rows belonging to the
      // supported extra formats are already separated by their scan gaps and
      // have between one and five numbers, so no synthetic sub-rows are needed.
      const chunks = group.length <= 5 ? [group] : [];
      return chunks.map((chunk, chunkIndex) => {
        const xStart = Math.min(...chunk.map((item) => item.x));
        const xEnd = Math.max(...chunk.map((item) => item.x + item.width));
        return {
          values: chunk,
          xStart,
          xEnd,
          xCenter: (xStart + xEnd) / 2,
          y: chunk.reduce((sum, item) => sum + item.y, 0) / chunk.length,
          width: xEnd - xStart,
          rowId: `special:${rowIndex}:${groupIndex}:${chunkIndex}`,
        } satisfies RowSegment;
      });
    });
  });
}

function detectSpecialCardGrids(numbers: PositionedNumber[]) {
  const segments = flexibleRowSegments(numbers);
  const candidates: DetectedGrid[] = [];
  for (const definition of specialCardDefinitions) {
    for (const first of segments.filter((segment) => segment.values.length === definition.rowLengths[0])) {
      const rows = [first];
      let previous = first;
      for (const expectedLength of definition.rowLengths.slice(1)) {
        const next = segments
          .filter((segment) =>
            segment.values.length === expectedLength &&
            segment.y < previous.y - 12 &&
            previous.y - segment.y < Math.max(
              55,
              Math.min(100, median(previous.values.map((value) => value.height)) * 3.2),
            ) &&
            // The additional cards are not always centered row-by-row: the
            // wide middle row of Cruz/Más and the stepped Perrito/Martillo
            // rows can shift the row center considerably. Keep the match
            // within the same card band while avoiding rows from neighbors.
            Math.abs(segment.xCenter - first.xCenter) < Math.max(90, first.width * 1.2),
          )
          // Choose the closest eligible row beneath the previous one. The
          // former comparator compared candidates to each other rather than
          // to the current row, so it could stitch adjacent Sabrositos into
          // a false Yapa/numeric shape across card boundaries.
          .sort((a, b) => b.y - a.y)[0];
        if (!next) break;
        rows.push(next);
        previous = next;
      }
      if (rows.length !== definition.rowLengths.length) continue;
      const values = rows.flatMap((row) => row.values.map((value) => value.value));
      const grid = [...values];
      for (const freeIndex of definition.freeIndexes ?? []) {
        grid.splice(freeIndex, 0, 0);
      }
      if (
        grid.length !== definition.layout.cells.length ||
        grid.some((value) => value !== 0 && (value < 1 || value > 90)) ||
        new Set(grid.filter((value) => value !== 0)).size !== grid.filter((value) => value !== 0).length
      ) {
        continue;
      }
      const gaps = rows.slice(1).map((row, index) => rows[index].y - row.y);
      const spacingScore = Math.max(0, 4 - coefficientOfVariation(gaps) * 6);
      candidates.push({
        grid,
        x: first.xCenter,
        y: first.y,
        score: 12 + spacingScore,
        rowIds: rows.map((row) => row.rowId),
        layout: definition.layout,
        // The grid has already passed the range/uniqueness checks below. Do
        // not force every valid additional card into a blocking review modal;
        // users can still edit it after import if a scan needs correction.
        reviewNotes: [],
      });
    }
  }
  const selected: DetectedGrid[] = [];
  for (const candidate of candidates.sort((a, b) => {
    const cells = (layout: DetectedGrid) =>
      layout.grid.filter((value) => value !== 0).length;
    return b.score - a.score || cells(b) - cells(a) || b.rowIds.length - a.rowIds.length;
  })) {
    const duplicate = selected.some((other) =>
      other.rowIds.some((rowId) => candidate.rowIds.includes(rowId)) ||
      (other.layout?.type === candidate.layout?.type &&
        Math.abs(other.x - candidate.x) < 35 &&
        Math.abs(other.y - candidate.y) < 35),
    );
    if (!duplicate) selected.push(candidate);
  }
  return selected.sort((a, b) => b.y - a.y || a.x - b.x);
}

export function specialCardsFromOcrBlocks(
  blocks: OcrBlock[],
  canvasHeight: number,
  fileName: string,
  page: number,
) {
  return cardsFromDetectedGrids(
    detectSpecialCardGrids(positionedNumbersFromOcrBlocks(blocks, canvasHeight)),
    fileName,
    page,
  );
}

export function extractCardsFromTextItems(
  items: PdfTextItem[],
  fileName: string,
  page: number,
) {
  const tokens = tokensFromTextItems(items);
  const identifiers = identifiersFromTextItems(items);
  const classicGridCount = detectPositionedGrids(tokens).length;
  return removeSabrositoCardsFromClassicSheets(mergeDetectedCards(
    cardsFromTokens(tokens, fileName, page, identifiers),
    cardsFromDetectedGrids(
      detectSpecialCardGrids(tokens),
      fileName,
      page,
      identifiers,
    ),
  ), classicGridCount);
}

const bingoColumnRanges = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
] as const;

interface DecodedOcrRow {
  values: number[];
  xStart: number;
  xEnd: number;
  y: number;
  height: number;
  confidence: number;
}

function decodeBingoDigits(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 13) return null;
  let best:
    | { values: number[]; skipped: number; confidence: number }
    | null = null;

  function visit(
    position: number,
    column: number,
    values: number[],
    skipped: number,
  ) {
    if (skipped > 3) return;
    if (column === 5) {
      const totalSkipped = skipped + digits.length - position;
      if (totalSkipped > 3) return;
      const confidence = values.length * 20 - totalSkipped * 18;
      if (!best || confidence > best.confidence) {
        best = { values, skipped: totalSkipped, confidence };
      }
      return;
    }
    if (position >= digits.length) return;

    visit(position + 1, column, values, skipped + 1);
    for (const length of [1, 2]) {
      if (position + length > digits.length) continue;
      const text = digits.slice(position, position + length);
      if (text.startsWith("0")) continue;
      const value = Number(text);
      const [minimum, maximum] = bingoColumnRanges[column];
      if (value < minimum || value > maximum) continue;
      visit(position + length, column + 1, [...values, value], skipped);
    }
  }

  visit(0, 0, [], 0);
  return best as {
    values: number[];
    skipped: number;
    confidence: number;
  } | null;
}

function ocrWords(blocks: OcrBlock[]) {
  return blocks.flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) =>
      (paragraph.lines ?? []).flatMap((line) => line.words ?? []),
    ),
  );
}

function flattenOcrSymbols(words: OcrWord[]) {
  return words.flatMap((word) =>
    (word.symbols ?? []).filter((symbol) => /^\d$/.test(symbol.text)),
  );
}

function anchorRowsFromWords(words: OcrWord[], canvasHeight: number) {
  return words.flatMap<DecodedOcrRow>((word) => {
    const height = word.bbox.y1 - word.bbox.y0;
    const width = word.bbox.x1 - word.bbox.x0;
    if (
      height < canvasHeight * 0.022 ||
      height > canvasHeight * 0.16 ||
      width < height * 3.2
    ) {
      return [];
    }
    const decoded = decodeBingoDigits(word.text);
    if (!decoded) return [];
    return [{
      values: decoded.values,
      xStart: word.bbox.x0,
      xEnd: word.bbox.x1,
      y: (word.bbox.y0 + word.bbox.y1) / 2,
      height,
      confidence: decoded.confidence + Math.max(0, word.confidence),
    }];
  });
}

interface OcrNumberCandidate {
  value: number;
  xStart: number;
  xEnd: number;
  center: number;
  confidence: number;
  symbolIndexes: number[];
}

function symbolRowGroups(symbols: OcrSymbol[], canvasHeight: number) {
  const eligible = symbols
    .map((symbol, index) => ({ symbol, index }))
    .filter(({ symbol }) => {
      const height = symbol.bbox.y1 - symbol.bbox.y0;
      return (
        height >= canvasHeight * 0.018 &&
        height <= canvasHeight * 0.17 &&
        symbol.confidence >= 5
      );
    })
    .sort(
      (a, b) =>
        (a.symbol.bbox.y0 + a.symbol.bbox.y1) / 2 -
        (b.symbol.bbox.y0 + b.symbol.bbox.y1) / 2,
    );
  const groups: Array<Array<{ symbol: OcrSymbol; index: number }>> = [];
  for (const item of eligible) {
    const centerY = (item.symbol.bbox.y0 + item.symbol.bbox.y1) / 2;
    const height = item.symbol.bbox.y1 - item.symbol.bbox.y0;
    const closest = groups
      .map((group, index) => {
        const groupCenter = median(
          group.map(
            ({ symbol }) => (symbol.bbox.y0 + symbol.bbox.y1) / 2,
          ),
        );
        const groupHeight = median(
          group.map(({ symbol }) => symbol.bbox.y1 - symbol.bbox.y0),
        );
        return {
          index,
          distance: Math.abs(groupCenter - centerY),
          tolerance: Math.max(12, Math.min(height, groupHeight) * 0.48),
        };
      })
      .filter((candidate) => candidate.distance <= candidate.tolerance)
      .sort((a, b) => a.distance - b.distance)[0];
    if (closest) groups[closest.index].push(item);
    else groups.push([item]);
  }
  return groups;
}

function numberCandidatesForRow(
  row: Array<{ symbol: OcrSymbol; index: number }>,
) {
  const ordered = [...row].sort(
    (a, b) =>
      (a.symbol.bbox.x0 + a.symbol.bbox.x1) / 2 -
      (b.symbol.bbox.x0 + b.symbol.bbox.x1) / 2,
  );
  const rowHeight = median(
    ordered.map(({ symbol }) => symbol.bbox.y1 - symbol.bbox.y0),
  );
  const candidates: OcrNumberCandidate[] = [];

  ordered.forEach((first, firstIndex) => {
    const firstCenter =
      (first.symbol.bbox.x0 + first.symbol.bbox.x1) / 2;
    const single = Number(first.symbol.text);
    if (single >= 1 && single <= 75) {
      candidates.push({
        value: single,
        xStart: first.symbol.bbox.x0,
        xEnd: first.symbol.bbox.x1,
        center: firstCenter,
        confidence: first.symbol.confidence,
        symbolIndexes: [first.index],
      });
    }
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < ordered.length;
      secondIndex += 1
    ) {
      const second = ordered[secondIndex];
      const secondCenter =
        (second.symbol.bbox.x0 + second.symbol.bbox.x1) / 2;
      if (secondCenter - firstCenter > rowHeight * 1.18) break;
      const value = Number(`${first.symbol.text}${second.symbol.text}`);
      if (value < 10 || value > 75) continue;
      candidates.push({
        value,
        xStart: Math.min(first.symbol.bbox.x0, second.symbol.bbox.x0),
        xEnd: Math.max(first.symbol.bbox.x1, second.symbol.bbox.x1),
        center:
          (Math.min(first.symbol.bbox.x0, second.symbol.bbox.x0) +
            Math.max(first.symbol.bbox.x1, second.symbol.bbox.x1)) /
          2,
        confidence:
          (first.symbol.confidence + second.symbol.confidence) / 2,
        symbolIndexes: [first.index, second.index],
      });
    }
  });
  return { candidates, rowHeight };
}

export function positionedNumbersFromOcrBlocks(blocks: OcrBlock[], canvasHeight: number) {
  const symbols = flattenOcrSymbols(ocrWords(blocks));
  const positioned: PositionedNumber[] = [];
  for (const row of symbolRowGroups(symbols, canvasHeight)) {
    const { candidates } = numberCandidatesForRow(row);
    const usedSymbols = new Set<number>();
    for (const candidate of candidates.sort((a, b) => b.confidence - a.confidence)) {
      if (
        candidate.confidence < 8 ||
        candidate.symbolIndexes.some((index) => usedSymbols.has(index))
      ) continue;
      candidate.symbolIndexes.forEach((index) => usedSymbols.add(index));
      const selected = row.filter((item) => candidate.symbolIndexes.includes(item.index));
      if (!selected.length) continue;
      positioned.push({
        value: candidate.value,
        x: candidate.xStart,
        y: canvasHeight - median(selected.map(({ symbol }) =>
          (symbol.bbox.y0 + symbol.bbox.y1) / 2,
        )),
        width: Math.max(candidate.xEnd - candidate.xStart, 5),
        height: median(selected.map(({ symbol }) =>
          symbol.bbox.y1 - symbol.bbox.y0,
        )),
        order: positioned.length,
      });
    }
  }
  return positioned;
}

function anchorsFromSymbolRows(
  symbols: OcrSymbol[],
  canvasHeight: number,
) {
  const anchors: DecodedOcrRow[] = [];
  for (const row of symbolRowGroups(symbols, canvasHeight)) {
    const { candidates, rowHeight } = numberCandidatesForRow(row);
    const byColumn = bingoColumnRanges.map(([minimum, maximum]) =>
      candidates.filter(
        (candidate) => candidate.value >= minimum && candidate.value <= maximum,
      ),
    );
    const rowCandidates: DecodedOcrRow[] = [];
    for (const first of byColumn[0]) {
      for (const second of byColumn[1]) {
        const spacing = second.center - first.center;
        if (
          spacing < rowHeight * 0.72 ||
          spacing > canvasHeight * 0.2
        ) {
          continue;
        }
        const used = new Set([
          ...first.symbolIndexes,
          ...second.symbolIndexes,
        ]);
        const selected: Array<OcrNumberCandidate | null> = [first, second];
        let score = first.confidence + second.confidence;
        let valid = true;
        for (let column = 2; column < 5; column += 1) {
          const expected = first.center + column * spacing;
          const options = byColumn[column]
            .filter(
              (candidate) =>
                !candidate.symbolIndexes.some((index) => used.has(index)) &&
                Math.abs(candidate.center - expected) <= spacing * 0.42,
            )
            .map((candidate) => ({
              candidate,
              score:
                candidate.confidence -
                (Math.abs(candidate.center - expected) / spacing) * 55,
            }))
            .sort((a, b) => b.score - a.score);
          if (!options.length && column === 2) {
            selected.push(null);
            score -= 10;
            continue;
          }
          if (!options.length) {
            valid = false;
            break;
          }
          const choice = options[0];
          selected.push(choice.candidate);
          choice.candidate.symbolIndexes.forEach((index) => used.add(index));
          score += choice.score;
        }
        if (!valid || selected.length !== 5) continue;
        const last = selected[4];
        if (!last) continue;
        rowCandidates.push({
          values: selected.map((candidate) => candidate?.value ?? 0),
          xStart: first.xStart,
          xEnd: last.xEnd,
          y: median(
            row
              .filter((item) => used.has(item.index))
              .map(
                ({ symbol }) => (symbol.bbox.y0 + symbol.bbox.y1) / 2,
              ),
          ),
          height: rowHeight,
          confidence: score,
        });
      }
    }

    const selectedRows: DecodedOcrRow[] = [];
    for (const candidate of rowCandidates.sort(
      (a, b) => b.confidence - a.confidence,
    )) {
      const overlaps = selectedRows.some(
        (other) =>
          Math.max(candidate.xStart, other.xStart) <
          Math.min(candidate.xEnd, other.xEnd),
      );
      if (!overlaps) selectedRows.push(candidate);
    }
    anchors.push(...selectedRows);
  }
  return anchors;
}

function clusterOcrRows(rows: DecodedOcrRow[]) {
  const clusters: DecodedOcrRow[][] = [];
  for (const row of [...rows].sort(
    (a, b) => (a.xStart + a.xEnd) / 2 - (b.xStart + b.xEnd) / 2,
  )) {
    const center = (row.xStart + row.xEnd) / 2;
    const width = row.xEnd - row.xStart;
    const match = clusters
      .map((cluster, index) => {
        const clusterCenter = median(
          cluster.map((item) => (item.xStart + item.xEnd) / 2),
        );
        const clusterWidth = median(
          cluster.map((item) => item.xEnd - item.xStart),
        );
        return {
          index,
          distance: Math.abs(clusterCenter - center),
          acceptable:
            Math.abs(clusterCenter - center) <
            Math.max(42, Math.min(width, clusterWidth) * 0.28),
        };
      })
      .filter((candidate) => candidate.acceptable)
      .sort((a, b) => a.distance - b.distance)[0];
    if (match) clusters[match.index].push(row);
    else clusters.push([row]);
  }
  return clusters;
}

function bestCellValue(
  symbols: OcrSymbol[],
  column: number,
  expectedCenter: number,
  columnSpacing: number,
) {
  const [minimum, maximum] = bingoColumnRanges[column];
  const ordered = [...symbols].sort(
    (a, b) =>
      (a.bbox.x0 + a.bbox.x1) / 2 - (b.bbox.x0 + b.bbox.x1) / 2,
  );
  const candidates: Array<{ value: number; score: number }> = [];

  ordered.forEach((first, index) => {
    const firstCenter = (first.bbox.x0 + first.bbox.x1) / 2;
    const single = Number(first.text);
    if (single >= minimum && single <= maximum) {
      candidates.push({
        value: single,
        score:
          first.confidence -
          (Math.abs(firstCenter - expectedCenter) / columnSpacing) * 35,
      });
    }
    for (let nextIndex = index + 1; nextIndex < ordered.length; nextIndex += 1) {
      const second = ordered[nextIndex];
      const secondCenter = (second.bbox.x0 + second.bbox.x1) / 2;
      if (secondCenter - firstCenter > columnSpacing * 0.72) break;
      const value = Number(`${first.text}${second.text}`);
      if (value < minimum || value > maximum) continue;
      const pairCenter =
        (Math.min(first.bbox.x0, second.bbox.x0) +
          Math.max(first.bbox.x1, second.bbox.x1)) /
        2;
      candidates.push({
        value,
        score:
          (first.confidence + second.confidence) / 2 +
          12 -
          (Math.abs(pairCenter - expectedCenter) / columnSpacing) * 35,
      });
    }
  });

  return candidates.sort((a, b) => b.score - a.score)[0]?.value ?? null;
}

function decodeOcrCells(
  symbols: OcrSymbol[],
  rowY: number,
  rowHeight: number,
  xStart: number,
  xEnd: number,
  rowSpacing: number,
) {
  const margin = rowHeight * 0.55;
  const firstCenter = xStart + margin;
  const lastCenter = xEnd - margin;
  const columnSpacing = (lastCenter - firstCenter) / 4;
  if (columnSpacing <= rowHeight * 0.65) return [];

  const rowSymbols = symbols.filter((symbol) => {
    const height = symbol.bbox.y1 - symbol.bbox.y0;
    const centerY = (symbol.bbox.y0 + symbol.bbox.y1) / 2;
    const centerX = (symbol.bbox.x0 + symbol.bbox.x1) / 2;
    return (
      height >= rowHeight * 0.48 &&
      height <= rowHeight * 1.72 &&
      Math.abs(centerY - rowY) <= Math.min(rowSpacing * 0.34, rowHeight * 0.72) &&
      centerX >= xStart - columnSpacing * 0.18 &&
      centerX <= xEnd + columnSpacing * 0.18
    );
  });

  return bingoColumnRanges.map((_, column) => {
    const expectedCenter = firstCenter + column * columnSpacing;
    const inCell = rowSymbols.filter((symbol) => {
      const centerX = (symbol.bbox.x0 + symbol.bbox.x1) / 2;
      return Math.abs(centerX - expectedCenter) <= columnSpacing * 0.58;
    });
    return bestCellValue(inCell, column, expectedCenter, columnSpacing);
  });
}

function detectOcrGrids(
  anchors: DecodedOcrRow[],
  symbols: OcrSymbol[],
  canvasHeight: number,
) {
  const candidates: DetectedGrid[] = [];

  for (const cluster of clusterOcrRows(anchors)) {
    if (cluster.length < 3) continue;
    const rows = [...cluster].sort((a, b) => a.y - b.y);
    for (let first = 0; first < rows.length; first += 1) {
      for (let second = first + 1; second < rows.length; second += 1) {
        for (let firstIndex = 0; firstIndex < 4; firstIndex += 1) {
          for (
            let secondIndex = firstIndex + 1;
            secondIndex < 5;
            secondIndex += 1
          ) {
            const rowSpacing =
              (rows[second].y - rows[first].y) /
              (secondIndex - firstIndex);
            const typicalHeight = median(cluster.map((row) => row.height));
            if (
              rowSpacing < typicalHeight * 0.78 ||
              rowSpacing > canvasHeight * 0.17
            ) {
              continue;
            }
            const top = rows[first].y - firstIndex * rowSpacing;
            const matched = Array.from({ length: 5 }, (_, rowIndex) => {
              const expectedY = top + rowIndex * rowSpacing;
              return rows
                .map((row) => ({ row, distance: Math.abs(row.y - expectedY) }))
                .filter((item) => item.distance <= rowSpacing * 0.23)
                .sort((a, b) => a.distance - b.distance)[0];
            });
            const matchedRows = matched.filter(Boolean);
            if (matchedRows.length < 3) continue;
            const xStart = median(
              matchedRows.map((item) => item.row.xStart),
            );
            const xEnd = median(matchedRows.map((item) => item.row.xEnd));
            const rowHeight = median(
              matchedRows.map((item) => item.row.height),
            );
            const grid = matched.flatMap((item, rowIndex) => {
              const values = decodeOcrCells(
                symbols,
                top + rowIndex * rowSpacing,
                rowHeight,
                xStart,
                xEnd,
                rowSpacing,
              );
              return values.map((value, column) =>
                value ??
                item?.row.values[column] ??
                (rowIndex === 2 && column === 2 ? 0 : -1),
              );
            });
            if (gridQuality(grid) < 8) continue;
            const matchError = matchedRows.reduce(
              (sum, item) =>
                sum +
                Math.min(
                  ...Array.from({ length: 5 }, (_, rowIndex) =>
                    Math.abs(item.row.y - (top + rowIndex * rowSpacing)),
                  ),
                ),
              0,
            );
            candidates.push({
              grid,
              x: (xStart + xEnd) / 2,
              y: canvasHeight - top,
              score: matchedRows.length * 15 - matchError / rowSpacing,
              rowIds: [],
            });
          }
        }
      }
    }
  }

  const selected: DetectedGrid[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const duplicate = selected.some(
      (other) =>
        Math.abs(other.x - candidate.x) < canvasHeight * 0.05 &&
        Math.abs(other.y - candidate.y) < canvasHeight * 0.12,
    );
    if (!duplicate) selected.push(candidate);
  }
  return selected;
}

export function extractCardsFromOcrBlocks(
  blocks: OcrBlock[],
  canvasHeight: number,
  fileName: string,
  page: number,
) {
  const words = ocrWords(blocks);
  const symbols = flattenOcrSymbols(words);
  const anchors = [
    ...anchorRowsFromWords(words, canvasHeight),
    ...anchorsFromSymbolRows(symbols, canvasHeight),
  ]
    .sort((a, b) => b.confidence - a.confidence)
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          (other) =>
            Math.abs(other.y - candidate.y) <
              Math.max(other.height, candidate.height) * 0.4 &&
            Math.abs(
              (other.xStart + other.xEnd) / 2 -
                (candidate.xStart + candidate.xEnd) / 2,
            ) <
              Math.max(other.xEnd - other.xStart, candidate.xEnd - candidate.xStart) *
                0.18,
        ) === index,
    );
  const grids = detectOcrGrids(anchors, symbols, canvasHeight);
  return cardsFromDetectedGrids(grids, fileName, page);
}

export function extractPartialGridFromKnownOcrBlocks(
  blocks: OcrBlock[],
  width: number,
  height: number,
) {
  const symbols = flattenOcrSymbols(ocrWords(blocks));
  const cellWidth = width / 5;
  const cellHeight = height / 5;
  const grid = Array.from({ length: 25 }, (_, index) => {
    const row = Math.floor(index / 5);
    const column = index % 5;
    if (row === 2 && column === 2) return 0;
    const expectedX = (column + 0.5) * cellWidth;
    const expectedY = (row + 0.5) * cellHeight;
    const inCell = symbols.filter((symbol) => {
      const symbolWidth = symbol.bbox.x1 - symbol.bbox.x0;
      const symbolHeight = symbol.bbox.y1 - symbol.bbox.y0;
      const centerX = (symbol.bbox.x0 + symbol.bbox.x1) / 2;
      const centerY = (symbol.bbox.y0 + symbol.bbox.y1) / 2;
      return (
        symbolHeight >= cellHeight * 0.18 &&
        symbolHeight <= cellHeight * 1.45 &&
        symbolWidth <= cellWidth * 1.15 &&
        Math.abs(centerX - expectedX) <= cellWidth * 0.55 &&
        Math.abs(centerY - expectedY) <= cellHeight * 0.5
      );
    });
    return bestCellValue(inCell, column, expectedX, cellWidth) ?? -1;
  });
  return grid;
}

export function extractGridFromKnownOcrBlocks(
  blocks: OcrBlock[],
  width: number,
  height: number,
) {
  const grid = extractPartialGridFromKnownOcrBlocks(blocks, width, height);
  return gridQuality(grid) >= 8 ? grid : null;
}

function tokensFromTsv(tsv: string, canvasHeight: number) {
  const tokens: PositionedNumber[] = [];
  const lines = tsv.split(/\r?\n/);
  lines.slice(1).forEach((line, lineIndex) => {
    const columns = line.split("\t");
    if (columns.length < 12) return;
    const confidence = Number(columns[10]);
    const text = columns.slice(11).join("\t").trim();
    if (confidence < 20 || !text) return;
    const left = Number(columns[6]);
    const top = Number(columns[7]);
    const width = Number(columns[8]);
    const height = Number(columns[9]);
    const matches = numberMatches(text);
    matches.forEach((match, matchIndex) => {
      const characterWidth = width / Math.max(text.length, 1);
      tokens.push({
        value: Number(match[0]),
        x: left + (match.index ?? 0) * characterWidth,
        y: canvasHeight - top - height / 2,
        width: Math.max(match[0].length * characterWidth, 5),
        height: Math.max(height, 6),
        order: lineIndex * 100 + matchIndex,
      });
    });
  });
  return tokens;
}

async function createOcrWorker() {
  const tesseract = await import("tesseract.js");
  const worker = (await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
    logger: () => undefined,
    // Keep OCR self-contained in the deployed app. The library defaults to
    // jsDelivr and tessdata.projectnaptha.com; when either request is blocked,
    // createWorker never resolves and imports remain stuck on page 1 forever.
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/tesseract-core-lstm.wasm.js",
    langPath: "/tesseract",
    workerBlobURL: false,
  })) as unknown as OcrWorker;
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: String(tesseract.PSM.SPARSE_TEXT),
    preserve_interword_spaces: "1",
  });
  return worker;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function binarizeNumbers(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  options: { luminance?: number; chroma?: number } = {},
) {
  const luminanceLimit = options.luminance ?? 175;
  const chromaLimit = options.chroma ?? 58;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    const luminance = red * 0.3 + green * 0.59 + blue * 0.11;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    const ink = luminance < luminanceLimit && chroma < chromaLimit;
    const value = ink ? 0 : 255;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function cropGridCanvas(source: HTMLCanvasElement, rectangle: GridRectangle) {
  const target = makeCanvas(rectangle.width, rectangle.height);
  if (!target) return null;
  target.context.drawImage(
    source,
    rectangle.x,
    rectangle.y,
    rectangle.width,
    rectangle.height,
    0,
    0,
    target.canvas.width,
    target.canvas.height,
  );
  return target.canvas;
}

function cleanGridCanvas(source: HTMLCanvasElement, rectangle: GridRectangle) {
  const cellWidth = 150;
  const cellHeight = 120;
  const target = makeCanvas(cellWidth * 5, cellHeight * 5);
  if (!target) return null;
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      if (row === 2 && column === 2) continue;
      const left = rectangle.verticalLines[column] + 4;
      const top = rectangle.horizontalLines[row] + 4;
      const width = Math.max(
        1,
        rectangle.verticalLines[column + 1] - left - 4,
      );
      const height = Math.max(
        1,
        rectangle.horizontalLines[row + 1] - top - 4,
      );
      target.context.drawImage(
        source,
        left,
        top,
        width,
        height,
        column * cellWidth + 10,
        row * cellHeight + 10,
        cellWidth - 20,
        cellHeight - 20,
      );
    }
  }
  // Scanned sheets can contain gray diagonal watermarks over the digits.
  // Keep only dark, low-chroma ink for the primary OCR pass; the original
  // crop remains available as a fallback when a scan is unusually light.
  binarizeNumbers(target.canvas, target.context, { luminance: 125, chroma: 48 });
  return target.canvas;
}

async function recognizeMissingCells(
  source: HTMLCanvasElement,
  rectangle: GridRectangle,
  grid: number[],
  worker: OcrWorker,
) {
  const counts = new Map<number, number>();
  grid
    .filter((value) => value > 0)
    .forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const missing = grid
    .map((value, index) => ({ value, index }))
    .filter(
      ({ value, index }) =>
        index !== 12 && (value < 0 || (counts.get(value) ?? 0) > 1),
    );
  if (!missing.length) return grid;
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "8",
    preserve_interword_spaces: "1",
  });
  const resolved = [...grid];
  for (const { index } of missing) {
    const row = Math.floor(index / 5);
    const column = index % 5;
    const left = rectangle.verticalLines[column] + 5;
    const top = rectangle.horizontalLines[row] + 5;
    const width = Math.max(
      1,
      rectangle.verticalLines[column + 1] - left - 5,
    );
    const height = Math.max(
      1,
      rectangle.horizontalLines[row + 1] - top - 5,
    );
    const target = makeCanvas(240, 190);
    if (!target) continue;
    target.context.drawImage(
      source,
      left,
      top,
      width,
      height,
      15,
      15,
      210,
      160,
    );
    binarizeNumbers(target.canvas, target.context, { luminance: 125, chroma: 48 });
    const result = await worker.recognize(
      target.canvas,
      {},
      { blocks: true, tsv: true, text: true },
    );
    const symbols = result.data.blocks?.length
      ? flattenOcrSymbols(ocrWords(result.data.blocks))
      : [];
    let value = bestCellValue(symbols, column, 120, 240);
    if (value === null) {
      const digits = (result.data.text ?? "").replace(/\D/g, "");
      const [minimum, maximum] = bingoColumnRanges[column];
      const options: number[] = [];
      for (let start = 0; start < digits.length; start += 1) {
        for (const length of [2, 1]) {
          const candidate = Number(digits.slice(start, start + length));
          if (candidate >= minimum && candidate <= maximum) {
            options.push(candidate);
          }
        }
      }
      value = options[0] ?? null;
    }
    resolved[index] = value ?? -1;
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  return resolved;
}

async function recognizeDetectedGrids(
  source: HTMLCanvasElement,
  rectangles: GridRectangle[],
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
) {
  const detected: DetectedGrid[] = [];
  for (const rectangle of rectangles.filter((item) => item.score >= 85)) {
    const original = cropGridCanvas(source, rectangle);
    if (!original) continue;
    const originalResult = await worker.recognize(
      original,
      {},
      { blocks: true, tsv: true, text: true },
    );
    let grid = extractPartialGridFromKnownOcrBlocks(
      originalResult.data.blocks ?? [],
      original.width,
      original.height,
    );
    const missingCount = grid.filter((value) => value < 0).length;
    if (
      gridQuality(grid) < 8 &&
      (missingCount > 3 || missingCount === 0)
    ) {
      const clean = cleanGridCanvas(source, rectangle);
      if (clean) {
        const cleanResult = await worker.recognize(
          clean,
          {},
          { blocks: true, tsv: true, text: true },
        );
        const cleanGrid = extractPartialGridFromKnownOcrBlocks(
          cleanResult.data.blocks ?? [],
          clean.width,
          clean.height,
        );
        grid = grid.map((value, index) =>
          cleanGrid[index] >= 0 ? cleanGrid[index] : value,
        );
      }
    }
    if (gridQuality(grid) < 8) {
      grid = await recognizeMissingCells(source, rectangle, grid, worker);
    }
    if (gridQuality(grid) < 8) continue;
    detected.push({
      grid,
      x: rectangle.x + rectangle.width / 2,
      y: source.height - rectangle.y,
      score: rectangle.score,
      rowIds: [],
    });
  }
  return cardsFromDetectedGrids(detected, fileName, pageNumber);
}

const compactCellPositions = [
  {
    range: [1, 30] as const,
    primary: { x: 0, y: 0.015, width: 0.21, height: 0.27 },
    fallback: { x: 0, y: 0, width: 0.23, height: 0.36 },
  },
  {
    range: [31, 45] as const,
    primary: { x: 0.39, y: 0.015, width: 0.22, height: 0.27 },
    fallback: { x: 0.37, y: 0, width: 0.26, height: 0.36 },
  },
  {
    range: [46, 75] as const,
    primary: { x: 0.79, y: 0.015, width: 0.17, height: 0.27 },
    fallback: { x: 0.77, y: 0, width: 0.23, height: 0.36 },
  },
  {
    range: [1, 30] as const,
    primary: { x: 0, y: 0.715, width: 0.21, height: 0.27 },
    fallback: { x: 0, y: 0.64, width: 0.23, height: 0.36 },
  },
  {
    range: [46, 75] as const,
    primary: { x: 0.79, y: 0.715, width: 0.17, height: 0.27 },
    fallback: { x: 0.77, y: 0.64, width: 0.23, height: 0.36 },
  },
];

function compactValueFromText(
  text: string,
  range: readonly [number, number],
  allowInference = false,
) {
  const digits = text.replace(/\D/g, "");
  for (let start = 0; start < digits.length; start += 1) {
    for (const length of [2, 1]) {
      const value = Number(digits.slice(start, start + length));
      if (value >= range[0] && value <= range[1]) return value;
    }
  }
  if (allowInference && range[0] === 31 && digits === "1") return 41;
  if (
    allowInference &&
    range[0] === 46 &&
    (digits === "7" || digits === "77")
  ) {
    return 71;
  }
  return null;
}

async function recognizeCompactCell(
  source: HTMLCanvasElement,
  rectangle: CompactRectangle,
  crop: { x: number; y: number; width: number; height: number },
  range: readonly [number, number],
  worker: OcrWorker,
  observedDigits: Set<string>,
  binarize = true,
  allowInference = false,
) {
  const target = makeCanvas(250, 200);
  if (!target) return null;
  target.context.drawImage(
    source,
    rectangle.x + rectangle.width * crop.x,
    rectangle.y + rectangle.height * crop.y,
    rectangle.width * crop.width,
    rectangle.height * crop.height,
    0,
    0,
    target.canvas.width,
    target.canvas.height,
  );
      if (binarize) {
        binarizeNumbers(target.canvas, target.context, { luminance: 125, chroma: 48 });
      }
  const result = await worker.recognize(
    target.canvas,
    {},
    { blocks: false, tsv: false, text: true },
  );
  observedDigits.add((result.data.text ?? "").replace(/\D/g, ""));
  return compactValueFromText(
    result.data.text ?? "",
    range,
    allowInference,
  );
}

async function recognizeCompactCards(
  source: HTMLCanvasElement,
  rectangles: CompactRectangle[],
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
) {
  if (!rectangles.length) return [];
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "8",
    preserve_interword_spaces: "1",
  });
  const detected: DetectedGrid[] = [];
  for (const rectangle of rectangles) {
    const grid: number[] = [];
    for (const cell of compactCellPositions) {
      const observedDigits = new Set<string>();
      let value = await recognizeCompactCell(
        source,
        rectangle,
        cell.primary,
        cell.range,
        worker,
        observedDigits,
      );
      if (value === null) {
        value = await recognizeCompactCell(
          source,
          rectangle,
          cell.fallback,
          cell.range,
          worker,
          observedDigits,
        );
      }
      if (value === null) {
        value = await recognizeCompactCell(
          source,
          rectangle,
          cell.primary,
          cell.range,
          worker,
          observedDigits,
          false,
        );
      }
      if (value === null) {
        value = await recognizeCompactCell(
          source,
          rectangle,
          cell.fallback,
          cell.range,
          worker,
          observedDigits,
          false,
          true,
        );
      }
      if (value === null) {
        value = await recognizeCompactCell(
          source,
          rectangle,
          cell.primary,
          cell.range,
          worker,
          observedDigits,
          true,
          true,
        );
      }
      if (
        value === null &&
        cell.range[0] === 31 &&
        observedDigits.has("1")
      ) {
        value = 41;
      }
      if (
        value === null &&
        cell.range[0] === 46 &&
        (observedDigits.has("7") || observedDigits.has("77"))
      ) {
        value = 71;
      }
      grid.push(value ?? -1);
    }
    if (
      grid.some((value) => value < 1 || value > 75) ||
      new Set(grid).size !== grid.length
    ) {
      continue;
    }
    detected.push({
      grid,
      x: rectangle.x + rectangle.width / 2,
      y: source.height - rectangle.y,
      score: rectangle.score,
      rowIds: [],
    });
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  return cardsFromDetectedGrids(detected, fileName, pageNumber);
}

async function recognizeSpecialSheetRegions(
  source: HTMLCanvasElement,
  rectangles: CompactRectangle[],
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
  minimumTokenHeight = 0.03,
) {
  const cards: BingoCard[] = [];
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  for (const [regionIndex, rectangle] of rectangles.entries()) {
    const scale = Math.min(3, Math.max(1, 900 / rectangle.width));
    const crop = makeCanvas(
      Math.round(rectangle.width * scale),
      Math.round(rectangle.height * scale),
    );
    if (!crop) continue;
    crop.context.drawImage(
      source,
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height,
      0,
      0,
      crop.canvas.width,
      crop.canvas.height,
    );
    const readRegion = async () => {
      const result = await worker.recognize(
        crop.canvas,
        {},
        { blocks: true, tsv: true, text: true },
      );
      const textTokens = result.data.tsv
        ? tokensFromTsv(result.data.tsv, crop.canvas.height).filter(
            (token) => token.height >= crop.canvas.height * minimumTokenHeight,
          )
        : [];
      const symbolTokens = result.data.blocks?.length
        ? positionedNumbersFromOcrBlocks(result.data.blocks, crop.canvas.height)
        : [];
      const tokens = [
        ...textTokens,
        ...symbolTokens.filter((candidate) =>
          !textTokens.some((token) =>
            token.value === candidate.value &&
            Math.abs(token.x - candidate.x) < Math.max(8, token.width * 0.45) &&
            Math.abs(token.y - candidate.y) < Math.max(8, token.height * 0.45),
          ),
        ),
      ];
      const grids = tokens.length >= 5
        ? detectSpecialCardGrids(tokens).filter(
            (grid) => grid.layout?.type !== "classic-5x5",
          )
        : [];
      return { tokens, grids };
    };
    // Preserve the scan's original grayscale first. Hard thresholding can
    // erase thin digits and turn (for example) a printed 41 into 31.
    let { tokens, grids } = await readRegion();
    if (!grids.length) {
      binarizeNumbers(crop.canvas, crop.context, { luminance: 165, chroma: 72 });
      const cleaned = await readRegion();
      tokens = [...tokens, ...cleaned.tokens];
      grids = cleaned.grids;
    }
    if (!grids.length) continue;
    const detected = cardsFromDetectedGrids(grids, fileName, pageNumber);
    detected.forEach((card, index) => {
      const name = card.layout?.name ?? "forma";
      const form = name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      cards.push({
        ...card,
        number: `${fileName.replace(/\.[^.]+$/i, "")}-p${pageNumber}-r${regionIndex + 1}-c${index + 1}-${form}`,
      });
    });
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  return cards;
}

async function recognizeSpecialCardsByCell(
  source: HTMLCanvasElement,
  rectangles: CompactRectangle[],
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
) {
  const detected: DetectedGrid[] = [];
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "8",
    preserve_interword_spaces: "1",
  });
  for (const [regionIndex, rectangle] of rectangles.entries()) {
    const cellWidth = rectangle.width / 5;
    const cellHeight = rectangle.height / 5;
    // Read one printed number at a time. Page-level OCR joins touching digits
    // (e.g. 9, 22, 36, 50, 73 → "9122365073"), while a padded cell crop keeps
    // the individual value legible even through box borders and watermarks.
    const side = Math.max(24, Math.round(Math.min(cellWidth * 0.95, cellHeight * 1.3)));
    const matrix: number[][] = [];
    for (let row = 0; row < 5; row += 1) {
      const values: number[] = [];
      for (let column = 0; column < 5; column += 1) {
        const centerX = rectangle.x + (column + 0.5) * cellWidth;
        const centerY = rectangle.y + (row + 0.5) * cellHeight;
        const crop = makeCanvas(220, 220);
        if (!crop) {
          values.push(0);
          continue;
        }
        crop.context.drawImage(
          source,
          Math.max(0, Math.round(centerX - side / 2)),
          Math.max(0, Math.round(centerY - side / 2)),
          side,
          side,
          0,
          0,
          crop.canvas.width,
          crop.canvas.height,
        );
        binarizeNumbers(crop.canvas, crop.context, { luminance: 130, chroma: 78 });
        const result = await worker.recognize(
          crop.canvas,
          {},
          { blocks: false, tsv: false, text: true },
        );
        const digits = (result.data.text.match(/\d+/g) ?? []).join("");
        let value = 0;
        if (digits.length >= 3 && digits[0] !== "9") {
          const firstTwo = Number(digits.slice(0, 2));
          if (firstTwo >= 1 && firstTwo <= 75) value = firstTwo;
        }
        if (!value) {
          const matches = digits.match(/(?:[1-9]|[1-7]\d)/g) ?? [];
          value = matches.map(Number).find((candidate) => candidate >= 1 && candidate <= 75) ?? 0;
        }
        values.push(value);
      }
      matrix.push(values);
    }

    const layoutName = specialLayoutNameForCellRows(matrix);
    if (!layoutName) continue;
    const definition = specialCardDefinitions.find((candidate) => candidate.layout.name === layoutName);
    if (!definition) continue;

    const observedRows = matrix
      .map((row) => row.map((value, column) => ({ value, column })).filter(({ value }) => value > 0))
      .filter((row) => row.length);
    const expectedRows = [...new Set(definition.layout.cells.map((cell) => cell.row))].sort((a, b) => a - b);
    const free = new Set(definition.freeIndexes ?? []);
    const usedByRow = new Map<number, Set<number>>();
    const grid = definition.layout.cells.map((cell, cellIndex) => {
      if (free.has(cellIndex)) return 0;
      const rowRank = expectedRows.indexOf(cell.row);
      const row = observedRows[rowRank] ?? [];
      const used = usedByRow.get(rowRank) ?? new Set<number>();
      const available = row
        .map((candidate, index) => ({ ...candidate, index, distance: Math.abs(candidate.column - cell.column) }))
        .filter((candidate) => candidate.distance <= 1 && !used.has(candidate.index))
        .sort((a, b) => a.distance - b.distance)[0];
      if (!available) return 0;
      used.add(available.index);
      usedByRow.set(rowRank, used);
      return available.value;
    });
    const values = grid.filter((value) => value > 0);
    const duplicateValues = new Set(values).size !== values.length;
    const expectedCount = definition.rowLengths.reduce((sum, count) => sum + count, 0);
    const missingValues = values.length < expectedCount;
    detected.push({
      grid,
      x: rectangle.x + rectangle.width / 2,
      y: source.height - rectangle.y,
      score: 24 + values.length,
      rowIds: [`special-cell:${regionIndex}`],
      layout: definition.layout,
      reviewNotes: [
        "Verifica los números de esta forma antes de confirmar la importación.",
        ...(missingValues ? ["Faltan números que no se pudieron leer automáticamente."] : []),
        ...(duplicateValues ? ["Se detectaron números repetidos; corrige las casillas antes de jugar."] : []),
      ],
    });
    // Keep the per-card layout in the grid metadata; cardsFromDetectedGrids
    // assigns a stable image/PDF identifier when no printed ID is found.
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  return cardsFromDetectedGrids(detected, fileName, pageNumber);
}

const supplierAdditionalSheetForms = [
  "Avión", "Flecha", "Espada", "Pesa", "Rombo", "Bomba",
] as const;
const geometricAdditionalSheetForms = [
  "Sonrisa", "Mini O", "Perrito", "Cruz", "Más", "Martillo",
] as const;

function normalizeOcrLabel(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Distinguishes the two six-card additional-sheet families from their masthead list. */
export function additionalFormOrderForHeading(text: string): readonly string[] | null {
  const label = normalizeOcrLabel(text);
  const countMatches = (forms: readonly string[]) => forms.filter((form) =>
    label.includes(normalizeOcrLabel(form)),
  ).length;
  const supplierMatches = countMatches(supplierAdditionalSheetForms);
  const geometricMatches = countMatches(geometricAdditionalSheetForms);
  if (supplierMatches >= 2 && supplierMatches > geometricMatches) return supplierAdditionalSheetForms;
  if (geometricMatches >= 2 && geometricMatches > supplierMatches) return geometricAdditionalSheetForms;
  return null;
}

export function specialCellRelativePosition(
  row: number,
  column: number,
  rows: number,
  columns: number,
): [number, number] {
  return [
    Number((0.1 + (column + (5 - columns) / 2) * 0.2).toFixed(4)),
    Number((0.1 + (row + (5 - rows) / 2) * 0.2).toFixed(4)),
  ];
}

function expectedFormFromLabel(text: string, definitions: SpecialCardDefinition[]) {
  const label = normalizeOcrLabel(text);
  const known = [...supplierAdditionalSheetForms, ...geometricAdditionalSheetForms].find((name) =>
    label.includes(normalizeOcrLabel(name)),
  );
  if (known) return definitions.find((definition) => definition.layout.name === known);
  const numericLabel = label.match(/(?:forma(?:adicional)?|numero)?(?:adicional)?#?([134579])(?:\D|$)/);
  if (!numericLabel) return undefined;
  return definitions.find((definition) =>
    normalizeOcrLabel(definition.layout.name).includes(`#${numericLabel[1]}`) ||
    normalizeOcrLabel(definition.layout.name).endsWith(numericLabel[1]),
  );
}

async function recognizeAnchoredSheetCards(
  source: HTMLCanvasElement,
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
  kind: "additional" | "number",
  additionalFormOrder: readonly string[] | null = null,
) {
  const cards: BingoCard[] = [];
  const normalizeRect = (x: number, y: number, width: number, height: number) => ({
    x: source.width * x, y: source.height * y,
    width: source.width * width, height: source.height * height,
  });
  const readText = async (rect: ReturnType<typeof normalizeRect>, whitelist: string) => {
    const crop = makeCanvas(rect.width * 2, rect.height * 2);
    if (!crop) return "";
    crop.context.drawImage(source, rect.x, rect.y, rect.width, rect.height,
      0, 0, crop.canvas.width, crop.canvas.height);
    await worker.setParameters({
      tessedit_char_whitelist: whitelist,
      tessedit_pageseg_mode: "11",
      preserve_interword_spaces: "1",
    });
    const result = await worker.recognize(crop.canvas, {}, { blocks: false, tsv: false, text: true });
    return result.data.text ?? "";
  };
  const readNumber = async (
    x: number,
    y: number,
    size: number,
    options: { allowedRange?: [number, number]; preferGrayscale?: boolean } = {},
  ) => {
    const side = Math.min(size, source.width * 0.095, source.height * 0.055);
    const recognize = async (
      cropSide: number,
      threshold: boolean,
      psm: "8" | "10" | "13",
      verticalOffset = 0,
    ) => {
      const crop = makeCanvas(cropSide * 2, cropSide * 2);
      if (!crop) return 0;
      crop.context.drawImage(source,
        Math.max(0, source.width * x - cropSide / 2),
        Math.max(0, source.height * (y + verticalOffset) - cropSide / 2),
        cropSide, cropSide, 0, 0, crop.canvas.width, crop.canvas.height);
      if (threshold) binarizeNumbers(crop.canvas, crop.context, { luminance: 165, chroma: 78 });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: psm,
        preserve_interword_spaces: "1",
      });
      const result = await worker.recognize(crop.canvas, {}, { blocks: false, tsv: false, text: true });
      const digits = (result.data.text.match(/\d+/g) ?? []).join("");
      const value = Number(digits.length > 2 ? digits.slice(0, 2) : digits);
      const [minimum, maximum] = options.allowedRange ?? [1, 75];
      return value >= minimum && value <= maximum ? value : 0;
    };
    // Keep the original scan texture for digit reading: binarization can turn
    // a 6 into a 5 on watermarked sheets. Number-form cards also have strict
    // B-I-N-G-O column ranges, which let us retry only genuinely suspicious
    // readings instead of adding another OCR pass to every cell.
    const first = await recognize(side, Boolean(!options.preferGrayscale), "10");
    if (first) return first;
    // Keep a single fallback for watermarks and interrupted strokes. PSM 13
    // handles isolated digits while avoiding the extra serial OCR pass that
    // made low-confidence number sheets exceed the import time budget.
    const retrySide = Math.min(side * 1.16, source.width * 0.095, source.height * 0.055);
    const grayscaleRetry = await recognize(retrySide, false, "10", 0.003);
    return grayscaleRetry || recognize(retrySide, true, "13", 0.003);
  };

  const regions = kind === "additional"
    ? [0.16, 0.46, 0.755].flatMap((y) => [0.045, 0.535].map((x) => normalizeRect(x, y, 0.42, 0.204)))
    : [0.262, 0.676].flatMap((y) => [0.045, 0.535].map((x) => normalizeRect(x, y, 0.42, 0.275)));
  for (const [index, rect] of regions.entries()) {
    // Numeric cards use a fixed order. Additional forms can come from two
    // different six-game sheets, so read each card's caption before falling
    // back to the game list in the masthead. Never assume every sheet starts
    // with Sonrisa: that mislabeled Avión as Sonrisa in supplier sheets.
    const numericIds = [1, 3, 5, 9];
    let regionDefinition: SpecialCardDefinition | undefined;
    if (kind === "additional") {
      const labelRect = {
        ...rect,
        y: rect.y - source.height * (index >= 4 ? 0.04 : 0.025),
        height: source.height * 0.052,
      };
      const labelText = await readText(
        labelRect,
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÜÑáéíóúüñ0123456789",
      );
      regionDefinition = expectedFormFromLabel(labelText, specialCardDefinitions);
    }
    const expectedName = kind === "additional"
      ? regionDefinition?.layout.name ?? additionalFormOrder?.[index]
      : `Forma adicional #${numericIds[index]}`;
    const catalogDefinition = specialCardDefinitions.find((candidate) =>
      normalizeOcrLabel(candidate.layout.name) === normalizeOcrLabel(expectedName ?? ""),
    );
    const numberId = numericIds[index] as 1 | 3 | 5 | 9;
    const numberCells = kind === "number" ? numberPatternCellIndexes(numberId) : undefined;
    const definition: SpecialCardDefinition | undefined = numberCells
      ? (() => {
          const cells = numberCells.map((cell) => ({ row: Math.floor(cell / 5), column: cell % 5 }));
          const rowLengths = Array.from({ length: 5 }, (_, row) => cells.filter((cell) => cell.row === row).length);
          return { layout: additionalLayout(`Forma ${numericIds[index]}`, cells), rowLengths };
        })()
      : regionDefinition ?? catalogDefinition ?? await (async () => {
      const labelRect = kind === "additional"
        ? { ...rect, y: rect.y - source.height * (index >= 4 ? 0.04 : 0.025), height: source.height * 0.052 }
        : normalizeRect(
            rect.x / source.width + 0.42 * 0.39,
            rect.y / source.height + 0.275 * 0.34,
            0.42 * 0.22,
            0.275 * 0.32,
          );
      const text = await readText(labelRect,
        kind === "additional"
          ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÜÑáéíóúüñ0123456789"
          : "#FORMAadicionalADICIONAL0123456789");
      return expectedFormFromLabel(text, specialCardDefinitions);
    })();
    if (!definition) continue;
    const layout = definition.layout;
    const matrix = Array.from({ length: 5 }, () => Array<number>(5).fill(0));
    const free = new Set(definition.freeIndexes ?? []);
    // The central print on number sheets is the form identifier, not a ball.
    if (kind === "number") {
      const centerIndex = layout.cells.findIndex((cell) => cell.row === 2 && cell.column === 2);
      if (centerIndex >= 0) free.add(centerIndex);
    }
    const coordinates = kind === "additional" ? {
      "Sonrisa": [[.30,.30],[.70,.30],[.10,.70],[.90,.70],[.30,.89],[.50,.89],[.69,.89]],
      "Mini O": [[.29,.30],[.52,.30],[.72,.30],[.29,.51],[.72,.51],[.29,.70],[.52,.70],[.713,.70]],
      "Perrito": [[.10,.29],[.30,.29],[.30,.53],[.68,.53],[.30,.72],[.52,.72],[.72,.72],[.30,.91],[.72,.91]],
      "Cruz": [[.52,.10],[.10,.30],[.29,.30],[.52,.30],[.71,.30],[.90,.30],[.52,.71],[.52,.90]],
      "Más": [[.5,.12],[.5,.32],[.10,.5],[.30,.5],[.70,.5],[.90,.5],[.5,.70],[.5,.90]],
      "Martillo": [[.72,.10],[.52,.30],[.10,.5],[.30,.5],[.71,.5],[.10,.70],[.30,.70],[.90,.70]],
    }[layout.name] ?? [] : layout.cells
      .filter((_, cellIndex) => !free.has(cellIndex))
      .map((cell) => specialCellRelativePosition(cell.row, cell.column, layout.rows, layout.columns));
    const activeCells = layout.cells
      .map((cell, cellIndex) => ({ ...cell, cellIndex }))
      .filter(({ cellIndex }) => !free.has(cellIndex));
    // Number sheets print very large digits inside a full 5×5 grid. A narrow
    // crop cuts off the round strokes on 5/6/8/9 (e.g. 50 -> 00, 69 -> 09),
    // especially after CamScanner compression. Include most of the cell while
    // staying inside the row/column borders; readNumber applies a page-based
    // upper bound so neighbouring cells cannot leak into the OCR crop.
    const size = Math.min(rect.width * (kind === "number" ? 0.18 : 0.16), rect.height * 0.23);
    for (let cellIndex = 0; cellIndex < activeCells.length; cellIndex += 1) {
      const [x, y] = coordinates[cellIndex] ?? [];
      if (x === undefined || y === undefined) continue;
      const cell = activeCells[cellIndex];
      const bingoColumnRanges: [number, number][] = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
      const value = await readNumber(rect.x / source.width + x * rect.width / source.width,
        rect.y / source.height + y * rect.height / source.height, size, kind === "number"
          ? { allowedRange: bingoColumnRanges[cell.column] }
          : {});
      matrix[cell.row][cell.column] = value;
    }
    const grid = layout.cells.map((cell, cellIndex) =>
      free.has(cellIndex) ? 0 : matrix[cell.row][cell.column] || -1,
    );
    const validCount = grid.filter((value) => value > 0).length;
    if (validCount < Math.max(3, Math.ceil(activeCells.length * 0.5))) continue;
    const playableValues = grid.filter((value) => value > 0);
    const duplicateValues = new Set(playableValues).size !== playableValues.length;
    const incomplete = validCount < activeCells.length;
    const detected: DetectedGrid = {
      grid, x: rect.x + rect.width / 2, y: source.height - rect.y,
      score: 80 + validCount, rowIds: [`anchored:${kind}:${index}`],
      layout,
      reviewNotes: incomplete || duplicateValues ? [
        "Verifica los números de esta forma antes de confirmar la importación.",
        ...(incomplete ? ["Faltan números que no se pudieron leer automáticamente."] : []),
        ...(duplicateValues ? ["Se detectaron números repetidos; corrige las casillas antes de jugar."] : []),
      ] : [],
    };
    cards.push(...cardsFromDetectedGrids([detected], fileName, pageNumber));
  }
  await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: "11" });
  return cards;
}

async function recognizeSabrositoCards(
  source: HTMLCanvasElement,
  rectangles: CompactRectangle[],
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
) {
  const detected: DetectedGrid[] = [];
  const ballPositions = [
    [0.17, 0.28], [0.5, 0.28], [0.83, 0.28],
    [0.17, 0.72], [0.83, 0.72],
  ] as const;
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "10",
    preserve_interword_spaces: "1",
  });
  for (const [cardIndex, rectangle] of rectangles.entries()) {
    const side = Math.max(
      24,
      Math.round(Math.min(rectangle.width * 0.23, rectangle.height * 0.46)),
    );
    const values: number[] = [];
    for (const [xRatio, yRatio] of ballPositions) {
      const centerX = rectangle.x + rectangle.width * xRatio;
      const centerY = rectangle.y + rectangle.height * yRatio;
      const readBall = async (captureSide: number, threshold?: number) => {
        const crop = makeCanvas(220, 220);
        if (!crop) return undefined;
        crop.context.drawImage(
          source,
          Math.max(0, Math.round(centerX - captureSide / 2)),
          Math.max(0, Math.round(centerY - captureSide / 2)),
          captureSide,
          captureSide,
          0,
          0,
          220,
          220,
        );
        if (threshold !== undefined) {
          binarizeNumbers(crop.canvas, crop.context, {
            luminance: threshold,
            chroma: 78,
          });
        }
        const result = await worker.recognize(
          crop.canvas,
          {},
          { blocks: false, tsv: false, text: true },
        );
        return (result.data.text.match(/\d{1,2}/g) ?? [])
          .map(Number)
          .find((candidate) => candidate >= 1 && candidate <= 75);
      };
      let value = await readBall(side);
      if (value === undefined) {
        value = await readBall(Math.round(side * 1.22), 175);
      }
      if (value === undefined) {
        value = await readBall(Math.round(side * 1.22), 195);
      }
      if (value !== undefined) values.push(value);
    }
    if (values.length !== 5 || new Set(values).size !== 5) continue;
    detected.push({
      grid: values,
      x: rectangle.x + rectangle.width / 2,
      y: source.height - rectangle.y,
      score: rectangle.score,
      rowIds: [`sabrosito:${cardIndex}`],
      layout: createCardLayout("sabrosito-5"),
    });
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  return cardsFromDetectedGrids(detected, fileName, pageNumber);
}

async function runOcrCanvas(
  canvas: HTMLCanvasElement,
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
  options: {
    forceFullPageOcr?: boolean;
    sabrositoSheet?: boolean;
    specialSheet?: boolean;
    recognizeImageHeading?: boolean;
  } = {},
) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const rectangles = detectGridRectangles(
    pixels.data,
    canvas.width,
    canvas.height,
  );
  let fullPageTokens: PositionedNumber[] = [];
  let pageWideCards: BingoCard[] = [];
  let sabrositoSheet = Boolean(options.sabrositoSheet);
  let specialSheet = Boolean(options.specialSheet);
  let numberSheet = false;
  // Special sheets (Sabrosito, Números and additional games) are sparse and
  // often contain ten small forms. A full-page sparse OCR pass can recover all
  // of their numbers in one job; probing every mini-cell first causes hundreds
  // of serial OCR calls and makes the import appear frozen on page 1.
  if (options.forceFullPageOcr) {
    let ocrHeading = "";
    // Classify a scanned page before running page-wide OCR. Explicitly titled
    // forms have fixed, sparse regions, so a full-page OCR pass both wastes
    // minutes and tends to merge unrelated values into false candidates.
    if (options.recognizeImageHeading) {
      // Include the first row's printed ticket IDs too; some scans have a
      // damaged masthead but clear ``N°-1 #...`` labels immediately below it.
      const header = makeCanvas(canvas.width, Math.max(1, Math.round(canvas.height * 0.28)));
      if (header) {
        header.context.drawImage(canvas, 0, 0, canvas.width, header.canvas.height,
          0, 0, header.canvas.width, header.canvas.height);
        await worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÁÉÍÓÚÜÑáéíóúüñ",
          tessedit_pageseg_mode: "6",
          preserve_interword_spaces: "1",
        });
        const headingResult = await worker.recognize(header.canvas, {}, { blocks: false, tsv: false, text: true });
        ocrHeading = headingResult.data.text ?? "";
      }
      sabrositoSheet ||= isSabrositoSheetHeading(ocrHeading);
      specialSheet ||= isExplicitSpecialSheetHeading(ocrHeading);
      numberSheet = isNumberPatternSheetHeading(ocrHeading);
      if (numberSheet) {
        return recognizeAnchoredSheetCards(canvas, worker, fileName, pageNumber, "number");
      }
      if (specialSheet && !sabrositoSheet) {
        return recognizeAnchoredSheetCards(
          canvas,
          worker,
          fileName,
          pageNumber,
          "additional",
          additionalFormOrderForHeading(ocrHeading),
        );
      }
      if (sabrositoSheet) {
        const cards = await recognizeSabrositoCards(
          canvas,
          sabrositoFallbackRectangles(canvas.width, canvas.height),
          worker,
          fileName,
          pageNumber,
        );
        if (cards.length) return cards;
      }
    }
    const pageResult = await worker.recognize(
      canvas,
      {},
      // TSV contains the positioned numbers needed to rebuild the forms.
      // Blocks are considerably more expensive on scanned pages and are kept
      // for the regional fallback below.
      { blocks: false, tsv: true, text: true },
    );
    const pageTokens = pageResult.data.tsv
      ? tokensFromTsv(pageResult.data.tsv, canvas.height)
      : [];
    ocrHeading ||= pageResult.data.text ?? "";
    // Image imports start with a numeric whitelist so ball recognition stays
    // precise. That makes a visible "HOJA DE ADICIONAL" heading impossible
    // to recognize, however, so OCR just the top header band with letters
    // enabled. Restricting this pass to the title area is much faster and less
    // noisy than re-running OCR over every number on the full image.
    if (options.recognizeImageHeading && !isExplicitSpecialSheetHeading(ocrHeading) &&
      !isSabrositoSheetHeading(ocrHeading)) {
      const header = makeCanvas(canvas.width, Math.max(1, Math.round(canvas.height * 0.2)));
      if (header) {
        header.context.drawImage(
          canvas,
          0,
          0,
          canvas.width,
          header.canvas.height,
          0,
          0,
          header.canvas.width,
          header.canvas.height,
        );
      }
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÁÉÍÓÚÜÑáéíóúüñ",
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1",
      });
      if (header) {
        const headingResult = await worker.recognize(
          header.canvas,
          {},
          { blocks: false, tsv: false, text: true },
        );
        ocrHeading = headingResult.data.text ?? "";
      }
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: "11",
        preserve_interword_spaces: "1",
      });
    }
    // Do not infer Sabrositos from generic page geometry alone. On 5×5 sheets
    // with interrupted borders, the old fixed 2×5 fallback sampled five
    // unrelated cells and presented them as valid Sabrosito tickets.
    sabrositoSheet ||= isSabrositoSheetHeading(ocrHeading);
    specialSheet ||= isExplicitSpecialSheetHeading(ocrHeading);
    numberSheet = isNumberPatternSheetHeading(ocrHeading);
    fullPageTokens = pageTokens;
    // The sparse pass can already recover a few compact cards, but it does
    // not by itself understand the row signatures of the six additional
    // forms on a sheet.  Always run the shape detector before deciding that
    // the page is complete; otherwise the first two grouped cards caused the
    // remaining forms (and many Sabrositos) to be discarded prematurely.
    const pageSpecialCards = pageTokens.length
      ? cardsFromDetectedGrids(
          detectSpecialCardGrids(pageTokens),
          fileName,
          pageNumber,
        )
      : [];
    pageWideCards = removeSabrositoCardsFromClassicSheets(mergeDetectedCards(
      pageResult.data.tsv
        ? cardsFromTokens(pageTokens, fileName, pageNumber)
        : [],
      pageSpecialCards,
    ), rectangles.length);
    if (
      hasCompletePageRead(pageWideCards, pageTokens.length) &&
      rectangles.length >= 2
    ) return removeSabrositoCardsFromClassicSheets(
      pageWideCards,
      rectangles.length,
    );
  }
  // A scanned page with several regular 5×5 tickets is much faster to read
  // as one sparse-text image than by OCR'ing every ticket and then every
  // missing cell. Keep the regional path as a fallback for low-quality scans.
  if (rectangles.length > 0 && !options.forceFullPageOcr) {
    const pageResult = await worker.recognize(
      canvas,
      {},
      { blocks: false, tsv: true, text: true },
    );
    const pageTokens = pageResult.data.tsv
      ? tokensFromTsv(pageResult.data.tsv, canvas.height)
      : [];
    const pageCards = mergeDetectedCards(
      pageResult.data.tsv
        ? cardsFromTokens(pageTokens, fileName, pageNumber)
        : [],
      [],
    );
    if (pageCards.length > 0) {
      return removeSabrositoCardsFromClassicSheets(pageCards, rectangles.length);
    }
  }
  let standardCards: BingoCard[] = [];
  if (rectangles.length) {
    standardCards = await recognizeDetectedGrids(
      canvas,
      rectangles,
      worker,
      fileName,
      pageNumber,
    );
  }
  // Compact-region OCR is intentionally limited to pages that need it. On a
  // normal scanned 5×5 sheet, probing every possible compact frame can create
  // dozens of extra OCR jobs before the page can advance. Special sheets are
  // forced by their explicit heading; otherwise we only probe compact regions
  // when the standard 5×5 detector did not recover a card.
  let compactRectangles: CompactRectangle[] = [];
  if (options.forceFullPageOcr || standardCards.length === 0) {
    compactRectangles = detectCompactRectangles(
      pixels.data,
      canvas.width,
      canvas.height,
    );
    // Run the frame detector once more on a high-contrast copy. Gray diagonal
    // watermarks can interrupt the original luminance image even though the
    // black Sabrosito borders remain clearly recoverable after binarization.
    if (!compactRectangles.length) {
      const cleaned = makeCanvas(canvas.width, canvas.height);
      if (cleaned) {
        cleaned.context.drawImage(canvas, 0, 0);
        binarizeNumbers(cleaned.canvas, cleaned.context, { luminance: 165, chroma: 72 });
        const cleanedPixels = cleaned.context.getImageData(0, 0, cleaned.canvas.width, cleaned.canvas.height);
        compactRectangles = detectCompactRectangles(
          cleanedPixels.data,
          cleaned.canvas.width,
          cleaned.canvas.height,
        );
      }
    }
  }
  const compactCards = options.forceFullPageOcr
    ? []
    : await recognizeCompactCards(
        canvas,
        compactRectangles,
        worker,
        fileName,
        pageNumber,
      );
  let regionCards = removeSabrositoCardsFromClassicSheets(
    mergeDetectedCards(standardCards, compactCards, pageWideCards),
    effectiveClassicGridCount(rectangles.length, compactRectangles.length),
  );
  if (shouldReadSpecialSheetRegions({
    forceFullPageOcr: Boolean(options.forceFullPageOcr),
    pageComplete: hasCompletePageRead(regionCards, fullPageTokens.length),
    classicRectangleCount: rectangles.length,
    compactRectangleCount: compactRectangles.length,
    explicitSpecialMarker: specialSheet,
  })) {
    // OCR each card-sized tile once. This page-geometry fallback handles
    // missing headings, split borders and watermark interruptions without
    // asking OCR to interpret the whole sheet as one 5×5 ticket.
    const sabrositoCards = shouldProbeSabrositoGeometryFallback({
      explicitHeading: sabrositoSheet,
      classicRectangleCount: rectangles.length,
      compactRectangleCount: compactRectangles.length,
    })
      ? await recognizeSabrositoCards(
          canvas,
          sabrositoFallbackRectangles(canvas.width, canvas.height),
          worker,
          fileName,
          pageNumber,
        )
      : [];
    const acceptedSabrositoCards = sabrositoSheet || sabrositoCards.length >= 8
      ? sabrositoCards
      : [];
    const specialRectangles = numberSheet
      ? numberPatternSheetRectangles(canvas.width, canvas.height)
      : additionalSheetRectangles(canvas.width, canvas.height, specialSheet);
    const additionalCards = numberSheet
      ? []
      : await recognizeSpecialSheetRegions(
          canvas,
          specialRectangles,
          worker,
          fileName,
          pageNumber,
          0.03,
        );
    const cellRecognizedCards = sabrositoSheet || (!numberSheet && additionalCards.length >= 6)
      ? []
      : await recognizeSpecialCardsByCell(
          canvas,
          specialRectangles,
          worker,
          fileName,
          pageNumber,
        );
    regionCards = removeSabrositoCardsFromClassicSheets(
      removeMisclassifiedClassicCards(
        mergeDetectedCards(regionCards, acceptedSabrositoCards, additionalCards, cellRecognizedCards),
      ),
      effectiveClassicGridCount(rectangles.length, compactRectangles.length),
    );
  }
  // Region OCR is substantially faster than a second full-page OCR pass.
  // Only run the page-wide pass when a detected region was not recovered (or
  // when the page has no card regions, as with sparse additional figures).
  // This preserves the existing fallback for incomplete scans while avoiding
  // duplicate work for clear PDF sheets.
  const standardRegionsComplete =
    rectangles.length > 0 && standardCards.length >= rectangles.length;
  const compactRegionsComplete =
    compactRectangles.length > 0 && compactCards.length >= compactRectangles.length;
  const hasCompleteRegions =
    regionCards.length > 0 &&
    (rectangles.length === 0 || standardRegionsComplete) &&
    (compactRectangles.length === 0 || compactRegionsComplete);
  // A page may contain valid-looking rectangular regions and still be a
  // sheet of Sabrositos or additional games.  In that case returning the
  // regional result early hides the sparse forms that only the full-page OCR
  // pass can assemble.  The caller sets this flag when the PDF text layer
  // identifies a special sheet (and image imports always use the same path).
  if (hasCompleteRegions && !options.forceFullPageOcr) {
    return removeSabrositoCardsFromClassicSheets(
      regionCards,
      effectiveClassicGridCount(rectangles.length, compactRectangles.length),
    );
  }

  const result = await worker.recognize(
    canvas,
    {},
    { blocks: true, tsv: true, text: true },
  );
  const tokenCards = result.data.tsv
    ? cardsFromTokens(tokensFromTsv(result.data.tsv, canvas.height), fileName, pageNumber)
    : [];
  const specialCards = result.data.tsv
    ? cardsFromDetectedGrids(
        detectSpecialCardGrids(tokensFromTsv(result.data.tsv, canvas.height)),
        fileName,
        pageNumber,
      )
    : [];
  const blockCards = result.data.blocks?.length
    ? extractCardsFromOcrBlocks(
        result.data.blocks,
        canvas.height,
        fileName,
        pageNumber,
      )
    : [];
  const detectedCards = removeSabrositoCardsFromClassicSheets(mergeDetectedCards(
    regionCards,
    specialCards,
    blockCards,
    tokenCards,
  ), effectiveClassicGridCount(rectangles.length, compactRectangles.length));
  if (detectedCards.length) {
    return removeSabrositoCardsFromClassicSheets(
      removeMisclassifiedClassicCards(detectedCards),
      effectiveClassicGridCount(rectangles.length, compactRectangles.length),
    );
  }
  const fallbackText = result.data.text ?? "";
  return removeSabrositoCardsFromClassicSheets(cardsFromTokens(
    numberMatches(fallbackText).map((match, index) => ({
      value: Number(match[0]),
      x: index % 5,
      y: -Math.floor(index / 5),
      width: 1,
      height: 1,
      order: index,
    })),
    fileName,
    pageNumber,
  ), effectiveClassicGridCount(rectangles.length, compactRectangles.length));
}

async function runOcr(
  pageProxy: import("pdfjs-dist").PDFPageProxy,
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
  options: {
    forceFullPageOcr?: boolean;
    sabrositoSheet?: boolean;
    specialSheet?: boolean;
    recognizeImageHeading?: boolean;
  } = {},
) {
  const baseViewport = pageProxy.getViewport({ scale: 1 });
  const scale = Math.max(
    1.1,
    Math.min(1.5, 1400 / Math.max(baseViewport.width, baseViewport.height)),
  );
  const viewport = pageProxy.getViewport({ scale });
  const target = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  if (!target) return [];
  await pageProxy.render({
    canvas: target.canvas,
    canvasContext: target.context,
    viewport,
  }).promise;
  return runOcrCanvas(target.canvas, worker, fileName, pageNumber, options);
}

export async function parseBingoPdf(
  file: File,
  onProgress: (progress: PdfParseProgress) => void,
  selectedPages?: number[],
): Promise<PdfParseResult> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
  }).promise;
  const pageCount = pdf.numPages;
  const pagesToProcess = normalizePdfPageSelection(pageCount, selectedPages);
  const pageResults: Array<{ cards: BingoCard[]; warnings: string[] }> =
    Array.from({ length: pageCount }, () => ({ cards: [], warnings: [] }));
  // Three workers keep multi-page scans moving while keeping memory bounded.
  // Pages are still merged in their original order below.
  const workerCount = Math.min(3, pagesToProcess.length);
  const ocrWorkers: Array<OcrWorker | null> = Array(workerCount).fill(null);

  try {
    const processPage = async (pageNumber: number, workerIndex: number, selectionIndex: number) => {
      const result = pageResults[pageNumber - 1];
      try {
      onProgress({
        page: pageNumber,
        pages: pageCount,
        stage: "Leyendo texto",
        percent: Math.round((selectionIndex / pagesToProcess.length) * 100),
      });
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      const items = text.items.flatMap<PdfTextItem>((item) =>
        "str" in item && "transform" in item
          ? [
              {
                str: item.str,
                transform: [...item.transform],
                width: "width" in item ? item.width : undefined,
                height: "height" in item ? item.height : undefined,
              },
            ]
          : [],
      );
      const expectedIdentifiers = identifiersFromTextItems(items);
      let pageCards: BingoCard[] = extractCardsFromTextItems(items, file.name, pageNumber);
      const specialMarker = hasAdditionalGameMarker(items);
      const expectedSpecial = expectedSpecialCardCount(items);
      const textNumberCount = items.reduce(
        (total, item) => total + numberMatches(item.str).length,
        0,
      );
      const underReadText =
        textNumberCount >= 15 &&
        countGridValues(pageCards) < Math.max(12, textNumberCount * 0.77);

      const tableMarkers = items
        .map((item) => item.str)
        .join(" ")
        .match(/\b(?:tabla|cart[oó]n|ticket)\b/giu)?.length ?? 0;
      if (
        !pageCards.length ||
        expectedIdentifiers.length > pageCards.length ||
        tableMarkers > pageCards.length ||
        (specialMarker && pageCards.length < expectedSpecial) ||
        underReadText
      ) {
        onProgress({
          page: pageNumber,
          pages: pageCount,
          stage: "Aplicando OCR",
          percent: Math.round(((selectionIndex + 0.5) / pagesToProcess.length) * 100),
        });
        try {
          ocrWorkers[workerIndex] ??= await createOcrWorker();
          const ocrCards = await runOcr(
            page,
            ocrWorkers[workerIndex] as OcrWorker,
            file.name,
            pageNumber,
            {
              forceFullPageOcr: specialMarker || items.length === 0 || underReadText,
              sabrositoSheet: isSabrositoSheetHeading(items.map((item) => item.str).join(" ")),
              specialSheet: specialMarker,
              recognizeImageHeading: true,
            },
          );
          // Keep classic 5×5 OCR cards as well: additional figures are often
          // printed on a 5×5-looking sheet and their identifying shape can be
          // lost if OCR output is filtered by layout type.
          pageCards = removeMisclassifiedClassicCards(
            mergeDetectedCards(pageCards, ocrCards),
          );
        } catch (error) {
          result.warnings.push(
            `Página ${pageNumber}: el OCR no pudo completarse (${error instanceof Error ? error.message : "error desconocido"}).`,
          );
        }
      }

      if (!pageCards.length) {
        result.warnings.push(
          `Página ${pageNumber}: no se encontró un cartón o juego adicional válido. Puedes corregirlo con “Ingreso manual”.`,
        );
      }
      result.cards.push(...pageCards);
      page.cleanup();
      } catch (error) {
        result.warnings.push(
          `Página ${pageNumber}: no pudo procesarse (${error instanceof Error ? error.message : "error desconocido"}).`,
        );
      }
    };
    for (let start = 0; start < pagesToProcess.length; start += workerCount) {
      const batch = pagesToProcess.slice(start, start + workerCount);
      await Promise.all(batch.map((pageNumber, offset) => processPage(pageNumber, offset, start + offset)));
    }
  } finally {
    await Promise.all(
      ocrWorkers.map((worker) => worker?.terminate().catch(() => undefined)),
    );
    await pdf.destroy();
  }

  onProgress({
    page: pagesToProcess.at(-1) ?? pageCount,
    pages: pageCount,
    stage: "Validando",
    percent: 100,
  });
  return {
    cards: pageResults.flatMap((result) => result.cards),
    pages: pagesToProcess.length,
    warnings: pageResults.flatMap((result) => result.warnings),
  };
}

export type BingoSourceKind = "pdf" | "image";

export async function getBingoSourcePageCount(file: File): Promise<number> {
  const kind = await identifyBingoSource(file);
  if (kind === "image") return 1;
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
  }).promise;
  try {
    return pdf.numPages;
  } finally {
    await pdf.destroy();
  }
}

export async function identifyBingoSource(file: File): Promise<BingoSourceKind> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isPdf = bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  const isPng = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const isJpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (isPdf) return "pdf";
  if (isPng || isJpeg) return "image";
  throw new Error("El archivo no es un PDF, JPG, JPEG o PNG válido.");
}

export async function parseBingoImage(
  file: File,
  onProgress: (progress: PdfParseProgress) => void,
): Promise<PdfParseResult> {
  onProgress({ page: 1, pages: 1, stage: "Aplicando OCR", percent: 12 });
  const bitmap = await createImageBitmap(file);
  // Screenshots of additional-game sheets are commonly 400–700 px wide.
  // Rendering them at the old 1.7× cap left the number glyphs too small for
  // Tesseract.  Scale modest images up to 3× while keeping large uploads
  // bounded to avoid excessive memory use.
  const scale = Math.min(3, 3000 / Math.max(bitmap.width, bitmap.height));
  const target = makeCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  if (!target) {
    bitmap.close();
    throw new Error("No se pudo preparar la imagen para el reconocimiento.");
  }
  target.context.drawImage(bitmap, 0, 0, target.canvas.width, target.canvas.height);
  bitmap.close();
  const worker = await createOcrWorker();
  try {
    const cards = await runOcrCanvas(target.canvas, worker, file.name, 1, {
      forceFullPageOcr: true,
      recognizeImageHeading: true,
    });
    const warnings = cards.length
      ? []
      : ["No se detectó un cartón en la imagen. Comprueba que esté enfocada y completa."];
    onProgress({ page: 1, pages: 1, stage: "Validando", percent: 100 });
    return { cards, pages: 1, warnings };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

export async function parseBingoFile(
  file: File,
  onProgress: (progress: PdfParseProgress) => void,
  selectedPages?: number[],
): Promise<PdfParseResult> {
  const kind = await identifyBingoSource(file);
  return kind === "pdf" ? parseBingoPdf(file, onProgress, selectedPages) : parseBingoImage(file, onProgress);
}

export async function fileChecksum(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
