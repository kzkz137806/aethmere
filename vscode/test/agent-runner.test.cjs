"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  AgentRunner,
  UPDATE_URL,
  assertSupportedVersion,
  invocationFromPosixCandidates,
  invocationFromWindowsCandidates,
  parseAgentJson,
  sanitizedEnvironment,
} = require("../lib/agent-runner.js");

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aethmere-vscode-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function createPackage(base, { name = "aethmere-agent", version = "0.12.0", entryName = "aethmere-agent.mjs" } = {}) {
  const packageRoot = path.join(base, "node_modules", "aethmere-agent");
  const entry = path.join(packageRoot, "bin", entryName);
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "#!/usr/bin/env node\n", "utf8");
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
    name,
    version,
    bin: { "aethmere-agent": `bin/${entryName}` },
  }), "utf8");
  return { packageRoot, entry };
}

function createFakeAgent(directory) {
  const script = path.join(directory, "fake-agent.cjs");
  fs.writeFileSync(script, `
"use strict";
const fs = require("node:fs");
const args = process.argv.slice(2);
const mode = process.env.AGENT_TEST_MODE || "ok";
const log = process.env.AGENT_TEST_LOG;
function append(input = "") {
  if (!log) return;
  fs.appendFileSync(log, JSON.stringify({
    args,
    input,
    blocked: {
      home: process.env.AETHMERE_HOME,
      local: process.env.AETHMERE_ALLOW_LOCAL_SERVER,
      nodeOptions: process.env.NODE_OPTIONS,
      nodePath: process.env.NODE_PATH,
    },
  }) + "\\n");
}
if (args.includes("--version")) {
  append();
  process.stdout.write((process.env.AGENT_TEST_VERSION || "Aethmere Agent Client 0.12.0") + "\\n");
} else if (args.includes("--request-stdin")) {
  if (mode === "bad-ready") {
    process.stdout.write('{"schema":"wrong","ready":true}\\n');
  } else if (mode === "extra-ready") {
    process.stdout.write('{"schema":"aethmere.stdin-ready.v1","ready":true}\\nextra');
  } else {
    setTimeout(() => {
      process.stdout.write('{"schema":"aethmere.stdin-ready.v1","ready":true}\\n');
      if (mode === "final-early") process.stdout.write('{"schema":"aethmere.local-add.v1","ok":true,"item":{}}\\n');
    }, 20);
  }
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    const input = Buffer.concat(chunks).toString("utf8");
    append(input);
    if (mode !== "final-early") process.stdout.write(JSON.stringify({ schema: "aethmere.local-add.v1", ok: true, item: { id: "SAFE", title: "Safe", text: "secret", tags: [] } }, null, 2) + "\\n");
  });
} else {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    const input = Buffer.concat(chunks).toString("utf8");
    append(input);
    process.stdout.write(JSON.stringify({ schema: "aethmere.context-list.v1", ok: true, items: [] }) + "\\n");
  });
}
`, "utf8");
  return script;
}

function fakeRunner(script, environment) {
  return new AgentRunner({
    environment,
    resolveInvocation: async () => ({
      command: process.execPath,
      argsPrefix: [script],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      packageVersion: "0.12.0",
    }),
  });
}

test("semantic version verification is exact and fail closed", () => {
  assert.equal(assertSupportedVersion("Aethmere Agent Client 0.12.0\n"), "0.12.0");
  assert.equal(assertSupportedVersion("Aethmere Agent Client 1.0.0+build.4"), "1.0.0+build.4");
  for (const output of [
    "Aethmere Agent Client 0.11.9",
    "Aethmere Agent Client 0.12.0-beta.1",
    "Aethmere Agent Client 00.12.0",
    "Aethmere Agent Client 0.12.0\nnoise",
    "0.12.0",
    "",
  ]) assert.throws(() => assertSupportedVersion(output), (error) => error.message.includes(UPDATE_URL) || error.code === "AGENT_VERSION_UNSUPPORTED");
  assert.throws(() => assertSupportedVersion("Aethmere Agent Client 0.12.1", "0.12.0"), { code: "AGENT_VERSION_INVALID" });
});

test("Windows resolution rejects executables and invokes only a verified npm package entry", (t) => {
  const directory = temporary(t);
  const { entry } = createPackage(directory);
  const commandShim = path.join(directory, "aethmere-agent.cmd");
  const executable = path.join(directory, "aethmere-agent.exe");
  fs.writeFileSync(commandShim, "untrusted shim is never executed", "utf8");
  fs.writeFileSync(executable, "untrusted executable", "utf8");
  assert.equal(invocationFromWindowsCandidates([executable], "verified-node"), null);
  const invocation = invocationFromWindowsCandidates([executable, commandShim], "verified-node");
  assert.deepEqual(invocation, {
    command: "verified-node",
    argsPrefix: [entry],
    env: { ELECTRON_RUN_AS_NODE: "1" },
    packageVersion: "0.12.0",
  });
  createPackage(path.join(directory, "old"), { version: "0.11.9" });
  assert.equal(invocationFromWindowsCandidates([path.join(directory, "old", "aethmere-agent.cmd")], "verified-node"), null);
});

