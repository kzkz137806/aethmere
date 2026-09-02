#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (manifest.version !== "0.12.0") throw new Error(`release version mismatch: ${manifest.version}`);
const outputDirectory = path.join(root, "dist");
const filename = `aethmere-vscode-${manifest.version}.vsix`;
const output = path.join(outputDirectory, filename);
const checksum = `${output}.sha256.txt`;
if (path.dirname(output) !== outputDirectory || path.basename(output) !== filename) throw new Error(`unsafe VSIX output: ${output}`);

await mkdir(outputDirectory, { recursive: true });
await rm(output, { force: true });
await rm(checksum, { force: true });
const vsce = require.resolve("@vscode/vsce/vsce");
execFileSync(process.execPath, [vsce, "package", "--no-dependencies", "--out", output], {
  cwd: root,
  env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
  stdio: "inherit",
  windowsHide: true,
});

const hash = createHash("sha256");
await new Promise((resolve, reject) => createReadStream(output)
  .on("data", (chunk) => hash.update(chunk))
  .on("error", reject)
  .on("end", resolve));
const digest = hash.digest("hex");
await writeFile(checksum, `${digest}  ${filename}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, output, checksum, sha256: digest }, null, 2)}\n`);
