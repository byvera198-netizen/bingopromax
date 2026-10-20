import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = 4174;
const distEntry = "dist/server/index.js";
const distConfig = "dist/server/wrangler.json";
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
await access(distEntry);
await access(distConfig);

const child = spawn(
  process.execPath,
  [wranglerBin, "dev", distEntry, "--config", distConfig, "--port", String(port), "--ip", "127.0.0.1"],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);

let logs = "";
const collect = (chunk) => {
  logs += chunk.toString();
  if (logs.length > 12000) logs = logs.slice(-12000);
};
child.stdout.on("data", collect);
child.stderr.on("data", collect);

const waitForServer = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Wrangler no inició a tiempo.\n${logs}`)), 45000);
  const check = () => {
    if (/Ready on http:\/\/127\.0\.0\.1:\d+/.test(logs)) {
      clearTimeout(timer);
      resolve();
    }
  };
  child.stdout.on("data", check);
  child.stderr.on("data", check);
  child.once("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`Wrangler terminó antes de estar listo (código ${code}).\n${logs}`));
  });
});

try {
  await waitForServer;
  const root = await fetch(`http://127.0.0.1:${port}/`);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  const state = await fetch(`http://127.0.0.1:${port}/api/state`);
  const healthBody = await health.json();

  assert.equal(root.status, 200);
  assert.equal(health.status, 200);
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.service, "bingo-control-promax");
  assert.equal(state.status, 403);
  console.log("ProMax Worker smoke OK: portada 200, health 200, API protegida 403.");
} finally {
  child.kill();
}
