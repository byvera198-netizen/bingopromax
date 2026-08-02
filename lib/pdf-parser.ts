"use client";

import {
  NUMBER_SHEET_FORM_CELLS,
  numberSheetFormForGrid,
  type BingoCard,
  type NumberSheetForm,
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
  identifier?: string;
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
  stage: "Leyendo texto" | "Decodificando imagen" | "Aplicando OCR" | "Validando";
  percent: number;
}

export interface PdfParseResult {
  cards: BingoCard[];
  pages: number;
  warnings: string[];
}

export interface GridRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  verticalLines: number[];
  horizontalLines: number[];
  score: number;
  nextHorizontalLine?: number;
}

export interface CompactRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
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
  // En hojas con dos cartones contiguos puede aparecer una secuencia falsa que
  // empieza en la segunda columna del cartón izquierdo y termina en el borde
  // del derecho. Elegir primero la cuadrícula más a la izquierda conserva los
  // cinco límites reales del cartón antes de descartar solapamientos.
  for (const rectangle of rectangles.sort(
    (a, b) => a.y - b.y || a.x - b.x || b.score - a.score,
  )) {
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
      return intersection / Math.max(1, smallerArea) > 0.12;
    });
    if (!duplicate) selected.push(rectangle);
  }
  const ordered = selected.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const rectangle of ordered) {
    const rightNeighbor = ordered
      .filter(
        (candidate) =>
          candidate.x > rectangle.x &&
          Math.abs(candidate.y - rectangle.y) <= rectangle.height * 0.08,
      )
      .sort((a, b) => a.x - b.x)[0];
    if (!rightNeighbor || rectangle.x + rectangle.width <= rightNeighbor.x) {
      continue;
    }
    const spacing = median(
      rectangle.verticalLines
        .slice(1)
        .map((position, index) => position - rectangle.verticalLines[index]),
    );
    const expected = rectangle.verticalLines[0] - spacing;
    const predecessor = vertical
      .filter(
        (line) =>
          line.position < rectangle.verticalLines[0] &&
          Math.abs(line.position - expected) <= spacing * 0.18,
      )
      .sort(
        (a, b) =>
          Math.abs(a.position - expected) - Math.abs(b.position - expected),
      )[0];
    if (!predecessor) continue;
    rectangle.verticalLines = [
      predecessor.position,
      ...rectangle.verticalLines.slice(0, 5),
    ];
    rectangle.x = predecessor.position;
    rectangle.width = rectangle.verticalLines[5] - rectangle.verticalLines[0];
  }
  for (const rectangle of ordered) {
    const spacing = median(
      rectangle.horizontalLines
        .slice(1)
        .map((position, index) => position - rectangle.horizontalLines[index]),
    );
    const expected = rectangle.horizontalLines[5] + spacing;
    rectangle.nextHorizontalLine = horizontal
      .filter(
        (line) =>
          line.position > rectangle.horizontalLines[5] &&
          Math.abs(line.position - expected) <= spacing * 0.18,
      )
      .sort(
        (a, b) =>
          Math.abs(a.position - expected) - Math.abs(b.position - expected),
      )[0]?.position;
  }
  return ordered;
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
    })).filter((line) => line.strength >= width * 0.22),
  );
  const vertical = groupLineBands(
    Array.from({ length: width }, (_, x) => ({
      position: x,
      strength: longestDarkRun(height, (y) => isDark(x, y), 3),
    })).filter((line) => line.strength >= height * 0.12),
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
            rectangleHeight < height * 0.12 ||
            rectangleHeight > height * 0.3
          ) {
            continue;
          }
          const ratio = rectangleWidth / rectangleHeight;
          if (ratio < 1.25 || ratio > 2.15) continue;
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
          if (edgeDensity < 0.45) continue;
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
  return values.every((value) => Number.isInteger(value) && value >= 1 && value <= 75);
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
  // Un cartón clásico de 75 bolillas debe conservar las columnas
  // B=1-15, I=16-30, N=31-45, G=46-60 y O=61-75. Si el OCR mezcla
  // filas o columnas, es más seguro rechazarlo que guardar otro cartón.
  if (standardMatches !== standardTotal) return -1;
  score += standardTotal ? (standardMatches / standardTotal) * 7 : 0;
  return score;
}

function numberMatches(text: string) {
  return [...text.matchAll(/(?<![\d])(?:[1-9]|[1-6]\d|7[0-5])(?![\d])/g)];
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
  const expression =
    /(?:tab|cart[oó]n|tabla|ticket|serie)\s*(?:n(?:úm(?:ero)?)?\.?|n[°ºo]?|#)?\s*[:\-]?\s*(\d{1,12}(?:-\d{1,3})?)/giu;
  for (const item of items) {
    if (item.transform.length < 6) continue;
    for (const match of item.str.matchAll(expression)) {
      identifiers.push({
        value: match[1],
        x: item.transform[4],
        y: item.transform[5],
      });
    }
    for (const match of item.str.matchAll(/\b(\d{5,12}(?:-\d{1,3})?)\b/g)) {
      identifiers.push({ value: match[1], x: item.transform[4], y: item.transform[5] });
    }
  }
  const positioned = items
    .filter((item) => item.transform.length >= 6 && item.str.trim())
    .map((item) => ({ item, x: item.transform[4], y: item.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: typeof positioned[] = [];
  for (const entry of positioned) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - entry.y) <= 4);
    if (row) row.push(entry);
    else rows.push([entry]);
  }
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    for (let index = 0; index < row.length; index += 1) {
      const group = [row[index]];
      for (let offset = 1; offset < 3 && index + offset < row.length; offset += 1) {
        const previous = group[group.length - 1];
        const next = row[index + offset];
        const gap = next.x - (previous.x + (Number(previous.item.width) || 0));
        if (gap > 80) break;
        group.push(next);
      }
      const combined = group.map((entry) => entry.item.str.trim()).join("");
      for (const match of combined.matchAll(expression)) {
        identifiers.push({ value: match[1], x: group[0].x, y: group[0].y });
      }
    }
  }
  return identifiers.filter(
    (identifier, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.value.toLowerCase() === identifier.value.toLowerCase() &&
          Math.abs(candidate.x - identifier.x) < 5 &&
          Math.abs(candidate.y - identifier.y) < 5,
      ) === index,
  );
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
  const missingIdentifier = (index: number) =>
    `SIN-ID-${String(page).padStart(3, "0")}-${index + 1}`;

  const usedIdentifiers = new Set<Identifier>();
  return orderedGrids.map((detected, index) => {
    const identifier = detected.identifier
      ? undefined
      : orderedIdentifiers
          .filter((candidate) => !usedIdentifiers.has(candidate))
          .sort((a, b) => {
            const distanceA = Math.abs(a.x - detected.x) + Math.abs(a.y - detected.y);
            const distanceB = Math.abs(b.x - detected.x) + Math.abs(b.y - detected.y);
            return distanceA - distanceB;
          })[0];
    if (identifier) usedIdentifiers.add(identifier);
    return {
      id: crypto.randomUUID(),
      number: detected.identifier ?? identifier?.value ?? missingIdentifier(index),
      serial: "",
      grid: detected.grid,
      sourceFile: fileName,
      sourcePage: page,
      status: "active" as const,
    };
  });
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

export function extractCardsFromTextItems(
  items: PdfTextItem[],
  fileName: string,
  page: number,
) {
  return cardsFromTokens(
    tokensFromTextItems(items),
    fileName,
    page,
    identifiersFromTextItems(items),
  );
}

const bingoColumnRanges = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
] as const;

function validNumberForCell(value: number, index: number) {
  const [minimum, maximum] = bingoColumnRanges[index % 5];
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function normalizeNumberSheetGrid(
  grid: number[],
  form: NumberSheetForm,
) {
  const required = new Set(NUMBER_SHEET_FORM_CELLS[form]);
  return Array.from({ length: 25 }, (_, index) => {
    if (!required.has(index)) return 0;
    const value = grid[index] ?? -1;
    return validNumberForCell(value, index) ? value : -1;
  });
}

function isPlausibleNumberSheetGrid(
  grid: number[],
  form: NumberSheetForm,
) {
  const required = NUMBER_SHEET_FORM_CELLS[form];
  const values = required.map((index) => grid[index]);
  return (
    numberSheetFormForGrid(grid) === form &&
    values.every((value, index) => validNumberForCell(value, required[index])) &&
    new Set(values).size === values.length
  );
}

function inferNumberSheetForm(grid: number[]): NumberSheetForm | null {
  const recognized = grid
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => validNumberForCell(value, index));
  if (recognized.length < 6) return null;
  return (
    (Object.entries(NUMBER_SHEET_FORM_CELLS) as Array<[NumberSheetForm, number[]]>)
      .map(([form, cells]) => {
        const required = new Set(cells);
        const matches = recognized.filter(({ index }) => required.has(index)).length;
        const outside = recognized.length - matches;
        return {
          form,
          matches,
          outside,
          score: matches / cells.length + matches / recognized.length - outside * 0.08,
        };
      })
      .filter(({ matches, outside }) => matches >= 6 && outside <= 3)
      .sort((a, b) => b.score - a.score)[0]?.form ?? null
  );
}

interface NumberSheetMetadata {
  form: NumberSheetForm | null;
  identifier: string | null;
}

