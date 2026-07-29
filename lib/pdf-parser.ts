"use client";

import type { BingoCard } from "./bingo";

interface PositionedNumber {
  value: number;
  x: number;
  y: number;
  width: number;
}

interface RowSegment {
  values: PositionedNumber[];
  xCenter: number;
  y: number;
  width: number;
}

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

function isPlausibleGrid(grid: number[]) {
  if (grid.length !== 25) return false;
  const values = grid.filter(Boolean);
  if (values.length < 24 || new Set(values).size !== values.length) return false;
  return values.every((value) => value >= 1 && value <= 90);
}

function splitRow(row: PositionedNumber[]) {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  if (sorted.length <= 5) return [sorted];
  const groups: PositionedNumber[][] = [];
  for (let index = 0; index < sorted.length; index += 5) {
    const group = sorted.slice(index, index + 5);
    if (group.length >= 4) groups.push(group);
  }
  return groups;
}

function normalizeRow(values: PositionedNumber[]) {
  const sorted = [...values].sort((a, b) => a.x - b.x);
  if (sorted.length === 5) return sorted.map((item) => item.value);
  if (sorted.length === 4) {
    const gaps = sorted.slice(1).map((item, index) => item.x - sorted[index].x);
    const largestGap = Math.max(...gaps);
    const insertion = largestGap > 0 ? gaps.indexOf(largestGap) + 1 : 2;
    const result = sorted.map((item) => item.value);
    result.splice(insertion, 0, 0);
    return result;
  }
  return [];
}

function cardsFromPositionedNumbers(numbers: PositionedNumber[], fileName: string, page: number) {
  const sortedByY = [...numbers].sort((a, b) => b.y - a.y);
  const rows: PositionedNumber[][] = [];
  for (const item of sortedByY) {
    const existing = rows.find((row) => Math.abs(row[0].y - item.y) <= 4);
    if (existing) existing.push(item);
    else rows.push([item]);
  }

  const segments: RowSegment[] = rows.flatMap((row) =>
    splitRow(row)
      .filter((segment) => segment.length >= 4)
      .map((segment) => {
        const start = Math.min(...segment.map((item) => item.x));
        const end = Math.max(...segment.map((item) => item.x + item.width));
        return {
          values: segment,
          xCenter: (start + end) / 2,
          y: segment[0].y,
          width: end - start,
        };
      }),
  );

  const clusters: RowSegment[][] = [];
  for (const segment of segments.sort((a, b) => a.xCenter - b.xCenter)) {
    const cluster = clusters.find((candidate) => {
      const center = candidate.reduce((sum, item) => sum + item.xCenter, 0) / candidate.length;
      const averageWidth = candidate.reduce((sum, item) => sum + item.width, 0) / candidate.length;
      return Math.abs(center - segment.xCenter) < Math.max(36, averageWidth * 0.35);
    });
    if (cluster) cluster.push(segment);
    else clusters.push([segment]);
  }

  const grids: number[][] = [];
  for (const cluster of clusters) {
    const ordered = [...cluster].sort((a, b) => b.y - a.y);
    for (let index = 0; index + 4 < ordered.length; index += 5) {
      const group = ordered.slice(index, index + 5);
      const grid = group.flatMap((segment) => normalizeRow(segment.values));
      if (isPlausibleGrid(grid)) grids.push(grid);
    }
  }

  const unique = grids.filter(
    (grid, index) => grids.findIndex((candidate) => candidate.join(",") === grid.join(",")) === index,
  );

  return unique.map((grid, index) => ({
    id: crypto.randomUUID(),
    number: `${fileName.replace(/\.pdf$/i, "").slice(0, 18)}-${String(page).padStart(3, "0")}-${index + 1}`,
    serial: "",
    grid,
    sourceFile: fileName,
    sourcePage: page,
    status: "active" as const,
  }));
}

function cardsFromSequence(values: number[], fileName: string, page: number) {
  const cards: BingoCard[] = [];
  for (let start = 0; start + 23 < values.length; ) {
    const twentyFive = values.slice(start, start + 25);
    const twentyFour = values.slice(start, start + 24);
    let grid: number[] | null = null;
    let consumed = 0;
    if (isPlausibleGrid(twentyFive)) {
      grid = twentyFive;
      consumed = 25;
    } else {
      const freeCenter = [...twentyFour.slice(0, 12), 0, ...twentyFour.slice(12)];
      if (isPlausibleGrid(freeCenter)) {
        grid = freeCenter;
        consumed = 24;
      }
    }
    if (!grid) {
      start += 1;
      continue;
    }
    cards.push({
      id: crypto.randomUUID(),
      number: `${fileName.replace(/\.pdf$/i, "").slice(0, 18)}-${String(page).padStart(3, "0")}-${cards.length + 1}`,
      serial: "",
      grid,
      sourceFile: fileName,
      sourcePage: page,
      status: "active",
    });
    start += consumed;
  }
  return cards;
}

async function runOcr(pageProxy: import("pdfjs-dist").PDFPageProxy) {
  const viewport = pageProxy.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  await pageProxy.render({ canvas, canvasContext: context, viewport }).promise;
  const { recognize } = await import("tesseract.js");
  const result = await recognize(canvas, "eng");
  return (result.data.text.match(/\b\d{1,2}\b/g) ?? [])
    .map(Number)
    .filter((number) => number >= 1 && number <= 90);
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
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const cards: BingoCard[] = [];
  const warnings: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress({
      page: pageNumber,
      pages: pdf.numPages,
      stage: "Leyendo texto",
      percent: Math.round(((pageNumber - 1) / pdf.numPages) * 100),
    });
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    const positioned = text.items.flatMap((item) => {
      if (!("str" in item) || !("transform" in item)) return [];
      const clean = item.str.trim().replace(/[^\d]/g, "");
      if (!/^\d{1,2}$/.test(clean)) return [];
      const value = Number(clean);
      if (value < 1 || value > 90) return [];
      return [
        {
          value,
          x: item.transform[4],
          y: item.transform[5],
          width: "width" in item ? item.width : 8,
        },
      ];
    });

    let pageCards: BingoCard[] = cardsFromPositionedNumbers(positioned, file.name, pageNumber);
    if (!pageCards.length && positioned.length >= 24) {
      pageCards = cardsFromSequence(
        positioned.map((item) => item.value),
        file.name,
        pageNumber,
      );
    }

    if (!pageCards.length) {
      onProgress({
        page: pageNumber,
        pages: pdf.numPages,
        stage: "Aplicando OCR",
        percent: Math.round(((pageNumber - 0.5) / pdf.numPages) * 100),
      });
      try {
        const ocrValues = await runOcr(page);
        pageCards = cardsFromSequence(ocrValues, file.name, pageNumber);
      } catch {
        warnings.push(`Página ${pageNumber}: no fue posible completar el OCR.`);
      }
    }

    if (!pageCards.length) {
      warnings.push(`Página ${pageNumber}: no se encontró una cuadrícula 5×5 válida.`);
    }
    cards.push(...pageCards);
  }

  onProgress({ page: pdf.numPages, pages: pdf.numPages, stage: "Validando", percent: 100 });
  return { cards, pages: pdf.numPages, warnings };
}

export async function fileChecksum(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
