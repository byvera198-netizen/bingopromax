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
  const pagesDeploy = await read("scripts/prepare-pages-deploy.ps1");

  assert.match(page, /importBusyRef\.current/);
  assert.match(page, /byFile\.set\(card\.sourceFile/);
  assert.match(page, /importSource: sourceFile/);
  assert.match(stateRoute, /cards\.some\(\(card\) => card\.sourceFile !== importSource\)/);
  assert.match(pagesDeploy, /e\.method!=="GET"&&e\.method!=="HEAD"/);
  assert.match(pagesDeploy, /pathname\.startsWith\("\/api\/"\)/);
});

test("conserva los cartones al reiniciar y solo abre una partida vacia por accion del usuario", async () => {
  const page = await read("app/game-console.tsx");
  const route = await read("app/api/state/route.ts");

  assert.match(route, /SELECT \* FROM games WHERE owner_email = \? ORDER BY created_at DESC LIMIT 1/);
  assert.match(route, /SELECT \* FROM cards WHERE game_id = \? ORDER BY created_at DESC/);
  assert.match(route, /if \(action === "createGame"\)/);
  assert.match(page, /onClick=\{\(\) => void createNewGame\(\)\}/);
  assert.doesNotMatch(route, /if \(action === "createGame"\)[\s\S]{0,1600}DELETE FROM cards/);
});

test("una cuenta eliminada puede crear una nueva solicitud pendiente", async () => {
  const route = await read("app/api/state/route.ts");
  const requestMembership = route.slice(
    route.indexOf('if (action === "requestMembership")'),
    route.indexOf('if (action === "activateMembership")'),
  );

  assert.match(requestMembership, /DELETE FROM blocked_users WHERE email = \?/);
  assert.match(requestMembership, /INSERT INTO memberships/);
  assert.match(requestMembership, /status = 'pending'/);
  assert.doesNotMatch(requestMembership, /Esta cuenta fue eliminada\. Contacta al administrador/);
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
  assert.match(page, /deleteSelectedCards/);
  assert.match(page, /disableSelectedCards/);
  assert.match(page, /Sabrositos/);
  assert.doesNotMatch(page, /Bom Bom Bum/);
  assert.doesNotMatch(page, /Eche Leche/);
  assert.match(route, /deleteCards/);
  assert.match(route, /updateCardStatusBulk/);
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
  assert.match(page, /Solicitar código al administrador por WhatsApp/);
  assert.match(page, /https:\/\/wa\.me\/\$\{WHATSAPP_NUMBER\}\?text=/);
  assert.doesNotMatch(page, /assignApplicationCardNumbers/);
  assert.match(parser, /assignSequentialCardNumbers/);
  assert.match(route, /addAdmin/);
  assert.match(route, /approveMembership/);
  assert.match(route, /x-device-id/);
  assert.match(route, /WHERE owner_email = \?/);
  assert.match(route, /cardsPerInsert = 10/);
  assert.match(route, /action !== "saveCards"/);
  assert.match(route, /alreadySaved/);
  assert.match(page, /IMPORT_SAVE_CHUNK_SIZE = 10/);
  assert.match(page, /await response\.text\(\)/);
  assert.match(page, /specialGamePatterns/);
  assert.match(page, /new Set\(state\.disabledPatternIds\)/);
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