export function numberSheetMetadataFromOcrText(
  text: string,
): NumberSheetMetadata | null {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const form = rawLines
    .map((line) => {
      const explicit = line.match(/(?:form\w*|#)\D*([1359])/i)?.[1];
      const digits = line.replace(/\D/g, "");
      return (explicit ?? (/^[1359]$/.test(digits) ? digits : null)) as NumberSheetForm | null;
    })
    .find((value): value is NumberSheetForm => value !== null) ?? null;
  const normalized = text
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1");
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const separated = normalized.match(/(\d{5,12})\s*[-_]\s*(\d{1,3})/);
  let identifier = separated ? `${separated[1]}-${separated[2]}` : null;
  if (!identifier) {
    const joined = lines
      .map((line) => line.replace(/\D/g, ""))
      .filter((digits) => digits.length >= 6 && digits.length <= 13)
      .sort((a, b) => b.length - a.length)[0];
    if (joined && /[3-9]$/.test(joined)) {
      identifier = `${joined.slice(0, -1)}-${joined.slice(-1)}`;
    }
  }
  return form || identifier ? { form, identifier } : null;
}

function numberSheetFormsFromIdentifierSeries(
  metadata: Array<NumberSheetMetadata | null>,
) {
  if (metadata.length !== 4) return null;
  const parsed = metadata.map((item, index) => {
    const match = item?.identifier?.match(/^(.+)-(\d+)$/);
    return match
      ? { index, family: match[1], suffix: Number(match[2]) }
      : null;
  });
  if (parsed.some((item) => !item)) return null;
  const entries = parsed.filter(
    (item): item is NonNullable<typeof item> => item !== null,
  );
  if (
    new Set(entries.map((item) => item.family)).size !== 1 ||
    new Set(entries.map((item) => item.suffix)).size !== 4
  ) {
    return null;
  }
  const forms: NumberSheetForm[] = ["1", "3", "5", "9"];
  const result = Array<NumberSheetForm>(4);
  entries
    .sort((a, b) => a.suffix - b.suffix)
    .forEach((item, order) => {
      result[item.index] = forms[order];
    });
  return result;
}

const numberSheetFormBySuffix: Partial<Record<number, NumberSheetForm>> = {
  3: "1",
  4: "3",
  5: "5",
  6: "9",
};

function dominantNumberSheetFamily(
  metadata: Array<NumberSheetMetadata | null>,
) {
  const counts = new Map<string, number>();
  for (const item of metadata) {
    const family = item?.identifier?.match(/^(.+)-\d+$/)?.[1];
    if (family) counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : null;
}

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

export function decodeBingoRowDigits(raw: string, centerFree = false) {
  const digits = raw.replace(/\D/g, "");
  const columns = centerFree ? [0, 1, 3, 4] : [0, 1, 2, 3, 4];
  if (digits.length < columns.length || digits.length > columns.length * 2 + 4) {
    return null;
  }
  let best: { values: number[]; skipped: number; confidence: number } | null = null;
  function visit(position: number, columnIndex: number, values: number[], skipped: number) {
    if (skipped > 4) return;
    if (columnIndex === columns.length) {
      const totalSkipped = skipped + digits.length - position;
      if (totalSkipped > 4) return;
      const confidence = values.length * 25 - totalSkipped * 20;
      if (!best || confidence > best.confidence) {
        best = { values, skipped: totalSkipped, confidence };
      }
      return;
    }
    if (position >= digits.length) return;
    visit(position + 1, columnIndex, values, skipped + 1);
    const column = columns[columnIndex];
    const [minimum, maximum] = bingoColumnRanges[column];
    for (const length of [2, 1]) {
      const text = digits.slice(position, position + length);
      if (!text || text.startsWith("0")) continue;
      const value = Number(text);
      if (value < minimum || value > maximum) continue;
      visit(position + length, columnIndex + 1, [...values, value], skipped);
    }
  }
  visit(0, 0, [], 0);
  if (!best) return null;
  const decoded = best as { values: number[] };
  return centerFree
    ? [decoded.values[0], decoded.values[1], 0, decoded.values[2], decoded.values[3]]
    : decoded.values;
}

export function extractNumberSheetGridFromKnownOcrBlocks(
  blocks: OcrBlock[],
  width: number,
  height: number,
  form: NumberSheetForm,
) {
  return normalizeNumberSheetGrid(
    extractPartialGridFromKnownOcrBlocks(blocks, width, height),
    form,
  );
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
  threshold = 175,
  maxChroma = 58,
) {
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    const luminance = red * 0.3 + green * 0.59 + blue * 0.11;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    const ink = luminance < threshold && chroma < maxChroma;
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

export function identifierFamilyFromOcrText(text: string) {
  const scores = new Map<string, number>();
  const add = (value: string, score: number) => {
    if (value.length < 5 || value.length > 10 || /^0+$/.test(value)) return;
    scores.set(value, (scores.get(value) ?? 0) + score);
  };
  const normalized = text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
  for (const match of normalized.matchAll(/tab(?:la)?\D{0,12}(\d{5,10})/gi)) add(match[1], 8);
  for (const match of normalized.matchAll(/(\d{5,10})\s*[-_]\s*([1-4])(?!\d)/g)) add(match[1], 5);
  for (const match of normalized.matchAll(/(?<!\d)(\d{6,11})(?!\d)/g)) {
    const joined = match[1];
    if (/[1-4]$/.test(joined)) add(joined.slice(0, -1), 3);
  }
  for (const match of normalized.matchAll(/(?<!\d)(\d{5,8})(?!\d)/g)) add(match[1], 1);
  return [...scores.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? null;
}

export function identifierFamilyConsensus(families: string[]) {
  const valid = families.filter((family) => /^\d{5,12}$/.test(family));
  if (!valid.length) return null;
  const lengths = valid.map((family) => family.length);
  const modalLength = [...new Set(lengths)].sort(
    (a, b) =>
      lengths.filter((length) => length === b).length -
        lengths.filter((length) => length === a).length ||
      a - b,
  )[0];
  const comparable = valid.filter((family) => family.length === modalLength);
  const consensus = Array.from({ length: modalLength }, (_, position) => {
    const counts = new Map<string, number>();
    for (const family of comparable) {
      counts.set(family[position], (counts.get(family[position]) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  });
  if (modalLength === 5 && consensus[0] === "0") {
    const nonZero = comparable.map((family) => family[0]).filter((digit) => digit !== "0");
    if (nonZero.length) {
      consensus[0] = [...new Set(nonZero)].sort(
        (a, b) =>
          nonZero.filter((digit) => digit === b).length -
          nonZero.filter((digit) => digit === a).length,
      )[0];
    }
  }
  return consensus.join("");
}

export function identifiersForDetectedGrids(
  family: string,
  count: number,
  consecutiveFamilies = false,
) {
  if (consecutiveFamilies && /^\d+$/.test(family)) {
    const first = Number(family);
    return Array.from({ length: count }, (_, index) =>
      `${String(first + index).padStart(family.length, "0")}-1`,
    );
  }
  return Array.from({ length: count }, (_, index) => `${family}-${index + 1}`);
}

async function recognizePortraitPageFamily(
  source: HTMLCanvasElement,
  worker: OcrWorker,
) {
  const left = source.width * 0.815;
  const top = source.height * 0.012;
  const width = source.width * 0.15;
  const height = source.height * 0.032;
  const readings: string[] = [];
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "1",
  });
  for (const threshold of [100, 135, 165]) {
    const target = makeCanvas(1200, 300);
    if (!target) continue;
    target.context.drawImage(
      source,
      left,
      top,
      width,
      height,
      0,
      0,
      target.canvas.width,
      target.canvas.height,
    );
    binarizeNumbers(target.canvas, target.context, threshold);
    const result = await worker.recognize(target.canvas, {}, { text: true });
    const reading = (result.data.text ?? "").replace(/\D/g, "");
    if (/^\d{5,12}$/.test(reading)) readings.push(reading);
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  return identifierFamilyConsensus(readings);
}

async function recognizeGridIdentifiers(
  source: HTMLCanvasElement,
  rectangles: GridRectangle[],
  worker: OcrWorker,
) {
  const ordered = [...rectangles].sort((a, b) => a.y - b.y || a.x - b.x);
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789-_#TabOoIl",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });

  // En las hojas de cuatro cartones la serie aparece varias veces en el
  // encabezado (p. ej. 87020, 87020-1 y 87020-2). Leer una sola franja amplia
  // es más estable que depender de cuatro recortes pequeños.
  const headerHeight = Math.max(1, Math.round(source.height * 0.42));
  const pageHeader = makeCanvas(source.width, headerHeight);
  let family: string | null = null;
  if (pageHeader) {
    pageHeader.context.drawImage(source, 0, 0, source.width, headerHeight, 0, 0, source.width, headerHeight);
    binarizeNumbers(pageHeader.canvas, pageHeader.context);
    const result = await worker.recognize(pageHeader.canvas, {}, { text: true });
    family = identifierFamilyFromOcrText(result.data.text ?? "");
  }

  if (!family) {
    const texts: string[] = [];
    for (const rectangle of ordered) {
      const margin = Math.max(28, rectangle.height * 0.25);
      const top = Math.max(0, rectangle.y - margin);
      const height = Math.max(1, rectangle.y - top);
      const target = makeCanvas(rectangle.width * 2, height * 2);
      if (!target) continue;
      target.context.drawImage(source, rectangle.x, top, rectangle.width, height, 0, 0, target.canvas.width, target.canvas.height);
      binarizeNumbers(target.canvas, target.context);
      const result = await worker.recognize(target.canvas, {}, { text: true });
      texts.push(result.data.text ?? "");
    }
    family = identifierFamilyFromOcrText(texts.join("\n"));
  }

  const identifierValues = family
    ? identifiersForDetectedGrids(
        family,
        ordered.length,
        source.width > source.height && ordered.length === 2,
      )
    : [];
  const identifiers: Identifier[] = family
      ? ordered.map((rectangle, index) => ({
          value: identifierValues[index],
          x: rectangle.x + rectangle.width / 2,
          y: source.height - rectangle.y,
        }))
      : [];

  /* istanbul ignore next -- defensive fallback for nonstandard single-card sheets */
  if (!identifiers.length) for (const [index, rectangle] of ordered.entries()) {
    const margin = Math.max(28, rectangle.height * 0.25);
    const top = Math.max(0, rectangle.y - margin);
    const height = Math.max(1, rectangle.y - top);
    const target = makeCanvas(rectangle.width * 2, height * 2);
    if (!target) continue;
    target.context.drawImage(source, rectangle.x, top, rectangle.width, height, 0, 0, target.canvas.width, target.canvas.height);
    binarizeNumbers(target.canvas, target.context);
    const result = await worker.recognize(target.canvas, {}, { text: true });
    const text = (result.data.text ?? "").replace(/\s+/g, " ").replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
    const separated = text.match(/(\d{5,12})\s*[-_]\s*(\d{1,3})/);
    let value = separated ? `${separated[1]}-${separated[2]}` : "";
    if (!value) {
      const joined = text.match(/\b(\d{6,13})\b/);
      if (joined && joined[1].endsWith(String((index % 4) + 1))) {
        value = `${joined[1].slice(0, -1)}-${joined[1].slice(-1)}`;
      }
    }
    if (value) identifiers.push({ value, x: rectangle.x + rectangle.width / 2, y: source.height - rectangle.y });
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  return identifiers;
}

async function recognizeNumberSheetMetadata(
  source: HTMLCanvasElement,
  rectangle: GridRectangle,
  worker: OcrWorker,
) {
  const left = rectangle.verticalLines[2] + 3;
  const top = rectangle.horizontalLines[2] + 3;
  const width = Math.max(1, rectangle.verticalLines[3] - left - 3);
  const height = Math.max(1, rectangle.horizontalLines[3] - top - 3);
  const target = makeCanvas(420, 300);
  if (!target) return null;
  target.context.drawImage(
    source,
    left,
    top,
    width,
    height,
    10,
    10,
    400,
    280,
  );
  binarizeNumbers(target.canvas, target.context, 168);
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789-_",
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1",
  });
  const result = await worker.recognize(target.canvas, {}, { text: true });
  const metadata = numberSheetMetadataFromOcrText(result.data.text ?? "");
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  return metadata;
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
  binarizeNumbers(target.canvas, target.context);
  return target.canvas;
}

const numberSheetSignatureCells = [5, 6, 7, 8, 9, 15, 16, 17, 18];

async function matchesNumberSheetSignature(
  source: HTMLCanvasElement,
  rectangle: GridRectangle,
  grid: number[],
  form: NumberSheetForm,
  worker: OcrWorker,
) {
  const expected = new Set(
    NUMBER_SHEET_FORM_CELLS[form].filter((index) =>
      numberSheetSignatureCells.includes(index),
    ),
  );
  let outside = 0;
  let matches = 0;
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "8",
    preserve_interword_spaces: "1",
  });
  const orderedCells = [
    ...numberSheetSignatureCells.filter((index) => !expected.has(index)),
    ...numberSheetSignatureCells.filter((index) => expected.has(index)),
  ];
  for (const index of orderedCells) {
    let value = validNumberForCell(grid[index] ?? -1, index)
      ? grid[index]
      : null;
    if (value === null) {
      const row = Math.floor(index / 5);
      const column = index % 5;
      const left = rectangle.verticalLines[column] + 5;
      const top = rectangle.horizontalLines[row] + 5;
      const width = Math.max(1, rectangle.verticalLines[column + 1] - left - 5);
      const height = Math.max(1, rectangle.horizontalLines[row + 1] - top - 5);
      const target = makeCanvas(240, 190);
      if (target) {
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
        binarizeNumbers(target.canvas, target.context, 168);
        const result = await worker.recognize(
          target.canvas,
          {},
          { blocks: true, text: true },
        );
        const symbols = result.data.blocks?.length
          ? flattenOcrSymbols(ocrWords(result.data.blocks))
          : [];
        value = bestCellValue(symbols, column, 120, 240);
        if (value === null) {
          const digits = (result.data.text ?? "").replace(/\D/g, "");
          for (let start = 0; start < digits.length && value === null; start += 1) {
            for (const length of [2, 1]) {
              const candidate = Number(digits.slice(start, start + length));
              if (validNumberForCell(candidate, index)) {
                value = candidate;
                break;
              }
            }
          }
        }
      }
    }
    if (value === null) continue;
    if (expected.has(index)) matches += 1;
    else outside += 1;
    if (outside > 1) break;
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  const requiredMatches = expected.size === 3 ? 2 : expected.size;
  return outside <= 1 && matches >= requiredMatches;
}

async function recognizeMissingNumberSheetCells(
  source: HTMLCanvasElement,
  rectangle: GridRectangle,
  grid: number[],
  form: NumberSheetForm,
  worker: OcrWorker,
) {
  const normalized = normalizeNumberSheetGrid(grid, form);
  const counts = new Map<number, number>();
  NUMBER_SHEET_FORM_CELLS[form]
    .map((index) => normalized[index])
    .filter((value) => value > 0)
    .forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const missing = NUMBER_SHEET_FORM_CELLS[form].filter((index) => {
    const value = normalized[index];
    return value < 0 || (counts.get(value) ?? 0) > 1;
  });
  const cellsToRecognize = [...new Set([
    ...NUMBER_SHEET_FORM_CELLS[form],
    ...missing,
  ])];
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "8",
    preserve_interword_spaces: "1",
  });
  const resolved = [...normalized];
  for (const index of cellsToRecognize) {
    const row = Math.floor(index / 5);
    const column = index % 5;
    const left = rectangle.verticalLines[column] + 5;
    const top = rectangle.horizontalLines[row] + 5;
    const width = Math.max(1, rectangle.verticalLines[column + 1] - left - 5);
    const height = Math.max(1, rectangle.horizontalLines[row + 1] - top - 5);
    let value: number | null = null;
    for (const threshold of [100, 145, 195, 225]) {
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
      binarizeNumbers(target.canvas, target.context, threshold);
      const result = await worker.recognize(
        target.canvas,
        {},
        { blocks: true, text: true },
      );
      const symbols = result.data.blocks?.length
        ? flattenOcrSymbols(ocrWords(result.data.blocks))
        : [];
      value = bestCellValue(symbols, column, 120, 240);
      if (value === null) {
        const digits = (result.data.text ?? "").replace(/\D/g, "");
        for (let start = 0; start < digits.length && value === null; start += 1) {
          for (const length of [2, 1]) {
            const candidate = Number(digits.slice(start, start + length));
            if (validNumberForCell(candidate, index)) {
              value = candidate;
              break;
            }
          }
        }
      }
      if (value !== null) break;
    }
    resolved[index] = value ?? (validNumberForCell(normalized[index], index)
      ? normalized[index]
      : -1);
  }
  const required = new Set(NUMBER_SHEET_FORM_CELLS[form]);
  const unresolvedRows = [...new Set(
    resolved
      .map((value, index) => ({ value, index }))
      .filter(({ value, index }) => required.has(index) && !validNumberForCell(value, index))
      .map(({ index }) => Math.floor(index / 5)),
  )];
  for (const row of unresolvedRows) {
    const left = rectangle.verticalLines[0] + 3;
    const top = rectangle.horizontalLines[row] + 3;
    const width = Math.max(1, rectangle.verticalLines[5] - left - 3);
    const height = Math.max(1, rectangle.horizontalLines[row + 1] - top - 3);
    let decoded: number[] | null = null;
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789",
      tessedit_pageseg_mode: "7",
      preserve_interword_spaces: "1",
    });
    for (const threshold of [145, 180, 215]) {
      const target = makeCanvas(1000, 210);
      if (!target) continue;
      target.context.drawImage(source, left, top, width, height, 15, 15, 970, 180);
      binarizeNumbers(target.canvas, target.context, threshold);
      const result = await worker.recognize(target.canvas, {}, { text: true });
      decoded = decodeBingoRowDigits(result.data.text ?? "", row === 2);
      if (decoded) break;
    }
    if (decoded) {
      decoded.forEach((value, column) => {
        resolved[row * 5 + column] = value;
      });
    }
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  return normalizeNumberSheetGrid(resolved, form);
}

async function recognizeMissingCells(
  source: HTMLCanvasElement,
  rectangle: GridRectangle,
  grid: number[],
  worker: OcrWorker,
  rereadAll = false,
) {
  const counts = new Map<number, number>();
  grid
    .filter((value) => value > 0)
    .forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const cellsToRecognize = grid
    .map((value, index) => ({ value, index }))
    .filter(
      ({ value, index }) =>
        index !== 12 &&
        (rereadAll ||
          !validNumberForCell(value, index) ||
          (counts.get(value) ?? 0) > 1),
    );
  if (!cellsToRecognize.length) return grid;
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "8",
    preserve_interword_spaces: "1",
  });
  const resolved = [...grid];
  for (const { index, value: originalValue } of cellsToRecognize) {
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
    let value: number | null = null;
    for (const threshold of [100, 145, 195]) {
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
      binarizeNumbers(target.canvas, target.context, threshold);
      const result = await worker.recognize(
        target.canvas,
        {},
        { blocks: true, tsv: true, text: true },
      );
      const symbols = result.data.blocks?.length
        ? flattenOcrSymbols(ocrWords(result.data.blocks))
        : [];
      value = bestCellValue(symbols, column, 120, 240);
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
        if (value === null && column === 1 && digits === "7") {
          value = 17;
        }
      }
      if (value !== null) break;
    }
    resolved[index] = value ?? (validNumberForCell(originalValue, index)
      ? originalValue
      : -1);
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
  const isFourCardPortraitSheet =
    source.height > source.width &&
    rectangles.length === 4 &&
    rectangles.every((item) => item.score >= 65);
  const eligibleRectangles = isFourCardPortraitSheet
    ? rectangles
    : rectangles.filter((item) => item.score >= 80);
  const firstRectangleTop = Math.min(
    ...eligibleRectangles.map((item) => item.y / source.height),
  );
  const likelyNumberSheetPage =
    eligibleRectangles.length === 4 && firstRectangleTop >= 0.32;
  const printedPortraitFamily = isFourCardPortraitSheet && !likelyNumberSheetPage
    ? await recognizePortraitPageFamily(source, worker)
    : null;
  const identifiers = await recognizeGridIdentifiers(source, eligibleRectangles, worker);
  let numberSheetMetadataCache: Array<NumberSheetMetadata | null> | null = null;
  let numberSheetFormCache: NumberSheetForm[] | null = null;
  let numberSheetFamily: string | null = null;
  for (const rectangle of eligibleRectangles) {
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
    if (gridQuality(grid) < 8 || likelyNumberSheetPage) {
      const rectangleIndex = eligibleRectangles.indexOf(rectangle);
      if (!numberSheetMetadataCache && eligibleRectangles.length === 4) {
        numberSheetMetadataCache = await Promise.all(
          eligibleRectangles.map((candidate) =>
            recognizeNumberSheetMetadata(source, candidate, worker),
          ),
        );
        numberSheetFormCache = numberSheetFormsFromIdentifierSeries(
          numberSheetMetadataCache,
        );
        numberSheetFamily = dominantNumberSheetFamily(numberSheetMetadataCache);
      }
      const metadata =
        numberSheetMetadataCache?.[rectangleIndex] ??
        (await recognizeNumberSheetMetadata(source, rectangle, worker));
      const metadataSuffix = Number(metadata?.identifier?.match(/-(\d+)$/)?.[1]);
      const formCandidates = [
        metadata?.form,
        numberSheetFormCache?.[rectangleIndex],
        likelyNumberSheetPage ? numberSheetFormBySuffix[metadataSuffix] : null,
        inferNumberSheetForm(grid),
      ].filter(
        (candidate, index, all): candidate is NumberSheetForm =>
          candidate !== null &&
          candidate !== undefined &&
          all.indexOf(candidate) === index,
      );
      let form: NumberSheetForm | null = null;
      for (const candidate of formCandidates) {
        if (
          metadata?.form === candidate ||
          await matchesNumberSheetSignature(
            source,
            rectangle,
            grid,
            candidate,
            worker,
          )
        ) {
          form = candidate;
          break;
        }
      }
      if (form) {
        let numberSheetGrid = normalizeNumberSheetGrid(grid, form);
        numberSheetGrid = await recognizeMissingNumberSheetCells(
          source,
          rectangle,
          numberSheetGrid,
          form,
          worker,
        );
        if (isPlausibleNumberSheetGrid(numberSheetGrid, form)) {
          detected.push({
            grid: numberSheetGrid,
            x: rectangle.x + rectangle.width / 2,
            y: source.height - rectangle.y,
            score: rectangle.score,
            rowIds: [],
            identifier: numberSheetFamily && Number.isInteger(metadataSuffix)
              ? `${numberSheetFamily}-${metadataSuffix}`
              : metadata?.identifier ??
              `SIN-ID-${String(pageNumber).padStart(3, "0")}-${eligibleRectangles.indexOf(rectangle) + 1}`,
          });
          continue;
        }
      }
    }
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
    if (gridQuality(grid) < 8 && rectangle.nextHorizontalLine) {
      const shiftedRectangle: GridRectangle = {
        ...rectangle,
        y: rectangle.horizontalLines[1],
        height: rectangle.nextHorizontalLine - rectangle.horizontalLines[1],
        horizontalLines: [
          ...rectangle.horizontalLines.slice(1),
          rectangle.nextHorizontalLine,
        ],
      };
      const shifted = cropGridCanvas(source, shiftedRectangle);
      if (shifted) {
        const shiftedResult = await worker.recognize(
          shifted,
          {},
          { blocks: true, tsv: true, text: true },
        );
        let shiftedGrid = extractPartialGridFromKnownOcrBlocks(
          shiftedResult.data.blocks ?? [],
          shifted.width,
          shifted.height,
        );
        shiftedGrid = await recognizeMissingCells(
          source,
          shiftedRectangle,
          shiftedGrid,
          worker,
          true,
        );
        if (gridQuality(shiftedGrid) >= 8) {
          grid = shiftedGrid;
          rectangle.y = shiftedRectangle.y;
          rectangle.height = shiftedRectangle.height;
          rectangle.horizontalLines = shiftedRectangle.horizontalLines;
        }
      }
    }
    if (gridQuality(grid) < 8) continue;
    const rectangleIndex = eligibleRectangles.indexOf(rectangle);
    const centerMetadata = await recognizeNumberSheetMetadata(
      source,
      rectangle,
      worker,
    );
    const headerIdentifier =
      source.width > source.height && eligibleRectangles.length === 2
        ? identifiers[rectangleIndex]?.value
        : undefined;
    detected.push({
      grid,
      x: rectangle.x + rectangle.width / 2,
      y: source.height - rectangle.y,
      score: rectangle.score,
      rowIds: [],
      identifier: headerIdentifier ?? centerMetadata?.identifier ?? undefined,
    });
  }
  const identifierParts = detected.flatMap((item) => {
    const match = item.identifier?.match(/^(\d{5,12})-(\d{1,3})$/);
    return match ? [{ family: match[1], suffix: match[2] }] : [];
  });
  const familyCounts = new Map<string, number>();
  identifierParts.forEach(({ family }) =>
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1),
  );
  const canonicalFamily = [...familyCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length,
  )[0];
  const detectedPortraitFamily = identifierFamilyConsensus(
    identifierParts.map((item) => item.family),
  );
  const printedFamilyMatchesDetected =
    printedPortraitFamily &&
    detectedPortraitFamily &&
    printedPortraitFamily.length === detectedPortraitFamily.length &&
    [...printedPortraitFamily].filter(
      (digit, index) => digit !== detectedPortraitFamily[index],
    ).length <= 2;
  const portraitFamily =
    source.height > source.width && eligibleRectangles.length === 4
      ? printedPortraitFamily && (!detectedPortraitFamily || printedFamilyMatchesDetected)
        ? printedPortraitFamily
        : detectedPortraitFamily
      : null;
  if (portraitFamily) {
    detected.forEach((item) => {
      const match = item.identifier?.match(/^(\d{5,12})-(\d{1,3})$/);
      if (match) item.identifier = `${portraitFamily}-${match[2]}`;
    });
    identifiers.forEach((item) => {
      const match = item.value.match(/^(\d{5,12})-(\d{1,3})$/);
      if (match) item.value = `${portraitFamily}-${match[2]}`;
    });
  } else if (canonicalFamily && canonicalFamily[1] >= 2) {
    detected.forEach((item) => {
      const match = item.identifier?.match(/^(\d{5,12})-(\d{1,3})$/);
      if (!match || match[1] === canonicalFamily[0]) return;
      if (
        match[1].includes(canonicalFamily[0]) ||
        canonicalFamily[0].includes(match[1])
      ) {
        item.identifier = `${canonicalFamily[0]}-${match[2]}`;
      }
    });
  }
  return cardsFromDetectedGrids(detected, fileName, pageNumber, identifiers);
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
  if (binarize) binarizeNumbers(target.canvas, target.context);
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

