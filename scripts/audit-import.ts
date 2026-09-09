// Read-only fixture runner. Original PDFs are never modified or uploaded.
// Usage: npx tsx scripts/audit-import.ts <pdf path> [page|all] [ocr]
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, OEM, PSM } from "tesseract.js";
import { detectGridRectangles, extractCardsFromTextItems, needsImportReview, pdfRenderScale, runOcr, filterEnabledImportGames, recognizeGridIdentifiers } from "../lib/pdf-parser";

const file = process.argv[2];
if (!file) throw new Error("Specify a source PDF.");
const pageOption = process.argv[3] || "1";
const doOcr = process.argv[4] === "ocr";
const out = resolve("work/pdf-audit");
await mkdir(out, { recursive: true });
Object.assign(globalThis, { document: { createElement: () => createCanvas(1, 1) } });
const pdf = await getDocument({ data: new Uint8Array(await readFile(file)), isEvalSupported: false, useSystemFonts: true }).promise;
const worker = doOcr ? await createWorker("eng", OEM.LSTM_ONLY, { cachePath: out }) : null;
let calls = 0;
const adapter = worker ? {
  setParameters: (p: Record<string, string>) => worker.setParameters(p),
  recognize: (canvas: { toBuffer: (mime: "image/png") => Buffer }, options: object, output: object) => { calls++; return worker.recognize(canvas.toBuffer("image/png"), options, output); },
  terminate: () => worker.terminate(),
} : null;
if (worker) await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
const results = [];
try {
  const pages = pageOption === "all" ? Array.from({ length: pdf.numPages }, (_, i) => i + 1) : pageOption.split(",").map(Number);
  for (const number of pages) {
    const start = Date.now(); calls = 0;
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pdfRenderScale(base.width, base.height, 2450) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvas, canvasContext: context, viewport } as never).promise;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const rects = detectGridRectangles(pixels.data, canvas.width, canvas.height);
    const text = await page.getTextContent();
    const textCards = extractCardsFromTextItems(text.items.filter((item) => "str" in item) as never, basename(file), number);
    if (pageOption !== "all") await writeFile(resolve(out, `${basename(file)}.page-${number}.png`), canvas.toBuffer("image/png"));
    const identifiers = adapter ? await recognizeGridIdentifiers(canvas as never, rects, adapter as never) : [];
    const cards = adapter ? filterEnabledImportGames(await runOcr(page as never, adapter as never, basename(file), number, 2450, textCards)) : textCards;
    canvas.width = canvas.height = 0;
    const result = { file: basename(file), pages: pdf.numPages, page: number, width: Math.ceil(viewport.width), height: Math.ceil(viewport.height), grids: rects.length, rectangles: rects, identifiers, textCards: textCards.length, cards, pending: cards.filter(needsImportReview).length, ms: Date.now() - start, calls };
    results.push(result);
    console.log(JSON.stringify({ ...result, rectangles: undefined, cards: cards.map((c) => ({ number: c.number, serial: c.serial, grid: c.grid, review: c.importReview })) }));
    await writeFile(resolve(out, `${basename(file)}.${pageOption}.${doOcr ? "ocr" : "layout"}.json`), JSON.stringify(results, null, 2));
    page.cleanup();
  }
} finally { await worker?.terminate(); await pdf.destroy(); }
