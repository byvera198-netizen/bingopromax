import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const outputName = process.argv[2] || "dist-pages-release";
const root = fileURLToPath(new URL("../", import.meta.url));
const client = join(root, "dist", "client");
const server = join(root, "dist", "server");
const output = resolve(root, outputName);

await access(join(client, "manifest.webmanifest"));
await access(join(server, "index.js"));
await mkdir(output, { recursive: true });
await cp(client, output, { recursive: true, force: true });
await cp(server, join(output, "server"), { recursive: true, force: true });

const worker = `import worker from "./server/index.js";

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    const staticPaths = new Set([
      "/assets/",
      "/favicon.svg",
      "/file.svg",
      "/globe.svg",
      "/window.svg",
      "/og.png",
      "/manifest.webmanifest",
      "/pwa-icon.svg",
      "/sw.js",
    ]);

    if ([...staticPaths].some((path) => path.endsWith("/") ? pathname.startsWith(path) : pathname === path)) {
      return env.ASSETS.fetch(request);
    }

    return worker.fetch(request, env, ctx);
  },
};
`;

await writeFile(join(output, "_worker.js"), worker, "utf8");
console.log(`Pages package ready: ${output}`);