export function compactIdentifierFamily(
  readings: string[],
  verticalReading = "",
) {
  const exactZeroPrefixed = readings.flatMap((text, index) => {
    const normalized = text
      .replace(/[Oo]/g, "0")
      .replace(/[Il|]/g, "1")
      .replace(/\s+/g, "")
      .replace(/[^\d-]/g, "");
    const match = normalized.match(
      new RegExp(`^(0\\d{5})-${(index % 8) + 1}$`),
    );
    return match ? [match[1]] : [];
  });
  if (exactZeroPrefixed.length) {
    return [...new Set(exactZeroPrefixed)].sort(
      (a, b) =>
        exactZeroPrefixed.filter((value) => value === b).length -
        exactZeroPrefixed.filter((value) => value === a).length,
    )[0];
  }
  const candidates = readings
    .map((text, index) => {
      const digits = text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/\D/g, "");
      if (digits.length < 6) return null;
      const suffix = String((index % 8) + 1);
      return digits.endsWith(suffix) ? digits.slice(0, -suffix.length) : digits;
    })
    .filter((value): value is string => Boolean(value));
  const vertical = verticalReading.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/\D/g, "");
  const verticalTail = vertical.match(/(0\d{5})$/)?.[1] ?? null;
  if (!candidates.length && verticalTail) return verticalTail;
  const lengths = [...candidates, vertical].filter(Boolean).map((value) => value.length);
  if (!lengths.length) return null;
  const modalLength = [...new Set(lengths)].sort(
    (a, b) => lengths.filter((value) => value === b).length - lengths.filter((value) => value === a).length,
  )[0];
  const comparable = candidates.filter((value) => value.length === modalLength);
  if (!comparable.length && vertical.length === modalLength) return vertical;
  if (!comparable.length) return null;
  const consensus = Array.from({ length: modalLength }, (_, position) => {
    const counts = new Map<string, number>();
    for (const value of comparable) counts.set(value[position], (counts.get(value[position]) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  });
  if (vertical.length === modalLength) {
    for (let index = 0; index < modalLength; index += 1) {
      if (vertical[index] === "0" && /[689]/.test(consensus[index])) consensus[index] = "0";
    }
  }
  return consensus.join("");
}

async function recognizeCompactIdentifiers(
  source: HTMLCanvasElement,
  rectangles: CompactRectangle[],
  worker: OcrWorker,
) {
  const ordered = [...rectangles].sort((a, b) => a.y - b.y || a.x - b.x);
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789-_",
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "1",
  });
  const readings: string[] = [];
  for (const rectangle of ordered) {
    const target = makeCanvas(1440, 264);
    if (!target) {
      readings.push("");
      continue;
    }
    target.context.drawImage(
      source,
      rectangle.x + rectangle.width * 0.288,
      rectangle.y + rectangle.height * 0.412,
      rectangle.width * 0.447,
      rectangle.height * 0.13,
      0,
      0,
      target.canvas.width,
      target.canvas.height,
    );
    binarizeNumbers(target.canvas, target.context, 225);
    const result = await worker.recognize(target.canvas, {}, { text: true });
    readings.push(result.data.text ?? "");
  }

  let verticalReading = "";
  const firstRow = ordered.slice(0, 2).sort((a, b) => a.x - b.x);
  if (firstRow.length === 2) {
    const gapLeft = firstRow[0].x + firstRow[0].width;
    const gapRight = firstRow[1].x;
    const gapWidth = gapRight - gapLeft;
    const gapHeight = Math.min(firstRow[0].height, firstRow[1].height);
    if (gapWidth > 4 && gapHeight > 20) {
      const gap = makeCanvas(Math.ceil(gapWidth), Math.ceil(gapHeight));
      if (gap) {
        gap.context.drawImage(
          source,
          gapLeft,
          Math.min(firstRow[0].y, firstRow[1].y),
          gapWidth,
          gapHeight,
          0,
          0,
          gap.canvas.width,
          gap.canvas.height,
        );
        const orientationReadings: string[] = [];
        for (const direction of [1, -1]) {
          const rotated = makeCanvas(gap.canvas.height, gap.canvas.width);
          const target = makeCanvas(gap.canvas.height * 4, gap.canvas.width * 4);
          if (!rotated || !target) continue;
          if (direction === 1) {
            rotated.context.translate(rotated.canvas.width, 0);
            rotated.context.rotate(Math.PI / 2);
          } else {
            rotated.context.translate(0, rotated.canvas.height);
            rotated.context.rotate(-Math.PI / 2);
          }
          rotated.context.drawImage(gap.canvas, 0, 0);
          target.context.drawImage(
            rotated.canvas,
            0,
            0,
            target.canvas.width,
            target.canvas.height,
          );
          binarizeNumbers(target.canvas, target.context, 210);
          const result = await worker.recognize(target.canvas, {}, { text: true });
          orientationReadings.push(result.data.text ?? "");
        }
        verticalReading = orientationReadings.sort(
          (a, b) => b.replace(/\D/g, "").length - a.replace(/\D/g, "").length,
        )[0] ?? "";
      }
    }
  }

  const family = compactIdentifierFamily(readings, verticalReading);
  return family
    ? ordered.map((rectangle, index) => ({
        value: `${family}-${index + 1}`,
        x: rectangle.x + rectangle.width / 2,
        y: source.height - rectangle.y,
      }))
    : [];
}

