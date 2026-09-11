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
  serial?: string;
  importReview?: string[];
}

interface Identifier {
  value: string;
  x: number;
  y: number;
}

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + Number(left[i - 1] !== right[j - 1]));
      diagonal = previous;
    }
  }
  return row[right.length];
}

/** Repairs only a consecutive sequence supported by at least 75% of its labels. */
export function reconcileSequentialGridIdentifiers(values: string[]) {
  if (values.length < 3 || values.some((value) => !/^\d{5,12}$/.test(value))) return values;
  const candidates = new Map<string, { start: number; width: number }>();
  values.forEach((value, index) => {
    const alternatives = [value, ...Array.from({ length: value.length }, (_, at) => value.slice(0, at) + value.slice(at + 1))];
    alternatives.forEach((item) => {
      if (item.length < 5) return;
      const start = Number(item) - index;
      if (Number.isSafeInteger(start) && start >= 0) candidates.set(`${item.length}:${start}`, { start, width: item.length });
    });
  });
  const ranked = [...candidates.values()].map((candidate) => {
    const expected = values.map((_, index) => String(candidate.start + index).padStart(candidate.width, "0"));
    const distances = expected.map((item, index) => editDistance(item, values[index]));
    return { expected, exact: distances.filter((distance) => distance === 0).length, close: distances.filter((distance) => distance <= 1).length, support: distances.filter((distance) => distance <= 2).length, cost: distances.reduce((sum, distance) => sum + Math.min(distance, 4), 0) };
  }).sort((a, b) => b.exact - a.exact || b.close - a.close || b.support - a.support || a.cost - b.cost);
  const [winner, runnerUp] = ranked;
  const strong = winner && (winner.close >= Math.ceil(values.length * 0.75) || (winner.exact >= 2 && winner.support >= Math.ceil(values.length * 0.75)));
  if (!strong || (runnerUp && runnerUp.close === winner.close && runnerUp.support === winner.support && runnerUp.exact === winner.exact && runnerUp.cost === winner.cost && runnerUp.expected[0] !== winner.expected[0])) return values;
  return winner.expected;
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

export type ImportProviderProfile =
  | "auto"
  | "provider-1"
  | "provider-2"
  | "provider-3"
  | "provider-4";

export interface BingoImportOptions {
  provider?: ImportProviderProfile;
  signal?: AbortSignal;
}

export const IMPORT_PROVIDER_PROFILES: ReadonlyArray<{
  id: ImportProviderProfile;
  label: string;
  description: string;
}> = [
  {
    id: "auto",
    label: "Automático",
    description: "Detecta la distribución sin indicar un proveedor.",
  },
  {
    id: "provider-1",
    label: "Proveedor 1",
    description: "Hojas de 1 o 2 cartones grandes.",
  },
  {
    id: "provider-2",
    label: "Proveedor 2",
    description: "Hojas de 4 cartones en cuadrícula 2×2.",
  },
  {
    id: "provider-3",
    label: "Proveedor 3",
    description: "Hojas con 6 u 8 cartones compactos.",
  },
  {
    id: "provider-4",
    label: "Proveedor 4",
    description: "Cartones escaneados, mixtos o con casillas vacías.",
  },
];

interface ImportProviderStrategy {
  minimumCardsPerPage: number;
  alwaysRunOcr: boolean;
  renderLongEdge: number;
}

const IMPORT_PROVIDER_STRATEGIES: Record<
  ImportProviderProfile,
  ImportProviderStrategy
> = {
  auto: { minimumCardsPerPage: 1, alwaysRunOcr: true, renderLongEdge: 2450 },
  "provider-1": { minimumCardsPerPage: 2, alwaysRunOcr: false, renderLongEdge: 2350 },
  "provider-2": { minimumCardsPerPage: 4, alwaysRunOcr: false, renderLongEdge: 2450 },
  "provider-3": { minimumCardsPerPage: 6, alwaysRunOcr: false, renderLongEdge: 2600 },
  "provider-4": { minimumCardsPerPage: 1, alwaysRunOcr: true, renderLongEdge: 2600 },
};

export function importProviderStrategy(
  provider: ImportProviderProfile = "auto",
) {
  return IMPORT_PROVIDER_STRATEGIES[provider] ?? IMPORT_PROVIDER_STRATEGIES.auto;
}

export function shouldRunProviderOcr(
  provider: ImportProviderProfile,
  detectedCards: number,
) {
  const strategy = importProviderStrategy(provider);
  return (
    strategy.alwaysRunOcr ||
    detectedCards < strategy.minimumCardsPerPage
  );
}

function importCardSetScore(cards: BingoCard[]) {
  return cards.reduce((score, card) => {
    const readableIdentifier = card.number && !card.number.startsWith("SIN-ID-");
    const validValues = card.grid.filter(
      (value) => Number.isInteger(value) && value >= 0 && value <= 75,
    ).length;
    return (
      score +
      100 +
      (readableIdentifier ? 18 : 0) +
      (needsImportReview(card) ? 0 : 12) +
      Math.min(25, validValues)
    );
  }, 0);
}

/**
 * Conserva la lectura por texto cuando es completa y prefiere el OCR cuando
 * este recupera cartones que una capa de texto parcial dejó fuera.
 */
export function selectProviderPageCards(
  textCards: BingoCard[],
  ocrCards: BingoCard[],
) {
  if (ocrCards.length !== textCards.length) {
    return ocrCards.length > textCards.length ? ocrCards : textCards;
  }
  return importCardSetScore(ocrCards) > importCardSetScore(textCards)
    ? ocrCards
    : textCards;
}

export function needsImportReview(card: BingoCard) {
  return (
    card.number.startsWith("SIN-ID-") ||
    Boolean(card.importReview?.length) ||
    card.grid.some((value) => !Number.isInteger(value) || value < 0)
  );
}

function addImportReview(
  card: BingoCard,
  reason: string,
  printedNumber = card.printedNumber,
): BingoCard {
  return {
    ...card,
    printedNumber,
    importReview: [...new Set([...(card.importReview ?? []), reason])],
  };
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
  const addSequence = (positions: number[]) => {
    const key = positions.join(",");
    if (!sequences.some((sequence) => sequence.join(",") === key)) {
      sequences.push(positions);
    }
  };
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 1; second < lines.length; second += 1) {
      const spacing = lines[second].position - lines[first].position;
      const span = spacing * 5;
      if (
        spacing < fullSize * 0.025 ||
        span < fullSize * 0.14 ||
        span > fullSize * 0.92
      ) {
        continue;
      }
      const positions = [lines[first].position, lines[second].position];
      let valid = true;
      for (let index = 2; index < 6; index += 1) {
        const localSpacing = median(
          positions.slice(1).map((position, gapIndex) => position - positions[gapIndex]),
        );
        const expected = positions[positions.length - 1] + localSpacing;
        const match = lines
          .filter((line) => line.position > positions[positions.length - 1])
          .map((line) => ({
            position: line.position,
            distance: Math.abs(line.position - expected),
          }))
          .filter((line) => line.distance <= localSpacing * 0.22)
          .sort((a, b) => a.distance - b.distance)[0];
        if (!match) {
          valid = false;
          break;
        }
        positions.push(match.position);
      }
      if (!valid) continue;
      const gaps = positions
        .slice(1)
        .map((position, index) => position - positions[index]);
      if (coefficientOfVariation(gaps) > 0.08) continue;
      addSequence(positions);
    }
  }
  // Las fotografías suelen recortar exactamente el borde izquierdo o derecho
  // del cartón. Si sobreviven cinco líneas internas equidistantes, reconstruir
  // únicamente el sexto borde que coincide con el límite de la imagen.
  for (let start = 0; start + 4 < lines.length; start += 1) {
    const positions = lines.slice(start, start + 5).map((line) => line.position);
    const gaps = positions.slice(1).map((position, index) => position - positions[index]);
    if (coefficientOfVariation(gaps) > 0.08) continue;
    const spacing = median(gaps);
    if (
      spacing < fullSize * 0.025 ||
      spacing * 5 < fullSize * 0.14 ||
      spacing * 5 > fullSize * 0.92
    ) {
      continue;
    }
    const before = positions[0] - spacing;
    if (before >= -spacing * 0.18 && before <= spacing * 0.18) {
      addSequence([Math.max(0, Math.round(before)), ...positions]);
    }
    const after = positions[4] + spacing;
    if (
      after >= fullSize - 1 - spacing * 0.18 &&
      after <= fullSize - 1 + spacing * 0.18
    ) {
      addSequence([...positions, Math.min(fullSize - 1, Math.round(after))]);
    }
  }
  return sequences;
}

