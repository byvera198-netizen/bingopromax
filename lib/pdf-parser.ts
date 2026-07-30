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
      blocks: Array<{
        paragraphs: Array<{
          lines: Array<{
            words: Array<{
              text: string;
              confidence: number;
              bbox: { x0: number; y0: number; x1: number; y1: number };
            }>;
          }>;
        }>;
      }> | null;
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

function cardsFromTokens(
  tokens: PositionedNumber[],
  fileName: string,
  page: number,
  identifiers: Identifier[] = [],
) {
  const positioned = detectPositionedGrids(tokens);
  const grids =
    positioned.length > 0 ? positioned : detectSequentialGrids(tokens);
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

async function runOcr(
  pageProxy: import("pdfjs-dist").PDFPageProxy,
  worker: OcrWorker,
) {
  const baseViewport = pageProxy.getViewport({ scale: 1 });
  const scale = Math.max(
    1.6,
    Math.min(2.5, 2300 / Math.max(baseViewport.width, baseViewport.height)),
  );
  const viewport = pageProxy.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await pageProxy.render({ canvas, canvasContext: context, viewport }).promise;
  const result = await worker.recognize(
    canvas,
    {},
    { blocks: true, tsv: true, text: true },
  );
  if (result.data.tsv) {
    return tokensFromTsv(result.data.tsv, canvas.height);
  }
  const fallbackText = result.data.text ?? "";
  return numberMatches(fallbackText).map((match, index) => ({
    value: Number(match[0]),
    x: index % 5,
    y: -Math.floor(index / 5),
    width: 1,
    height: 1,
    order: index,
  }));
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
          const ocrTokens = await runOcr(page, ocrWorker);
          pageCards = cardsFromTokens(ocrTokens, file.name, pageNumber);
        } catch (error) {
          warnings.push(
            `Página ${pageNumber}: el OCR no pudo completarse (${error instanceof Error ? error.message : "error desconocido"}).`,
          );
        }
      }

      if (!pageCards.length) {
        warnings.push(
          `Página ${pageNumber}: no se encontró una tabla 5×5 válida. Puedes crearla con “Ingreso manual”.`,
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
