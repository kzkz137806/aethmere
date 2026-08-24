#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(studioRoot, "package.json"), "utf8")));
const distRoot = path.join(studioRoot, "dist");
const directoryName = `aethmere-agent-studio-${packageJson.version}-win32-x64`;
const packageRoot = path.join(distRoot, directoryName);
const archiveName = `${directoryName}.zip`;
const archive = path.join(distRoot, archiveName);
const checksum = path.join(distRoot, `${archiveName}.sha256.txt`);

const packageStat = await lstat(packageRoot);
if (!packageStat.isDirectory() || path.dirname(packageRoot) !== distRoot) throw new Error(`unsafe package root: ${packageRoot}`);
await rm(archive, { force: true });
await rm(checksum, { force: true });
execFileSync("tar.exe", ["-a", "-c", "-f", archive, directoryName], { cwd: distRoot, stdio: "inherit" });

const hash = createHash("sha256");
await new Promise((resolve, reject) => createReadStream(archive).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolve));
const digest = hash.digest("hex");
await writeFile(checksum, `${digest}  ${archiveName}\n`, "utf8");
const stat = await lstat(archive);
process.stdout.write(`${JSON.stringify({ ok: true, archive, bytes: stat.size, sha256: digest, checksum }, null, 2)}\n`);