async function recognizeCompactCards(
  source: HTMLCanvasElement,
  rectangles: CompactRectangle[],
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
) {
  if (rectangles.length < 2) return [];
  const identifiers = await recognizeCompactIdentifiers(source, rectangles, worker);
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
  return cardsFromDetectedGrids(detected, fileName, pageNumber, identifiers);
}

interface RelativeNumberCell {
  x: number;
  y: number;
  width: number;
  height: number;
  range?: readonly [number, number];
  preferSymbols?: boolean;
}

interface SpecialPageCard {
  suffix: number;
  label: string;
  x: number;
  y: number;
  cells: RelativeNumberCell[];
}

const cell = (
  x: number,
  y: number,
  range: readonly [number, number] = [1, 75],
  width = 0.07,
  height = 0.06,
  preferSymbols = false,
): RelativeNumberCell => ({ x, y, width, height, range, preferSymbols });

const gorditoSpecialCards: SpecialPageCard[] = [
  {
    suffix: 7,
    label: "Yapa",
    x: 0.82,
    y: 0.16,
    cells: [
      cell(0.760, 0.113, [1, 30], 0.055, 0.045, true), cell(0.835, 0.113, [16, 60], 0.055, 0.045, true), cell(0.910, 0.113, [46, 75], 0.055, 0.045, true),
      cell(0.763, 0.170, [1, 30], 0.055, 0.045, true), cell(0.837, 0.170, [16, 60], 0.055, 0.045, true), cell(0.912, 0.170, [46, 75], 0.055, 0.045, true),
      cell(0.764, 0.223, [1, 30], 0.055, 0.045, true), cell(0.839, 0.223, [16, 60], 0.055, 0.045, true), cell(0.912, 0.223, [46, 75], 0.055, 0.045, true),
    ],
  },
  {
    suffix: 5,
    label: "Eche Leche",
    x: 0.25,
    y: 0.60,
    cells: [
      cell(0.087, 0.574, [1, 30], 0.07, 0.04), cell(0.196, 0.574, [16, 45], 0.07, 0.04), cell(0.305, 0.574, [31, 60], 0.07, 0.04), cell(0.414, 0.574, [46, 75], 0.07, 0.04),
      cell(0.142, 0.614, [1, 30], 0.065, 0.038), cell(0.251, 0.614, [16, 45], 0.065, 0.038), cell(0.360, 0.614, [46, 75], 0.065, 0.038),
    ],
  },
  {
    suffix: 6,
    label: "Bom Bom Bum",
    x: 0.75,
    y: 0.60,
    cells: [
      cell(0.577, 0.574, [1, 75], 0.07, 0.04), cell(0.687, 0.574, [1, 75], 0.07, 0.04), cell(0.796, 0.574, [1, 75], 0.07, 0.04), cell(0.905, 0.574, [1, 75], 0.07, 0.04),
      cell(0.577, 0.614, [1, 75], 0.065, 0.038), cell(0.687, 0.614, [1, 75], 0.065, 0.038), cell(0.796, 0.614, [1, 75], 0.065, 0.038), cell(0.905, 0.614, [1, 75], 0.065, 0.038),
    ],
  },
];

