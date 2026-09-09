// Fast, read-only structural audit of every page in supplied PDF fixtures.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { detectCompactRectangles, detectGridRectangles, extractCardsFromTextItems, pdfRenderScale } from "../lib/pdf-parser";

Object.assign(globalThis, { document: { createElement: () => createCanvas(1, 1) } });
const files = process.argv.slice(2);
if (!files.length) throw new Error("Specify PDF paths.");
for (const file of files) {
  const pdf = await getDocument({ data: new Uint8Array(await readFile(file)), isEvalSupported: false }).promise;
  const layouts: Array<{ page: number; grids: number; compact: number; textCards: number }> = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: pdfRenderScale(base.width, base.height, 1250) });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas, canvasContext: context, viewport } as never).promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const grids = detectGridRectangles(pixels.data, canvas.width, canvas.height).length;
      const compact = grids ? 0 : detectCompactRectangles(pixels.data, canvas.width, canvas.height).length;
      const text = await page.getTextContent().catch(() => ({ items: [] }));
      const textCards = extractCardsFromTextItems(text.items.filter((item) => "str" in item) as never, basename(file), pageNumber).length;
      layouts.push({ page: pageNumber, grids, compact, textCards });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } finally { await pdf.destroy(); }
  const histogram = (key: "grids" | "compact" | "textCards") => Object.fromEntries([...new Set(layouts.map((item) => item[key]))].sort((a, b) => a - b).map((value) => [value, layouts.filter((item) => item[key] === value).length]));
  console.log(JSON.stringify({ file: basename(file), pages: layouts.length, pagesWithoutLayout: layouts.filter((item) => !item.grids && !item.compact && !item.textCards).map((item) => item.page), grids: histogram("grids"), compact: histogram("compact"), textCards: histogram("textCards"), layouts }));
}
