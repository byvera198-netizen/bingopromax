import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules", "pdfjs-dist", "build");
const target = resolve(root, "public", "pdfjs");

mkdirSync(target, { recursive: true });
copyFileSync(resolve(source, "pdf.mjs"), resolve(target, "pdf.mjs"));
copyFileSync(resolve(source, "pdf.worker.min.mjs"), resolve(target, "pdf.worker.min.mjs"));