function cardNumberSuffix(card: BingoCard) {
  const suffix = Number(card.number.match(/-(\d+)$/)?.[1]);
  return Number.isInteger(suffix) ? suffix : null;
}

export function orderCardsByPdfPosition(cards: BingoCard[]) {
  const serials = new Set(cards.map((card) => card.serial));
  const suffixOrder = serials.has("Yapa")
    ? [7, 1, 2, 5, 6, 3, 4]
    : serials.has("Keke Keke")
      ? [1, 3, 4, 5, 6]
      : null;
  if (!suffixOrder) return cards;
  const rank = new Map(suffixOrder.map((suffix, index) => [suffix, index]));
  return cards
    .map((card, index) => ({ card, index }))
    .sort((left, right) => {
      const leftRank = rank.get(cardNumberSuffix(left.card) ?? -1) ?? suffixOrder.length;
      const rightRank = rank.get(cardNumberSuffix(right.card) ?? -1) ?? suffixOrder.length;
      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ card }) => card);
}

const numberSheetExtraCards: SpecialPageCard[] = [
  {
    suffix: 1,
    label: "Keke Keke",
    x: 0.25,
    y: 0.18,
    cells: [
      cell(0.102, 0.077, [1, 75], 0.09, 0.075), cell(0.423, 0.077, [1, 75], 0.09, 0.075),
      cell(0.204, 0.178, [1, 75], 0.09, 0.075), cell(0.335, 0.178, [1, 75], 0.09, 0.075),
      cell(0.095, 0.280, [1, 75], 0.075, 0.07), cell(0.423, 0.280, [1, 75], 0.075, 0.07),
    ],
  },
];

