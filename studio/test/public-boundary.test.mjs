import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = [
  "main.mjs", "preload.cjs", "lib/account-client.mjs", "lib/bounded-response.mjs", "lib/context-store.mjs", "lib/governance-client.mjs", "lib/private-files.mjs",
  "renderer/index.html", "renderer/app.js", "renderer/styles.css",
  "launcher/Program.cs",
].map((file) => path.join(root, file));
const source = sourceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");

test("public Studio contains no private workspace paths, credentials or internal mechanism imports", () => {
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
  ]) assert.equal(pattern.test(source), false, `forbidden public source pattern: ${pattern}`);
});

test("renderer has no network capability and automatic requests are fixed to Aethmere App plus loopback Ollama", () => {
  const html = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
  const main = fs.readFileSync(path.join(root, "main.mjs"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");
  const account = fs.readFileSync(path.join(root, "lib", "account-client.mjs"), "utf8");
  assert.match(html, /connect-src 'none'/u);
  assert.doesNotMatch(renderer, /\b(?:fetch|XMLHttpRequest|WebSocket)\b/u);
  assert.match(main, /http:\/\/127\.0\.0\.1:11434/u);
  assert.match(account, /https:\/\/app\.aethmere\.com/u);
  assert.match(account, /value\.server !== AETHMERE_APP_ORIGIN/u);
  assert.doesNotMatch(`${main}\n${account}`, /response\.(?:json|text)\(\)/u);
  assert.match(main, /readBoundedText\(response, MAX_OLLAMA_RESPONSE_BYTES/u);
  assert.match(main, /body: options\.body[\s\S]*?redirect: "error"[\s\S]*?signal: controller\.signal/u);
  assert.match(main, /webRequest\.onBeforeRequest\([\s\S]*?"http:\/\/\*\/\*"[\s\S]*?callback\(\{ cancel: true \}\)/u);
  assert.doesNotMatch(main, /(?:PRIVATE|INTERNAL)_(?:SERVICE_)?URL/u);
  const external = [...main.matchAll(/https:\/\/[^"\s]+/gu)].map((match) => match[0]).filter((url) => !url.includes("*"));
  assert.deepEqual(external.sort(), [
    "https://aethmere.com/",
    "https://github.com/kzkz137806/aethmere/releases",
    "https://github.com/kzkz137806/aethmere/releases/download/v0.12.0/aethmere-agent-client-0.12.0.tgz",
  ].sort());
});

test("every Studio context or model IPC capability enters the governed main-process wrapper", () => {
  const main = fs.readFileSync(path.join(root, "main.mjs"), "utf8");
  for (const pattern of [
    /ipcMain\.handle\("project:current", \(\) => governed\("MEMORY_RECALL"/u,
    /ipcMain\.handle\("project:choose",[\s\S]*?return governed\("MEMORY_RECALL"/u,
    /ipcMain\.handle\("context:list", \(\) => governed\("MEMORY_RECALL"/u,
    /ipcMain\.handle\("context:get",[\s\S]*?governed\("MEMORY_GET"/u,
    /ipcMain\.handle\("context:save",[\s\S]*?governed\("LOCAL_CANDIDATE_READY"/u,
    /ipcMain\.handle\("context:remove",[\s\S]*?return governed\("LOCAL_CANDIDATE_READY"/u,
    /ipcMain\.handle\("models:list", \(\) => governed\("SEARCH"/u,
    /ipcMain\.handle\("chat:send",[\s\S]*?governed\("CHAT"/u,
  ]) assert.match(main, pattern);
  assert.match(main, /const run = \(\) => runGovernedCapability/u);
});

test("IPC channels are exhaustively split between governed capabilities and narrow support exemptions", () => {
  const main = fs.readFileSync(path.join(root, "main.mjs"), "utf8");
  const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");
  const formal = ["project:current", "project:choose", "context:list", "context:get", "context:save", "context:remove", "models:list", "chat:send"];
  const support = ["app:info", "account:status", "account:login", "account:logout", "governance:check", "clipboard:copy", "external:open"];
  const registered = [...main.matchAll(/ipcMain\.handle\("([^"]+)"/gu)].map((match) => match[1]).sort();
  assert.deepEqual(registered, [...formal, ...support].sort());
  const exposed = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/gu)].map((match) => match[1]).sort();
  assert.deepEqual(exposed, registered);
  for (const channel of support) {
    const start = main.indexOf(`ipcMain.handle("${channel}"`);
    const next = main.indexOf("ipcMain.handle(\"", start + 16);
    const handler = main.slice(start, next < 0 ? main.indexOf("\n}\n\nasync function createWindow", start) : next);
    assert.doesNotMatch(handler, /\bgoverned\(/u, `${channel} must remain a support-only exemption`);
  }
  assert.doesNotMatch(renderer, /\b(?:require|process|ipcRenderer|fs\.|child_process|fetch|XMLHttpRequest|WebSocket)\b/u);
  assert.doesNotMatch(preload, /\b(?:readFile|writeFile|fetch|XMLHttpRequest|WebSocket)\b/u);
});

test("renderer receives summary-only lists and fetches one item through fresh governance before editing", () => {
  const main = fs.readFileSync(path.join(root, "main.mjs"), "utf8");
  const store = fs.readFileSync(path.join(root, "lib", "context-store.mjs"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");
  assert.match(main, /items: listSummaries\(currentProject\)/u);
  assert.match(main, /ipcMain\.handle\("context:get",[\s\S]*?governed\("MEMORY_GET"[\s\S]*?getItem\(currentProject, id\)/u);
  assert.match(store, /export function listSummaries[\s\S]*?map\(\(\{ id, title, tags, updated_at: updatedAt \}\)/u);
  assert.doesNotMatch(store, /export function listSummaries[\s\S]*?\btext\b[\s\S]*?\n\}/u);
  assert.match(renderer, /const item = summary \? await window\.aethmere\.getContext\(summary\.id\) : null/u);
});

test("clipboard support accepts only enumerated fixed commands and uses the 0.12.0 Agent asset", () => {
  const main = fs.readFileSync(path.join(root, "main.mjs"), "utf8");
  const preload = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");
  assert.match(main, /"agent-install": "npm install -g https:\/\/github\.com\/kzkz137806\/aethmere\/releases\/download\/v0\.12\.0\/aethmere-agent-client-0\.12\.0\.tgz"/u);
  assert.match(main, /"agent-connect": "aethmere-agent connect --client all"/u);
  assert.match(main, /ipcMain\.handle\("clipboard:copy", \(_event, key\)[\s\S]*?SUPPORT_CLIPBOARD\[String\(key \|\| ""\)\]/u);
  assert.match(preload, /copySupport: \(key\) => ipcRenderer\.invoke\("clipboard:copy", key\)/u);
  assert.match(renderer, /copySupport\("agent-install"\)/u);
  assert.doesNotMatch(preload, /copySupport: \((?:text|value|command)\)/u);
});

test("Studio OS mutex is a fixed exclusive loopback endpoint and runtime loss is fail-fatal", () => {
  const main = fs.readFileSync(path.join(root, "main.mjs"), "utf8");
  const lock = fs.readFileSync(path.join(root, "lib", "operation-lock.mjs"), "utf8");
  assert.match(lock, /studio: 62_462/u);
  assert.match(lock, /host: LOOPBACK_HOST/u);
  assert.match(lock, /exclusive: true/u);
  assert.match(lock, /process\.exit\(70\)/u);
  assert.match(lock, /state\.releasing = true[\s\S]*?server\.close/u);
  assert.match(main, /process\.on\("uncaughtException"[\s\S]*?showErrorBox[\s\S]*?app\.exit\(1\)/u);
});
