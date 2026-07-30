import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("declara persistencia para partidas y archivos PDF", async () => {
  const hosting = JSON.parse(await read(".openai/hosting.json"));
  const schema = await read("db/schema.ts");
  const migration = await read("drizzle/0000_high_warbird.sql");

  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "FILES");
  for (const table of ["games", "cards", "draws", "patterns", "winners", "files", "audit_logs"]) {
    assert.match(schema, new RegExp(`"${table}"`));
    assert.match(migration, new RegExp(`CREATE TABLE \`${table}\``));
  }
});

test("incluye los flujos operativos principales", async () => {
  const page = await read("app/page.tsx");
  const bingo = await read("lib/bingo.ts");
  const parser = await read("lib/pdf-parser.ts");

  assert.match(page, /parseBingoPdf/);
  assert.match(page, /saveManualCard/);
  assert.match(page, /registerBall/);
  assert.match(page, /recordWinners/);
  assert.match(page, /Todos los patrones están activos/);
  assert.match(page, /patternStatuses/);
  assert.match(page, /exportPdf/);
  assert.match(page, /exportExcel/);
  assert.match(page, /exportCsv/);
  assert.match(bingo, /isWinningCard/);
  assert.match(bingo, /winningPatternsForCard/);
  assert.match(bingo, /blackout/);
  assert.match(parser, /pdfjs-dist/);
  assert.match(parser, /tesseract\.js/);
});

test("no conserva la interfaz temporal del starter", async () => {
  const page = await read("app/page.tsx");
  const layout = await read("app/layout.tsx");
  const packageJson = await read("package.json");

  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(layout, /Bingo Control Pro/);
});