const lineAndLocoCards: SpecialPageCard[] = [
  {
    suffix: 1,
    label: "Línea",
    x: 0.27,
    y: 0.58,
    cells: [
      cell(0.185, 0.385, [16, 30], 0.065, 0.09), cell(0.350, 0.385, [46, 60], 0.065, 0.09),
      cell(0.100, 0.497, [1, 15], 0.065, 0.09), cell(0.183, 0.497, [16, 30], 0.065, 0.09), cell(0.266, 0.497, [31, 45], 0.065, 0.09), cell(0.350, 0.497, [46, 60], 0.065, 0.09), cell(0.433, 0.497, [61, 75], 0.065, 0.09),
      cell(0.185, 0.609, [16, 30], 0.065, 0.09), cell(0.350, 0.609, [46, 60], 0.065, 0.09),
      cell(0.100, 0.718, [1, 15], 0.065, 0.07), cell(0.183, 0.718, [16, 30], 0.065, 0.07), cell(0.266, 0.718, [31, 45], 0.065, 0.07), cell(0.350, 0.718, [46, 60], 0.065, 0.07), cell(0.433, 0.718, [61, 75], 0.065, 0.07),
      cell(0.185, 0.833, [16, 30], 0.065, 0.09), cell(0.350, 0.833, [46, 60], 0.065, 0.09),
    ],
  },
  {
    suffix: 2,
    label: "Loco",
    x: 0.75,
    y: 0.58,
    cells: [
      cell(0.733, 0.385, [31, 45], 0.065, 0.09),
      cell(0.581, 0.497, [1, 15], 0.065, 0.09), cell(0.665, 0.497, [16, 30], 0.065, 0.09), cell(0.749, 0.497, [31, 45], 0.065, 0.09), cell(0.827, 0.497, [46, 60], 0.075, 0.09), cell(0.905, 0.497, [61, 75], 0.07, 0.09),
      cell(0.733, 0.715, [31, 45], 0.065, 0.09),
      cell(0.665, 0.837, [16, 30], 0.065, 0.09), cell(0.749, 0.837, [31, 45], 0.065, 0.09), cell(0.833, 0.837, [46, 60], 0.065, 0.09),
    ],
  },
];

function valueFromRelativeSymbols(
  symbols: OcrSymbol[],
  sourceWidth: number,
  sourceHeight: number,
  position: RelativeNumberCell,
) {
  const expectedX = position.x * sourceWidth;
  const expectedY = position.y * sourceHeight;
  const boxWidth = position.width * sourceWidth;
  const boxHeight = position.height * sourceHeight;
  const [minimum, maximum] = position.range ?? [1, 75];
  const candidates = symbols
    .filter((symbol) => {
      const centerX = (symbol.bbox.x0 + symbol.bbox.x1) / 2;
      const centerY = (symbol.bbox.y0 + symbol.bbox.y1) / 2;
      const height = symbol.bbox.y1 - symbol.bbox.y0;
      return (
        Math.abs(centerX - expectedX) <= boxWidth / 2 &&
        Math.abs(centerY - expectedY) <= boxHeight / 2 &&
        height >= boxHeight * 0.18
      );
    })
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const values: Array<{ value: number; score: number }> = [];
  for (let start = 0; start < candidates.length; start += 1) {
    for (const length of [2, 1]) {
      const selection = candidates.slice(start, start + length);
      if (selection.length !== length) continue;
      const digits = selection.map((symbol) => symbol.text.replace(/\D/g, "")).join("");
      if (!digits || digits.length > 2) continue;
      const value = Number(digits);
      if (value < minimum || value > maximum) continue;
      const center =
        (Math.min(...selection.map((symbol) => symbol.bbox.x0)) +
          Math.max(...selection.map((symbol) => symbol.bbox.x1))) /
        2;
      values.push({
        value,
        score:
          selection.reduce((sum, symbol) => sum + symbol.confidence, 0) /
            selection.length -
          (Math.abs(center - expectedX) / Math.max(1, boxWidth)) * 30 +
          (length === 2 ? 45 : 0),
      });
    }
  }
  return values.sort((a, b) => b.score - a.score)[0]?.value ?? null;
}

function valueFromCellText(text: string, range: readonly [number, number]) {
  const digits = text.replace(/\D/g, "");
  for (let start = 0; start < digits.length; start += 1) {
    for (const length of [2, 1]) {
      const value = Number(digits.slice(start, start + length));
      if (value >= range[0] && value <= range[1]) return value;
    }
  }
  return null;
}

async function recognizeRelativeCell(
  source: HTMLCanvasElement,
  position: RelativeNumberCell,
  worker: OcrWorker,
) {
  const left = Math.max(0, (position.x - position.width / 2) * source.width);
  const top = Math.max(0, (position.y - position.height / 2) * source.height);
  const width = Math.min(source.width - left, position.width * source.width);
  const height = Math.min(source.height - top, position.height * source.height);
  const range = position.range ?? [1, 75];
  const readings: Array<{ value: number; confidence: number }> = [];
  for (const maxChroma of position.preferSymbols ? [256, 58] : [58]) {
    for (const pageSegMode of ["8", "7"]) {
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: pageSegMode,
        preserve_interword_spaces: "1",
      });
      for (const threshold of [100, 135, 165, 195, 225]) {
        const target = makeCanvas(400, 300);
        if (!target) continue;
        target.context.drawImage(source, left, top, width, height, 0, 0, 400, 300);
        binarizeNumbers(target.canvas, target.context, threshold, maxChroma);
        const result = await worker.recognize(target.canvas, {}, { text: true });
        const value = valueFromCellText(result.data.text ?? "", range);
        if (value !== null) {
          readings.push({ value, confidence: result.data.confidence ?? 0 });
        }
      }
    }
    if (readings.length) break;
  }
  if (!readings.length) {
    const insetLeft = left + width * 0.14;
    const insetTop = top + height * 0.14;
    const insetWidth = width * 0.72;
    const insetHeight = height * 0.72;
    for (const pageSegMode of ["8", "7"]) {
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: pageSegMode,
        preserve_interword_spaces: "1",
      });
      for (const threshold of [100, 135, 165, 195, 225]) {
        const target = makeCanvas(420, 280);
        if (!target) continue;
        target.context.drawImage(
          source,
          insetLeft,
          insetTop,
          insetWidth,
          insetHeight,
          0,
          0,
          target.canvas.width,
          target.canvas.height,
        );
        binarizeNumbers(target.canvas, target.context, threshold, 58);
        const result = await worker.recognize(target.canvas, {}, { text: true });
        const value = valueFromCellText(result.data.text ?? "", range);
        if (value !== null) {
          readings.push({ value, confidence: result.data.confidence ?? 0 });
        }
      }
    }
  }
  const grouped = new Map<number, { count: number; confidence: number }>();
  for (const reading of readings) {
    const current = grouped.get(reading.value) ?? { count: 0, confidence: 0 };
    grouped.set(reading.value, {
      count: current.count + 1,
      confidence: Math.max(current.confidence, reading.confidence),
    });
  }
  return [...grouped.entries()].sort(
    (a, b) => b[1].confidence - a[1].confidence || b[1].count - a[1].count,
  )[0]?.[0] ?? null;
}

function familyFromCards(cards: BingoCard[]) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const match = card.number.match(/^(\d{5,12})-\d{1,3}$/);
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function repairAscendingSpecialColumns(
  values: number[],
  candidates: number[][],
) {
  if (values.length !== 9 || candidates.length !== 9) return values;
  const repaired = [...values];
  for (let column = 0; column < 3; column += 1) {
    const positions = [column, column + 3, column + 6];
    const options = positions.map((position) => candidates[position]);
    let best: { values: number[]; score: number } | null = null;
    for (const first of options[0]) {
      for (const second of options[1]) {
        for (const third of options[2]) {
          if (!(first < second && second < third)) continue;
          const selection = [first, second, third];
          const score = selection.reduce(
            (total, value, index) =>
              total + (value === values[positions[index]] ? 2 : 0),
            0,
          );
          if (!best || score > best.score) best = { values: selection, score };
        }
      }
    }
    if (best) positions.forEach((position, index) => { repaired[position] = best!.values[index]; });
  }
  return repaired;
}

function validYapaGrid(values: number[]) {
  return (
    values.length === 9 &&
    new Set(values).size === 9 &&
    values.every((value, index) => {
      const column = index % 3;
      const range = column === 0 ? [1, 30] : column === 1 ? [16, 60] : [46, 75];
      return value >= range[0] && value <= range[1];
    }) &&
    [0, 1, 2].every(
      (column) => values[column] < values[column + 3] && values[column + 3] < values[column + 6],
    )
  );
}

export function decodeYapaRowDigits(text: string) {
  const digits = text.replace(/\D/g, "");
  const ranges = [[1, 30], [16, 60], [46, 75]] as const;
  const candidates: number[][] = [];
  const visit = (column: number, offset: number, values: number[]) => {
    if (column === ranges.length) {
      if (offset === digits.length) candidates.push(values);
      return;
    }
    for (const length of [1, 2]) {
      const chunk = digits.slice(offset, offset + length);
      if (chunk.length !== length || (chunk.length > 1 && chunk.startsWith("0"))) continue;
      const value = Number(chunk);
      const [minimum, maximum] = ranges[column];
      if (value < minimum || value > maximum) continue;
      visit(column + 1, offset + length, [...values, value]);
    }
  };
  visit(0, 0, []);
  return candidates.length === 1 ? candidates[0] : null;
}

