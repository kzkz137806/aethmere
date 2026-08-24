#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(studioRoot, "package.json"), "utf8"));
const electronRoot = path.resolve(String(process.env.AETHMERE_ELECTRON_DIST || ""));
const outputRoot = path.resolve(process.env.AETHMERE_STUDIO_OUTPUT || path.join(studioRoot, "dist", `aethmere-agent-studio-${manifest.version}-win32-x64`));
const expectedOutputName = `aethmere-agent-studio-${manifest.version}-win32-x64`;
const runtimeRoot = path.join(outputRoot, "runtime");
const runtimeFiles = [
  "chrome_100_percent.pak", "chrome_200_percent.pak", "d3dcompiler_47.dll", "dxcompiler.dll", "dxil.dll",
  "ffmpeg.dll", "icudtl.dat", "libEGL.dll", "libGLESv2.dll", "LICENSE", "LICENSES.chromium.html",
  "resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin", "version", "vk_swiftshader_icd.json",
  "vk_swiftshader.dll", "vulkan-1.dll",
];
const appFiles = ["package.json", "main.mjs", "preload.cjs", "lib", "renderer"];

function assertSafeOutput() {
  const parsed = path.parse(outputRoot);
  if (outputRoot === parsed.root || path.basename(outputRoot) !== expectedOutputName || !path.dirname(outputRoot)) {
    throw new Error(`unsafe output path: ${outputRoot}`);
  }
}

async function exists(target) {
  try { await lstat(target); return true; } catch { return false; }
}

async function hashFile(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolve));
  return hash.digest("hex");
}

async function collectFiles(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(root, child));
    else if (entry.isFile()) result.push(child.replaceAll("\\", "/"));
    else throw new Error(`unsupported package entry: ${child}`);
  }
  return result;
}

if (!electronRoot || !await exists(path.join(electronRoot, "electron.exe"))) {
  throw new Error("Set AETHMERE_ELECTRON_DIST to a reviewed Windows x64 Electron distribution.");
}
assertSafeOutput();
await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(runtimeRoot, "resources", "app"), { recursive: true });
const launcherCompiler = process.env.AETHMERE_CSC || "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
if (!await exists(launcherCompiler)) throw new Error(`C# launcher compiler not found: ${launcherCompiler}`);
execFileSync(launcherCompiler, [
  "/nologo", "/target:winexe", "/optimize+", "/platform:x64", "/reference:System.Windows.Forms.dll",
  `/out:${path.join(outputRoot, "Aethmere Agent Studio.exe")}`,
  path.join(studioRoot, "launcher", "Program.cs"),
], { stdio: "inherit" });
await cp(path.join(electronRoot, "electron.exe"), path.join(runtimeRoot, "electron.exe"));
for (const file of runtimeFiles) {
  if (!await exists(path.join(electronRoot, file))) throw new Error(`missing Electron runtime file: ${file}`);
  await cp(path.join(electronRoot, file), path.join(runtimeRoot, file));
}
await cp(path.join(electronRoot, "locales"), path.join(runtimeRoot, "locales"), { recursive: true });
for (const file of appFiles) await cp(path.join(studioRoot, file), path.join(runtimeRoot, "resources", "app", file), { recursive: true });
await cp(path.resolve(studioRoot, "..", "LICENSE.txt"), path.join(outputRoot, "AETHMERE-LICENSE.txt"));
await writeFile(path.join(outputRoot, "README.txt"), [
  `Aethmere Agent Studio ${manifest.version} — Windows x64 public preview`,
  "",
  "1. Extract the whole ZIP before starting the app.",
  "2. Double-click Aethmere Agent Studio.exe.",
  "3. Windows may show an unknown-publisher warning because this preview is not code-signed.",
  "4. Local chat requires Ollama on 127.0.0.1:11434; context management works without it.",
  "",
  "No telemetry. No automatic external network requests. Project files are not scanned.",
  "Source and checksums: https://github.com/kzkz137806/aethmere",
  "",
].join("\r\n"), "utf8");

const filesBeforeManifest = await collectFiles(outputRoot);
const artifacts = [];
for (const relative of filesBeforeManifest) {
  const absolute = path.join(outputRoot, ...relative.split("/"));
  const stat = await lstat(absolute);
  artifacts.push({ path: relative, bytes: stat.size, sha256: await hashFile(absolute) });
}
const portable = {
  schema: "aethmere.agent-studio.public-portable.v1",
  name: "Aethmere Agent Studio",
  version: manifest.version,
  platform: "win32-x64",
  entrypoint: "Aethmere Agent Studio.exe",
  runtime: "runtime/electron.exe",
  source: "https://github.com/kzkz137806/aethmere/tree/main/studio",
  network: { automatic_external_requests: false, telemetry: false, local_model_origin: "http://127.0.0.1:11434" },
  artifacts,
};
await writeFile(path.join(outputRoot, "PORTABLE-MANIFEST.json"), `${JSON.stringify(portable, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, output: outputRoot, artifacts: artifacts.length + 1 }, null, 2)}\n`);