export function detectGridRectangles(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
) {
  const isGridInk = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    const luminance = red * 0.3 + green * 0.59 + blue * 0.11;
    // Los cartones impresos no siempre usan tinta negra. Las hojas reales
    // contienen cuadrículas naranjas o azules que antes se confundían con el
    // fondo y no llegaban a la fase de OCR.
    const orangeInk =
      red >= 120 &&
      red > green * 1.22 &&
      green > blue * 1.12 &&
      red - blue >= 65 &&
      green < 205;
    const blueInk =
      blue >= 90 &&
      blue > red * 1.18 &&
      blue > green * 1.08 &&
      blue - red >= 55;
    return luminance < 112 || orangeInk || blueInk;
  };
  const horizontal = groupLineBands(
    Array.from({ length: height }, (_, y) => ({
      position: y,
      strength: longestDarkRun(width, (x) => isGridInk(x, y), 3),
    })).filter((line) => line.strength >= width * 0.16),
  );
  const vertical = groupLineBands(
    Array.from({ length: width }, (_, x) => ({
      position: x,
      strength: longestDarkRun(height, (y) => isGridInk(x, y), 3),
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
              if (isGridInk(sampleX, sampleY)) {
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
            if (isGridInk(x, y)) darkPixels += 1;
          }
          return sum + darkPixels / Math.max(1, rectangleHeight);
        }, 0) / 6;
      const horizontalDensity =
        horizontalLines.reduce((sum, y) => {
          let darkPixels = 0;
          for (let x = verticalLines[0]; x <= verticalLines[5]; x += 1) {
            if (isGridInk(x, y)) darkPixels += 1;
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

  const selected = selectGridRectangles(rectangles);
  // En hojas con dos cartones contiguos puede aparecer una secuencia falsa que
  // empieza en la segunda columna del cartón izquierdo y termina en el borde
  // del derecho. Si todavía invade al vecino, se recupera el borde anterior
  // antes de entregar las coordenadas definitivas al OCR.
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

/**
 * Recupera hojas verticales con seis juegos abiertos (dos columnas por tres
 * filas). En estos formatos el borde exterior sí es continuo, pero las líneas
 * interiores solo se imprimen donde la figura tiene números; por eso no pueden
 * exigirse las 36 intersecciones de una cuadrícula clásica.
 */
export function detectSparseOuterGridRectangles(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
) {
  if (height <= width * 1.18) return [];
  const isDark = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return rgba[offset] * 0.3 + rgba[offset + 1] * 0.59 + rgba[offset + 2] * 0.11 < 118;
  };
  const horizontal = groupLineBands(
    Array.from({ length: height }, (_, y) => ({
      position: y,
      strength: longestDarkRun(width, (x) => isDark(x, y), 3),
    })).filter((line) => line.strength >= width * 0.3),
  );
  const vertical = groupLineBands(
    Array.from({ length: width }, (_, x) => ({
      position: x,
      strength: longestDarkRun(height, (y) => isDark(x, y), 3),
    })).filter((line) => line.strength >= height * 0.135),
  );
  const density = (
    fixed: number,
    start: number,
    end: number,
    verticalLine: boolean,
  ) => {
    let ink = 0;
    const samples = Math.max(1, end - start + 1);
    for (let position = start; position <= end; position += 1) {
      let found = false;
      for (let offset = -2; offset <= 2 && !found; offset += 1) {
        const x = verticalLine ? fixed + offset : position;
        const y = verticalLine ? position : fixed + offset;
        if (x >= 0 && x < width && y >= 0 && y < height && isDark(x, y)) found = true;
      }
      if (found) ink += 1;
    }
    return ink / samples;
  };
  const candidates: GridRectangle[] = [];
  for (let topIndex = 0; topIndex < horizontal.length; topIndex += 1) {
    for (let bottomIndex = topIndex + 1; bottomIndex < horizontal.length; bottomIndex += 1) {
      const top = horizontal[topIndex].position;
      const bottom = horizontal[bottomIndex].position;
      const rectangleHeight = bottom - top;
      if (rectangleHeight < height * 0.15 || rectangleHeight > height * 0.235) continue;
      for (let leftIndex = 0; leftIndex < vertical.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < vertical.length; rightIndex += 1) {
          const left = vertical[leftIndex].position;
          const right = vertical[rightIndex].position;
          const rectangleWidth = right - left;
          if (rectangleWidth < width * 0.34 || rectangleWidth > width * 0.47) continue;
          const ratio = rectangleWidth / rectangleHeight;
          if (ratio < 1.15 || ratio > 1.7) continue;
          const edgeDensities = [
            density(left, top, bottom, true),
            density(right, top, bottom, true),
            density(top, left, right, false),
            density(bottom, left, right, false),
          ];
          if (edgeDensities.some((value) => value < 0.58)) continue;
          candidates.push({
            x: left,
            y: top,
            width: rectangleWidth,
            height: rectangleHeight,
            verticalLines: Array.from({ length: 6 }, (_, index) =>
              Math.round(left + rectangleWidth * index / 5),
            ),
            horizontalLines: Array.from({ length: 6 }, (_, index) =>
              Math.round(top + rectangleHeight * index / 5),
            ),
            score: 90 + edgeDensities.reduce((sum, value) => sum + value, 0),
          });
        }
      }
    }
  }
  const selected = selectGridRectangles(candidates).sort((a, b) => a.y - b.y || a.x - b.x);
  if (selected.length !== 6) return [];
  const rows = [selected.slice(0, 2), selected.slice(2, 4), selected.slice(4, 6)];
  const regularRows = rows.every((row) =>
    row.length === 2 &&
    Math.abs(row[0].y - row[1].y) <= height * 0.025 &&
    row[0].x + row[0].width < row[1].x,
  );
  const rowHeights = rows.map((row) => median(row.map((item) => item.height)));
  if (!regularRows || coefficientOfVariation(rowHeights) > 0.08) return [];
  return selected;
}

export function selectGridRectangles(rectangles: GridRectangle[]) {
  const selected: GridRectangle[] = [];
  // Los anuncios y recuadros situados encima de un cartón pueden formar una
  // secuencia falsa superpuesta. La cuadrícula completa conserva más
  // intersecciones y densidad, por lo que su puntuación debe prevalecer.
  for (const rectangle of [...rectangles].sort(
    (a, b) => b.score - a.score || a.y - b.y || a.x - b.x,
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
  return selected;
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

function cellLooksBlank(
  source: HTMLCanvasElement,
  rectangle: GridRectangle,
  index: number,
) {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const row = Math.floor(index / 5);
  const column = index % 5;
  const cellLeft = rectangle.verticalLines[column];
  const cellTop = rectangle.horizontalLines[row];
  const cellWidth = rectangle.verticalLines[column + 1] - cellLeft;
  const cellHeight = rectangle.horizontalLines[row + 1] - cellTop;
  const marginX = Math.max(3, Math.round(cellWidth * 0.18));
  const marginY = Math.max(3, Math.round(cellHeight * 0.16));
  const width = Math.max(1, Math.floor(cellWidth - marginX * 2));
  const height = Math.max(1, Math.floor(cellHeight - marginY * 2));
  const pixels = context.getImageData(
    Math.max(0, Math.floor(cellLeft + marginX)),
    Math.max(0, Math.floor(cellTop + marginY)),
    width,
    height,
  ).data;
  let dark = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const luminance =
      pixels[offset] * 0.3 + pixels[offset + 1] * 0.59 + pixels[offset + 2] * 0.11;
    if (luminance < 105) dark += 1;
  }
  return dark / Math.max(1, pixels.length / 4) < 0.012;
}

function recoverMaskedGridForReview(
  source: HTMLCanvasElement,
  rectangle: GridRectangle,
  grid: number[],
) {
  if (grid.length !== 25) return null;
  const seen = new Set<number>();
  const recovered = grid.map((value, index) => {
    if (index === 12 && !validNumberForCell(value, index)) return 0;
    if (validNumberForCell(value, index) && !seen.has(value)) {
      seen.add(value);
      return value;
    }
    return cellLooksBlank(source, rectangle, index) ? 0 : -1;
  });
  const recognized = recovered.filter((value) => value > 0).length;
  const printedBlanks = recovered.filter((value, index) => index !== 12 && value === 0).length;
  const unresolved = recovered.filter((value) => value < 0).length;
  if (
    recognized < 5 ||
    recognized >= 24 ||
    printedBlanks < 2 ||
    unresolved > 6
  ) {
    return null;
  }
  return recovered;
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

  // Asociar primero las lecturas por distancia global. El enfoque anterior
  // recorría las cuadrículas en orden y consumía una lectura aislada para el
  // primer cartón, aunque esa lectura estuviera exactamente sobre el tercero.
  const identifierByGrid = new Map<DetectedGrid, Identifier>();
  const assignedIdentifiers = new Set<Identifier>();
  const availableGrids = orderedGrids.filter((grid) => !grid.identifier);
  const candidatePairs = availableGrids.flatMap((grid) =>
    orderedIdentifiers.map((identifier) => ({
      grid,
      identifier,
      distance:
        Math.abs(identifier.x - grid.x) + Math.abs(identifier.y - grid.y),
    })),
  );
  for (const candidate of candidatePairs.sort((a, b) => a.distance - b.distance)) {
    if (
      identifierByGrid.has(candidate.grid) ||
      assignedIdentifiers.has(candidate.identifier)
    ) {
      continue;
    }
    identifierByGrid.set(candidate.grid, candidate.identifier);
    assignedIdentifiers.add(candidate.identifier);
  }

  return orderedGrids.map((detected, index) => {
    const numberSheetForm = numberSheetFormForGrid(detected.grid);
    const identifier = identifierByGrid.get(detected);
    return {
      id: crypto.randomUUID(),
      number: detected.identifier ?? identifier?.value ?? missingIdentifier(index),
      serial: detected.serial ?? (numberSheetForm ? `Forma #${numberSheetForm}` : ""),
      importReview: detected.importReview,
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

export function shouldRereadBingoCell(value: number, index: number) {
  return index % 5 === 0 && ((value >= 1 && value <= 9) || value === 11);
}

export function resolveOneElevenCandidates(
  originalValue: number,
  candidates: number[],
) {
  const ones = candidates.filter((value) => value === 1).length;
  const elevens = candidates.filter((value) => value === 11).length;
  if (ones === elevens) return originalValue;
  return ones > elevens ? 1 : 11;
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
      // Un identificador clásico como "Tab#23726-1" no describe una Forma #1.
      // Solo la palabra FORMA (o un dígito aislado dentro de la casilla central)
      // constituye evidencia del juego 1-3-4-5-7-9.
      const explicit = line.match(/form\w*\D*#?\s*([134579])/i)?.[1];
      const digits = line.replace(/\D/g, "");
      return (explicit ?? (/^[134579]$/.test(digits) ? digits : null)) as NumberSheetForm | null;
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
    if (joined) {
      const suffix = Number(joined.slice(-1));
      identifier = form && numberSheetFormBySuffix[suffix] === form
        ? `${joined.slice(0, -1)}-${suffix}`
        : rawLines.some((line) => /(?:tab(?:la)?|cart[oó]n|ticket|serie|#)/i.test(line))
          ? joined
          : null;
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
    new Set(entries.map((item) => item.suffix)).size !== 4 ||
    entries.map((item) => item.suffix).sort((a, b) => a - b).join(",") !== "3,4,5,6"
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

const numberSheetSuffixByForm: Partial<Record<NumberSheetForm, number>> = {
  "1": 3,
  "3": 4,
  "5": 5,
  "9": 6,
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

function validLooseBingoValue(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 75;
}

/** Reads sparse-form cells without applying classic B-I-N-G-O column ranges. */
function bestLooseCellValue(
  symbols: OcrSymbol[],
  expectedCenter: number,
  cellWidth: number,
) {
  const ordered = [...symbols].sort(
    (a, b) =>
      (a.bbox.x0 + a.bbox.x1) / 2 - (b.bbox.x0 + b.bbox.x1) / 2,
  );
  const candidates: Array<{ value: number; score: number }> = [];

  ordered.forEach((first, index) => {
    const firstCenter = (first.bbox.x0 + first.bbox.x1) / 2;
    const single = Number(first.text);
    if (validLooseBingoValue(single)) {
      candidates.push({
        value: single,
        score: first.confidence -
          (Math.abs(firstCenter - expectedCenter) / cellWidth) * 35,
      });
    }
    for (let nextIndex = index + 1; nextIndex < ordered.length; nextIndex += 1) {
      const second = ordered[nextIndex];
      const secondCenter = (second.bbox.x0 + second.bbox.x1) / 2;
      if (secondCenter - firstCenter > cellWidth * 0.62) break;
      const value = Number(`${first.text}${second.text}`);
      if (!validLooseBingoValue(value) || value < 10) continue;
      const pairCenter =
        (Math.min(first.bbox.x0, second.bbox.x0) +
          Math.max(first.bbox.x1, second.bbox.x1)) / 2;
      candidates.push({
        value,
        score: (first.confidence + second.confidence) / 2 + 12 -
          (Math.abs(pairCenter - expectedCenter) / cellWidth) * 35,
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

export function extractLooseSparseGridFromKnownOcrBlocks(
  blocks: OcrBlock[],
  width: number,
  height: number,
) {
  const symbols = flattenOcrSymbols(ocrWords(blocks));
  const cellWidth = width / 5;
  const cellHeight = height / 5;
  return Array.from({ length: 25 }, (_, index) => {
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
    return bestLooseCellValue(inCell, expectedX, cellWidth) ?? -1;
  });
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

type IdentifierEvidence = { family: string; score: number };

export function cardIdentifierFromOcrText(text: string) {
  const normalized = text
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[–—_]/g, "-");
  const separated = [...normalized.matchAll(/(?<!\d)(\d{5,12})\s*-\s*(\d{1,3})(?!\d)/g)]
    .map((match) => `${match[1]}-${match[2]}`);
  if (separated.length) return separated[0];

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const contextual = lines.flatMap((line) => {
    const match = line.match(
      /(?:tab(?:la)?|cart[oó]n|tabla|ticket|serie|n[°ºo]?\s*tabla|#)\D{0,8}(\d{5,12})(?!\d)/i,
    );
    return match ? [match[1]] : [];
  });
  if (contextual.length) return contextual[0];

  // El recorte pertenece exclusivamente al encabezado inmediato de un cartón.
  // Esto permite conservar series impresas como #0311297, sin exigir el sufijo
  // "-1" usado por otros proveedores. Una cifra aislada de solo cinco dígitos
  // se descarta aquí porque suele ser fecha, premio o texto promocional; los
  // identificadores de cinco dígitos siguen aceptándose cuando tienen contexto.
  const plain = lines.flatMap((line) =>
    [...line.matchAll(/(?<!\d)(\d{6,12})(?!\d)/g)].map((match) => match[1]),
  );
  return plain[0] ?? null;
}

function identifierEvidenceFromOcrText(text: string): IdentifierEvidence | null {
  const scores = new Map<string, number>();
  const add = (value: string, score: number) => {
    if (value.length < 5 || value.length > 10 || /^0+$/.test(value)) return;
    scores.set(value, (scores.get(value) ?? 0) + score);
  };
  const normalized = text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
  for (const match of normalized.matchAll(/tab(?:la)?\D{0,12}(\d{5,10})/gi)) add(match[1], 12);
  for (const match of normalized.matchAll(/jueg[0o]\D{0,12}(\d{5,10})/gi)) add(match[1], 10);
  for (const match of normalized.matchAll(/(\d{5,10})\s*[-_]\s*([1-9])(?!\d)/g)) add(match[1], 8);
  for (const match of normalized.matchAll(/(?<!\d)(\d{6,11})(?!\d)/g)) {
    const joined = match[1];
    if (/[1-4]$/.test(joined)) add(joined.slice(0, -1), 3);
  }
  for (const match of normalized.matchAll(/(?<!\d)(\d{5,8})(?!\d)/g)) add(match[1], 1);
  const winner = [...scores.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length,
  )[0];
  return winner ? { family: winner[0], score: winner[1] } : null;
}

export function identifierFamilyFromOcrText(text: string) {
  return identifierEvidenceFromOcrText(text)?.family ?? null;
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

export function reconcilePositionalIdentifierFamily(values: string[]) {
  if (values.length < 4) return values;
  const parsed = values.map((value) =>
    value.trim().match(/^#?(\d{5,12})(?:-([1-9]))?$/),
  );
  if (parsed.some((match) => !match)) return values;
  const families = parsed.map((match) => match![1]);
  const family = identifierFamilyConsensus(families);
  if (!family) return values;
  const exact = families.filter((value) => value === family).length;
  const close = families.filter((value) => editDistance(value, family) <= 1).length;
  if (exact < Math.ceil(values.length / 2) || close < Math.ceil(values.length * 0.75)) {
    return values;
  }
  return values.map((_, index) => `${family}-${index + 1}`);
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

export async function recognizeGridIdentifiers(
  source: HTMLCanvasElement,
  rectangles: GridRectangle[],
  worker: OcrWorker,
) {
  const rowTolerance = median(rectangles.map((rectangle) => rectangle.height)) * 0.35;
  const ordered = [...rectangles].sort((a, b) =>
    Math.abs(a.y - b.y) <= rowTolerance ? a.x - b.x : a.y - b.y,
  );
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789-_#TabJUEGOjuegoOoIl",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });

  // En las hojas de cuatro cartones la serie aparece varias veces en el
  // encabezado (p. ej. 87020, 87020-1 y 87020-2). Leer una sola franja amplia
  // es más estable que depender de cuatro recortes pequeños.
  const firstGridTop = ordered.length
    ? Math.min(...ordered.map((rectangle) => rectangle.y))
    : source.height * 0.42;
  const headerHeight = Math.max(
    1,
    Math.round(Math.min(source.height * 0.42, Math.max(source.height * 0.08, firstGridTop))),
  );
  const headerScale = Math.max(1, Math.min(3, 1800 / source.width));
  const pageHeader = makeCanvas(
    Math.round(source.width * headerScale),
    Math.round(headerHeight * headerScale),
  );
  let family: string | null = null;
  if (pageHeader) {
    pageHeader.context.drawImage(
      source,
      0,
      0,
      source.width,
      headerHeight,
      0,
      0,
      pageHeader.canvas.width,
      pageHeader.canvas.height,
    );
    binarizeNumbers(pageHeader.canvas, pageHeader.context);
    const result = await worker.recognize(pageHeader.canvas, {}, { text: true });
    const evidence = identifierEvidenceFromOcrText(result.data.text ?? "");
    family = evidence && evidence.score >= 8 ? evidence.family : null;
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

  /* istanbul ignore next -- exercised with scanned PDF and image fixtures */
  if (!identifiers.length) for (const [index, rectangle] of ordered.entries()) {
    const margin = Math.max(36, rectangle.height * 0.3);
    const top = Math.max(0, rectangle.y - margin);
    const height = Math.max(1, rectangle.y - top);
    // El número impreso suele ocupar la franja estrecha inmediatamente encima
    // de B-I-N-G-O. Recortar demasiado arriba incluía el membrete de la hoja y
    // dejaba fuera identificadores claros como #0173745.
    const labelTop = Math.max(0, rectangle.y - rectangle.height * 0.12);
    const labelHeight = Math.max(1, rectangle.y - labelTop);
    const upperFocusedLabelTop = Math.max(0, rectangle.y - rectangle.height * 0.32);
    const upperFocusedLabelHeight = Math.max(1, rectangle.height * 0.15);
    const focusedLabelTop = Math.max(0, rectangle.y - rectangle.height * 0.235);
    const focusedLabelHeight = Math.max(1, rectangle.height * 0.14);
    const crops = [
      // Proveedores como VRO imprimen “#0183897” o “TABLA No. 0111625”
      // en una banda situada bastante más arriba de B-I-N-G-O. Esta lectura
      // estrecha evita mezclar premios, teléfonos y números de las casillas.
      { x: rectangle.x, y: upperFocusedLabelTop, width: rectangle.width, height: upperFocusedLabelHeight, focusedThreshold: 120, maxChroma: 255 },
      { x: rectangle.x, y: upperFocusedLabelTop, width: rectangle.width, height: upperFocusedLabelHeight, focusedThreshold: 155, maxChroma: 255 },
      { x: rectangle.x, y: focusedLabelTop, width: rectangle.width, height: focusedLabelHeight, focusedThreshold: 120, maxChroma: 90 },
      { x: rectangle.x, y: focusedLabelTop, width: rectangle.width, height: focusedLabelHeight, focusedThreshold: 100, maxChroma: 90 },
      { x: rectangle.x, y: focusedLabelTop, width: rectangle.width, height: focusedLabelHeight, focusedThreshold: 120, maxChroma: 255 },
      { x: rectangle.x, y: focusedLabelTop, width: rectangle.width, height: focusedLabelHeight, focusedThreshold: 100, maxChroma: 255 },
      { x: rectangle.x, y: labelTop, width: rectangle.width * 0.72, height: labelHeight },
      { x: rectangle.x, y: labelTop, width: rectangle.width, height: labelHeight },
      { x: rectangle.x, y: top, width: rectangle.width, height: height * 0.64 },
      { x: rectangle.x, y: top, width: rectangle.width * 0.76, height: height * 0.72 },
      { x: rectangle.x, y: top, width: rectangle.width, height },
      // Some scanners report the first numeric line as the grid top. Include
      // the preceding BINGO row and its printed label in one contextual crop.
      { x: rectangle.x, y: Math.max(0, rectangle.y - rectangle.height * 0.38), width: rectangle.width, height: rectangle.height * 0.45 },
    ];
    let value = "";
    let lastText = "";
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789-_#",
      tessedit_pageseg_mode: "7",
      preserve_interword_spaces: "1",
    });
    for (const [cropIndex, crop] of crops.entries()) {
      const focusedCrop = "focusedThreshold" in crop;
      const contextualCrop = cropIndex === crops.length - 1;
      const target = makeCanvas(1440, contextualCrop ? 440 : focusedCrop ? 300 : 240);
      if (!target) continue;
      await worker.setParameters({
        tessedit_char_whitelist: contextualCrop
          ? "0123456789-_#ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚáéíóú"
          : "0123456789-_#",
        tessedit_pageseg_mode: contextualCrop ? "6" : focusedCrop ? "11" : "7",
        preserve_interword_spaces: "1",
      });
      target.context.drawImage(
        source,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        20,
        20,
        target.canvas.width - 40,
        target.canvas.height - 40,
      );
      binarizeNumbers(
        target.canvas,
        target.context,
        focusedCrop ? crop.focusedThreshold : cropIndex <= 3 ? 205 : 175,
        contextualCrop ? 130 : "maxChroma" in crop ? crop.maxChroma : 90,
      );
      const result = await worker.recognize(target.canvas, {}, { text: true });
      lastText = result.data.text ?? "";
      value = cardIdentifierFromOcrText(lastText) ?? "";
      if (value) break;
    }
    if (!value) {
      const joined = lastText.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").match(/\b(\d{6,13})\b/);
      if (joined && joined[1].endsWith(String((index % 4) + 1))) {
        value = `${joined[1].slice(0, -1)}-${joined[1].slice(-1)}`;
      }
    }
    if (value) identifiers.push({ value, x: rectangle.x + rectangle.width / 2, y: source.height - rectangle.y });
  }
  if (identifiers.length === ordered.length) {
    const positional = reconcilePositionalIdentifierFamily(
      identifiers.map((item) => item.value),
    );
    const repaired = reconcileSequentialGridIdentifiers(positional);
    identifiers.forEach((item, index) => { item.value = repaired[index]; });
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

function cleanGridCanvas(source: HTMLCanvasElement, rectangle: GridRectangle, threshold = 175) {
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
  binarizeNumbers(target.canvas, target.context, threshold, 75);
  return target.canvas;
}

async function recognizeSparseGrid(
  source: HTMLCanvasElement,
  rectangle: GridRectangle,
  worker: OcrWorker,
) {
  const readings: number[][] = [];
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  for (const threshold of [55, 75, 95, 115]) {
    const montage = cleanGridCanvas(source, rectangle, threshold);
    if (!montage) continue;
    try {
      const result = await worker.recognize(montage, {}, { blocks: true, text: true });
      readings.push(extractLooseSparseGridFromKnownOcrBlocks(
        result.data.blocks ?? [],
        montage.width,
        montage.height,
      ));
    } finally {
      montage.width = montage.height = 0;
    }
  }
  const confidence = Array(25).fill(0) as number[];
  const grid = Array.from({ length: 25 }, (_, index) => {
    if (index === 12) return 0;
    const votes = new Map<number, number>();
    readings
      .map((reading) => reading[index])
      .filter((value) => validLooseBingoValue(value))
      .forEach((value) => votes.set(value, (votes.get(value) ?? 0) + 1));
    const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    confidence[index] = winner?.[1] ?? 0;
    return winner && winner[1] >= 2 ? winner[0] : 0;
  });
  // Las marcas de agua inclinadas pueden separar un dígito del montaje global.
  // Releer únicamente las casillas que contienen tinta negra conserva la forma
  // impresa y evita ejecutar OCR sobre todos los espacios realmente vacíos.
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "8",
    preserve_interword_spaces: "1",
  });
  for (let index = 0; index < grid.length; index += 1) {
    if (index === 12) continue;
    if (cellLooksBlank(source, rectangle, index)) {
      grid[index] = 0;
      confidence[index] = 0;
      continue;
    }
    const row = Math.floor(index / 5);
    const column = index % 5;
    const left = rectangle.verticalLines[column] + 5;
    const top = rectangle.horizontalLines[row] + 5;
    const width = Math.max(1, rectangle.verticalLines[column + 1] - left - 5);
    const height = Math.max(1, rectangle.horizontalLines[row + 1] - top - 5);
    const votes = new Map<number, number>();
    for (const threshold of [90, 120, 150, 180]) {
      const target = makeCanvas(240, 190);
      if (!target) continue;
      target.context.drawImage(source, left, top, width, height, 15, 15, 210, 160);
      binarizeNumbers(target.canvas, target.context, threshold);
      const result = await worker.recognize(target.canvas, {}, { blocks: true, text: true });
      const symbols = result.data.blocks?.length
        ? flattenOcrSymbols(ocrWords(result.data.blocks))
        : [];
      const digits = (result.data.text ?? "").replace(/\D/g, "");
      const exact = Number(digits);
      const candidate = bestLooseCellValue(symbols, 120, 240) ??
        (validLooseBingoValue(exact) ? exact : null);
      if (candidate !== null && validLooseBingoValue(candidate)) {
        votes.set(candidate, (votes.get(candidate) ?? 0) + 1);
      }
      target.canvas.width = target.canvas.height = 0;
    }
    const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (winner && winner[1] >= 2) {
      grid[index] = winner[0];
      confidence[index] = winner[1] + 2;
    } else if (confidence[index] < 3) {
      grid[index] = 0;
      confidence[index] = 0;
    }
  }
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  const positionsByValue = new Map<number, number[]>();
  grid.forEach((value, index) => {
    if (value > 0) positionsByValue.set(value, [...(positionsByValue.get(value) ?? []), index]);
  });
  for (const positions of positionsByValue.values()) {
    if (positions.length < 2) continue;
    positions.sort((a, b) => confidence[b] - confidence[a]);
    positions.slice(1).forEach((index) => {
      grid[index] = 0;
      confidence[index] = 0;
    });
  }
  const values = grid.filter((value) => value > 0);
  if (values.length < 5 || values.length > 15 || new Set(values).size !== values.length) return null;
  return grid;
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
  // La primera lectura ya procesa la cuadrícula completa. Repetir OCR sobre
  // todas las casillas válidas multiplicaba el tiempo por cada página sin
  // aportar información nueva. Solo se releen cifras ausentes o duplicadas;
  // la ruta exhaustiva inferior se conserva para cualquier fila incompleta.
  const cellsToRecognize = [...new Set(missing)];
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
          shouldRereadBingoCell(value, index) ||
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
    const repeatedOriginal = (counts.get(originalValue) ?? 0) > 1;
    const compareOneEleven =
      !repeatedOriginal &&
      column === 0 &&
      (originalValue === 1 || originalValue === 11);
    const verifyOriginal =
      rereadAll &&
      !repeatedOriginal &&
      !compareOneEleven &&
      validNumberForCell(originalValue, index);
    const oneElevenCandidates: number[] = [];
    const repeatedCandidates: number[] = [];
    const verificationCandidates: number[] = [];
    const thresholds = compareOneEleven || repeatedOriginal
      ? [100, 145, 195, 225]
      : [100, 145, 195];
    for (const threshold of thresholds) {
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
      target.canvas.width = target.canvas.height = 0;
      if (compareOneEleven) {
        if (value === 1 || value === 11) oneElevenCandidates.push(value);
        value = null;
        continue;
      }
      if (repeatedOriginal) {
        if (value !== null) repeatedCandidates.push(value);
        value = null;
        continue;
      }
      if (verifyOriginal) {
        if (value !== null) verificationCandidates.push(value);
        value = null;
        continue;
      }
      if (value !== null) break;
    }
    // Cuando una estrella o logotipo de color queda detrás del dígito, el
    // filtro cromático estricto puede borrar también parte del número. Solo
    // como último recurso se conserva todo el color oscuro y se vuelve a
    // validar el resultado contra el rango B-I-N-G-O de esa columna.
    if (value === null) {
      for (const threshold of [120, 100]) {
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
        binarizeNumbers(target.canvas, target.context, threshold, 255);
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
          const exact = Number(digits);
          value = Number.isInteger(exact) && exact >= minimum && exact <= maximum
            ? exact
            : null;
        }
        target.canvas.width = target.canvas.height = 0;
        if (compareOneEleven) {
          if (value === 1 || value === 11) oneElevenCandidates.push(value);
          value = null;
          continue;
        }
        if (repeatedOriginal) {
          if (value !== null) repeatedCandidates.push(value);
          value = null;
          continue;
        }
        if (verifyOriginal) {
          if (value !== null) verificationCandidates.push(value);
          value = null;
          continue;
        }
        if (value !== null) break;
      }
    }
    if (compareOneEleven) {
      value = resolveOneElevenCandidates(originalValue, oneElevenCandidates);
    } else if (repeatedOriginal && repeatedCandidates.length) {
      const frequency = new Map<number, number>();
      repeatedCandidates.forEach((candidate) =>
        frequency.set(candidate, (frequency.get(candidate) ?? 0) + 1),
      );
      value = [...frequency.entries()].sort(
        (left, right) =>
          right[1] - left[1] ||
          Number(left[0] === originalValue) - Number(right[0] === originalValue),
      )[0][0];
    } else if (verifyOriginal && verificationCandidates.length) {
      const frequency = new Map<number, number>();
      verificationCandidates.forEach((candidate) =>
        frequency.set(candidate, (frequency.get(candidate) ?? 0) + 1),
      );
      const winner = [...frequency.entries()].sort(
        (left, right) => right[1] - left[1] || Number(right[0] === originalValue) - Number(left[0] === originalValue),
      )[0];
      value = winner && winner[1] >= 2 ? winner[0] : originalValue;
    }
    resolved[index] = value ?? (validNumberForCell(originalValue, index)
      ? originalValue
      : -1);
  }
  const resolvedCounts = new Map<number, number>();
  resolved
    .filter((value) => value > 0)
    .forEach((value) => resolvedCounts.set(value, (resolvedCounts.get(value) ?? 0) + 1));
  const rowsToRepair = [...new Set(
    resolved
      .map((value, index) => ({ value, index }))
      .filter(({ value, index }) =>
        index !== 12 &&
        (!validNumberForCell(value, index) || (resolvedCounts.get(value) ?? 0) > 1),
      )
      .map(({ index }) => Math.floor(index / 5)),
  )];
  for (const row of rowsToRepair) {
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
    for (const threshold of [125, 160, 195, 225]) {
      const target = makeCanvas(1100, 220);
      if (!target) continue;
      target.context.drawImage(source, left, top, width, height, 20, 20, 1060, 180);
      binarizeNumbers(target.canvas, target.context, threshold);
      const result = await worker.recognize(target.canvas, {}, { text: true });
      const candidate = decodeBingoRowDigits(result.data.text ?? "", row === 2);
      if (!candidate) continue;
      const replaced = [...resolved];
      candidate.forEach((value, column) => {
        replaced[row * 5 + column] = value;
      });
      const values = replaced.filter((value) => value > 0);
      if (new Set(values).size === values.length) {
        decoded = candidate;
        break;
      }
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
  const isTwoCardLandscapeSheet =
    source.width > source.height &&
    rectangles.length === 2 &&
    rectangles.every((item) => item.score >= 60);
  const isSparseMultiCardSheet =
    source.height > source.width &&
    rectangles.length === 6 &&
    rectangles.every((item) =>
      item.height >= source.height * 0.14 && item.height <= source.height * 0.25
    );
  const eligibleRectangles = isFourCardPortraitSheet || isTwoCardLandscapeSheet
    ? rectangles
    : rectangles.filter((item) => item.score >= 80);
  const firstRectangleTop = Math.min(
    ...eligibleRectangles.map((item) => item.y / source.height),
  );
  // Las hojas 1-3-5-9 empiezan un poco más arriba que las muestras iniciales
  // (aprox. 31 % de la página). El umbral anterior de 32 % las trataba como
  // cartones 5x5 completos y terminaba enviándolas a revisión.
  const numberSheetGeometryCandidate =
    eligibleRectangles.length === 4 && firstRectangleTop >= 0.28;
  let numberSheetMetadataCache: Array<NumberSheetMetadata | null> | null =
    numberSheetGeometryCandidate
      ? await Promise.all(
          eligibleRectangles.map((candidate) =>
            recognizeNumberSheetMetadata(source, candidate, worker),
          ),
        )
      : null;
  let numberSheetFormCache = numberSheetMetadataCache
    ? numberSheetFormsFromIdentifierSeries(numberSheetMetadataCache)
    : null;
  let numberSheetFamily = numberSheetMetadataCache
    ? dominantNumberSheetFamily(numberSheetMetadataCache)
    : null;
  const explicitNumberSheetAgreements =
    numberSheetMetadataCache?.filter((metadata) => {
      const suffix = Number(metadata?.identifier?.match(/-(\d+)$/)?.[1]);
      return Boolean(
        metadata?.form &&
        Number.isInteger(suffix) &&
        numberSheetFormBySuffix[suffix] === metadata.form,
      );
    }).length ?? 0;
  const likelyNumberSheetPage =
    numberSheetGeometryCandidate &&
    (explicitNumberSheetAgreements >= 2 || numberSheetFormCache !== null);
  const printedPortraitFamily = (isFourCardPortraitSheet || isSparseMultiCardSheet) && !likelyNumberSheetPage
    ? await recognizePortraitPageFamily(source, worker)
    : null;
  const identifiers = await recognizeGridIdentifiers(source, eligibleRectangles, worker);
  for (const rectangle of eligibleRectangles) {
    const originalPosition = {
      x: rectangle.x + rectangle.width / 2,
      y: source.height - rectangle.y,
    };
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
    original.width = original.height = 0;
    const rowHeight = median(
      rectangle.horizontalLines.slice(1).map((line, index) => line - rectangle.horizontalLines[index]),
    );
    const nextGap = rectangle.nextHorizontalLine
      ? rectangle.nextHorizontalLine - rectangle.horizontalLines[5]
      : 0;
    const firstRowValues = grid.slice(0, 5).filter((value, index) => validNumberForCell(value, index)).length;
    if (
      rectangle.nextHorizontalLine &&
      rowHeight > 0 &&
      nextGap >= rowHeight * 0.68 &&
      nextGap <= rowHeight * 1.34 &&
      firstRowValues <= 2
    ) {
      rectangle.y = rectangle.horizontalLines[1];
      rectangle.height = rectangle.nextHorizontalLine - rectangle.y;
      rectangle.horizontalLines = [...rectangle.horizontalLines.slice(1), rectangle.nextHorizontalLine];
      rectangle.nextHorizontalLine = undefined;
      const shifted = cropGridCanvas(source, rectangle);
      if (shifted) {
        try {
          const shiftedResult = await worker.recognize(shifted, {}, { blocks: true, tsv: true, text: true });
          grid = extractPartialGridFromKnownOcrBlocks(shiftedResult.data.blocks ?? [], shifted.width, shifted.height);
        } finally { shifted.width = shifted.height = 0; }
      }
    }
    let detectedSerial: string | undefined;
    let detectedImportReview: string[] | undefined;
    if (isSparseMultiCardSheet) {
      const sparseGrid = await recognizeSparseGrid(source, rectangle, worker);
      const rectangleIndex = eligibleRectangles.indexOf(rectangle);
      const positionalIdentifier = identifiers[rectangleIndex]?.value;
      if (sparseGrid) {
        const sparseForm = numberSheetFormForGrid(sparseGrid);
        detected.push({
          grid: sparseGrid,
          x: rectangle.x + rectangle.width / 2,
          y: source.height - rectangle.y,
          score: rectangle.score,
          rowIds: [],
          serial: sparseForm === "+"
            ? "Signo +"
            : sparseForm
              ? `Forma #${sparseForm}`
              : "Forma detectada",
          identifier: positionalIdentifier ??
            `SIN-ID-${String(pageNumber).padStart(3, "0")}-${rectangleIndex + 1}`,
        });
      } else {
        detected.push({
          grid: recoverMaskedGridForReview(source, rectangle, grid) ??
            Array.from({ length: 25 }, (_, index) => index === 12 ? 0 : -1),
          x: rectangle.x + rectangle.width / 2,
          y: source.height - rectangle.y,
          score: rectangle.score,
          rowIds: [],
          serial: "Forma detectada · pendiente de revisión",
          importReview: ["La figura fue localizada, pero algunas casillas no tuvieron una lectura segura."],
          identifier: positionalIdentifier ??
            `SIN-ID-${String(pageNumber).padStart(3, "0")}-${rectangleIndex + 1}`,
        });
      }
      continue;
    }
    if (likelyNumberSheetPage) {
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
    // Algunas marcas de agua impiden leer el rótulo central que clasifica la
    // hoja, aunque la silueta de la forma sí sea inequívoca. En ese caso se
    // normalizan solo sus casillas impresas y se releen las cifras dudosas.
    const directlyRecognizedForm = numberSheetFormForGrid(grid);
    if (directlyRecognizedForm) {
      const normalizedFormGrid = await recognizeMissingNumberSheetCells(
        source,
        rectangle,
        normalizeNumberSheetGrid(grid, directlyRecognizedForm),
        directlyRecognizedForm,
        worker,
      );
      grid = normalizedFormGrid;
      detectedSerial = directlyRecognizedForm === "+"
        ? "Signo +"
        : `Forma #${directlyRecognizedForm}`;
      if (isPlausibleNumberSheetGrid(normalizedFormGrid, directlyRecognizedForm)) {
        const positionalIdentifier = [...identifiers].sort((left, right) =>
          Math.abs(left.x - originalPosition.x) + Math.abs(left.y - originalPosition.y) -
          (Math.abs(right.x - originalPosition.x) + Math.abs(right.y - originalPosition.y)),
        )[0];
        detected.push({
          grid: normalizedFormGrid,
          x: rectangle.x + rectangle.width / 2,
          y: source.height - rectangle.y,
          score: rectangle.score,
          rowIds: [],
          serial: detectedSerial,
          identifier: positionalIdentifier?.value,
        });
        continue;
      }
    }
    // No conviertas una cuadrícula clásica incompleta en una forma numerada
    // solo porque el primer OCR dejó varias casillas sin leer. Esa
    // clasificación requiere evidencia de toda la hoja (rótulos FORMA o la
    // serie impresa 3-4-5-6); de lo contrario se debe terminar primero la
    // recuperación normal del cartón 5x5.
    if (likelyNumberSheetPage && gridQuality(grid) < 8) {
      const inferredForm = inferNumberSheetForm(grid);
      if (
        inferredForm &&
        await matchesNumberSheetSignature(
          source,
          rectangle,
          grid,
          inferredForm,
          worker,
        )
      ) {
        const numberSheetGrid = await recognizeMissingNumberSheetCells(
          source,
          rectangle,
          grid,
          inferredForm,
          worker,
        );
        if (isPlausibleNumberSheetGrid(numberSheetGrid, inferredForm)) {
          const rectangleIndex = eligibleRectangles.indexOf(rectangle);
          const detectedIdentifier = identifiers[rectangleIndex]?.value;
          const family =
            numberSheetFamily ??
            detectedIdentifier?.match(/^(\d{5,12})(?:-\d{1,3})?$/)?.[1] ??
            null;
          const formSuffix = numberSheetSuffixByForm[inferredForm] ?? rectangleIndex + 1;
          detected.push({
            grid: numberSheetGrid,
            x: rectangle.x + rectangle.width / 2,
            y: source.height - rectangle.y,
            score: rectangle.score,
            rowIds: [],
            serial: `Forma #${inferredForm}`,
            identifier: family
              ? `${family}-${formSuffix}`
              : `SIN-ID-${String(pageNumber).padStart(3, "0")}-${formSuffix}`,
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
    if (
      gridQuality(grid) < 8 ||
      grid.some((value, index) => shouldRereadBingoCell(value, index))
    ) {
      // En una hoja impresa de cuatro cartones, una primera pasada OCR suele
      // leer dos cuadrículas y dejar otras dos incompletas por el diseño,
      // tinta o marca de agua. Releer todas las casillas solo de la cuadrícula
      // dudosa evita descartar un cartón sin sustituir números por estimaciones.
      grid = await recognizeMissingCells(
        source,
        rectangle,
        grid,
        worker,
        isFourCardPortraitSheet && gridQuality(grid) < 8,
      );
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
    // Algunas hojas separan los dos cartones con una franja vertical de
    // publicidad. La detección de líneas puede tomar esa franja como la
    // primera columna del cartón derecho. Solo cuando la lectura normal no
    // valida, se prueba el desplazamiento de una celda a la derecha; se acepta
    // exclusivamente si las 24 cifras respetan las columnas B-I-N-G-O.
    const leftSibling = eligibleRectangles
      .filter(
        (candidate) =>
          candidate !== rectangle &&
          candidate.x < rectangle.x &&
          Math.abs(candidate.y - rectangle.y) <= rectangle.height * 0.35 &&
          Math.abs(candidate.x + candidate.width - rectangle.x) <=
            Math.max(5, rectangle.width * 0.08),
      )
      .sort((a, b) => b.x - a.x)[0];
    if (gridQuality(grid) < 8 && leftSibling) {
      const columnSpacing = median(
        rectangle.verticalLines
          .slice(1)
          .map((position, index) => position - rectangle.verticalLines[index]),
      );
      if (columnSpacing > 0) {
        const shiftedRightRectangle: GridRectangle = {
          ...rectangle,
          x: rectangle.verticalLines[1],
          width: rectangle.verticalLines[5] + columnSpacing - rectangle.verticalLines[1],
          verticalLines: [
            ...rectangle.verticalLines.slice(1),
            rectangle.verticalLines[5] + columnSpacing,
          ],
          horizontalLines: rectangle.nextHorizontalLine
            ? [...rectangle.horizontalLines.slice(1), rectangle.nextHorizontalLine]
            : [...rectangle.horizontalLines],
        };
        const shiftedRightGrid = await recognizeMissingCells(
          source,
          shiftedRightRectangle,
          Array.from({ length: 25 }, (_, index) => (index === 12 ? 0 : -1)),
          worker,
          true,
        );
        if (gridQuality(shiftedRightGrid) >= 8) {
          grid = shiftedRightGrid;
          rectangle.x = shiftedRightRectangle.x;
          rectangle.width = shiftedRightRectangle.width;
          rectangle.verticalLines = shiftedRightRectangle.verticalLines;
          rectangle.horizontalLines = shiftedRightRectangle.horizontalLines;
        }
      }
    }
    if (likelyNumberSheetPage && gridQuality(grid) < 8) {
      const inferredForm = inferNumberSheetForm(grid);
      if (
        inferredForm &&
        await matchesNumberSheetSignature(
          source,
          rectangle,
          grid,
          inferredForm,
          worker,
        )
      ) {
        const numberSheetGrid = await recognizeMissingNumberSheetCells(
          source,
          rectangle,
          grid,
          inferredForm,
          worker,
        );
        if (isPlausibleNumberSheetGrid(numberSheetGrid, inferredForm)) {
          grid = numberSheetGrid;
          detectedSerial = `Forma #${inferredForm}`;
        }
      }
    }
    if (
      gridQuality(grid) < 8 &&
      isFourCardPortraitSheet &&
      !numberSheetFormForGrid(grid)
    ) {
      const sparseGrid = await recognizeSparseGrid(source, rectangle, worker);
      if (sparseGrid) {
        const sparseForm = numberSheetFormForGrid(sparseGrid);
        if (sparseForm) {
          grid = await recognizeMissingNumberSheetCells(
            source,
            rectangle,
            normalizeNumberSheetGrid(sparseGrid, sparseForm),
            sparseForm,
            worker,
          );
          detectedSerial = sparseForm === "+" ? "Signo +" : `Forma #${sparseForm}`;
        } else {
          grid = sparseGrid;
          detectedSerial = "Forma detectada";
          detectedImportReview = [
            "Se detectó automáticamente una forma con casillas vacías. Confirma el patrón antes de guardar.",
          ];
        }
      }
    }
    if (gridQuality(grid) < 8 && !detectedSerial && !numberSheetFormForGrid(grid)) {
      const maskedGrid = recoverMaskedGridForReview(source, rectangle, grid);
      if (maskedGrid) {
        grid = maskedGrid;
        const unresolved = grid.filter((value) => value < 0).length;
        detectedSerial = "Forma detectada";
        detectedImportReview = [
          unresolved
            ? `Se detectó una forma nueva con ${unresolved} casilla(s) que debes confirmar.`
            : "Se detectó una forma nueva. Confirma sus casillas antes de guardarla.",
        ];
      }
    }
    if (
      gridQuality(grid) < 8 &&
      !numberSheetFormForGrid(grid) &&
      !detectedSerial
    ) {
      const unresolved = grid.filter((value) => value < 0).length;
      detectedSerial = "Cartón 5×5 · pendiente de revisión";
      detectedImportReview = [
        unresolved
          ? `El cartón fue localizado, pero ${unresolved} casilla(s) no tuvieron una lectura segura. Corrígelas antes de guardar.`
          : "El cartón fue localizado, pero sus columnas necesitan confirmación antes de guardar.",
      ];
    }
    const centerMetadata = await recognizeNumberSheetMetadata(
      source,
      rectangle,
      worker,
    );
    // La indexación directa solo es segura cuando se leyó un identificador
    // para cada cuadrícula. Con una lectura parcial, cardsFromDetectedGrids
    // conserva la posición real y asocia cada lectura por cercanía.
    const positionalIdentifier = [...identifiers].sort((left, right) =>
      Math.abs(left.x - originalPosition.x) + Math.abs(left.y - originalPosition.y) -
      (Math.abs(right.x - originalPosition.x) + Math.abs(right.y - originalPosition.y)),
    )[0];
    const headerIdentifier =
      (isFourCardPortraitSheet ||
        (source.width > source.height && eligibleRectangles.length === 2)) &&
      identifiers.length === eligibleRectangles.length
        ? positionalIdentifier?.value
        : undefined;
    const fallbackIdentifier =
      headerIdentifier ??
      (identifiers.length === 0 ? centerMetadata?.identifier : undefined);
    const recoveredForm = numberSheetFormForGrid(grid);
    if (recoveredForm) {
      grid = normalizeNumberSheetGrid(grid, recoveredForm);
      detectedSerial = recoveredForm === "+" ? "Signo +" : `Forma #${recoveredForm}`;
    }
    const recoveredFamily =
      numberSheetFamily ??
      fallbackIdentifier?.match(/^(\d{5,12})(?:-\d{1,3})?$/)?.[1] ??
      null;
    detected.push({
      grid,
      x: rectangle.x + rectangle.width / 2,
      y: source.height - rectangle.y,
      score: rectangle.score,
      rowIds: [],
      serial: detectedSerial,
      importReview: detectedImportReview,
      // En cartones 5x5 el centro puede contener logotipos, fechas y números
      // promocionales. Si existe al menos una lectura de encabezado, conservar
      // esas posiciones y completar las faltantes por secuencia; solo recurrir
      // al centro cuando no se pudo leer ningún encabezado de la página.
      identifier: fallbackIdentifier ?? (
        recoveredForm && recoveredFamily && numberSheetSuffixByForm[recoveredForm]
          ? `${recoveredFamily}-${numberSheetSuffixByForm[recoveredForm]}`
          : undefined
      ),
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
    (
      (printedPortraitFamily.length === detectedPortraitFamily.length &&
        editDistance(printedPortraitFamily, detectedPortraitFamily) <= 2) ||
      (printedPortraitFamily.length === detectedPortraitFamily.length + 1 &&
        printedPortraitFamily.startsWith(detectedPortraitFamily))
    );
  const portraitFamily =
    source.height > source.width && [4, 6].includes(eligibleRectangles.length)
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

function reviewCardsForUndecodedGrids(
  rectangles: GridRectangle[],
  recognizedCards: BingoCard[],
  fileName: string,
  pageNumber: number,
) {
  const missing = Math.max(0, rectangles.length - recognizedCards.length);
  if (!missing) return [];
  return Array.from({ length: missing }, (_, index): BingoCard => ({
    id: crypto.randomUUID(),
    number: `SIN-ID-${String(pageNumber).padStart(3, "0")}-REV-${index + 1}`,
    serial: "Pendiente de revisión",
    // Se muestra en la vista previa, pero nunca se guarda una lectura
    // incompleta como si fuera un cartón válido.
    grid: Array(25).fill(-1),
    sourceFile: fileName,
    sourcePage: pageNumber,
    status: "active",
  }));
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
      .replace(/[‐‑–—_]/g, "-");
    const suffix = (index % 8) + 1;
    // Cada recorte conserva sus intentos separados; así un teléfono, premio o
    // lectura concatenada más larga no aporta una familia falsa.
    const match = normalized.match(
      new RegExp(`(?:^|\\D)(0\\d{5})\\s*-\\s*${suffix}(?!\\d)`),
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
  const candidates = readings.flatMap((text) => {
    const normalized = text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
    return [...normalized.matchAll(/(?:^|\D)(0\d{5})(?!\d)/g)].map(
      (match) => match[1],
    );
  });
  const vertical = verticalReading.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/\D/g, "");
  const verticalTail = vertical.match(/(0\d{5})$/)?.[1] ?? null;
  if (!candidates.length && verticalTail) return verticalTail;
  const lengths = [...candidates, verticalTail ?? ""]
    .filter(Boolean)
    .map((value) => value.length);
  if (!lengths.length) return null;
  const modalLength = [...new Set(lengths)].sort(
    (a, b) => lengths.filter((value) => value === b).length - lengths.filter((value) => value === a).length,
  )[0];
  const comparable = candidates.filter((value) => value.length === modalLength);
  if (!comparable.length && verticalTail?.length === modalLength) return verticalTail;
  if (!comparable.length) return null;
  const consensus = Array.from({ length: modalLength }, (_, position) => {
    const counts = new Map<string, number>();
    for (const value of comparable) counts.set(value[position], (counts.get(value[position]) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  });
  if (verticalTail?.length === modalLength) {
    for (let index = 0; index < modalLength; index += 1) {
      if (verticalTail[index] === "0" && /[689]/.test(consensus[index])) consensus[index] = "0";
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
  for (const [index, rectangle] of ordered.entries()) {
    const suffix = (index % 8) + 1;
    const variants = [
      {
        // Algunos Sabrositos imprimen el identificador con trazo muy fino.
        // Conservar el color/gris original evita que el umbral lo borre.
        x: 0.3,
        y: 0.4,
        width: 0.4,
        height: 0.12,
        threshold: 175,
        targetHeight: 320,
        binarize: false,
      },
      {
        x: 0.36,
        y: 0.43,
        width: 0.28,
        height: 0.12,
        threshold: 170,
        targetHeight: 220,
      },
      {
        x: 0.36,
        y: 0.43,
        width: 0.28,
        height: 0.12,
        threshold: 205,
        targetHeight: 220,
      },
      {
        x: 0.32,
        y: 0.41,
        width: 0.36,
        height: 0.15,
        threshold: 220,
        targetHeight: 260,
      },
      {
        x: 0.28,
        y: 0.4,
        width: 0.44,
        height: 0.2,
        threshold: 175,
        targetHeight: 320,
      },
    ];
    const attempts: string[] = [];
    for (const variant of variants) {
      const target = makeCanvas(1200, variant.targetHeight);
      if (!target) continue;
      target.context.drawImage(
        source,
        rectangle.x + rectangle.width * variant.x,
        rectangle.y + rectangle.height * variant.y,
        rectangle.width * variant.width,
        rectangle.height * variant.height,
        0,
        0,
        target.canvas.width,
        target.canvas.height,
      );
      if (variant.binarize !== false) {
        binarizeNumbers(target.canvas, target.context, variant.threshold, 90);
      }
      const result = await worker.recognize(target.canvas, {}, { text: true });
      const text = result.data.text ?? "";
      attempts.push(text);
      const normalized = text
        .replace(/[Oo]/g, "0")
        .replace(/[Il|]/g, "1")
        .replace(/\s+/g, "")
        .replace(/[^\d-]/g, "");
      if (new RegExp(`0\\d{5}-?${suffix}(?!\\d)`).test(normalized)) break;
    }
    readings.push(attempts.join("\n"));
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
  return cardsFromDetectedGrids(detected, fileName, pageNumber, identifiers).map(
    (card) => ({ ...card, serial: "Sabrosito" }),
  );
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
  /** Posiciones dentro de una matriz 5×5 cuando la figura conserva huecos. */
  gridIndexes?: number[];
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
      cell(0.101, 0.550, [1, 30], 0.07, 0.045), cell(0.217, 0.550, [16, 45], 0.07, 0.045), cell(0.336, 0.550, [31, 60], 0.07, 0.045), cell(0.427, 0.550, [46, 75], 0.07, 0.045),
      cell(0.161, 0.598, [1, 30], 0.07, 0.045), cell(0.276, 0.598, [16, 45], 0.07, 0.045), cell(0.373, 0.598, [46, 75], 0.07, 0.045),
    ],
  },
  {
    suffix: 6,
    label: "Bom Bom Bum",
    x: 0.75,
    y: 0.60,
    cells: [
      cell(0.560, 0.550, [1, 75], 0.07, 0.045), cell(0.659, 0.550, [1, 75], 0.07, 0.045), cell(0.783, 0.550, [1, 75], 0.07, 0.045), cell(0.907, 0.550, [1, 75], 0.07, 0.045),
      cell(0.560, 0.591, [1, 75], 0.07, 0.045), cell(0.659, 0.591, [1, 75], 0.07, 0.045), cell(0.783, 0.591, [1, 75], 0.07, 0.045), cell(0.907, 0.591, [1, 75], 0.07, 0.045),
    ],
  },
];

// «Hoja de adicional» de Bingo de la Suerte. Sus seis juegos no tienen una
// cuadrícula exterior convencional, por lo que se leen por las posiciones de
// cada cifra, igual que Sabrositos. Las coordenadas se mantienen relativas a
// la página para que funcionen en PDFs escaneados con otra resolución.
const additionalSheetCards: SpecialPageCard[] = [
  {
    suffix: 1,
    label: "Línea",
    x: 0.25,
    y: 0.30,
    gridIndexes: [1, 3, 5, 6, 7, 8, 9, 11, 13, 15, 16, 17, 18, 19, 21, 23],
    cells: [
      cell(0.171, 0.222, [16, 30]), cell(0.337, 0.222, [46, 60]),
      cell(0.087, 0.263, [1, 15]), cell(0.171, 0.263, [16, 30]), cell(0.254, 0.263, [31, 45]), cell(0.337, 0.263, [46, 60]), cell(0.421, 0.263, [61, 75]),
      cell(0.171, 0.307, [16, 30]), cell(0.337, 0.307, [46, 60]),
      cell(0.087, 0.349, [1, 15]), cell(0.171, 0.349, [16, 30]), cell(0.254, 0.349, [31, 45]), cell(0.337, 0.349, [46, 60]), cell(0.421, 0.349, [61, 75]),
      cell(0.171, 0.390, [16, 30]), cell(0.337, 0.390, [46, 60]),
    ],
  },
  {
    suffix: 2,
    label: "Loco",
    x: 0.75,
    y: 0.30,
    cells: [
      cell(0.753, 0.222, [31, 45]),
      cell(0.586, 0.263, [1, 15]), cell(0.667, 0.263, [16, 30]), cell(0.753, 0.263, [31, 45]), cell(0.833, 0.263, [46, 60]), cell(0.915, 0.263, [61, 75]),
      cell(0.753, 0.349, [31, 45]),
      cell(0.667, 0.390, [16, 30]), cell(0.753, 0.390, [31, 45]), cell(0.834, 0.390, [46, 60]),
    ],
  },
  {
    suffix: 3,
    label: "Eche Leche",
    x: 0.25,
    y: 0.60,
    cells: [
      cell(0.092, 0.551, [1, 75], 0.085, 0.07), cell(0.171, 0.551, [1, 75], 0.085, 0.07), cell(0.340, 0.551, [1, 75], 0.085, 0.07), cell(0.421, 0.551, [1, 75], 0.085, 0.07),
      cell(0.129, 0.608, [1, 75], 0.085, 0.07), cell(0.254, 0.608, [1, 75], 0.085, 0.07), cell(0.378, 0.608, [1, 75], 0.085, 0.07),
    ],
  },
  {
    suffix: 4,
    label: "Bom Bom Bum",
    x: 0.75,
    y: 0.60,
    cells: [
      cell(0.585, 0.551), cell(0.667, 0.551), cell(0.831, 0.551), cell(0.916, 0.551),
      cell(0.585, 0.608), cell(0.667, 0.608), cell(0.831, 0.608), cell(0.916, 0.608),
    ],
  },
  {
    suffix: 5,
    label: "Keke Keke",
    x: 0.25,
    y: 0.87,
    cells: [
      cell(0.087, 0.776, [1, 75], 0.10, 0.07, true), cell(0.421, 0.776, [1, 75], 0.10, 0.07, true),
      cell(0.171, 0.851, [1, 75], 0.10, 0.07, true), cell(0.338, 0.851, [1, 75], 0.10, 0.07, true),
      cell(0.087, 0.922, [1, 75], 0.10, 0.07, true), cell(0.421, 0.922, [1, 75], 0.10, 0.07, true),
    ],
  },
  {
    suffix: 6,
    label: "Yapa",
    x: 0.75,
    y: 0.87,
    cells: [
      cell(0.585, 0.776, [1, 30], 0.10, 0.07, true), cell(0.753, 0.776, [16, 60], 0.10, 0.07, true), cell(0.915, 0.776, [46, 75], 0.10, 0.07, true),
      cell(0.585, 0.851, [1, 30], 0.10, 0.07, true), cell(0.753, 0.851, [16, 60], 0.10, 0.07, true), cell(0.915, 0.851, [46, 75], 0.10, 0.07, true),
      cell(0.585, 0.922, [1, 30], 0.10, 0.07, true), cell(0.753, 0.922, [16, 60], 0.10, 0.07, true), cell(0.915, 0.922, [46, 75], 0.10, 0.07, true),
    ],
  },
];

function cardNumberSuffix(card: BingoCard) {
  const suffix = Number(card.number.match(/-(\d+)$/)?.[1]);
  return Number.isInteger(suffix) ? suffix : null;
}

export function specialPageLayoutFromOcrText(
  text: string,
  isPortrait: boolean,
  rectangleCount: number,
  firstTop: number,
) {
  const labelText = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9#]+/g, " ");
  const gorditoLabelCount = ["YAPA", "ECHE", "BOM"].filter((label) =>
    labelText.includes(label),
  ).length;
  const additionalLabelCount = ["LINEA", "LOCO", "ECHE", "BOM", "KEKE", "YAPA"].filter(
    (label) => labelText.includes(label),
  ).length;
  const formaLabelCount = labelText.match(/FORMA/g)?.length ?? 0;
  if (
    isPortrait &&
    labelText.includes("HOJA DE ADICIONAL") &&
    additionalLabelCount >= 4
  ) {
    return "additional" as const;
  }
  // Algunas emisiones incluyen únicamente la Yapa junto a los cuatro cartones
  // clásicos. Basta la etiqueta YAPA y la geometría de la hoja; los otros
  // juegos especiales se validan por sus propias cifras antes de agregarse.
  if (isPortrait && rectangleCount >= 4 && firstTop < 0.32 && gorditoLabelCount >= 1) {
    return "gordito" as const;
  }
  // Línea y Loco son dos diagramas irregulares. El detector puede encontrar
  // sus trazos como una o dos cuadrículas, por lo que su reconocimiento no
  // debe depender de que el conteo de rectángulos sea cero.
  const hasLineTitle = /(?:^|\s)[1I]\s*LINEA\b/.test(labelText);
  // El OCR puede omitir el «1» antes de LOCO, pero el título exclusivo
  // «LLENA EL LOCO» no aparece en el encabezado genérico de otras hojas.
  const hasLocoTitle =
    /(?:^|\s)[1I]\s*LOCO\b/.test(labelText) ||
    labelText.includes("LLENA EL LOCO");
  if (hasLineTitle && hasLocoTitle) {
    return "line-loco" as const;
  }
  if (
    isPortrait &&
    rectangleCount >= 4 &&
    firstTop >= 0.28 &&
    (labelText.includes("KEKE") || formaLabelCount >= 2)
  ) {
    return "number-sheet" as const;
  }
  return null;
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

function importPageLayoutKey(cards: BingoCard[]) {
  const serials = new Set(cards.map((card) => card.serial ?? ""));
  if (serials.has("Yapa")) return "gordito";
  if (
    cards.length > 0 &&
    cards.every((card) => numberSheetFormForGrid(card.grid) !== null)
  ) {
    return "number-sheet";
  }
  if (serials.has("Keke Keke")) return "number-sheet";
  if (serials.has("LÃ­nea") || serials.has("Loco")) return "line-loco";
  if (cards.length === 2 && cards.every((card) => card.grid.length === 25)) {
    return "two-card";
  }
  return `standard-${cards.length}`;
}

function replaceCardFamily(card: BingoCard, family: string) {
  const suffix = card.number.match(/-(\d+)$/)?.[1];
  return suffix ? { ...card, number: `${family}-${suffix}` } : card;
}

function closestFamilyWithInsertedDigit(
  shortFamily: string,
  expectedLength: number,
  references: Array<{ page: number; family: string }>,
  page: number,
) {
  if (shortFamily.length + 1 !== expectedLength || !/^\d+$/.test(shortFamily)) {
    return null;
  }
  const nearestBefore = references
    .filter((reference) => reference.page < page)
    .sort((a, b) => b.page - a.page)[0];
  const nearestAfter = references
    .filter((reference) => reference.page > page)
    .sort((a, b) => a.page - b.page)[0];
  const neighbors = [nearestBefore, nearestAfter].filter(
    (reference): reference is { page: number; family: string } => Boolean(reference),
  );
  if (!neighbors.length) return null;

  const candidates = new Set<string>();
  for (let position = 0; position <= shortFamily.length; position += 1) {
    for (let digit = 0; digit <= 9; digit += 1) {
      const candidate = `${shortFamily.slice(0, position)}${digit}${shortFamily.slice(position)}`;
      if (candidate.length === expectedLength && !candidate.startsWith("0")) {
        candidates.add(candidate);
      }
    }
  }
  const distance = (left: bigint, right: bigint) => left >= right ? left - right : right - left;
  return [...candidates].sort((left, right) => {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    const leftScore = neighbors.reduce(
      (score, neighbor) => score + distance(leftValue, BigInt(neighbor.family)),
      BigInt(0),
    );
    const rightScore = neighbors.reduce(
      (score, neighbor) => score + distance(rightValue, BigInt(neighbor.family)),
      BigInt(0),
    );
    return leftScore < rightScore ? -1 : leftScore > rightScore ? 1 : left.localeCompare(right);
  })[0] ?? null;
}

/**
 * Corrige Ãºnicamente familias OCR incompletas cuando otras hojas del mismo
 * formato aportan evidencia suficiente. No inventa una serie si no existe un
 * vecino confiable y conserva siempre el sufijo impreso de cada juego.
 */
export function reconcilePdfPageFamilies(cards: BingoCard[]) {
  const pageGroups = new Map<number, BingoCard[]>();
  for (const card of cards) {
    const pageCards = pageGroups.get(card.sourcePage) ?? [];
    pageCards.push(card);
    pageGroups.set(card.sourcePage, pageCards);
  }
  const pages = [...pageGroups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, pageCards]) => ({
      page,
      cards: pageCards,
      layout: importPageLayoutKey(pageCards),
      family: familyFromCards(pageCards),
    }));
  const replacements = new Map<number, string>();

  for (const layout of new Set(pages.map((item) => item.layout))) {
    const comparable = pages.filter(
      (item) => item.layout === layout && item.family && layout !== "two-card",
    ) as Array<(typeof pages)[number] & { family: string }>;
    if (comparable.length < 2) continue;
    const lengths = comparable.map((item) => item.family.length);
    const expectedLength = [...new Set(lengths)].sort(
      (a, b) => lengths.filter((length) => length === b).length - lengths.filter((length) => length === a).length,
    )[0];
    const references = comparable
      .filter((item) => item.family.length === expectedLength)
      .map((item) => ({ page: item.page, family: item.family }));
    if (!references.length) continue;
    for (const item of comparable) {
      if (item.family.length === expectedLength) continue;
      const repaired = closestFamilyWithInsertedDigit(
        item.family,
        expectedLength,
        references,
        item.page,
      );
      if (repaired) replacements.set(item.page, repaired);
    }
  }

  return cards.map((card) => {
    const family = replacements.get(card.sourcePage);
    if (!family) return { ...card };
    const repaired = replaceCardFamily(card, family);
    return repaired.number === card.number
      ? repaired
      : addImportReview(
          repaired,
          `La familia “${card.number}” perdió un dígito y se propuso “${repaired.number}”. Confírmala.`,
          card.number,
        );
  });
}

/** Conserva el orden de archivo, pÃ¡gina y posiciÃ³n visual del PDF. */
export function sortCardsByPdfOrder(cards: BingoCard[]) {
  const fileRank = new Map<string, number>();
  const pageRank = new Map<string, number>();
  for (const card of cards) {
    if (!fileRank.has(card.sourceFile)) fileRank.set(card.sourceFile, fileRank.size);
  }
  const pages = new Map<string, BingoCard[]>();
  for (const card of cards) {
    const key = `${card.sourceFile}\u0000${card.sourcePage}`;
    pages.set(key, [...(pages.get(key) ?? []), card]);
  }
  for (const [key, pageCards] of pages) {
    orderCardsByPdfPosition(pageCards).forEach((card, index) => {
      pageRank.set(`${key}\u0000${card.id}`, index);
    });
  }
  return [...cards].sort((left, right) => {
    const leftFile = fileRank.get(left.sourceFile) ?? 0;
    const rightFile = fileRank.get(right.sourceFile) ?? 0;
    if (leftFile !== rightFile) return leftFile - rightFile;
    if (left.sourcePage !== right.sourcePage) return left.sourcePage - right.sourcePage;
    const leftKey = `${left.sourceFile}\u0000${left.sourcePage}\u0000${left.id}`;
    const rightKey = `${right.sourceFile}\u0000${right.sourcePage}\u0000${right.id}`;
    return (pageRank.get(leftKey) ?? 0) - (pageRank.get(rightKey) ?? 0);
  });
}

export function filterEnabledImportGames(cards: BingoCard[]) {
  // Cada figura reconocida pertenece a la partida cargada. No se descartan
  // juegos por su nombre: la página adicional los entrega ya validados.
  return cards;
}

interface RelativeSymbolReading {
  value: number;
  confidence: number;
  digits: number;
  normalizedDistance: number;
  score: number;
}

function readingFromRelativeSymbols(
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
  const values: RelativeSymbolReading[] = [];
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
      const confidence =
        selection.reduce((sum, symbol) => sum + symbol.confidence, 0) /
        selection.length;
      const normalizedDistance =
        Math.abs(center - expectedX) / Math.max(1, boxWidth);
      values.push({
        value,
        confidence,
        digits: digits.length,
        normalizedDistance,
        score: confidence - normalizedDistance * 30 + (length === 2 ? 45 : 0),
      });
    }
  }
  return values.sort((a, b) => b.score - a.score)[0] ?? null;
}

function isReliableTwoDigitSymbol(
  reading: RelativeSymbolReading | null,
): reading is RelativeSymbolReading {
  return Boolean(
    reading &&
      reading.digits === 2 &&
      reading.value >= 10 &&
      reading.confidence >= 85 &&
      reading.normalizedDistance <= 0.3,
  );
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
  // En hojas escaneadas con marca de agua la tinta diagonal suele entrar por
  // los bordes de una casilla. Para los formatos especiales se empieza por
  // el centro, donde está el número impreso, antes de ampliar la lectura.
  const edgeInset = position.preferSymbols ? 0.10 : 0;
  const left = Math.max(
    0,
    (position.x - position.width / 2 + position.width * edgeInset) * source.width,
  );
  const top = Math.max(
    0,
    (position.y - position.height / 2 + position.height * edgeInset) * source.height,
  );
  const width = Math.min(
    source.width - left,
    position.width * (1 - edgeInset * 2) * source.width,
  );
  const height = Math.min(
    source.height - top,
    position.height * (1 - edgeInset * 2) * source.height,
  );
  const range = position.range ?? [1, 75];
  const thresholds = position.preferSymbols
    ? [135, 165, 100, 195, 225]
    : [165, 100, 135, 195, 225];
  for (const maxChroma of position.preferSymbols ? [256, 58] : [58]) {
    for (const pageSegMode of ["8", "7"]) {
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: pageSegMode,
        preserve_interword_spaces: "1",
      });
      for (const threshold of thresholds) {
        const target = makeCanvas(400, 300);
        if (!target) continue;
        target.context.drawImage(source, left, top, width, height, 0, 0, 400, 300);
        binarizeNumbers(target.canvas, target.context, threshold, maxChroma);
        const result = await worker.recognize(target.canvas, {}, { text: true });
        const value = valueFromCellText(result.data.text ?? "", range);
        if (value !== null) return value;
      }
    }
  }
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
    for (const threshold of thresholds) {
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
      if (value !== null) return value;
    }
  }
  return null;
}

function validSpecialLayoutValues(
  layout: SpecialPageCard,
  values: number[],
) {
  return (
    values.length === layout.cells.length &&
    values.every((value, index) => {
      const [minimum, maximum] = layout.cells[index].range ?? [1, 75];
      return value >= minimum && value <= maximum;
    }) &&
    new Set(values).size === values.length &&
    (layout.label !== "Yapa" || validYapaGrid(values))
  );
}

async function recognizeSpecialLayoutCrop(
  source: HTMLCanvasElement,
  layout: SpecialPageCard,
  worker: OcrWorker,
) {
  const left = Math.max(
    0,
    Math.min(...layout.cells.map((position) => position.x - position.width / 2)) - 0.02,
  );
  const right = Math.min(
    1,
    Math.max(...layout.cells.map((position) => position.x + position.width / 2)) + 0.02,
  );
  const top = Math.max(
    0,
    Math.min(...layout.cells.map((position) => position.y - position.height / 2)) - 0.02,
  );
  const bottom = Math.min(
    1,
    Math.max(...layout.cells.map((position) => position.y + position.height / 2)) + 0.02,
  );
  const normalizedWidth = right - left;
  const normalizedHeight = bottom - top;
  const targetWidth = 1400;
  const targetHeight = Math.max(
    300,
    Math.round(targetWidth * normalizedHeight / normalizedWidth),
  );
  const relativePositions = layout.cells.map((position) => ({
    ...position,
    x: (position.x - left) / normalizedWidth,
    y: (position.y - top) / normalizedHeight,
    width: position.width / normalizedWidth,
    height: position.height / normalizedHeight,
  }));
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  const thresholds = (layout.cells.some((position) => position.preferSymbols) ||
    ["Línea", "Loco", "Eche Leche", "Bom Bom Bum"].includes(layout.label))
    ? [135, 165, 100]
    : [165, 135];
  for (const threshold of thresholds) {
    const target = makeCanvas(targetWidth, targetHeight);
    if (!target) continue;
    target.context.drawImage(
      source,
      left * source.width,
      top * source.height,
      normalizedWidth * source.width,
      normalizedHeight * source.height,
      0,
      0,
      target.canvas.width,
      target.canvas.height,
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
    const values = relativePositions.map((position) =>
      readingFromRelativeSymbols(
        symbols,
        target.canvas.width,
        target.canvas.height,
        position,
      )?.value ?? -1,
    );
    if (validSpecialLayoutValues(layout, values)) return values;
  }
  return null;
}

function familyFromCards(cards: BingoCard[]) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const match = card.number.match(/^(\d{5,12})-\d{1,3}$/);
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function gameFamilyFromOcrText(text: string) {
  // En Línea, Loco y Keke el número maestro aparece como "JUEGO #12345".
  // Se prioriza sobre teléfonos o anuncios que el OCR también puede leer.
  const match = text.match(/JUEGO\s*#?\s*([\d\s]{4,20})/i)?.[1];
  const digits = match?.replace(/\D/g, "") ?? "";
  return /^\d{4,12}$/.test(digits) ? digits : null;
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

async function recognizeKnownNumberSheetGrid(
  source: HTMLCanvasElement,
  rectangle: GridRectangle,
  form: NumberSheetForm,
  worker: OcrWorker,
) {
  const grid = Array(25).fill(0);
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "8",
    preserve_interword_spaces: "1",
  });
  const requiredCells = form === "9"
    ? [19, ...NUMBER_SHEET_FORM_CELLS[form].filter((index) => index !== 19)]
    : NUMBER_SHEET_FORM_CELLS[form];
  for (const index of requiredCells) {
    const row = Math.floor(index / 5);
    const column = index % 5;
    const left = rectangle.verticalLines[column] + 5;
    const top = rectangle.horizontalLines[row] + 5;
    const width = Math.max(1, rectangle.verticalLines[column + 1] - left - 5);
    const height = Math.max(1, rectangle.horizontalLines[row + 1] - top - 5);
    const readings = new Map<number, number>();
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
      const result = await worker.recognize(target.canvas, {}, { text: true });
      const value = valueFromCellText(
        result.data.text ?? "",
        bingoColumnRanges[column],
      );
      if (value !== null) {
        readings.set(value, (readings.get(value) ?? 0) + 1);
      }
    }
    if (!readings.size) {
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: "7",
        preserve_interword_spaces: "1",
      });
      for (const threshold of [135, 180, 215]) {
        const target = makeCanvas(420, 280);
        if (!target) continue;
        target.context.drawImage(
          source,
          left + width * 0.12,
          top + height * 0.12,
          width * 0.76,
          height * 0.76,
          15,
          15,
          390,
          250,
        );
        binarizeNumbers(target.canvas, target.context, threshold);
        const result = await worker.recognize(target.canvas, {}, { text: true });
        const value = valueFromCellText(
          result.data.text ?? "",
          bingoColumnRanges[column],
        );
        if (value !== null) {
          readings.set(value, (readings.get(value) ?? 0) + 1);
        }
      }
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: "8",
        preserve_interword_spaces: "1",
      });
    }
    const value = [...readings.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    grid[index] = value ?? -1;
  }
  return grid;
}

async function recognizeKnownNumberSheetCards(
  source: HTMLCanvasElement,
  rectangles: GridRectangle[],
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
  family: string | null,
) {
  const ordered = [...rectangles].sort((a, b) => a.y - b.y || a.x - b.x);
  if (ordered.length !== 4) return [];
  const forms: NumberSheetForm[] = ["1", "3", "5", "9"];
  const suffixes = [3, 4, 5, 6];
  const cards: BingoCard[] = [];
  for (const [index, rectangle] of ordered.entries()) {
    const form = forms[index];
    // El detector conserva la fila B-I-N-G-O como la primera franja. Para
    // las formas 1-3-5-9 esa franja es encabezado, no una fila de números.
    // Desplazamos las líneas una posición y añadimos el borde inferior real.
    const nextLine = rectangle.nextHorizontalLine;
    const bottomDataLines = nextLine
      ? [
        ...rectangle.horizontalLines.slice(2),
        nextLine,
        // En la fila inferior, el detector se engancha con el borde de la
        // forma superior. El último borde se calcula desde el espaciado de
        // filas ya detectado, sin fabricar cifras ni identificadores.
        nextLine + (nextLine - rectangle.horizontalLines.at(-1)!),
      ]
      : null;
    const dataLines = index < 2
      ? nextLine
        ? [...rectangle.horizontalLines.slice(1), nextLine]
        : null
      : bottomDataLines;
    const dataRectangle = dataLines && dataLines.length === 6
      ? {
        ...rectangle,
        y: dataLines[0],
        height: dataLines[5] - dataLines[0],
        horizontalLines: dataLines,
      }
      : rectangle;
    const grid = await recognizeKnownNumberSheetGrid(
      source,
      dataRectangle,
      form,
      worker,
    );
    // Cada forma tiene posiciones vacías impresas. La validación comprueba
    // únicamente sus casillas obligatorias y el rango B-I-N-G-O de cada una.
    if (!isPlausibleNumberSheetGrid(grid, form)) {
      // Se conserva la forma, el identificador impreso y toda cifra que sí
      // pasó la validación. La única celda dudosa queda visible para edición
      // en la revisión previa; así nunca se omite ni se inventa un cartón.
      cards.push({
        id: crypto.randomUUID(),
        number: family
          ? `${family}-${suffixes[index]}`
          : `SIN-ID-${String(pageNumber).padStart(3, "0")}-${suffixes[index]}`,
        serial: `Forma #${form} · pendiente de revisión`,
        grid,
        sourceFile: fileName,
        sourcePage: pageNumber,
        status: "active",
      });
      continue;
    }
    cards.push({
      id: crypto.randomUUID(),
      number: family
        ? `${family}-${suffixes[index]}`
        : `SIN-ID-${String(pageNumber).padStart(3, "0")}-${suffixes[index]}`,
      serial: `Forma #${form}`,
      grid,
      sourceFile: fileName,
      sourcePage: pageNumber,
      status: "active",
    });
  }
  return cards;
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
  const mayContainSpecialCards =
    // Línea/Loco puede dejar solo dos rectángulos detectables; la validación
    // posterior por etiquetas y cifras impide confundirlo con una hoja común.
    (isPortrait && ordered.length >= 2) ||
    ordered.length === 0;
  if (!mayContainSpecialCards) return [];

  await worker.setParameters({
    tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#-_ ",
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "1",
  });
  const result = await worker.recognize(
    source,
    {},
    { blocks: true, text: true },
  );
  const specialLayout = specialPageLayoutFromOcrText(
    result.data.text ?? "",
    isPortrait,
    ordered.length,
    firstTop,
  );
  if (specialLayout === "line-loco") {
    detectedCards.splice(0, detectedCards.length);
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789",
      tessedit_pageseg_mode: "11",
      preserve_interword_spaces: "1",
    });
    return [];
  }
  const yapaLayouts = gorditoSpecialCards.filter((layout) => layout.label === "Yapa");
  // La geometría de una hoja común también puede contener nueve cifras
  // promocionales en la zona superior. Solo se crea una Yapa cuando el OCR
  // encontró su etiqueta, evitando fabricar un juego a partir del membrete.
  const layouts = specialLayout === "additional"
    ? additionalSheetCards
    : specialLayout === "gordito"
      ? yapaLayouts
      : [];
  if (!layouts.length && specialLayout !== "number-sheet") {
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789",
      tessedit_pageseg_mode: "11",
      preserve_interword_spaces: "1",
    });
    return [];
  }
  const symbols = result.data.blocks?.length
    ? flattenOcrSymbols(ocrWords(result.data.blocks))
    : [];
  const family = familyFromCards(detectedCards) ??
    gameFamilyFromOcrText(result.data.text ?? "") ??
    identifierFamilyFromOcrText(result.data.text ?? "");
  const hasCompleteNumberSheet =
    detectedCards.filter((card) => numberSheetFormForGrid(card.grid) !== null).length === 4;
  const numberSheetCards = specialLayout === "number-sheet" && !hasCompleteNumberSheet
    ? await recognizeKnownNumberSheetCards(
      source,
      rectangles,
      worker,
      fileName,
      pageNumber,
      family,
    )
    : [];
  const cards: BingoCard[] = [];
  for (const layout of layouts) {
    const directValues = (specialLayout === "additional"
      ? null
      : await recognizeSpecialLayoutCrop(
        source,
        layout,
        worker,
      )) ?? (layout.label === "Yapa" && specialLayout !== "additional"
      ? await recognizeYapaGridCrop(source, worker)
      : null);
    let values: number[] = directValues ? [...directValues] : [];
    const candidates: number[][] = [];
    const positions = directValues ? [] : layout.cells;
    for (const position of positions) {
      const ocrPosition = specialLayout === "additional"
        ? { ...position, preferSymbols: true }
        : position;
      const symbolReading = readingFromRelativeSymbols(
        symbols,
        source.width,
        source.height,
        ocrPosition,
      );
      const symbolValue = symbolReading?.value ?? null;
      const croppedValue = isReliableTwoDigitSymbol(symbolReading)
        ? symbolReading.value
        : await recognizeRelativeCell(source, ocrPosition, worker);
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
      new Set(values).size !== values.length ||
      (layout.label === "Yapa" && !validYapaGrid(values))
    ) {
      continue;
    }
    const grid = layout.gridIndexes
      ? Array.from({ length: 25 }, (_, index) => {
        const valueIndex = layout.gridIndexes!.indexOf(index);
        return valueIndex === -1 ? 0 : values[valueIndex];
      })
      : values;
    cards.push({
      id: crypto.randomUUID(),
      number: family
        ? `${family}-${layout.suffix}`
        : `SIN-ID-${String(pageNumber).padStart(3, "0")}-${layout.suffix}`,
      serial: layout.label,
      grid,
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
  return [...cards, ...numberSheetCards];
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
  const sparseOuterRectangles = detectSparseOuterGridRectangles(
    pixels.data,
    canvas.width,
    canvas.height,
  );
  if (sparseOuterRectangles.length > rectangles.length) {
    rectangles = sparseOuterRectangles;
  }
  let detectedCards: BingoCard[] = [];
  if (rectangles.length) {
    detectedCards = await recognizeDetectedGrids(
      canvas,
      rectangles,
      worker,
      fileName,
      pageNumber,
    );
    detectedCards = [
      ...detectedCards,
      ...reviewCardsForUndecodedGrids(
        rectangles,
        detectedCards,
        fileName,
        pageNumber,
      ),
    ];
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
    const hasRecoveredNumberSheet =
      specialCards.some((card) => card.serial?.startsWith("Forma #"));
    // Si las cuatro formas se recuperaron con la geometría impresa, los
    // marcadores "Pendiente" del primer OCR son sustituidos, no duplicados.
    const primaryCards = hasRecoveredNumberSheet
      ? detectedCards.filter((card) => !needsImportReview(card))
      : detectedCards;
    return orderCardsByPdfPosition([...primaryCards, ...specialCards]);
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

function rotatedCanvas(source: HTMLCanvasElement, degrees: number) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const width = Math.ceil(source.width * cosine + source.height * sine);
  const height = Math.ceil(source.width * sine + source.height * cosine);
  const target = makeCanvas(width, height);
  if (!target) return null;
  target.context.fillStyle = "#ffffff";
  target.context.fillRect(0, 0, width, height);
  target.context.translate(width / 2, height / 2);
  target.context.rotate(radians);
  target.context.drawImage(source, -source.width / 2, -source.height / 2);
  return target.canvas;
}

function canvasGridDetectionScore(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 0;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const grids = detectGridRectangles(pixels.data, canvas.width, canvas.height);
  if (grids.length) {
    return grids.length * 10_000 + grids.reduce((sum, grid) => sum + grid.score, 0);
  }
  const compact = detectCompactRectangles(pixels.data, canvas.width, canvas.height);
  return compact.length * 2_000 + compact.reduce((sum, card) => sum + card.score, 0);
}

function deskewCanvasForImport(source: HTMLCanvasElement) {
  const initialScore = canvasGridDetectionScore(source);
  if (initialScore > 0) return source;
  let best = source;
  let bestScore = initialScore;
  // Esta ruta solo se ejecuta cuando la imagen original no contiene ninguna
  // cuadrícula detectable. Corrige fotografías ligeramente inclinadas sin
  // multiplicar el tiempo normal de importación.
  for (const degrees of [-4, -2, 2, 4]) {
    const candidate = rotatedCanvas(source, degrees);
    if (!candidate) continue;
    const score = canvasGridDetectionScore(candidate);
    if (score > bestScore) {
      if (best !== source) best.width = best.height = 0;
      best = candidate;
      bestScore = score;
    } else {
      candidate.width = candidate.height = 0;
    }
  }
  return best;
}

export async function runOcr(
  pageProxy: import("pdfjs-dist").PDFPageProxy,
  worker: OcrWorker,
  fileName: string,
  pageNumber: number,
  renderLongEdge = 2300,
  textCards: BingoCard[] = [],
): Promise<BingoCard[]> {
  const baseViewport = pageProxy.getViewport({ scale: 1 });
  const scale = pdfRenderScale(baseViewport.width, baseViewport.height, renderLongEdge);
  const viewport = pageProxy.getViewport({ scale });
  const target = makeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  if (!target) return [];
  let aligned = target.canvas;
  try {
    await pageProxy.render({ canvas: target.canvas, canvasContext: target.context, viewport }).promise;
    aligned = deskewCanvasForImport(target.canvas);
    const ctx = aligned.getContext("2d", { willReadFrequently: true });
    if (ctx && textCards.length && textCards.every((card) => !needsImportReview(card))) {
      const pixels = ctx.getImageData(0, 0, aligned.width, aligned.height);
      const grids = detectGridRectangles(pixels.data, aligned.width, aligned.height);
      // Do not stop after just one text card: verify the visible page layout.
      if (grids.length === textCards.length && grids.length > 0 && textCards.every((card) => card.grid.length === 25)) return textCards;
    }
    return await runOcrCanvas(aligned, worker, fileName, pageNumber);
  } finally {
    if (aligned !== target.canvas) aligned.width = aligned.height = 0;
    target.canvas.width = target.canvas.height = 0;
  }
}

/** PDF page sizes are points, not pixels. Large scanner MediaBoxes must downscale. */
export function pdfRenderScale(width: number, height: number, longEdge = 2450) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error("Dimensiones de página inválidas.");
  return Math.min(4, longEdge / Math.max(width, height));
}

export function recommendedOcrConcurrency(
  pageCount: number,
  hardwareThreads: number,
  deviceMemoryGb: number,
  mobileDevice: boolean,
) {
  if (pageCount < 4 || hardwareThreads < 4 || deviceMemoryGb < 4) return 1;
  if (mobileDevice) return hardwareThreads >= 6 && deviceMemoryGb >= 6 ? 2 : 1;
  if (hardwareThreads >= 8 && deviceMemoryGb >= 8) return 3;
  return 2;
}

function imageExtension(fileName: string) {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

const MAX_IMPORT_FILE_BYTES = 150 * 1024 * 1024;

function startsWithBytes(bytes: Uint8Array, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value);
}

export async function validateBingoImportFileContent(file: File) {
  if (!file.size) throw new Error("El archivo está vacío.");
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("El archivo supera 150 MB. Divídelo en archivos más pequeños para cuidar la memoria del dispositivo.");
  }
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const extension = imageExtension(file.name);
  const pdf = startsWithBytes(header, [0x25, 0x50, 0x44, 0x46]);
  if (file.type === "application/pdf" || extension === "pdf") {
    if (!pdf) throw new Error("El archivo no contiene un PDF válido.");
    return "pdf" as const;
  }
  const png = startsWithBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = startsWithBytes(header, [0xff, 0xd8, 0xff]);
  const gif = startsWithBytes(header, [0x47, 0x49, 0x46, 0x38]);
  const bmp = startsWithBytes(header, [0x42, 0x4d]);
  const webp = startsWithBytes(header, [0x52, 0x49, 0x46, 0x46]) &&
    String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  const heifBrand = String.fromCharCode(...header.slice(8, 12)).toLowerCase();
  const heif =
    String.fromCharCode(...header.slice(4, 8)) === "ftyp" &&
    ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif", "avis"].includes(heifBrand);
  if (!(png || jpeg || gif || bmp || webp || heif)) {
    throw new Error("El archivo no contiene una imagen compatible válida.");
  }
  return "image" as const;
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
  let release: () => void = () => undefined;
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
  return deskewCanvasForImport(target.canvas);
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
      const cardIndex = start + offset;
      resolved[cardIndex] = addImportReview(
        { ...resolved[cardIndex], number: candidate },
        "La numeración no fue legible y se completó con la secuencia vecina. Confírmala.",
      );
      used.add(candidate.toLowerCase());
    }
  }
  return resolved;
}

export function ensureUniqueImportIdentifiers(
  cards: BingoCard[],
  existingCardNumbers: Iterable<string> = [],
) {
  const existing = [...existingCardNumbers]
    .map((number) => number.trim())
    .filter(Boolean);
  const occupied = new Set(existing.map((number) => number.toLowerCase()));
  const reserved = [...existing, ...cards.map((card) => card.number.trim())];
  const nextByPrefix = new Map<string, { value: number; width: number }>();

  for (const number of reserved) {
    const parts = sequentialNumberParts(number);
    if (!parts) continue;
    const key = parts.prefix.toLowerCase();
    const current = nextByPrefix.get(key);
    if (!current || parts.value > current.value) {
      nextByPrefix.set(key, { value: parts.value, width: parts.width });
    }
  }

  const usedIds = new Set<string>();
  let adjustedNumbers = 0;
  let adjustedIds = 0;
  const resolved = cards.map((card) => {
    let id = card.id;
    if (!id || usedIds.has(id)) {
      id = crypto.randomUUID();
      adjustedIds += 1;
    }
    usedIds.add(id);

    const original = card.number.trim();
    if (original && !occupied.has(original.toLowerCase())) {
      occupied.add(original.toLowerCase());
      return { ...card, id, number: original };
    }

    const parts = sequentialNumberParts(original);
    let candidate = "";
    if (parts) {
      const key = parts.prefix.toLowerCase();
      const sequence = nextByPrefix.get(key) ?? {
        value: parts.value,
        width: parts.width,
      };
      do {
        sequence.value += 1;
        candidate = `${parts.prefix}${String(sequence.value).padStart(sequence.width, "0")}`;
      } while (occupied.has(candidate.toLowerCase()));
      nextByPrefix.set(key, sequence);
    } else {
      const base = original || fallbackNumberFromPdf(card, adjustedNumbers);
      let suffix = 2;
      candidate = base;
      while (occupied.has(candidate.toLowerCase())) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
      }
    }
    occupied.add(candidate.toLowerCase());
    adjustedNumbers += 1;
    return addImportReview(
      { ...card, id, number: candidate },
      `El identificador detectado “${original || "sin número"}” estaba repetido y se propuso “${candidate}”. Confírmalo.`,
      original || undefined,
    );
  });

  return { cards: resolved, adjustedNumbers, adjustedIds };
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
  return cards.map((card) => {
    const number = replacements.get(card) ?? card.number;
    return number === card.number
      ? { ...card }
      : addImportReview(
          { ...card, number },
          `La lectura “${card.number}” se ajustó a la secuencia de hojas dobles como “${number}”. Confírmala.`,
          card.number,
        );
  });
}

export function reconcilePlainSequentialCardNumbers(cards: BingoCard[]) {
  const plainCards = cards.flatMap((card, cardIndex) => {
    const match = card.number.trim().match(/^#?(\d{5,12})$/);
    if (!match) return [];
    return [{ cardIndex, digits: match[1] }];
  });
  if (plainCards.length < 3) return cards.map((card) => ({ ...card }));

  const detected = plainCards.flatMap((card, index) => {
    const value = BigInt(card.digits);
    const base = value - BigInt(index);
    return base >= 0n ? [{ base, width: card.digits.length }] : [];
  });
  if (detected.length < Math.ceil(plainCards.length * 0.6)) {
    return cards.map((card) => ({ ...card }));
  }

  const votes = new Map<string, { count: number; base: bigint; width: number }>();
  for (const item of detected) {
    const key = `${item.width}:${item.base}`;
    const current = votes.get(key);
    votes.set(key, { ...item, count: (current?.count ?? 0) + 1 });
  }
  const winner = [...votes.values()].sort((a, b) => b.count - a.count)[0];
  if (!winner || winner.count < Math.max(3, Math.ceil(detected.length * 0.5))) {
    // Sin una mayoría clara se conserva exactamente lo impreso. La antigua
    // estimación por mediana podía convertir una lectura válida en otra.
    return cards.map((card) => ({ ...card }));
  }

  const replacements = new Map(
    plainCards.map((card, index) => [
      card.cardIndex,
      String(winner.base + BigInt(index)).padStart(winner.width, "0"),
    ]),
  );
  return cards.map((card, index) => {
    const number = replacements.get(index) ?? card.number;
    return number === card.number
      ? { ...card }
      : addImportReview(
          { ...card, number },
          `La lectura “${card.number}” rompía una secuencia confirmada y se propuso “${number}”. Confírmala.`,
          card.number,
        );
  });
}

function numericCardIdentifier(number: string) {
  const match = number.trim().match(/^#?(\d{5,12})(?:-([1-4]))?$/);
  return match ? { digits: match[1], suffix: match[2] ? Number(match[2]) : null } : null;
}

function identifierDeletionVariants(value: string) {
  const variants = new Set([value]);
  for (let first = 0; first < value.length; first += 1) {
    variants.add(value.slice(0, first) + value.slice(first + 1));
    for (let second = first + 1; second < value.length; second += 1) {
      variants.add(
        value.slice(0, first) +
        value.slice(first + 1, second) +
        value.slice(second + 1),
      );
    }
  }
  return [...variants].filter((candidate) => candidate.length >= 5);
}

function withoutIdentifierReview(reasons: string[] | undefined) {
  const remaining = (reasons ?? []).filter(
    (reason) => !/(numeraci[oó]n|identificador|secuencia|familia|sin n[uú]mero)/i.test(reason),
  );
  return remaining.length ? remaining : undefined;
}

function reconcileSinglePagePositionSequence(ordered: BingoCard[]) {
  const observations = ordered.map((card) => numericCardIdentifier(card.number)?.digits ?? null);
  if (observations.filter(Boolean).length < 2) return null;
  const candidates = new Map<string, { base: bigint; width: number }>();
  observations.forEach((digits, index) => {
    if (!digits) return;
    for (const variant of identifierDeletionVariants(digits)) {
      const base = BigInt(variant) - BigInt(index);
      if (base >= 0n) candidates.set(`${variant.length}:${base}`, { base, width: variant.length });
    }
  });
  const ranked = [...candidates.values()].map((candidate) => {
    let exact = 0;
    let close = 0;
    let cost = 0;
    observations.forEach((digits, index) => {
      if (!digits) return;
      const expected = String(candidate.base + BigInt(index)).padStart(candidate.width, "0");
      const distance = editDistance(expected, digits);
      if (distance === 0) exact += 1;
      if (distance <= 1) close += 1;
      cost += Math.min(distance, 5);
    });
    return { ...candidate, exact, close, cost };
  }).sort((a, b) => b.exact - a.exact || b.close - a.close || a.cost - b.cost);
  const winner = ranked[0];
  if (!winner || winner.exact < 1 || winner.close < 2) return null;
  return ordered.map((_, index) =>
    `${String(winner.base + BigInt(index)).padStart(winner.width, "0")}-${index + 1}`,
  );
}

/**
 * Normaliza cada hoja de cuatro cartones con sufijos posicionales -1…-4.
 * Para proveedores que imprimen una secuencia distinta en cada cartón, usa
 * todas las hojas vecinas del mismo bloque visual y descarta lecturas OCR que
 * no encajan con la progresión respaldada por el resto del archivo.
 */
export function reconcileFourCardPositionIdentifiers(cards: BingoCard[]) {
  const resolved = cards.map((card) => ({ ...card }));
  const replacements = new Map<string, BingoCard>();
  const files = new Map<string, Array<{ page: number; cards: BingoCard[]; sparse: boolean }>>();
  const pageGroups = new Map<string, BingoCard[]>();
  for (const card of resolved) {
    const key = `${card.sourceFile}\u0000${card.sourcePage}`;
    pageGroups.set(key, [...(pageGroups.get(key) ?? []), card]);
  }
  for (const [key, pageCards] of pageGroups) {
    if (pageCards.length !== 4) continue;
    const split = key.lastIndexOf("\u0000");
    const file = key.slice(0, split);
    const page = Number(key.slice(split + 1));
    const ordered = orderCardsByPdfPosition(pageCards);
    const sparse = ordered.filter((card) => card.grid.filter((value) => value > 0).length <= 16).length >= 2;

    // Formato clásico: una familia compartida y sufijos impresos 1–4.
    const familyVotes = new Map<string, number>();
    ordered.forEach((card, index) => {
      const parsed = numericCardIdentifier(card.number);
      if (parsed?.suffix === index + 1) {
        familyVotes.set(parsed.digits, (familyVotes.get(parsed.digits) ?? 0) + 1);
      }
    });
    const family = [...familyVotes.entries()].sort((a, b) => b[1] - a[1])[0];
    const positionalFamily = reconcilePositionalIdentifierFamily(
      ordered.map((card) => card.number),
    );
    const normalizedFamily = positionalFamily.every((number, index) =>
      number.endsWith(`-${index + 1}`),
    ) && positionalFamily.some((number, index) => number !== ordered[index].number)
      ? positionalFamily[0].replace(/-1$/, "")
      : null;
    const selectedFamily = family && family[1] >= 2 ? family[0] : normalizedFamily;
    if (selectedFamily) {
      ordered.forEach((card, index) => {
        const number = `${selectedFamily}-${index + 1}`;
        replacements.set(card.id, {
          ...card,
          number,
          printedNumber: number === card.number ? card.printedNumber : card.number,
          importReview: withoutIdentifierReview(card.importReview),
        });
      });
      continue;
    }
    const positionalSequence = reconcileSinglePagePositionSequence(ordered);
    if (positionalSequence) {
      ordered.forEach((card, index) => {
        const number = positionalSequence[index];
        replacements.set(card.id, {
          ...card,
          number,
          printedNumber: number === card.number ? card.printedNumber : card.number,
          importReview: withoutIdentifierReview(card.importReview),
        });
      });
      continue;
    }
    const pages = files.get(file) ?? [];
    pages.push({ page, cards: ordered, sparse });
    files.set(file, pages);
  }

  for (const pages of files.values()) {
    const orderedPages = [...pages].sort((a, b) => a.page - b.page);
    const segments: typeof orderedPages[] = [];
    for (const page of orderedPages) {
      const current = segments.at(-1);
      if (!current || current.at(-1)!.sparse !== page.sparse || current.at(-1)!.page + 1 !== page.page) {
        segments.push([page]);
      } else {
        current.push(page);
      }
    }
    for (const segment of segments) {
      const segmentCards = segment.flatMap((item) => item.cards);
      if (segmentCards.length < 8) continue;
      const observations = segmentCards.map((card) => numericCardIdentifier(card.number)?.digits ?? null);
      const candidateMap = new Map<string, { base: bigint; width: number }>();
      observations.forEach((digits, index) => {
        if (!digits) return;
        for (const variant of identifierDeletionVariants(digits)) {
          const base = BigInt(variant) - BigInt(index);
          if (base < 0n) continue;
          candidateMap.set(`${variant.length}:${base}`, { base, width: variant.length });
        }
      });
      const ranked = [...candidateMap.values()].map((candidate) => {
        let exact = 0;
        let close = 0;
        let support = 0;
        let cost = 0;
        observations.forEach((digits, index) => {
          if (!digits) return;
          const expected = String(candidate.base + BigInt(index)).padStart(candidate.width, "0");
          const distance = editDistance(expected, digits);
          if (distance === 0) exact += 1;
          if (distance <= 1) close += 1;
          if (distance <= 2) support += 1;
          cost += Math.min(distance, 5);
        });
        return { ...candidate, exact, close, support, cost };
      }).sort((a, b) =>
        b.exact - a.exact || b.close - a.close || b.support - a.support || a.cost - b.cost,
      );
      const winner = ranked[0];
      const observedCount = observations.filter(Boolean).length;
      const strong = winner && winner.exact >= 2 && (
        winner.close >= Math.ceil(observedCount * 0.3) ||
        winner.support >= Math.ceil(observedCount * 0.55)
      );
      if (!strong) continue;
      segmentCards.forEach((card, index) => {
        const printed = String(winner.base + BigInt(index)).padStart(winner.width, "0");
        const position = index % 4 + 1;
        const number = `${printed}-${position}`;
        replacements.set(card.id, {
          ...card,
          number,
          printedNumber: number === card.number ? card.printedNumber : card.number,
          importReview: withoutIdentifierReview(card.importReview),
        });
      });
    }
  }
  return resolved.map((card) => replacements.get(card.id) ?? card);
}

export async function parseBingoPdf(
  file: File,
  onProgress: (progress: PdfParseProgress) => void,
  options: BingoImportOptions = {},
): Promise<PdfParseResult> {
  const provider = options.provider ?? "auto";
  const providerStrategy = importProviderStrategy(provider);
  const pdfModuleUrl = String.fromCharCode(
    47, 112, 100, 102, 106, 115, 47, 112, 100, 102, 46, 109, 106, 115,
  );
  const pdfjs = (await import(
    /* @vite-ignore */ pdfModuleUrl
  )) as typeof import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
  }).promise;
  const pageCount = pdf.numPages;
  const pageResults: Array<PdfParseResult | undefined> = new Array(pageCount);
  const browserNavigator = typeof navigator === "undefined" ? null : navigator;
  const hardwareThreads = browserNavigator?.hardwareConcurrency ?? 2;
  const deviceMemoryGb =
    (browserNavigator as (Navigator & { deviceMemory?: number }) | null)
      ?.deviceMemory ?? 4;
  const mobileDevice = browserNavigator
    ? /Android|iPhone|iPad|iPod/i.test(browserNavigator.userAgent)
    : false;
  const concurrency = recommendedOcrConcurrency(
    pageCount,
    hardwareThreads,
    deviceMemoryGb,
    mobileDevice,
  );
  let nextPage = 1;
  let completedPages = 0;

  try {
    const processPages = async () => {
      let ocrWorker: OcrWorker | null = null;
      try {
        while (nextPage <= pageCount && !options.signal?.aborted) {
          const pageNumber = nextPage;
          nextPage += 1;
          const pageWarnings: string[] = [];
          onProgress({
            page: pageNumber,
            pages: pageCount,
            stage: "Leyendo texto",
            percent: Math.round((completedPages / pageCount) * 100),
          });
          let page: import("pdfjs-dist").PDFPageProxy | null = null;
          let pageCards: BingoCard[] = [];
          try {
            page = await pdf.getPage(pageNumber);
            const text = await page.getTextContent().catch(() => ({ items: [] }));
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
            const textCards = extractCardsFromTextItems(items, file.name, pageNumber);
            pageCards = textCards;

            if (shouldRunProviderOcr(provider, textCards.length)) {
              onProgress({
                page: pageNumber,
                pages: pageCount,
                stage: "Aplicando OCR",
                percent: Math.round(((completedPages + 0.5) / pageCount) * 100),
              });
              try {
                ocrWorker ??= await createOcrWorker();
                const ocrCards = await runOcr(
                  page,
                  ocrWorker,
                  file.name,
                  pageNumber,
                  providerStrategy.renderLongEdge,
                  textCards,
                );
                pageCards = selectProviderPageCards(textCards, ocrCards);
              } catch (error) {
                // A failed worker is not reused for the remaining 99 pages.
                await ocrWorker?.terminate().catch(() => undefined);
                ocrWorker = null;
                pageWarnings.push(
                  `Página ${pageNumber}: el OCR no pudo completarse (${error instanceof Error ? error.message : "error desconocido"}).`,
                );
              }
            }

            if (!pageCards.length) {
              pageWarnings.push(
                `Página ${pageNumber}: no se encontró un cartón de bingo válido. Puedes crearlo con “Ingreso manual”.`,
              );
            }
            pageCards = assignSequentialCardNumbers(
              reconcilePlainSequentialCardNumbers(pageCards),
            );
            const pending = pageCards.filter(needsImportReview).length;
            if (pending) {
              pageWarnings.push(
                `Página ${pageNumber}: ${pending} cartón(es) detectado(s) necesitan revisión antes de guardarse.`,
              );
            }
            pageResults[pageNumber - 1] = {
              cards: pageCards,
              pages: 1,
              warnings: pageWarnings,
            };
          } catch (error) {
            pageResults[pageNumber - 1] = {
              cards: pageCards, pages: 1,
              warnings: [`Página ${pageNumber}: no pudo completarse (${error instanceof Error ? error.message : "error desconocido"}). Las demás páginas se conservan.`],
            };
          } finally {
            page?.cleanup();
            completedPages += 1;
            onProgress({ page: pageNumber, pages: pageCount, stage: "Validando", percent: Math.round(completedPages / pageCount * 100) });
            // Yield between pages so controls stay responsive in large files.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
      } finally {
        await ocrWorker?.terminate().catch(() => undefined);
      }
    };

    await Promise.allSettled(
      Array.from({ length: concurrency }, () => processPages()),
    );
  } finally {
    await pdf.destroy();
  }

  onProgress({
    page: completedPages,
    pages: pageCount,
    stage: "Validando",
    percent: Math.round(completedPages / pageCount * 100),
  });
  // Se conserva la numeración impresa y solo se repara una familia a la que
  // le falta un dígito cuando las hojas vecinas equivalentes la confirman.
  const detectedCards = filterEnabledImportGames(
    pageResults.flatMap((result) => result?.cards ?? []),
  );
  const reconciledCards = reconcileFourCardPositionIdentifiers(
    reconcilePlainSequentialCardNumbers(
      reconcilePdfPageFamilies(detectedCards),
    ),
  );
  const reviewWarnings = [...new Map(
    reconciledCards
      .filter(needsImportReview)
      .map((card) => [card.sourcePage, card]),
  ).keys()].map((page) => {
    const pending = reconciledCards.filter((card) => card.sourcePage === page && needsImportReview(card)).length;
    return `Página ${page}: ${pending} cartón(es) detectado(s) necesitan revisión antes de guardarse.`;
  });
  return {
    cards: sortCardsByPdfOrder(reconciledCards),
    pages: pageCount,
    warnings: [
      ...pageResults.flatMap((result) => result?.warnings ?? []).filter((warning) => !warning.includes("necesitan revisión antes de guardarse")),
      ...reviewWarnings,
      ...(completedPages < pageCount ? [`Lectura detenida: ${completedPages} de ${pageCount} páginas procesadas. Se conservan los cartones ya detectados; las páginas restantes no se han importado.`] : []),
    ],
  };
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
    cards = assignSequentialCardNumbers(
      reconcilePlainSequentialCardNumbers(
        filterEnabledImportGames(
          await runOcrCanvas(canvas, worker, file.name, 1),
        ),
      ),
    );
  } catch (error) {
    warnings.push(
      `La imagen no pudo reconocerse (${error instanceof Error ? error.message : "error desconocido"}).`,
    );
  } finally {
    await worker.terminate().catch(() => undefined);
    canvas.width = canvas.height = 0;
  }
  if (!cards.length) {
    warnings.push(
      "No se encontró un formato de bingo válido. Procura que la fotografía esté derecha, enfocada y muestre el cartón completo.",
    );
  }
  onProgress({ page: 1, pages: 1, stage: "Validando", percent: 100 });
  return { cards, pages: 1, warnings };
}

export async function parseBingoImportFile(
  file: File,
  onProgress: (progress: PdfParseProgress) => void,
  options: BingoImportOptions = {},
) {
  if (!isSupportedBingoImportFile(file)) {
    throw new Error(`${file.name} no es un PDF ni una imagen compatible.`);
  }
  const kind = await validateBingoImportFileContent(file);
  return kind === "pdf"
    ? parseBingoPdf(file, onProgress, options)
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