async function recognizeYapaGridCrop(
  source: HTMLCanvasElement,
  worker: OcrWorker,
) {
  const left = source.width * 0.725;
  const top = source.height * 0.087;
  const width = source.width * 0.22;
  const height = source.height * 0.16;
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789 ",
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1",
  });
  for (const maxChroma of [58, 256]) {
    for (const threshold of [100, 135, 165, 195, 225]) {
      const target = makeCanvas(900, 720);
      if (!target) continue;
      target.context.drawImage(
        source,
        left,
        top,
        width,
        height,
        0,
        0,
        target.canvas.width,
        target.canvas.height,
      );
      binarizeNumbers(target.canvas, target.context, threshold, maxChroma);
      const result = await worker.recognize(target.canvas, {}, { text: true });
      const rows = (result.data.text ?? "")
        .split(/\r?\n/)
        .map((row) => decodeYapaRowDigits(row))
        .filter((row): row is number[] => Boolean(row));
      const values = rows.length === 3
        ? rows.flat()
        : numberMatches(result.data.text ?? "").map((match) => Number(match[0]));
      if (validYapaGrid(values)) return values;
    }
  }
  return null;
}

async function recognizeSpecialPageCards(
  source: HTMLCanvasElement,
  rectangles: GridRectangle[],
  detectedCards: BingoCard[],
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
): Promise<BingoCard[]> {
  const ordered = [...rectangles].sort((a, b) => a.y - b.y || a.x - b.x);
  const firstTop = ordered[0]?.y / source.height;
  const isPortrait = source.height > source.width;
  const layouts =
    isPortrait && ordered.length >= 4 && firstTop < 0.32
      ? gorditoSpecialCards
      : isPortrait && ordered.length >= 4 && firstTop >= 0.32
        ? numberSheetExtraCards
        : !isPortrait && ordered.length === 0
          ? lineAndLocoCards
          : [];
  if (!layouts.length) return [];

  await worker.setParameters({
    tessedit_char_whitelist: "0123456789-_Tab",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  const result = await worker.recognize(
    source,
    {},
    { blocks: true, text: true },
  );
  const symbols = result.data.blocks?.length
    ? flattenOcrSymbols(ocrWords(result.data.blocks))
    : [];
  const family =
    familyFromCards(detectedCards) ??
    identifierFamilyFromOcrText(result.data.text ?? "");
  const cards: BingoCard[] = [];
  for (const layout of layouts) {
    const directValues = layout.label === "Yapa"
      ? await recognizeYapaGridCrop(source, worker)
      : null;
    let values: number[] = directValues ? [...directValues] : [];
    const candidates: number[][] = [];
    const positions = directValues ? [] : layout.cells;
    for (const [positionIndex, position] of positions.entries()) {
      const symbolValue = valueFromRelativeSymbols(
        symbols,
        source.width,
        source.height,
        position,
      );
      let croppedValue = await recognizeRelativeCell(source, position, worker);
      if (
        layout.label === "Keke Keke" &&
        positionIndex === 4
      ) {
        const alternateValue = await recognizeRelativeCell(
          source,
          { ...position, x: 0.102 },
          worker,
        );
        if (
          croppedValue === null ||
          (croppedValue < 10 && (alternateValue ?? 0) >= 10)
        ) {
          croppedValue = alternateValue;
        }
      }
      const value = croppedValue ?? symbolValue;
      values.push(value ?? -1);
      candidates.push(
        [...new Set([croppedValue, symbolValue])].filter(
          (candidate): candidate is number => candidate !== null,
        ),
      );
    }
    if (layout.label === "Yapa" && !directValues) values = repairAscendingSpecialColumns(values, candidates);
    if (
      values.some((value) => value < 1 || value > 75) ||
      new Set(values).size !== values.length
    ) {
      continue;
    }
    cards.push({
      id: crypto.randomUUID(),
      number: family
        ? `${family}-${layout.suffix}`
        : `SIN-ID-${String(pageNumber).padStart(3, "0")}-${layout.suffix}`,
      serial: layout.label,
      grid: values,
      sourceFile: fileName,
      sourcePage: pageNumber,
      status: "active",
    });
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  return cards;
}

export async function runOcrCanvas(
  canvas: HTMLCanvasElement,
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
): Promise<BingoCard[]> {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  let rectangles = detectGridRectangles(
    pixels.data,
    canvas.width,
    canvas.height,
  );
  let detectedCards: BingoCard[] = [];
  if (rectangles.length) {
    detectedCards = await recognizeDetectedGrids(
      canvas,
      rectangles,
      worker,
      fileName,
      pageNumber,
    );
  } else if (
    canvas.height > canvas.width &&
    canvas.height / canvas.width >= 1.25 &&
    canvas.height / canvas.width <= 1.55
  ) {
    // Las hojas Keke Keke / formas 1-3-5-9 compartidas como capturas de baja
    // resoluciÃ³n pueden conservar los nÃºmeros pero perder grosor en sus bordes.
    // Probar su geometrÃ­a impresa conocida permite recuperar las cuatro formas;
    // solo se acepta si las cuatro validan como hojas de nÃºmeros reales.
    const normalizedRectangles = [
      [0.018, 0.390, 0.481, 0.658],
      [0.507, 0.390, 0.965, 0.658],
      [0.018, 0.714, 0.481, 0.982],
      [0.507, 0.714, 0.965, 0.982],
    ].map(([left, top, right, bottom]): GridRectangle => {
      const x = left * canvas.width;
      const y = top * canvas.height;
      const width = (right - left) * canvas.width;
      const height = (bottom - top) * canvas.height;
      return {
        x,
        y,
        width,
        height,
        verticalLines: Array.from({ length: 6 }, (_, index) =>
          x + width * index / 5,
        ),
        horizontalLines: Array.from({ length: 6 }, (_, index) =>
          y + height * index / 5,
        ),
        score: 70,
      };
    });
    const forms: NumberSheetForm[] = ["1", "3", "5", "9"];
    const candidateCards: BingoCard[] = [];
    for (const [index, rectangle] of normalizedRectangles.entries()) {
      const form = forms[index];
      const grid = await recognizeMissingNumberSheetCells(
        canvas,
        rectangle,
        Array(25).fill(-1),
        form,
        worker,
      );
      if (!isPlausibleNumberSheetGrid(grid, form)) continue;
      candidateCards.push({
        id: crypto.randomUUID(),
        number: `SIN-ID-${String(pageNumber).padStart(3, "0")}-${index + 3}`,
        serial: `Forma #${form}`,
        grid,
        sourceFile: fileName,
        sourcePage: pageNumber,
        status: "active",
      });
    }
    if (
      candidateCards.length === 4 &&
      candidateCards.every((card) => numberSheetFormForGrid(card.grid) !== null)
    ) {
      rectangles = normalizedRectangles;
      detectedCards = candidateCards;
    }
  }
  const specialCards = await recognizeSpecialPageCards(
    canvas,
    rectangles,
    detectedCards,
    worker,
    fileName,
    pageNumber,
  );
  if (detectedCards.length || specialCards.length) {
    return orderCardsByPdfPosition([...detectedCards, ...specialCards]);
  }
  if (!rectangles.some((rectangle) => rectangle.score >= 80)) {
    const compactRectangles = detectCompactRectangles(
      pixels.data,
      canvas.width,
      canvas.height,
    );
    const compactCards = await recognizeCompactCards(
      canvas,
      compactRectangles,
      worker,
      fileName,
      pageNumber,
    );
    if (compactCards.length) return compactCards;
  }
  const result = await worker.recognize(
    canvas,
    {},
    { blocks: true, tsv: true, text: true },
  );
  if (result.data.blocks?.length) {
    const blockCards = extractCardsFromOcrBlocks(
      result.data.blocks,
      canvas.height,
      fileName,
      pageNumber,
    );
    if (blockCards.length) return blockCards;
  }
  if (result.data.tsv) {
    return cardsFromTokens(
      tokensFromTsv(result.data.tsv, canvas.height),
      fileName,
      pageNumber,
    );
  }
  const fallbackText = result.data.text ?? "";
  return cardsFromTokens(
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
  );
}

export async function runOcr(
  pageProxy: import("pdfjs-dist").PDFPageProxy,
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
): Promise<BingoCard[]> {
  const baseViewport = pageProxy.getViewport({ scale: 1 });
  const scale = Math.max(
    1.6,
    Math.min(2.5, 2300 / Math.max(baseViewport.width, baseViewport.height)),
  );
  const viewport = pageProxy.getViewport({ scale });
  const target = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  if (!target) return [];
  await pageProxy.render({ canvas: target.canvas, canvasContext: target.context, viewport }).promise;
  return runOcrCanvas(target.canvas, worker, fileName, pageNumber);
}

function imageExtension(fileName: string) {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export function isSupportedBingoImportFile(file: Pick<File, "name" | "type">) {
  const extension = imageExtension(file.name);
  return (
    file.type === "application/pdf" ||
    extension === "pdf" ||
    file.type.startsWith("image/") ||
    ["png", "jpg", "jpeg", "webp", "bmp", "gif", "avif", "heic", "heif"].includes(extension)
  );
}

async function canvasFromImageFile(file: File) {
  let source: CanvasImageSource;
  let width = 0;
  let height = 0;
  let release = () => undefined;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    release = () => bitmap.close();
  } catch {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(objectUrl);
      throw new Error("El dispositivo no pudo decodificar este formato de imagen.");
    }
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
    release = () => URL.revokeObjectURL(objectUrl);
  }
  if (!width || !height) {
    release();
    throw new Error("La imagen no contiene dimensiones válidas.");
  }
  const longestSide = Math.max(width, height);
  const scale = longestSide < 1800
    ? Math.min(2.5, 1800 / longestSide)
    : Math.min(1, 2600 / longestSide);
  const target = makeCanvas(
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  );
  if (!target) {
    release();
    throw new Error("No se pudo preparar la imagen para reconocimiento.");
  }
  target.context.drawImage(source, 0, 0, target.canvas.width, target.canvas.height);
  release();
  return target.canvas;
}

function sequentialNumberParts(number: string) {
  const match = number.trim().match(/^(.*?)(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    value: Number(match[2]),
    width: match[2].length,
  };
}

function formatSequentialNumber(
  parts: { prefix: string; value: number; width: number },
  offset: number,
) {
  const value = parts.value + offset;
  if (value < 0) return null;
  return `${parts.prefix}${String(value).padStart(parts.width, "0")}`;
}

function fallbackNumberFromPdf(card: BingoCard, offset: number) {
  const fileName = card.sourceFile.replace(/\.pdf$/i, "").trim() || "PDF";
  const detectedPosition = card.number.match(/-(\d+)$/)?.[1];
  const position = detectedPosition ?? String(offset + 1);
  return `${fileName}-P${String(card.sourcePage).padStart(3, "0")}-${position}`;
}

export function assignSequentialCardNumbers(cards: BingoCard[]) {
  const resolved = cards.map((card) => ({ ...card }));
  const used = new Set(
    cards
      .filter((card) => !card.number.startsWith("SIN-ID-"))
      .map((card) => card.number.toLowerCase()),
  );
  let index = 0;
  while (index < resolved.length) {
    if (!resolved[index].number.startsWith("SIN-ID-")) {
      index += 1;
      continue;
    }
    const start = index;
    while (
      index < resolved.length &&
      resolved[index].number.startsWith("SIN-ID-")
    ) {
      index += 1;
    }
    const end = index;
    const count = end - start;
    const previousCard = start > 0 ? resolved[start - 1] : null;
    const nextCard = end < resolved.length ? resolved[end] : null;
    const previous = previousCard?.number ?? null;
    const next = nextCard?.number ?? null;
    const previousParts = previous ? sequentialNumberParts(previous) : null;
    const nextParts = next ? sequentialNumberParts(next) : null;
    const sourcePage = resolved[start].sourcePage;
    const contiguousGap =
      previousParts &&
      nextParts &&
      previousParts.prefix === nextParts.prefix &&
      nextParts.value - previousParts.value === count + 1;
    const preferNext =
      nextParts &&
      nextParts.value > count &&
      (!previousParts ||
        (nextCard?.sourcePage === sourcePage &&
          previousCard?.sourcePage !== sourcePage));

    for (let offset = 0; offset < count; offset += 1) {
      let candidate = contiguousGap
        ? formatSequentialNumber(previousParts, offset + 1)
        : preferNext
            ? formatSequentialNumber(nextParts, offset - count)
            : previousParts
              ? formatSequentialNumber(previousParts, offset + 1)
              : nextParts && nextParts.value > count
                ? formatSequentialNumber(nextParts, offset - count)
                : null;
      if (!candidate) {
        candidate = fallbackNumberFromPdf(resolved[start + offset], offset);
      }
      const baseCandidate = candidate;
      let collision = 2;
      while (used.has(candidate.toLowerCase())) {
        candidate = `${baseCandidate}-${collision}`;
        collision += 1;
      }
      resolved[start + offset].number = candidate;
      used.add(candidate.toLowerCase());
    }
  }
  return resolved;
}

export function reconcileTwoCardPageNumbers(cards: BingoCard[]) {
  const pages = new Map<number, BingoCard[]>();
  for (const card of cards) {
    const pageCards = pages.get(card.sourcePage) ?? [];
    pageCards.push(card);
    pages.set(card.sourcePage, pageCards);
  }
  const orderedPages = [...pages.entries()].sort((a, b) => a[0] - b[0]);
  if (
    orderedPages.length < 2 ||
    orderedPages.some(([, pageCards]) => pageCards.length !== 2)
  ) {
    return cards.map((card) => ({ ...card }));
  }

  const ordered = orderedPages.flatMap(([, pageCards]) => pageCards);
  const parts = ordered.map((card) => card.number.match(/^(\d{5,12})-1$/));
  if (parts.some((part) => !part)) {
    return cards.map((card) => ({ ...card }));
  }

  const votes = new Map<string, { count: number; base: bigint; width: number }>();
  parts.forEach((part, index) => {
    const family = part![1];
    const base = BigInt(family) - BigInt(index);
    if (base < 0n) return;
    const key = `${family.length}:${base}`;
    const vote = votes.get(key);
    votes.set(key, {
      count: (vote?.count ?? 0) + 1,
      base,
      width: family.length,
    });
  });
  const winner = [...votes.values()].sort((a, b) => b.count - a.count)[0];
  if (!winner || winner.count < 4) {
    return cards.map((card) => ({ ...card }));
  }

  const numbers = ordered.map((_, index) =>
    `${String(winner.base + BigInt(index)).padStart(winner.width, "0")}-1`,
  );
  const replacements = new Map(ordered.map((card, index) => [card, numbers[index]]));
  return cards.map((card) => ({
    ...card,
    number: replacements.get(card) ?? card.number,
  }));
}

export async function parseBingoPdf(
  file: File,
  onProgress: (progress: PdfParseProgress) => void,
): Promise<PdfParseResult> {
  const pdfModuleUrl = "/pdfjs/pdf.mjs";
  const pdfjs = (await import(
    /* @vite-ignore */ pdfModuleUrl
  )) as typeof import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
  }).promise;
  const pageCount = pdf.numPages;
  const cards: BingoCard[] = [];
  const warnings: string[] = [];
  let ocrWorker: OcrWorker | null = null;

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      onProgress({
        page: pageNumber,
        pages: pageCount,
        stage: "Leyendo texto",
        percent: Math.round(((pageNumber - 1) / pageCount) * 100),
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
      let pageCards = extractCardsFromTextItems(items, file.name, pageNumber);

      if (!pageCards.length) {
        onProgress({
          page: pageNumber,
          pages: pageCount,
          stage: "Aplicando OCR",
          percent: Math.round(((pageNumber - 0.5) / pageCount) * 100),
        });
        try {
          ocrWorker ??= await createOcrWorker();
          pageCards = await runOcr(page, ocrWorker, file.name, pageNumber);
        } catch (error) {
          warnings.push(
            `Página ${pageNumber}: el OCR no pudo completarse (${error instanceof Error ? error.message : "error desconocido"}).`,
          );
        }
      }

      if (!pageCards.length) {
        warnings.push(
          `Página ${pageNumber}: no se encontró un cartón de bingo válido. Puedes crearlo con “Ingreso manual”.`,
        );
      }
      cards.push(...pageCards);
      page.cleanup();
    }
  } finally {
    await ocrWorker?.terminate().catch(() => undefined);
    await pdf.destroy();
  }

  onProgress({
    page: pageCount,
    pages: pageCount,
    stage: "Validando",
    percent: 100,
  });
  const reconciledCards = reconcileTwoCardPageNumbers(cards);
  const numberedCards = assignSequentialCardNumbers(reconciledCards);
  return { cards: numberedCards, pages: pageCount, warnings };
}

export async function parseBingoImage(
  file: File,
  onProgress: (progress: PdfParseProgress) => void,
): Promise<PdfParseResult> {
  onProgress({ page: 1, pages: 1, stage: "Decodificando imagen", percent: 8 });
  const canvas = await canvasFromImageFile(file);
  onProgress({ page: 1, pages: 1, stage: "Aplicando OCR", percent: 30 });
  const worker = await createOcrWorker();
  const warnings: string[] = [];
  let cards: BingoCard[] = [];
  try {
    cards = await runOcrCanvas(canvas, worker, file.name, 1);
  } catch (error) {
    warnings.push(
      `La imagen no pudo reconocerse (${error instanceof Error ? error.message : "error desconocido"}).`,
    );
  } finally {
    await worker.terminate().catch(() => undefined);
  }
  if (!cards.length) {
    warnings.push(
      "No se encontró un formato de bingo válido. Procura que la fotografía esté derecha, enfocada y muestre el cartón completo.",
    );
  }
  onProgress({ page: 1, pages: 1, stage: "Validando", percent: 100 });
  return { cards: assignSequentialCardNumbers(cards), pages: 1, warnings };
}

export async function parseBingoImportFile(
  file: File,
  onProgress: (progress: PdfParseProgress) => void,
) {
  if (!isSupportedBingoImportFile(file)) {
    throw new Error(`${file.name} no es un PDF ni una imagen compatible.`);
  }
  return file.type === "application/pdf" || imageExtension(file.name) === "pdf"
    ? parseBingoPdf(file, onProgress)
    : parseBingoImage(file, onProgress);
}

export function assignApplicationCardNumbers(
  cards: BingoCard[],
  firstNumber = 1,
) {
  return cards.map((card, index) => ({
    ...card,
    number: String(firstNumber + index),
  }));
}

export async function fileChecksum(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
