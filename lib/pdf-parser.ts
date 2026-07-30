"use client";

import type { BingoCard } from "./bingo";

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
  }
  return identifiers;
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
  const stem =
    fileName
      .replace(/\.pdf$/i, "")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "PDF";

  return orderedGrids.map((detected, index) => ({
    id: crypto.randomUUID(),
    number:
      orderedIdentifiers.length === orderedGrids.length
        ? orderedIdentifiers[index].value
        : `${stem}-${String(page).padStart(3, "0")}-${index + 1}`,
    serial: "",
    grid: detected.grid,
    sourceFile: fileName,
    sourcePage: page,
    status: "active" as const,
  }));
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
) {
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    const luminance = red * 0.3 + green * 0.59 + blue * 0.11;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    const ink = luminance < 175 && chroma < 58;
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
  binarizeNumbers(target.canvas, target.context);
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
    binarizeNumbers(target.canvas, target.context);
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

async function recognizeCompactCards(
  source: HTMLCanvasElement,
  rectangles: CompactRectangle[],
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
) {
  if (rectangles.length < 2) return [];
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

async function runOcr(
  pageProxy: import("pdfjs-dist").PDFPageProxy,
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
) {
  const baseViewport = pageProxy.getViewport({ scale: 1 });
  const scale = Math.max(
    1.6,
    Math.min(2.5, 2300 / Math.max(baseViewport.width, baseViewport.height)),
  );
  const viewport = pageProxy.getViewport({ scale });
  const target = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  if (!target) return [];
  const { canvas, context } = target;
  await pageProxy.render({ canvas, canvasContext: context, viewport }).promise;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const rectangles = detectGridRectangles(
    pixels.data,
    canvas.width,
    canvas.height,
  );
  if (rectangles.length) {
    const detectedCards = await recognizeDetectedGrids(
      canvas,
      rectangles,
      worker,
      fileName,
      pageNumber,
    );
    if (detectedCards.length) return detectedCards;
  }
  if (!rectangles.some((rectangle) => rectangle.score >= 85)) {
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

export async function parseBingoPdf(
  file: File,
  onProgress: (progress: PdfParseProgress) => void,
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
          `Página ${pageNumber}: no se encontró un cartón 5×5 o Sabrosito válido. Puedes crearlo con “Ingreso manual”.`,
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
  return { cards, pages: pageCount, warnings };
}

export async function fileChecksum(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
