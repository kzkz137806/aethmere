#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(studioRoot, "package.json"), "utf8"));
const packageRoot = path.resolve(process.env.AETHMERE_STUDIO_PACKAGE_ROOT || path.join(studioRoot, "dist", `aethmere-agent-studio-${packageJson.version}-win32-x64`));
const manifestFile = path.join(packageRoot, "PORTABLE-MANIFEST.json");

function normalize(value) {
  const result = String(value || "").replaceAll("\\", "/");
  if (!result || result.startsWith("/") || /^[A-Za-z]:/u.test(result) || result.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`invalid package path: ${value}`);
  }
  return result;
}

async function collectFiles(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, child));
    else if (entry.isFile()) files.push(child.replaceAll("\\", "/"));
    else throw new Error(`unsupported package entry: ${child}`);
  }
  return files;
}

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolve));
  return hash.digest("hex");
}

const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
if (manifest.schema !== "aethmere.agent-studio.public-portable.v1" || manifest.version !== packageJson.version) {
  throw new Error("portable manifest identity mismatch");
}
if (manifest.entrypoint !== "Aethmere Agent Studio.exe" || manifest.runtime !== "runtime/electron.exe") {
  throw new Error("portable entrypoint mismatch");
}
const expected = manifest.artifacts.map((artifact) => normalize(artifact.path));
if (new Set(expected).size !== expected.length) throw new Error("duplicate manifest path");
const actual = (await collectFiles(packageRoot)).filter((file) => file !== "PORTABLE-MANIFEST.json");
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`package file set mismatch: ${JSON.stringify({ missing: expected.filter((file) => !actual.includes(file)), unexpected: actual.filter((file) => !expected.includes(file)) })}`);
}
for (const artifact of manifest.artifacts) {
  const relative = normalize(artifact.path);
  const absolute = path.join(packageRoot, ...relative.split("/"));
  const stat = await lstat(absolute);
  const digest = await sha256(absolute);
  if (!stat.isFile() || stat.size !== artifact.bytes || digest !== artifact.sha256) throw new Error(`package artifact mismatch: ${relative}`);
}
const appRoot = path.join(packageRoot, "runtime", "resources", "app");
const publicSource = [];
for (const file of (await collectFiles(appRoot)).filter((entry) => /\.(?:cjs|mjs|js|json|html|css)$/u.test(entry))) {
  publicSource.push(await readFile(path.join(appRoot, ...file.split("/")), "utf8"));
}
const scanned = publicSource.join("\n");
for (const pattern of [
  /docs\/(?:memory|projects|sessions|tools)\//iu,
  /global-memory\//iu,
  /sensitivity\s*:\s*P[01]/iu,
  /export\s*:\s*false/iu,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/iu,
  /(?:API_KEY|ACCESS_TOKEN|BEARER_TOKEN|CLIENT_SECRET|PRIVATE_KEY)/iu,
  /governed-(?:deliberation|knowledge|library)/iu,
  /ProofIR/iu,
  /[A-Z]:\\Users\\/u,
]) if (pattern.test(scanned)) throw new Error(`forbidden public package pattern: ${pattern}`);

process.stdout.write(`${JSON.stringify({ ok: true, package: packageRoot, version: manifest.version, artifacts: manifest.artifacts.length }, null, 2)}\n`);
