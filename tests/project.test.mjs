import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("declara persistencia para partidas, membresías y archivos PDF", async () => {
  const hosting = JSON.parse(await read(".openai/hosting.json"));
  const schema = await read("db/schema.ts");
  const baseMigration = await read("drizzle/0000_high_warbird.sql");
  const accessMigration = await read("drizzle/0001_zippy_namorita.sql");

  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "FILES");
  for (const table of ["games", "cards", "draws", "patterns", "winners", "files", "audit_logs"]) {
    assert.match(schema, new RegExp(`"${table}"`));
    assert.match(baseMigration, new RegExp(`CREATE TABLE \`${table}\``));
  }
  for (const table of ["game_patterns", "memberships"]) {
    assert.match(schema, new RegExp(`"${table}"`));
    assert.match(accessMigration, new RegExp(`CREATE TABLE \`${table}\``));
  }
});

test("aísla cada selección de archivos durante la importación", async () => {
  const page = await read("app/game-console.tsx");
  const stateRoute = await read("app/api/state/route.ts");

  assert.match(page, /importBusyRef\.current/);
  assert.match(page, /card\.sourceFile === file\.name/);
  assert.match(page, /importSource: file\.name/);
  assert.match(stateRoute, /cards\.some\(\(card\) => card\.sourceFile !== importSource\)/);
});

test("incluye los flujos operativos y administrativos principales", async () => {
  const page = await read("app/game-console.tsx");
  const route = await read("app/api/state/route.ts");
  const bingo = await read("lib/bingo.ts");
  const parser = await read("lib/pdf-parser.ts");

  assert.match(page, /parseBingoImportFile/);
  assert.match(page, /saveManualCard/);
  assert.match(page, /registerBall/);
  assert.match(page, /recordWinners/);
  assert.match(page, /Administra los patrones del juego/);
  assert.match(page, /patternStatuses/);
  assert.match(page, /togglePattern/);
  assert.match(page, /deleteCard/);
  assert.match(page, /action: "updateCard"/);
  assert.match(page, /Editar cartón/);
  assert.match(page, /deleteVoidedCards/);
  assert.match(page, /cardLayers/);
  assert.match(page, /Usuarios y membresías/);
  assert.match(page, /exportPdf/);
  assert.doesNotMatch(page, /Libro Excel/);
  assert.doesNotMatch(page, /Archivo CSV/);
  assert.match(page, /updatePattern/);
  assert.match(page, /deleteMembershipUser/);
  assert.match(page, /authorizationHeaders\(forceRefresh\)/);
  assert.match(page, /supabase\.auth\.signInWithPassword/);
  assert.match(page, /supabase\.auth\.signUp/);
  assert.match(page, />Ingresar<\/button>/);
  assert.match(page, />Registrarse<\/button>/);
  assert.match(page, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void submitAuth\(\); \}\}/);
  assert.match(page, /className="primary-button auth-submit"[^>]+type="submit"/);
  assert.match(page, /membershipEmail = access\.email \|\| authUser\?\.email/);
  assert.match(page, /Cerrar sesión y volver al inicio/);
  assert.match(page, /capture="environment"/);
  assert.doesNotMatch(page, /assignApplicationCardNumbers/);
  assert.match(parser, /assignSequentialCardNumbers/);
  assert.match(route, /addAdmin/);
  assert.match(route, /approveMembership/);
  assert.match(route, /x-device-id/);
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
