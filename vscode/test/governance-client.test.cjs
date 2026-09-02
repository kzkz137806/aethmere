"use strict";

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  EXTENSION_VERSION,
  GOVERNANCE_EVENT_SCHEMA,
  GOVERNANCE_POLICY_DIGEST,
  GOVERNANCE_STATUS_SCHEMA,
  GovernanceCancelledError,
  UPDATE_URL,
  VscodeGovernance,
  isGovernanceCancellation,
  verifyExtensionManifest,
} = require("../lib/governance-client.js");
const { acquireGovernanceOperationLock, releaseGovernanceOperationLock } = require("../lib/operation-lock.js");

const EXTENSION_ROOT = path.resolve(__dirname, "..");
const ACCOUNT_ID = "account-vscode-governance-test";
const ACCOUNT_BINDING = crypto.createHash("sha256").update(ACCOUNT_ID, "utf8").digest("hex");
const TOKEN = `aet_dev_${"A".repeat(48)}`;

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aethmere-vscode-governance-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeAccount(home) {
  const directory = path.join(home, ".aethmere");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "account.json"), `${JSON.stringify({
    schema: "aethmere.desktop-account.v1",
    server: "https://app.aethmere.com",
    accessToken: TOKEN,
    accountBinding: ACCOUNT_BINDING,
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    linkedAt: "2026-09-02T00:00:00.000Z",
  })}\n`, "utf8");
}

