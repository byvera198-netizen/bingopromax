import { createCardLayout, validateBingoCard, type BingoCard } from "./bingo";

type UnknownRecord = Record<string, unknown>;

export type ProMaxImportGame = {
  id: string;
  name: string;
  date: string;
  prize: string;
  status: string;
  notes: string;
  activePatternId: string;
  activePatternName: string;
  activePatternCells: number[];
  autoPause: boolean;
};

export type ProMaxImportPattern = {
  id: string;
  name: string;
  description: string;
  group: string;
  color: string;
  cells: number[];
  active: boolean;
};

export type ProMaxImportResult = {
  schemaVersion: string;
  source: string;
  target: string;
  generatedAt: string;
  game: ProMaxImportGame | null;
  patterns: ProMaxImportPattern[];
  blocks: number;
  campaigns: number;
  cards: BingoCard[];
  rejected: string[];
  warnings: string[];
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function integer(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function numbers(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isInteger(item))
    ? value as number[]
    : [];
}

function grid(value: unknown) {
  const flat = numbers(value);
  if (flat.length) return flat;
  if (Array.isArray(value) && value.every((row) => Array.isArray(row))) {
    const rows = value as unknown[][];
    const flattened = rows.flat();
    return numbers(flattened);
  }
  return [];
}

function normalizeGame(value: unknown): ProMaxImportGame | null {
  const source = record(value);
  if (!Object.keys(source).length) return null;
  return {
    id: text(source.id, "studio-import"),
    name: text(source.name, "Importación Bingo ProMax Studio"),
    date: text(source.date),
    prize: text(source.prize),
    status: text(source.status, "ready"),
    notes: text(source.notes),
    activePatternId: text(source.activePatternId),
    activePatternName: text(source.activePatternName),
    activePatternCells: numbers(source.activePatternCells),
    autoPause: source.autoPause !== false,
  };
}

function normalizePatterns(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ProMaxImportPattern[] => {
    const source = record(item);
    const cells = numbers(source.cells).filter((cell) => cell >= 0 && cell < 25);
    const id = text(source.id);
    const name = text(source.name);
    if (!id || !name || !cells.length) return [];
    return [{
      id,
      name,
      description: text(source.description),
      group: text(source.group, "Personalizados"),
      color: text(source.color, "#d7ff3f"),
      cells: Array.from(new Set(cells)),
      active: source.active === true,
    }];
  });
}

function legacyCards(parsed: UnknownRecord) {
  const campaigns = Array.isArray(parsed.campaigns) ? parsed.campaigns : [];
  return campaigns.flatMap((campaign) => {
    const campaignRecord = record(campaign);
    const blocks = Array.isArray(campaignRecord.blocks) ? campaignRecord.blocks : [];
    return blocks.flatMap((block) => {
      const blockRecord = record(block);
      const sheets = Array.isArray(blockRecord.sheets) ? blockRecord.sheets : [];
      return sheets.flatMap((sheet) => {
        const sheetRecord = record(sheet);
        const cards = Array.isArray(sheetRecord.cards) ? sheetRecord.cards : [];
        return cards.map((card) => ({
          ...record(card),
          legacyBlock: blockRecord,
          legacySheet: sheetRecord,
        }));
      });
    });
  });
}

export function parseProMaxPackage(raw: string): ProMaxImportResult {
  let parsed: UnknownRecord;
  try {
    parsed = record(JSON.parse(raw));
  } catch {
    throw new Error("El archivo no contiene un JSON válido.");
  }

  const schemaVersion = text(parsed.schemaVersion);
  const source = text(parsed.source);
  if (!(["1.0", "1.1"] as string[]).includes(schemaVersion) || source !== "bingo-promax-studio") {
    throw new Error("El archivo no corresponde a un paquete Bingo ProMax Studio v1.0 o v1.1.");
  }

  const rawCards = Array.isArray(parsed.cards) ? parsed.cards : legacyCards(parsed);
  if (!rawCards.length) throw new Error("El paquete no contiene cartones para importar.");

  const rejected: string[] = [];
  const warnings: string[] = [];
  const cards: BingoCard[] = [];
  const layout = createCardLayout("classic-5x5");

  rawCards.forEach((value, index) => {
    const item = record(value);
    const block = record(item.legacyBlock);
    const sheet = record(item.legacySheet);
    const number = text(item.number, text(item.id, `IMPORT-${String(index + 1).padStart(6, "0")}`));
    const cardGrid = grid(item.grid).length ? grid(item.grid) : grid(item.numbers);
    const sourceFile = text(item.sourceFile, `${text(block.code, "paquete-promax")}.pdf`);
    const sourcePage = integer(item.sourcePage, integer(sheet.pageNumber, 0));
    const card: BingoCard = {
      id: text(item.id, `${number}-${String(index + 1)}`),
      number,
      serial: text(item.serial, text(sheet.code)),
      grid: cardGrid,
      sourceFile,
      sourcePage,
      status: item.status === "void" ? "void" : "active",
      layout,
      reviewStatus: "ready",
    };
    const errors = cardGrid.length === 25 ? validateBingoCard(card) : ["La cuadrícula debe contener 25 posiciones."];
    if (!number) errors.unshift("El cartón no tiene numeración.");
    if (errors.length) {
      rejected.push(`Cartón ${number || `#${index + 1}`}: ${errors.join(" ")}`);
      return;
    }
    cards.push(card);
  });

  if (rejected.length) warnings.push(`${rejected.length} cartón(es) quedaron fuera por validación.`);
  if (!cards.length) throw new Error("Todos los cartones del paquete fueron rechazados por validación.");

  const blocks = Array.isArray(parsed.blocks)
    ? parsed.blocks.length
    : Array.isArray(parsed.campaigns)
      ? parsed.campaigns.flatMap((campaign) => Array.isArray(record(campaign).blocks) ? record(campaign).blocks : []).length
      : 0;

  return {
    schemaVersion,
    source,
    target: text(parsed.target, "bingo-control-pro"),
    generatedAt: text(parsed.generatedAt),
    game: normalizeGame(parsed.game),
    patterns: normalizePatterns(parsed.patterns),
    blocks,
    campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns.length : 0,
    cards,
    rejected,
    warnings,
  };
}
