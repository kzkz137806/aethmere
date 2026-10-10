#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPackageDependencyClosure, extractPackageEntries } from "../lib/package-audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, "dist");
const expected = "aethmere-agent-client-" + manifest.version + ".tgz";
const output = path.join(dist, expected);
const checksum = output + ".sha256.txt";
const npmCli = process.env.npm_execpath;

if (!npmCli || !path.isAbsolute(npmCli)) {
  throw new Error("Run this release builder through npm run package:release.");
}
if (path.dirname(output) !== dist || !/^aethmere-agent-client-\d+\.\d+\.\d+\.tgz$/u.test(expected)) {
  throw new Error("unsafe release artifact path");
}

fs.mkdirSync(dist, { recursive: true });
fs.rmSync(output, { force: true });
fs.rmSync(checksum, { force: true });
const packed = JSON.parse(execFileSync(process.execPath, [
  npmCli,
  "pack",
  "--json",
  "--ignore-scripts",
  "--pack-destination",
  dist,
], { cwd: root, encoding: "utf8" }));
if (!Array.isArray(packed) || packed.length !== 1 || !packed[0].filename) {
  throw new Error("npm pack returned an invalid receipt");
}
const generated = path.join(dist, path.basename(packed[0].filename));
if (!fs.existsSync(generated)) throw new Error("npm pack artifact is missing");
const closure = auditPackageDependencyClosure(extractPackageEntries(fs.readFileSync(generated)));
if (!closure.ok) { fs.rmSync(generated, { force: true }); throw new Error("Incomplete release runtime: " + JSON.stringify(closure.issues)); }
fs.renameSync(generated, output);

const digest = createHash("sha256").update(fs.readFileSync(output)).digest("hex");
fs.writeFileSync(checksum, digest + "  " + expected + "\n", "utf8");
process.stdout.write(JSON.stringify({
  schema: "aethmere.public-agent-release.v1",
  ok: true,
  version: manifest.version,
  artifact: output,
  bytes: fs.statSync(output).size,
  sha256: digest,
  checksum,
  files: packed[0].files,
}, null, 2) + "\n");