function policy(overrides = {}) {
  return {
    schema: GOVERNANCE_STATUS_SCHEMA,
    ok: true,
    required: true,
    policyDigest: GOVERNANCE_POLICY_DIGEST,
    eventSchema: GOVERNANCE_EVENT_SCHEMA,
    rawContentAccepted: false,
    minimumClientVersions: { agent_client: EXTENSION_VERSION, studio: EXTENSION_VERSION, vscode: EXTENSION_VERSION },
    latestClientVersions: { agent_client: EXTENSION_VERSION, studio: EXTENSION_VERSION, vscode: EXTENSION_VERSION },
    updateUrl: UPDATE_URL,
    ...overrides,
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function spoolFiles(home) {
  const directory = path.join(home, ".aethmere", "governance-spool-vscode");
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

async function jsonLineFromChild(child, label) {
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`${label} did not start: ${stderr}`)), 5000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(buffer.slice(0, newline))); } catch (error) { reject(error); }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${label} exited before ready (${code}): ${stderr}`));
    });
  });
}

async function startVscodeLockHolder(home) {
  const moduleFile = path.resolve(__dirname, "..", "lib", "operation-lock.js");
  const childSource = `
    const { acquireGovernanceOperationLock, releaseGovernanceOperationLock } = require(${JSON.stringify(moduleFile)});
    (async () => {
      const lock = await acquireGovernanceOperationLock({
        home: ${JSON.stringify(home)}, lockName: "vscode", accountBinding: ${JSON.stringify(ACCOUNT_BINDING)},
        clientKind: "vscode", clientVersion: ${JSON.stringify(EXTENSION_VERSION)}, waitMs: 1000
      });
      process.stdout.write(JSON.stringify(lock.endpoint) + "\\n");
      const keepalive = setInterval(() => {}, 1000);
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", async (value) => {
        if (String(value).trim() !== "release") process.exit(2);
        await releaseGovernanceOperationLock(lock);
        clearInterval(keepalive);
        process.stdout.write("released\\n", () => process.exit(0));
      });
    })().catch((error) => { process.stderr.write(error.stack + "\\n"); process.exit(1); });
  `;
  const child = spawn(process.execPath, ["--eval", childSource], { stdio: ["pipe", "pipe", "pipe"] });
  return { child, endpoint: await jsonLineFromChild(child, "VS Code lock holder") };
}

async function startVscodePersistenceFailureHolder(home) {
  const governanceFile = path.resolve(__dirname, "..", "lib", "governance-client.js");
  const childSource = `
    const fs = require("node:fs");
    const path = require("node:path");
    const { VscodeGovernance } = require(${JSON.stringify(governanceFile)});
    (async () => {
      const governance = new VscodeGovernance({
        extensionRoot: ${JSON.stringify(EXTENSION_ROOT)}, home: ${JSON.stringify(home)},
        fetchImpl: async (_url, options = {}) => {
          if (options.method === "GET") return new Response(JSON.stringify(${JSON.stringify(policy())}), { status: 200 });
          const count = JSON.parse(options.body).events.length;
          return new Response(JSON.stringify({ accepted: count, stored: count, rejected: [] }), { status: 200 });
        }
      });
      try {
        await governance.run("MEMORY_GET", () => {
          fs.writeFileSync(path.join(${JSON.stringify(home)}, ".aethmere", "governance-spool-vscode"), "not-a-directory", "utf8");
          return "locally completed";
        });
        process.exit(3);
      } catch (error) {
        process.stdout.write(JSON.stringify({ locked: true, message: error.message }) + "\\n");
        setInterval(() => {}, 1000);
      }
    })().catch((error) => { process.stderr.write(error.stack + "\\n"); process.exit(1); });
  `;
  const child = spawn(process.execPath, ["--eval", childSource], { stdio: ["ignore", "pipe", "pipe"] });
  return { child, report: await jsonLineFromChild(child, "VS Code persistence-failure holder") };
}

test("installed extension manifest and code version are exact stable 0.12.0", (t) => {
  assert.equal(verifyExtensionManifest(EXTENSION_ROOT), "0.12.0");
  const root = temporary(t);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "aethmere-vscode", publisher: "aethmere", main: "./extension.js", version: "0.12.0-beta.1",
  }), "utf8");
  assert.throws(() => verifyExtensionManifest(root), /Install Aethmere VS Code 0\.12\.0/u);
});

test("VS Code status, full ACK start, Agent action, durable terminal and POST are ordered", async (t) => {
  const home = temporary(t);
  writeAccount(home);
  const calls = [];
  const governance = new VscodeGovernance({
    extensionRoot: EXTENSION_ROOT,
    home,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://app.aethmere.com/api/governance");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["x-aethmere-client-kind"], "vscode");
      assert.equal(options.headers["x-aethmere-client-version"], "0.12.0");
      if (options.method === "GET") {
        calls.push("status");
        return response(policy());
      }
      assert.equal(options.headers.origin, "https://app.aethmere.com");
      const events = JSON.parse(options.body).events;
      calls.push(...events.map((event) => event.outcome));
      if (events[0].outcome !== "started") assert.equal(spoolFiles(home).length, 1);
      return response({ accepted: events.length, stored: events.length, rejected: [] });
    },
  });
  const result = await governance.run("MEMORY_GET", async () => {
    calls.push("agent-action");
    return "done";
  });
  assert.equal(result, "done");
  assert.deepEqual(calls, ["status", "started", "agent-action", "success"]);
  assert.deepEqual(spoolFiles(home), []);
});

test("minimum.vscode 0.13.0 blocks before selection, context ID, or Agent process access", async (t) => {
  const home = temporary(t);
  writeAccount(home);
  let selectionReads = 0;
  let idReads = 0;
  let agentActions = 0;
  let posts = 0;
  const sensitive = {
    get selection() { selectionReads += 1; return "secret selection"; },
    get id() { idReads += 1; return "SECRET_ID"; },
  };
  const unsupported = policy({
    minimumClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.13.0" },
    latestClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.13.0" },
  });
  const governance = new VscodeGovernance({
    extensionRoot: EXTENSION_ROOT,
    home,
    fetchImpl: async (_url, options) => {
      if (options.method === "POST") posts += 1;
      return response(options.method === "GET" ? unsupported : { accepted: 1, stored: 1, rejected: [] });
    },
  });
  for (const stepCode of ["LOCAL_CANDIDATE_READY", "MEMORY_GET"]) {
    await assert.rejects(governance.run(stepCode, async () => {
      agentActions += 1;
      String(stepCode === "MEMORY_GET" ? sensitive.id : sensitive.selection);
    }), (error) => {
      assert.equal(error.reasonCode, "VERSION_UNSUPPORTED");
      return true;
    });
  }
  assert.equal(selectionReads, 0);
  assert.equal(idReads, 0);
  assert.equal(agentActions, 0);
  assert.equal(posts, 0);
});

test("user cancellation is durably reported as cancelled and remains an internal sentinel", async (t) => {
  const home = temporary(t);
  writeAccount(home);
  const events = [];
  const governance = new VscodeGovernance({
    extensionRoot: EXTENSION_ROOT,
    home,
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") return response(policy());
      const posted = JSON.parse(options.body).events;
      events.push(...posted);
      return response({ accepted: posted.length, stored: posted.length, rejected: [] });
    },
  });
  await assert.rejects(governance.run("LOCAL_CANDIDATE_READY", () => {
    throw new GovernanceCancelledError();
  }), (error) => {
    assert.equal(isGovernanceCancellation(error), true);
    return true;
  });
  assert.deepEqual(events.map((event) => [event.outcome, event.reason_code]), [
    ["started", "NONE"],
    ["cancelled", "USER_CANCELLED"],
  ]);
});

test("extension command wrappers use the real unsupported policy before prompts, ID coercion, and Agent spawn", async (t) => {
  const home = temporary(t);
  writeAccount(home);
  const unsupported = policy({
    minimumClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.13.0" },
    latestClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.13.0" },
  });
  const realGovernance = new VscodeGovernance({
    extensionRoot: EXTENSION_ROOT,
    home,
    fetchImpl: async () => response(unsupported),
  });
  let agentCalls = 0;
  let selectionReads = 0;
  let idReads = 0;
  let promptCalls = 0;
  const handlers = new Map();

  class FakeAgentRunner {
    async formal() { agentCalls += 1; throw new Error("Agent must not run"); }
    async formalReady() { agentCalls += 1; throw new Error("Agent must not run"); }
    async version() { agentCalls += 1; throw new Error("Agent must not run"); }
  }
  class EventEmitter { constructor() { this.event = () => undefined; } fire() {} }
  const vscodeMock = {
    EventEmitter,
    ThemeIcon: class {},
    TreeItem: class {},
    Uri: { parse: (value) => value },
    commands: { registerCommand(id, handler) { handlers.set(id, handler); return { dispose() {} }; } },
    env: { openExternal: async () => undefined },
    window: {
      get activeTextEditor() { selectionReads += 1; return null; },
      registerTreeDataProvider: () => ({ dispose() {} }),
      showErrorMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showInputBox: async () => { promptCalls += 1; return "SHOULD_NOT_BE_READ"; },
      showTextDocument: async () => undefined,
      showWarningMessage: async () => undefined,
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "C:\\never-read" } }],
      openTextDocument: async () => undefined,
    },
  };
  const id = { toString() { idReads += 1; return "SECRET_ID"; } };
  const runnerPath = require.resolve("../lib/agent-runner.js");
  const governancePath = require.resolve("../lib/governance-client.js");
  const extensionPath = require.resolve("../extension.js");
  const oldRunnerCache = require.cache[runnerPath];
  const oldGovernanceCache = require.cache[governancePath];
  const oldLoad = Module._load;
  require.cache[runnerPath] = { id: runnerPath, filename: runnerPath, loaded: true, exports: {
    AgentRunner: FakeAgentRunner, MINIMUM_AGENT_VERSION: "0.12.0", UPDATE_URL, parseAgentJson() {},
  }, children: [], paths: [] };
  const actualGovernance = require(governancePath);
  require.cache[governancePath] = { id: governancePath, filename: governancePath, loaded: true, exports: {
    ...actualGovernance,
    createVscodeGovernance: () => realGovernance,
  }, children: [], paths: [] };
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscodeMock;
    return oldLoad.call(this, request, parent, isMain);
  };
  delete require.cache[extensionPath];
  try {
    const extension = require(extensionPath);
    extension.activate({ extensionPath: EXTENSION_ROOT, subscriptions: { push() {} } });
    await handlers.get("aethmere.saveSelection")();
    await handlers.get("aethmere.openContext")(id);
    assert.equal(promptCalls, 0);
    assert.equal(selectionReads, 0);
    assert.equal(idReads, 0);
    assert.equal(agentCalls, 0);
  } finally {
    Module._load = oldLoad;
    delete require.cache[extensionPath];
    if (oldRunnerCache) require.cache[runnerPath] = oldRunnerCache; else delete require.cache[runnerPath];
    if (oldGovernanceCache) require.cache[governancePath] = oldGovernanceCache; else delete require.cache[governancePath];
  }
});

test("exact maps, stable versions, fresh stored ACK and bounded streaming fail closed", async (t) => {
  const badPolicies = [
    policy({ minimumClientVersions: { agent_client: "0.12.0", studio: "0.12.0" } }),
    policy({ latestClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0", native: "0.12.0" } }),
    policy({ minimumClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0-beta.1" } }),
    policy({ updateUrl: "https://example.test/downloads/" }),
  ];
  for (const invalidPolicy of badPolicies) {
    const home = temporary(t); writeAccount(home); let actionCalls = 0;
    const governance = new VscodeGovernance({ extensionRoot: EXTENSION_ROOT, home, fetchImpl: async () => response(invalidPolicy) });
    await assert.rejects(governance.run("MEMORY_RECALL", () => { actionCalls += 1; }), /GOVERNANCE_CONNECTION_REQUIRED/u);
    assert.equal(actionCalls, 0);
  }

  for (const acknowledgement of [{ accepted: 1, stored: 0, rejected: [] }, { accepted: 1, rejected: [] }]) {
    const home = temporary(t); writeAccount(home); let actionCalls = 0;
    const governance = new VscodeGovernance({
      extensionRoot: EXTENSION_ROOT, home,
      fetchImpl: async (_url, options) => response(options.method === "GET" ? policy() : acknowledgement),
    });
    await assert.rejects(governance.run("MEMORY_RECALL", () => { actionCalls += 1; }), /start event was not acknowledged/u);
    assert.equal(actionCalls, 0);
  }

  const home = temporary(t); writeAccount(home); let actionCalls = 0;
  const governance = new VscodeGovernance({
    extensionRoot: EXTENSION_ROOT, home,
    fetchImpl: async () => new Response("x".repeat(64_001), { status: 200 }),
  });
  await assert.rejects(governance.run("MEMORY_RECALL", () => { actionCalls += 1; }), /safety limit/u);
  assert.equal(actionCalls, 0);
});

test("VS Code fixed endpoint releases normally and can be rebound", async (t) => {
  const firstHome = temporary(t);
  const secondHome = temporary(t);
  const options = {
    home: firstHome,
    lockName: "vscode",
    accountBinding: ACCOUNT_BINDING,
    clientKind: "vscode",
    clientVersion: EXTENSION_VERSION,
    waitMs: 100,
  };
  const first = await acquireGovernanceOperationLock(options);
  assert.deepEqual(first.endpoint, { host: "127.0.0.1", port: 62_463 });
  await assert.rejects(acquireGovernanceOperationLock({ ...options, home: secondHome, waitMs: 0 }), /Another governed capability/u);
  await releaseGovernanceOperationLock(first);
  const rebound = await acquireGovernanceOperationLock({ ...options, home: secondHome });
  assert.deepEqual(rebound.endpoint, first.endpoint);
  await releaseGovernanceOperationLock(rebound);
});

test("VS Code OS mutex covers the complete Agent action and concurrent action remains zero", async (t) => {
  const home = temporary(t); writeAccount(home);
  const fetchImpl = async (_url, options) => {
    if (options.method === "GET") return response(policy());
    const events = JSON.parse(options.body).events;
    return response({ accepted: events.length, stored: events.length, rejected: [] });
  };
  const firstGovernance = new VscodeGovernance({ extensionRoot: EXTENSION_ROOT, home, fetchImpl });
  const secondGovernance = new VscodeGovernance({ extensionRoot: EXTENSION_ROOT, home, fetchImpl });
  let releaseAction;
  let signalAction;
  const actionStarted = new Promise((resolve) => { signalAction = resolve; });
  const actionRelease = new Promise((resolve) => { releaseAction = resolve; });
  const first = firstGovernance.run("MEMORY_GET", async () => {
    signalAction();
    await actionRelease;
    return "first";
  });
  await actionStarted;
  let concurrentActionCalls = 0;
  try {
    await assert.rejects(secondGovernance.run("MEMORY_RECALL", () => {
      concurrentActionCalls += 1;
    }), /Another governed capability/u);
    assert.equal(concurrentActionCalls, 0);
  } finally {
    releaseAction();
  }
  assert.equal(await first, "first");
});

test("VS Code cross-process close and SIGKILL block action then permit exact endpoint rebind", async (t) => {
  const home = temporary(t); writeAccount(home);
  const lockOptions = {
    home, lockName: "vscode", accountBinding: ACCOUNT_BINDING, clientKind: "vscode",
    clientVersion: EXTENSION_VERSION, waitMs: 1000,
  };
  const normalHolder = await startVscodeLockHolder(home);
  try {
    let actionCalls = 0;
    const governance = new VscodeGovernance({
      extensionRoot: EXTENSION_ROOT, home,
      fetchImpl: async () => { throw new Error("network must not run while cross-process lock is held"); },
    });
    await assert.rejects(governance.run("MEMORY_GET", () => { actionCalls += 1; }), /Another governed capability/u);
    assert.equal(actionCalls, 0);
    const exited = once(normalHolder.child, "exit");
    normalHolder.child.stdin.write("release\n");
    await exited;
    const rebound = await acquireGovernanceOperationLock(lockOptions);
    assert.deepEqual(rebound.endpoint, normalHolder.endpoint);
    await releaseGovernanceOperationLock(rebound);
  } finally {
    if (normalHolder.child.exitCode === null) normalHolder.child.kill("SIGKILL");
  }

  const killedHolder = await startVscodeLockHolder(home);
  const killed = once(killedHolder.child, "exit");
  killedHolder.child.kill("SIGKILL");
  await killed;
  const rebound = await acquireGovernanceOperationLock(lockOptions);
  assert.deepEqual(rebound.endpoint, killedHolder.endpoint);
  await releaseGovernanceOperationLock(rebound);
});

test("VS Code runtime listener loss exits 70 before the Agent action can continue", (t) => {
  const home = temporary(t); writeAccount(home);
  const continuedMarker = path.join(home, "vscode-action-continued.txt");
  const governanceFile = path.resolve(__dirname, "..", "lib", "governance-client.js");
  const childSource = `
    const fs = require("node:fs");
    const net = require("node:net");
    const originalCreateServer = net.createServer.bind(net);
    let lockServer;
    net.createServer = (...args) => {
      lockServer = originalCreateServer(...args);
      return lockServer;
    };
    const { VscodeGovernance } = require(${JSON.stringify(governanceFile)});
    (async () => {
      const governance = new VscodeGovernance({
        extensionRoot: ${JSON.stringify(EXTENSION_ROOT)}, home: ${JSON.stringify(home)},
        fetchImpl: async (_url, options = {}) => {
          if (options.method === "GET") return new Response(JSON.stringify(${JSON.stringify(policy())}), { status: 200 });
          const count = JSON.parse(options.body).events.length;
          return new Response(JSON.stringify({ accepted: count, stored: count, rejected: [] }), { status: 200 });
        }
      });
      await governance.run("MEMORY_GET", async () => {
        lockServer.close();
        await new Promise((resolve) => setTimeout(resolve, 250));
        fs.writeFileSync(${JSON.stringify(continuedMarker)}, "must-not-run", "utf8");
      });
    })();
  `;
  const child = spawnSync(process.execPath, ["--eval", childSource], { encoding: "utf8", timeout: 5000 });
  assert.equal(child.status, 70, child.stdout + child.stderr);
  assert.match(child.stderr, /operating-system governance lock was lost/u);
  assert.equal(fs.existsSync(continuedMarker), false);
});

test("VS Code cross-process terminal persistence failure retains the lock until process exit", async (t) => {
  const home = temporary(t); writeAccount(home);
  const holder = await startVscodePersistenceFailureHolder(home);
  assert.equal(holder.report.locked, true);
  assert.match(holder.report.message, /目录|directory/iu);
  try {
    let actionCalls = 0;
    const governance = new VscodeGovernance({
      extensionRoot: EXTENSION_ROOT, home,
      fetchImpl: async () => { throw new Error("network must not run while persistence-failure lock is held"); },
    });
    await assert.rejects(governance.run("MEMORY_GET", () => { actionCalls += 1; }), /Another governed capability/u);
    assert.equal(actionCalls, 0);
  } finally {
    const exited = once(holder.child, "exit");
    holder.child.kill("SIGKILL");
    await exited;
  }
  fs.unlinkSync(path.join(home, ".aethmere", "governance-spool-vscode"));
  const recovered = await acquireGovernanceOperationLock({
    home, lockName: "vscode", accountBinding: ACCOUNT_BINDING, clientKind: "vscode",
    clientVersion: EXTENSION_VERSION, waitMs: 1000,
  });
  await releaseGovernanceOperationLock(recovered);
});