test("POSIX resolution rejects arbitrary PATH programs and binds the package bin entry", (t) => {
  const directory = temporary(t);
  const fake = path.join(directory, "aethmere-agent");
  fs.writeFileSync(fake, "#!/bin/sh\necho fake\n", "utf8");
  assert.equal(invocationFromPosixCandidates([fake], "verified-node"), null);
  const { entry } = createPackage(path.join(directory, "official"), { entryName: "aethmere-agent" });
  const invocation = invocationFromPosixCandidates([entry], "verified-node");
  assert.equal(invocation.command, "verified-node");
  assert.deepEqual(invocation.argsPrefix, [entry]);
  assert.equal(invocation.packageVersion, "0.12.0");
});

test("formal calls verify version first, disable shell, sanitize overrides, and keep stdin out of argv", async (t) => {
  const directory = temporary(t);
  const log = path.join(directory, "calls.jsonl");
  const script = createFakeAgent(directory);
  const environment = {
    ...process.env,
    AGENT_TEST_LOG: log,
    AETHMERE_HOME: "alternate-home",
    AETHMERE_ALLOW_LOCAL_SERVER: "1",
    NODE_OPTIONS: "--require injected.js",
    NODE_PATH: "injected-modules",
  };
  const spawnCalls = [];
  const runner = fakeRunner(script, environment);
  const originalSpawn = runner.spawnImpl;
  runner.spawnImpl = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    return originalSpawn(command, args, options);
  };
  const result = await runner.formal(["list", "--json"], { cwd: directory, stdinText: "private-stdin" });
  assert.equal(parseAgentJson(result.stdout, "aethmere.context-list.v1").items.length, 0);
  const records = fs.readFileSync(log, "utf8").trim().split(/\r?\n/u).map(JSON.parse);
  assert.deepEqual(records.map((record) => record.args), [["--version"], ["list", "--json"]]);
  assert.equal(records[1].input, "private-stdin");
  assert.equal(records[1].args.includes("private-stdin"), false);
  assert.deepEqual(records[1].blocked, {});
  assert.equal(spawnCalls.every((call) => call.options.shell === false), true);
  assert.equal(spawnCalls.every((call) => call.options.env.ELECTRON_RUN_AS_NODE === "1"), true);
});

test("ready-gated formal input is produced only after the exact READY line", async (t) => {
  const directory = temporary(t);
  const log = path.join(directory, "ready.jsonl");
  const script = createFakeAgent(directory);
  const runner = fakeRunner(script, { ...process.env, AGENT_TEST_LOG: log });
  let factoryCalled = false;
  const pending = runner.formalReady(["add", "--request-stdin", "--json"], {
    cwd: directory,
    requestFactory: () => {
      factoryCalled = true;
      return JSON.stringify({ id: "SAFE", title: "Safe", text: "secret", tags: [], replace: false });
    },
  });
  assert.equal(factoryCalled, false);
  const result = await pending;
  assert.equal(factoryCalled, true);
  assert.equal(parseAgentJson(result.stdout, "aethmere.local-add.v1").item.id, "SAFE");
  const records = fs.readFileSync(log, "utf8").trim().split(/\r?\n/u).map(JSON.parse);
  assert.deepEqual(records.map((record) => record.args), [["--version"], ["add", "--request-stdin", "--json"]]);
  const request = JSON.parse(records[1].input.trim());
  assert.equal(request.text, "secret");
  assert.equal(records[1].args.some((arg) => arg.includes("secret") || arg.includes("SAFE")), false);
});

test("invalid, extra, or early READY protocol output never admits the request factory", async (t) => {
  for (const mode of ["bad-ready", "extra-ready", "final-early"]) {
    const directory = temporary(t);
    const script = createFakeAgent(directory);
    let factoryCalls = 0;
    const runner = fakeRunner(script, { ...process.env, AGENT_TEST_MODE: mode });
    await assert.rejects(runner.formalReady(["add", "--request-stdin", "--json"], {
      cwd: directory,
      requestFactory: async () => {
        factoryCalls += 1;
        if (mode === "final-early") await new Promise((resolve) => setTimeout(resolve, 60));
        return "{}";
      },
    }), { code: "AGENT_PROTOCOL_INVALID" });
    if (mode !== "final-early") assert.equal(factoryCalls, 0);
  }
});

test("unsupported Agent versions stop before the formal action", async (t) => {
  const directory = temporary(t);
  const log = path.join(directory, "old.jsonl");
  const script = createFakeAgent(directory);
  const runner = fakeRunner(script, { ...process.env, AGENT_TEST_LOG: log, AGENT_TEST_VERSION: "Aethmere Agent Client 0.11.9" });
  await assert.rejects(runner.formal(["list", "--json"], { cwd: directory }), { code: "AGENT_VERSION_UNSUPPORTED" });
  const records = fs.readFileSync(log, "utf8").trim().split(/\r?\n/u).map(JSON.parse);
  assert.deepEqual(records.map((record) => record.args), [["--version"]]);
});

test("server/home overrides and malformed Agent JSON are rejected", async () => {
  const runner = new AgentRunner({ resolveInvocation: async () => ({ command: process.execPath, argsPrefix: [] }) });
  await assert.rejects(runner.formal(["list", "--server=https://evil.invalid"]), { code: "AGENT_ARGUMENT_INVALID" });
  await assert.rejects(runner.formal(["list", "--home", "elsewhere"]), { code: "AGENT_ARGUMENT_INVALID" });
  assert.throws(() => parseAgentJson("not-json", "schema"), { code: "AGENT_RESPONSE_INVALID" });
  assert.deepEqual(sanitizedEnvironment({ Path: "safe", NODE_OPTIONS: "bad", aethmere_home: "bad" }), { Path: "safe" });
});
