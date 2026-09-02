#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const yauzl = require("yauzl");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const filename = `aethmere-vscode-${manifest.version}.vsix`;
const archive = path.join(root, "dist", filename);
const checksumFile = `${archive}.sha256.txt`;
const MAX_ARCHIVE_BYTES = 20_000_000;
const MAX_ENTRY_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 8_000_000;

function safeName(value) {
  const name = String(value || "");
  if (!name || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/u.test(name) || name.split("/").some((part) => part === "..")) {
    throw new Error(`unsafe VSIX entry: ${name}`);
  }
  return name;
}

function openArchive(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => error ? reject(error) : resolve(zip)));
}

function readEntry(zip, entry) {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) return Promise.reject(new Error(`VSIX entry exceeds safety limit: ${entry.fileName}`));
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
    if (error) return reject(error);
    const chunks = [];
    let total = 0;
    stream.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_ENTRY_BYTES) stream.destroy(new Error(`VSIX entry exceeds safety limit: ${entry.fileName}`));
      else chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  }));
}

const stat = await lstat(archive);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARCHIVE_BYTES) throw new Error("VSIX file is missing, unsafe, or too large");
const bytes = await readFile(archive);
const digest = createHash("sha256").update(bytes).digest("hex");
const expectedChecksum = `${digest}  ${filename}\n`;
if (await readFile(checksumFile, "utf8") !== expectedChecksum) throw new Error("VSIX checksum mismatch");

const zip = await openArchive(archive);
const entries = new Map();
let totalBytes = 0;
await new Promise((resolve, reject) => {
  zip.on("error", reject);
  zip.on("entry", async (entry) => {
    try {
      const name = safeName(entry.fileName);
      if (entries.has(name)) throw new Error(`duplicate VSIX entry: ${name}`);
      if ((entry.generalPurposeBitFlag & 1) !== 0) throw new Error(`encrypted VSIX entry: ${name}`);
      totalBytes += entry.uncompressedSize;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("VSIX expanded content exceeds safety limit");
      const content = name.endsWith("/") ? Buffer.alloc(0) : await readEntry(zip, entry);
      entries.set(name, content);
      zip.readEntry();
    } catch (error) { reject(error); }
  });
  zip.on("end", resolve);
  zip.readEntry();
});

for (const required of [
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/package.json",
  "extension/extension.js",
  "extension/lib/agent-runner.js",
  "extension/lib/governance-client.js",
  "extension/lib/operation-lock.js",
  "extension/lib/private-files.js",
  "extension/readme.md",
  "extension/LICENSE.txt",
]) if (!entries.has(required)) throw new Error(`VSIX required entry missing: ${required}`);

for (const name of entries.keys()) {
  if (/^extension\/(?:bin|dist|node_modules|test)\//u.test(name) || name === "extension/package-lock.json" || name.includes(".aethmere")) {
    throw new Error(`private build entry included in VSIX: ${name}`);
  }
}
const packaged = JSON.parse(entries.get("extension/package.json").toString("utf8"));
if (
  packaged.name !== "aethmere-vscode" ||
  packaged.publisher !== "aethmere" ||
  packaged.version !== "0.12.0" ||
  packaged.main !== "./extension.js" ||
  packaged.contributes?.configuration !== undefined
) throw new Error("packaged extension identity or server-setting boundary mismatch");
const source = [
  "extension/extension.js",
  "extension/lib/agent-runner.js",
  "extension/lib/governance-client.js",
  "extension/lib/operation-lock.js",
  "extension/lib/private-files.js",
].map((name) => entries.get(name).toString("utf8")).join("\n");
if (/\.aethmere[\\/]context\.json|readFileSync\([^)]*context|writeFileSync\([^)]*context/iu.test(source)) {
  throw new Error("packaged extension directly accesses the context store");
}
if (!source.includes('const AETHMERE_APP_ORIGIN = "https://app.aethmere.com"') || /AETHMERE_ALLOW_LOCAL_SERVER/u.test(entries.get("extension/lib/governance-client.js").toString("utf8"))) {
  throw new Error("packaged extension governance origin boundary mismatch");
}
process.stdout.write(`${JSON.stringify({ ok: true, archive, sha256: digest, entries: entries.size }, null, 2)}\n`);
