"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("manifest exposes an exhaustive formal/support command boundary without server settings", () => {
  const manifest = JSON.parse(read("package.json"));
  const commands = manifest.contributes.commands.map((entry) => entry.command).sort();
  const expected = [
    "aethmere.checkSetup",
    "aethmere.connectClients",
    "aethmere.initialize",
    "aethmere.openContext",
    "aethmere.openDownloads",
    "aethmere.refresh",
    "aethmere.saveSelection",
  ];
  assert.equal(manifest.version, "0.12.0");
  assert.equal(manifest.homepage, "https://aethmere.com/downloads/");
  assert.deepEqual(commands, expected);
  assert.deepEqual(manifest.activationEvents.filter((value) => value.startsWith("onCommand:")).map((value) => value.slice(10)).sort(), expected);
  assert.equal(manifest.contributes.configuration, undefined);
  assert.equal(manifest.devDependencies["@vscode/vsce"], "3.9.2");
  assert.equal(manifest.devDependencies.yauzl, "3.2.1");
  assert.equal(manifest.scripts["package:vsix"], "node bin/package-vsix.mjs");
  assert.equal(manifest.scripts["verify:vsix"], "node bin/verify-vsix.mjs");
});

test("extension never accesses the context file or sends context through argv/shell", () => {
  const source = read("extension.js");
  for (const forbidden of [
    "node:fs",
    "node:child_process",
    ".aethmere/context.json",
    "createFileSystemWatcher",
    "readFile",
    "writeFile",
    "clipboard",
    "--root",
    "--text",
    "--stdin\"",
    "copyConnectCommand",
  ]) assert.equal(source.includes(forbidden), false, forbidden);
  assert.match(source, /runner\.formal\(/u);
  assert.match(source, /runner\.formalReady\(/u);
  assert.match(source, /\["add", "--request-stdin"\]/u);
  assert.match(source, /\["get", "--request-stdin"\]/u);
  assert.doesNotMatch(source, /\["get", "--id"/u);
  assert.match(source, /JSON\.stringify\(\{ id, title: title\.trim\(\), text, tags: \[\], replace: existing \}\)/u);
  assert.equal((source.match(/document\.getText/gu) || []).length, 1);
  assert.ok(source.indexOf("requestFactory") < source.indexOf("document.getText"));
  assert.match(source, /\["connect", "--client", "all"\]/u);
  assert.match(source, /createVscodeGovernance\(context\.extensionPath\)/u);
  for (const pattern of [
    /governance\.run\("LOCAL_CANDIDATE_READY", \(\) => initialize/u,
    /governance\.run\("LOCAL_CANDIDATE_READY", \(\) => saveSelection/u,
    /governance\.run\("MEMORY_GET", \(\) => openContext/u,
    /governance\.run\("GOVERNANCE_CONNECT", \(\) => connectClients/u,
    /this\.governance\.run\("MEMORY_RECALL"/u,
  ]) assert.match(source, pattern);
});

test("extension governance is fixed first-party, manifest-bound, content-free, and independently spooled", () => {
  const source = read("lib/governance-client.js");
  const lock = read("lib/operation-lock.js");
  assert.match(source, /const EXTENSION_VERSION = "0\.12\.0"/u);
  assert.match(source, /manifest\.version !== EXTENSION_VERSION/u);
  assert.match(source, /const AETHMERE_APP_ORIGIN = "https:\/\/app\.aethmere\.com"/u);
  assert.match(source, /minimumClientVersions/u);
  assert.match(source, /Object\.keys\(value\)\.sort\(\)\.join\(","\)/u);
  assert.match(source, /governance-spool-vscode/u);
  assert.match(source, /state: "terminal"/u);
  assert.match(source, /response\.body\.getReader\(\)/u);
  assert.doesNotMatch(source, /response\.(?:text|json|arrayBuffer)\(\)/u);
  assert.doesNotMatch(source, /AETHMERE_(?:HOME|ALLOW_LOCAL_SERVER)/u);
  assert.match(lock, /vscode: 62_463/u);
  assert.match(lock, /exclusive: true/u);
  assert.match(lock, /process\.exit\(70\)/u);
  assert.match(lock, /state\.releasing = true[\s\S]*?server\.close/u);
  for (const forbidden of ["prompt", "selectedText", "workspaceRoot", "projectPath", "contextText"]) {
    assert.equal(source.includes(`event.${forbidden}`), false);
  }
});

test("runner accepts only verified npm Agent entries and has no formal-operation kill deadline", () => {
  const source = read("lib/agent-runner.js");
  assert.match(source, /manifest\?\.name !== "aethmere-agent"/u);
  assert.match(source, /basename !== "aethmere-agent\.cmd"/u);
  assert.doesNotMatch(source, /basename === "aethmere-agent\.exe"\) return/u);
  assert.match(source, /packageVersion/u);
  assert.match(source, /async formal\(args, \{ cwd, stdinText = "", timeoutMs = 0 \} = \{\}\)/u);
  assert.match(source, /async formalReady\(args, \{ cwd, requestFactory \} = \{\}\)/u);
  assert.match(source, /shell: false/u);
  assert.match(source, /READY_LINE/u);
  assert.equal((source.match(/https:\/\/aethmere\.com\/downloads\//gu) || []).length, 1);
  for (const blocked of ["AETHMERE_ALLOW_LOCAL_SERVER", "AETHMERE_HOME", "NODE_OPTIONS", "NODE_PATH"]) assert.match(source, new RegExp(`"${blocked}"`, "u"));
});

test("README and packaging scripts pin the 0.12.0 public artifacts and factual data boundary", () => {
  const readme = read("README.md");
  const packageScript = read("bin/package-vsix.mjs");
  const verifyScript = read("bin/verify-vsix.mjs");
  const ignore = read(".vscodeignore");
  assert.match(readme, /aethmere-agent-client-0\.12\.0\.tgz/u);
  assert.match(readme, /aethmere-vscode-0\.12\.0\.vsix/u);
  assert.match(readme, /aethmere\.stdin-ready\.v1/u);
  assert.match(readme, /does not read, write, watch, or open/u);
  assert.match(readme, /app\.aethmere\.com/u);
  assert.match(readme, /client_kind=vscode/u);
  assert.match(readme, /governance-spool-vscode/u);
  assert.match(packageScript, /aethmere-vscode-\$\{manifest\.version\}\.vsix/u);
  assert.match(packageScript, /\.sha256\.txt/u);
  assert.match(verifyScript, /packaged\.version !== "0\.12\.0"/u);
  assert.match(verifyScript, /extension\/lib\/agent-runner\.js/u);
  assert.match(verifyScript, /extension\/lib\/governance-client\.js/u);
  assert.match(verifyScript, /extension\/lib\/operation-lock\.js/u);
  for (const value of ["bin/**", "dist/**", "node_modules/**", "test/**", "package-lock.json"]) assert.match(ignore, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("repository Agent source contains the stable interactive add contract", () => {
  const agent = fs.readFileSync(path.resolve(root, "..", "agent-client", "bin", "aethmere-agent.mjs"), "utf8");
  assert.match(agent, /--request-stdin/u);
  assert.match(agent, /aethmere\.stdin-ready\.v1/u);
  assert.match(agent, /async function readGetRequest/u);
});
