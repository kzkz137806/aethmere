"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AgentRunner, parseAgentJson } = require("../lib/agent-runner.js");
const { VscodeGovernance } = require("../lib/governance-client.js");

const POLICY_DIGEST = "76d79b04705333ce60764488c8923ee25a24dae9e5d17a8fc08b67c14a033285";

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aethmere-vscode-real-agent-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.resolve(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("npm-cli.js is required for the packaged Agent integration test");
  return found;
}

function packAgent(agentRoot, directory) {
  const output = execFileSync(process.execPath, [
    npmCli(), "pack", agentRoot, "--pack-destination", directory, "--ignore-scripts", "--json",
  ], { encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" } });
  const report = JSON.parse(output);
  assert.equal(report.length, 1);
  const archive = path.join(directory, report[0].filename);
  const extracted = path.join(directory, "extracted");
  fs.mkdirSync(extracted);
  execFileSync(process.platform === "win32" ? "tar.exe" : "tar", ["-xzf", archive, "-C", extracted], { windowsHide: true });
  return path.join(extracted, "package");
}

test("independent VS Code governance nests the packaged real Agent READY add/get path", async (t) => {
  const directory = temporary(t);
  const repository = path.resolve(__dirname, "..", "..");
  const packageRoot = packAgent(path.join(repository, "agent-client"), directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.name, "aethmere-agent");
  assert.equal(manifest.version, "0.12.0");
  const entry = path.join(packageRoot, manifest.bin["aethmere-agent"]);
  assert.equal(fs.statSync(entry).isFile(), true);

  const home = path.join(directory, "home");
  const project = path.join(directory, "project");
  const log = path.join(directory, "governance.jsonl");
  fs.mkdirSync(path.join(home, ".aethmere"), { recursive: true });
  fs.mkdirSync(project);
  const accountId = "account-real-agent-e2e";
  fs.writeFileSync(path.join(home, ".aethmere", "account.json"), `${JSON.stringify({
    schema: "aethmere.desktop-account.v1",
    server: "https://app.aethmere.com",
    accessToken: `aet_dev_${"A".repeat(48)}`,
    accountBinding: crypto.createHash("sha256").update(accountId, "utf8").digest("hex"),
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    linkedAt: "2026-09-02T00:00:00.000Z",
  }, null, 2)}\n`, "utf8");

  const preload = path.join(directory, "first-party-fetch.cjs");
  fs.writeFileSync(preload, `
"use strict";
const fs = require("node:fs");
process.env.AETHMERE_HOME = process.env.AGENT_E2E_HOME;
const status = {
  schema: "aethmere.governance-status.v1",
  ok: true,
  required: true,
  policyDigest: ${JSON.stringify(POLICY_DIGEST)},
  eventSchema: "aethmere.client-behavior.v1",
  rawContentAccepted: false,
  minimumClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
  latestClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
  updateUrl: "https://aethmere.com/downloads/",
};
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.origin !== "https://app.aethmere.com" || url.pathname !== "/api/governance") throw new Error("unexpected endpoint");
  const method = String(options.method || "GET").toUpperCase();
  if (method === "POST" && new Headers(options.headers || {}).get("origin") !== "https://app.aethmere.com") throw new Error("missing first-party origin");
  const events = method === "POST" ? JSON.parse(String(options.body || "{}")).events : [];
  fs.appendFileSync(process.env.AGENT_E2E_LOG, JSON.stringify({ method, events }) + "\\n");
  const payload = method === "GET" ? status : { accepted: events.length, stored: events.length, rejected: [] };
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
};
`, "utf8");

  const spawnCalls = [];
  const runner = new AgentRunner({
    environment: { ...process.env, AGENT_E2E_HOME: home, AGENT_E2E_LOG: log },
    resolveInvocation: async () => ({
      command: process.execPath,
      argsPrefix: ["--require", preload, entry],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      packageVersion: manifest.version,
    }),
  });
  const originalSpawn = runner.spawnImpl;
  runner.spawnImpl = (command, args, options) => {
    spawnCalls.push({ command, args: [...args], options });
    return originalSpawn(command, args, options);
  };

  const vscodeEvents = [];
  const vscodeGovernance = new VscodeGovernance({
    extensionRoot: path.resolve(__dirname, ".."),
    home,
    fetchImpl: async (input, options = {}) => {
      assert.equal(String(input), "https://app.aethmere.com/api/governance");
      if (options.method === "GET") return new Response(JSON.stringify({
        schema: "aethmere.governance-status.v1",
        ok: true,
        required: true,
        policyDigest: POLICY_DIGEST,
        eventSchema: "aethmere.client-behavior.v1",
        rawContentAccepted: false,
        minimumClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
        latestClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
        updateUrl: "https://aethmere.com/downloads/",
      }), { status: 200 });
      assert.equal(options.headers.origin, "https://app.aethmere.com");
      const events = JSON.parse(options.body).events;
      vscodeEvents.push(...events);
      return new Response(JSON.stringify({ accepted: events.length, stored: events.length, rejected: [] }), { status: 200 });
    },
  });

  const initialized = await vscodeGovernance.run("LOCAL_CANDIDATE_READY", () => runner.formal(["init", "--json"], { cwd: project }));
  assert.equal(parseAgentJson(initialized.stdout, "aethmere.local-init.v1").ok, true);
  let readyFactoryCalls = 0;
  const added = await vscodeGovernance.run("LOCAL_CANDIDATE_READY", () => runner.formalReady(["add", "--request-stdin", "--json"], {
    cwd: project,
    requestFactory: () => {
      readyFactoryCalls += 1;
      const records = fs.readFileSync(log, "utf8").trim().split(/\r?\n/u).map(JSON.parse);
      assert.equal(records.some((record) => record.events.some((event) => event.step_code === "LOCAL_CANDIDATE_READY" && event.outcome === "started")), true);
      return JSON.stringify({ id: "PACKAGED", title: "Packed entry", text: "selected-real-secret", tags: ["e2e"], replace: false });
    },
  }));
  assert.equal(readyFactoryCalls, 1);
  assert.equal(parseAgentJson(added.stdout, "aethmere.local-add.v1").item.id, "PACKAGED");

  const fetched = await vscodeGovernance.run("MEMORY_GET", () => runner.formalReady(["get", "--request-stdin", "--json"], {
    cwd: project,
    requestFactory: () => JSON.stringify({ id: "PACKAGED" }),
  }));
  const fetchedItem = parseAgentJson(fetched.stdout, "aethmere.context-item.v1").item;
  assert.equal(fetchedItem.id, "PACKAGED");
  assert.equal(fetchedItem.text, "selected-real-secret");

  const store = JSON.parse(fs.readFileSync(path.join(project, ".aethmere", "context.json"), "utf8"));
  assert.equal(store.items[0].text, "selected-real-secret");
  assert.equal(spawnCalls.every((call) => call.options.shell === false), true);
  assert.equal(spawnCalls.some((call) => call.args.some((arg) => arg.includes("selected-real-secret") || arg === "PACKAGED" || arg === "Packed entry")), false);
  assert.equal(fs.readFileSync(log, "utf8").includes("selected-real-secret"), false);
  assert.deepEqual(vscodeEvents.map((event) => [event.client_kind, event.outcome]), [
    ["vscode", "started"], ["vscode", "success"],
    ["vscode", "started"], ["vscode", "success"],
    ["vscode", "started"], ["vscode", "success"],
  ]);
  assert.equal(JSON.stringify(vscodeEvents).includes("selected-real-secret"), false);
});
