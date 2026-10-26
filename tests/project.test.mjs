import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("declara persistencia para partidas y membresías sin conservar los PDF fuente", async () => {
  const hosting = JSON.parse(await read(".openai/hosting.json"));
  const schema = await read("db/schema.ts");
  const baseMigration = await read("drizzle/0000_high_warbird.sql");
  const accessMigration = await read("drizzle/0001_zippy_namorita.sql");
  const ownershipMigration = await read("drizzle/0002_per_user_games.sql");
  const filesRoute = await read("app/api/files/route.ts");

  assert.equal(hosting.d1, "DB");
  assert.match(schema, /owner_email/);
  assert.match(ownershipMigration, /owner_email/);
  for (const table of ["games", "cards", "draws", "patterns", "winners", "audit_logs"]) {
    assert.match(schema, new RegExp(`"${table}"`));
    assert.match(baseMigration, new RegExp(`CREATE TABLE \`${table}\``));
  }
  for (const table of ["game_patterns", "memberships"]) {
    assert.match(schema, new RegExp(`"${table}"`));
    assert.match(accessMigration, new RegExp(`CREATE TABLE \`${table}\``));
  }
  // PDFs are parsed in the browser and only confirmed cards are persisted;
  // the legacy upload endpoint must not silently retain source documents.
  assert.match(filesRoute, /no conserva archivos fuente/);
  assert.match(filesRoute, /status: 410/);
});

test("incluye los flujos operativos y administrativos principales", async () => {
  const page = await read("app/game-console.tsx");
  const route = await read("app/api/state/route.ts");
  const bingo = await read("lib/bingo.ts");
  const parser = await read("lib/pdf-parser.ts");

  assert.match(page, /parseBingoPdf/);
  assert.match(page, /const saveImportedCards/);
  assert.match(page, /deduplicateBingoCards/);
  assert.match(route, /if \(action === "saveCards"\)/);
  assert.match(page, /Guardar cartones revisados/);
  assert.match(page, /saveManualCard/);
  assert.match(page, /registerBall/);
  assert.match(page, /recordWinners/);
  assert.match(page, /Administra los patrones del juego/);
  assert.match(page, /patternStatuses/);
  assert.match(page, /togglePattern/);
  assert.match(page, /syncPatterns/);
  assert.match(page, /Sincronizar patrones del paquete/);
  assert.match(page, /deleteCard/);
  assert.match(page, /deleteVoidedCards/);
  assert.match(page, /cardLayers/);
  assert.match(page, /Usuarios y membresías/);
  assert.match(page, /exportPdf/);
  assert.match(page, /exportExcel/);
  assert.match(page, /exportCsv/);
  assert.match(route, /approveMembership/);
  assert.match(route, /DELETE FROM cards WHERE game_id/);
  assert.match(route, /DELETE FROM draws WHERE game_id/);
  assert.match(route, /DELETE FROM winners WHERE game_id/);
  assert.match(route, /x-device-id/);
  assert.match(route, /adminOnlyActions/);
  assert.match(route, /Solo un administrador puede administrar los patrones/);
  assert.match(route, /Solo un administrador puede importar paquetes generados por Studio/);
  assert.match(bingo, /isWinningCard/);
  assert.match(bingo, /winningPatternsForCard/);
  assert.match(bingo, /blackout/);
  assert.match(parser, /pdfjs-dist/);
  assert.match(parser, /tesseract\.js/);
});

test("no conserva la interfaz temporal del starter", async () => {
  const page = await read("app/game-console.tsx");
  const layout = await read("app/layout.tsx");
  const packageJson = await read("package.json");

  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(layout, /Bingo Control Pro/);
});
