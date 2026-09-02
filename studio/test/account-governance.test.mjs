import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { loadCloudAccount } from "../../agent-client/lib/cloud-client.mjs";
import {
  ACCOUNT_SCHEMA, AETHMERE_APP_ORIGIN, accountBinding, accountPaths, loadAccount,
  loginWithDeviceCode, logoutAccount, publicAccountStatus,
} from "../lib/account-client.mjs";
import {
  GOVERNANCE_EVENT_SCHEMA, GOVERNANCE_POLICY_DIGEST, GOVERNANCE_STATUS_SCHEMA, UPDATE_URL,
  buildGovernanceEvent, checkGovernanceConnection, runGovernedCapability,
} from "../lib/governance-client.mjs";
import { acquireGovernanceOperationLock, releaseGovernanceOperationLock } from "../lib/operation-lock.mjs";

const TOKEN = `aet_dev_${"A".repeat(48)}`;
const VERSION = "0.12.0";
const ACCOUNT_ID = "account-studio-owner";
const BINDING = crypto.createHash("sha256").update(ACCOUNT_ID, "utf8").digest("hex");

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
function policy(overrides = {}) {
  return {
    schema: GOVERNANCE_STATUS_SCHEMA, ok: true, required: true, policyDigest: GOVERNANCE_POLICY_DIGEST,
    eventSchema: GOVERNANCE_EVENT_SCHEMA, rawContentAccepted: false,
    minimumClientVersions: { agent_client: VERSION, studio: VERSION, vscode: VERSION },
    latestClientVersions: { agent_client: VERSION, studio: VERSION, vscode: VERSION },
    updateUrl: UPDATE_URL, ...overrides,
  };
}
async function temporaryHome(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aethmere-studio-governance-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}
function accountValue(overrides = {}) {
  return {
    schema: ACCOUNT_SCHEMA, server: AETHMERE_APP_ORIGIN, accessToken: TOKEN, accountBinding: BINDING,
    tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), linkedAt: new Date().toISOString(), ...overrides,
  };
}
function writeAccount(home, overrides = {}) {
  const paths = accountPaths(home);
  fs.mkdirSync(paths.directory, { recursive: true });
  fs.writeFileSync(paths.account, `${JSON.stringify(accountValue(overrides))}\n`, "utf8");
}
function terminalEvent(overrides = {}) {
  return buildGovernanceEvent({ clientVersion: VERSION, stepCode: "SEARCH", outcome: "success", reasonCode: "NONE", ...overrides });
}
function writeSpoolEntry(home, event = terminalEvent(), binding = BINDING) {
  const directory = accountPaths(home).governanceSpool;
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `terminal-${event.event_id}.json`);
  fs.writeFileSync(file, `${JSON.stringify({
    schema: "aethmere.governance-spool-entry.v1", account_binding: binding, state: "terminal", event,
  })}\n`, "utf8");
  return file;
}
function spoolFiles(home) {
  const directory = accountPaths(home).governanceSpool;
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}
function loginResponse(id = ACCOUNT_ID) {
  return json({
    accessToken: TOKEN, tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    account: { id, email: "not-persisted@example.test", displayName: "Not persisted" }, scopes: ["sync:read"],
  });
}

async function startStudioLockHolder(home) {
  const moduleUrl = pathToFileURL(path.resolve("lib", "operation-lock.mjs")).href;
  const childSource = `
    import { acquireGovernanceOperationLock, releaseGovernanceOperationLock } from ${JSON.stringify(moduleUrl)};
    const lock = await acquireGovernanceOperationLock({
      home: ${JSON.stringify(home)},
      lockName: "studio",
      accountBinding: ${JSON.stringify(BINDING)},
      clientKind: "studio",
      clientVersion: ${JSON.stringify(VERSION)},
      waitMs: 1000
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
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: path.resolve("."), stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.setEncoding("utf8");
  const endpoint = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`Studio lock holder did not start: ${stderr}`)), 5000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(buffer.slice(0, newline))); } catch (error) { reject(error); }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Studio lock holder exited before ready (${code}): ${stderr}`));
    });
  });
  return { child, endpoint };
}

test("Studio writes the exact shared account envelope, Agent reads it, and logout preserves terminal spool", async (t) => {
  const home = await temporaryHome(t);
  const requests = [];
  const status = await loginWithDeviceCode("abcd-1234", { home, fetchImpl: async (url, options) => {
    requests.push({ url, options }); return loginResponse();
  } });
  assert.equal(requests[0].url, `${AETHMERE_APP_ORIGIN}/api/auth/device-code`);
  assert.deepEqual(JSON.parse(requests[0].options.body), { code: "ABCD-1234" });
  assert.equal(status.connected, true);
  const disk = JSON.parse(fs.readFileSync(accountPaths(home).account, "utf8"));
  assert.deepEqual(Object.keys(disk).sort(), ["accessToken", "accountBinding", "linkedAt", "schema", "server", "tokenExpiresAt"].sort());
  assert.equal(disk.accountBinding, BINDING);
  assert.equal(JSON.stringify(disk).includes("not-persisted@example.test"), false);
  assert.equal(loadCloudAccount(home).accountBinding, BINDING);
  const pending = writeSpoolEntry(home);
  await logoutAccount({ home, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(fs.existsSync(accountPaths(home).account), false);
  assert.equal(fs.existsSync(pending), true);
  assert.equal(publicAccountStatus(home).connected, false);
});

test("same-account relogin is allowed while a different account cannot strand the shared spool", async (t) => {
  const home = await temporaryHome(t); writeAccount(home); writeSpoolEntry(home);
  await loginWithDeviceCode("same-1234", { home, fetchImpl: async () => loginResponse(ACCOUNT_ID) });
  assert.equal(loadAccount(home).accountBinding, BINDING);
  await assert.rejects(loginWithDeviceCode("other-1234", {
    home, fetchImpl: async () => loginResponse("different-account"),
  }), /另一个账号/u);
  assert.equal(loadAccount(home).accountBinding, BINDING);
  assert.equal(spoolFiles(home).length, 1);
});

test("account validation rejects origin, expiry, extras, oversize, and path-replacement TOCTOU", async (t) => {
  const home = await temporaryHome(t); writeAccount(home);
  const file = accountPaths(home).account;
  fs.writeFileSync(file, JSON.stringify(accountValue({ server: "https://example.test" })), "utf8");
  assert.throws(() => loadAccount(home), /授权格式无效/u);
  fs.writeFileSync(file, JSON.stringify(accountValue({ tokenExpiresAt: new Date(Date.now() - 1000).toISOString() })), "utf8");
  assert.throws(() => loadAccount(home), /已过期/u);
  fs.writeFileSync(file, JSON.stringify({ ...accountValue(), email: "extra@example.test" }), "utf8");
  assert.throws(() => loadAccount(home), /授权格式无效/u);
  fs.writeFileSync(file, "x".repeat(16_385), "utf8");
  assert.throws(() => loadAccount(home), /损坏/u);

  writeAccount(home);
  const replacement = path.join(home, "replacement.json");
  const original = path.join(home, "original.json");
  fs.writeFileSync(replacement, JSON.stringify(accountValue({ accessToken: `aet_dev_${"B".repeat(48)}` })), "utf8");
  const originalOpen = fs.openSync;
  let interposed = false;
  fs.openSync = function interposedOpen(target, flags, ...rest) {
    if (!interposed && path.resolve(String(target)) === path.resolve(file) && flags === fs.constants.O_RDONLY) {
      interposed = true; fs.renameSync(file, original); fs.renameSync(replacement, file);
    }
    return originalOpen.call(this, target, flags, ...rest);
  };
  try { assert.throws(() => loadAccount(home), /损坏/u); } finally { fs.openSync = originalOpen; }
  assert.equal(interposed, true);
  assert.equal(accountBinding(ACCOUNT_ID), BINDING);
});

test("account responses without Content-Length are stream-bounded", async (t) => {
  const home = await temporaryHome(t);
  const oversized = new Response("x".repeat(64_001), { status: 200 });
  assert.equal(oversized.headers.has("content-length"), false);
  await assert.rejects(loginWithDeviceCode("abcd-1234", { home, fetchImpl: async () => oversized }), /超过安全上限/u);
  assert.equal(fs.existsSync(accountPaths(home).account), false);
});

test("policy and stored start ACK precede action; terminal is spooled before POST", async (t) => {
  const home = await temporaryHome(t); writeAccount(home);
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "GET") return json(policy());
    const events = JSON.parse(options.body).events;
    if (events[0].outcome !== "started") assert.equal(spoolFiles(home).length, 1);
    return json({ accepted: events.length, stored: events.length, rejected: [] });
  };
  let actionCalled = false;
  const result = await runGovernedCapability({ home, fetchImpl, clientVersion: VERSION, stepCode: "CHAT" }, async () => {
    actionCalled = true;
    assert.equal(requests.length, 2);
    assert.equal(JSON.parse(requests[1].options.body).events[0].outcome, "started");
    return "done";
  });
  assert.equal(result, "done"); assert.equal(actionCalled, true);
  const events = requests.filter((request) => request.options.method === "POST").flatMap((request) => JSON.parse(request.options.body).events);
  assert.deepEqual(events.map((event) => event.outcome), ["started", "success"]);
  assert.equal(events[0].flow_id, events[1].flow_id);
  assert.deepEqual(spoolFiles(home), []);
  const serialized = JSON.stringify(events);
  for (const forbidden of ["prompt", "answer", "project", "path", "url", "token", "secret", TOKEN]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});

test("incomplete start acknowledgements block action without terminal spool", async (t) => {
  for (const acknowledgement of [
    { accepted: 1, stored: 0, rejected: [] }, { accepted: 1, rejected: [] }, { accepted: 1, stored: 1 },
    { accepted: 1, stored: 2, rejected: [] }, { accepted: 0, stored: 0, rejected: [{ index: 0 }] },
  ]) {
    const home = await temporaryHome(t); writeAccount(home); let actionCalled = false;
    await assert.rejects(runGovernedCapability({
      home, clientVersion: VERSION, stepCode: "CHAT",
      fetchImpl: async (_url, options) => options.method === "GET" ? json(policy()) : json(acknowledgement),
    }, async () => { actionCalled = true; }), /开始事件未被服务器确认/u);
    assert.equal(actionCalled, false); assert.deepEqual(spoolFiles(home), []);
  }
});

test("undelivered terminal blocks next action until immutable replay succeeds", async (t) => {
  const home = await temporaryHome(t); writeAccount(home);
  const firstFetch = async (_url, options) => {
    if (options.method === "GET") return json(policy());
    const events = JSON.parse(options.body).events;
    return events[0].outcome === "started"
      ? json({ accepted: events.length, stored: events.length, rejected: [] })
      : json({ error: "unavailable" }, 503);
  };
  assert.equal(await runGovernedCapability({ home, fetchImpl: firstFetch, clientVersion: VERSION, stepCode: "SEARCH" }, async () => "first"), "first");
  assert.equal(spoolFiles(home).length, 1);
  const envelope = JSON.parse(fs.readFileSync(path.join(accountPaths(home).governanceSpool, spoolFiles(home)[0]), "utf8"));
  assert.deepEqual(Object.keys(envelope).sort(), ["account_binding", "event", "schema", "state"]);
  assert.equal(envelope.account_binding, BINDING); assert.equal(envelope.state, "terminal");
  let blocked = false;
  await assert.rejects(runGovernedCapability({
    home, clientVersion: VERSION, stepCode: "SEARCH",
    fetchImpl: async (_url, options) => options.method === "GET" ? json(policy()) : json({ error: "still unavailable" }, 503),
  }, async () => { blocked = true; }), /历史治理事件尚未安全送达/u);
  assert.equal(blocked, false);
  const outcomes = [];
  const recoveryFetch = async (_url, options) => {
    if (options.method === "GET") return json(policy());
    const events = JSON.parse(options.body).events; outcomes.push(...events.map((event) => event.outcome));
    return json({ accepted: events.length, stored: events[0].outcome === "success" ? 0 : events.length, rejected: [] });
  };
  assert.equal(await runGovernedCapability({ home, fetchImpl: recoveryFetch, clientVersion: VERSION, stepCode: "SEARCH" }, async () => "recovered"), "recovered");
  assert.deepEqual(outcomes, ["success", "started", "success"]); assert.deepEqual(spoolFiles(home), []);
});

test("policy maps are exact stable semver and corrupt/started/oversized/mismatched spool fails closed", async (t) => {
  for (const { status, reasonCode } of [
    { status: policy({ policyDigest: "wrong" }), reasonCode: "POLICY_MISMATCH" },
    { status: policy({ minimumClientVersions: { agent_client: VERSION, studio: "0.13.0", vscode: VERSION }, latestClientVersions: { agent_client: VERSION, studio: "0.13.0", vscode: VERSION } }), reasonCode: "VERSION_UNSUPPORTED" },
    { status: policy({ minimumClientVersions: { agent_client: VERSION, studio: VERSION } }), reasonCode: "POLICY_MISMATCH" },
    { status: policy({ minimumClientVersions: { agent_client: VERSION, studio: VERSION, vscode: VERSION, native: VERSION } }), reasonCode: "POLICY_MISMATCH" },
    { status: policy({ latestClientVersions: { agent_client: VERSION, studio: "0.11.0", vscode: VERSION } }), reasonCode: "POLICY_MISMATCH" },
    { status: policy({ latestClientVersions: { agent_client: VERSION, studio: "0.12.0-beta.1", vscode: VERSION } }), reasonCode: "POLICY_MISMATCH" },
    { status: policy({ minimumClientVersions: { agent_client: VERSION, studio: "0.12.0+build.1", vscode: VERSION } }), reasonCode: "POLICY_MISMATCH" },
    { status: policy({ updateUrl: "https://example.test/downloads/" }), reasonCode: "POLICY_MISMATCH" },
  ]) {
    const home = await temporaryHome(t); writeAccount(home);
    await assert.rejects(checkGovernanceConnection({ home, clientVersion: VERSION, fetchImpl: async () => json(status) }), (error) => {
      assert.equal(error.reasonCode, reasonCode); return true;
    });
  }
  const setups = [
    (home) => { const directory = accountPaths(home).governanceSpool; fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, `terminal-${crypto.randomUUID()}.json`), "not-json\n", "utf8"); },
    (home) => writeSpoolEntry(home, buildGovernanceEvent({ clientVersion: VERSION, stepCode: "SEARCH", outcome: "started", reasonCode: "NONE" })),
    (home) => writeSpoolEntry(home, terminalEvent(), "b".repeat(64)),
    (home) => { const file = writeSpoolEntry(home); fs.writeFileSync(file, "x".repeat(16_385), "utf8"); },
  ];
  for (const setup of setups) {
    const home = await temporaryHome(t); writeAccount(home); setup(home); let actionCalled = false;
    await assert.rejects(runGovernedCapability({
      home, clientVersion: VERSION, stepCode: "CHAT",
      fetchImpl: async (_url, options) => options.method === "GET" ? json(policy()) : json({ accepted: 1, stored: 1, rejected: [] }),
    }, async () => { actionCalled = true; }), /GOVERNANCE_CONNECTION_REQUIRED/u);
    assert.equal(actionCalled, false);
  }
});

test("Studio uses one machine-global fixed OS endpoint across homes and awaits release", async (t) => {
  const firstHome = await temporaryHome(t);
  const secondHome = await temporaryHome(t);
  const options = {
    home: firstHome,
    lockName: "studio",
    accountBinding: BINDING,
    clientKind: "studio",
    clientVersion: VERSION,
    waitMs: 100,
  };
  const first = await acquireGovernanceOperationLock(options);
  assert.deepEqual(first.endpoint, { host: "127.0.0.1", port: 62_462 });
  await assert.rejects(acquireGovernanceOperationLock({ ...options, home: secondHome, waitMs: 0 }), /Another governed capability/u);
  await releaseGovernanceOperationLock(first);
  const rebound = await acquireGovernanceOperationLock({ ...options, home: secondHome });
  assert.deepEqual(rebound.endpoint, first.endpoint);
  await releaseGovernanceOperationLock(rebound);
});

test("Studio OS mutex covers the complete governed action and blocks a concurrent action", async (t) => {
  const home = await temporaryHome(t); writeAccount(home);
  let releaseAction;
  let signalAction;
  const actionStarted = new Promise((resolve) => { signalAction = resolve; });
  const actionRelease = new Promise((resolve) => { releaseAction = resolve; });
  const fetchImpl = async (_url, options) => {
    if (options.method === "GET") return json(policy());
    const events = JSON.parse(options.body).events;
    return json({ accepted: events.length, stored: events.length, rejected: [] });
  };
  const first = runGovernedCapability({ home, fetchImpl, clientVersion: VERSION, stepCode: "CHAT" }, async () => {
    signalAction();
    await actionRelease;
    return "first";
  });
  await actionStarted;
  let concurrentActionCalls = 0;
  try {
    await assert.rejects(runGovernedCapability({ home, fetchImpl, clientVersion: VERSION, stepCode: "SEARCH" }, () => {
      concurrentActionCalls += 1;
    }), /Another governed capability/u);
    assert.equal(concurrentActionCalls, 0);
  } finally {
    releaseAction();
  }
  assert.equal(await first, "first");
});

test("Studio cross-process close and SIGKILL both release the fixed endpoint for rebind", async (t) => {
  const home = await temporaryHome(t); writeAccount(home);
  const options = {
    home,
    lockName: "studio",
    accountBinding: BINDING,
    clientKind: "studio",
    clientVersion: VERSION,
    waitMs: 1000,
  };
  const normalHolder = await startStudioLockHolder(home);
  try {
    let actionCalls = 0;
    await assert.rejects(runGovernedCapability({
      home,
      clientVersion: VERSION,
      stepCode: "MEMORY_GET",
      fetchImpl: async () => { throw new Error("network must not run while cross-process lock is held"); },
    }, () => { actionCalls += 1; }), /Another governed capability/u);
    assert.equal(actionCalls, 0);
    const exited = once(normalHolder.child, "exit");
    normalHolder.child.stdin.write("release\n");
    await exited;
    const rebound = await acquireGovernanceOperationLock(options);
    assert.deepEqual(rebound.endpoint, normalHolder.endpoint);
    await releaseGovernanceOperationLock(rebound);
  } finally {
    if (normalHolder.child.exitCode === null) normalHolder.child.kill("SIGKILL");
  }

  const killedHolder = await startStudioLockHolder(home);
  const killed = once(killedHolder.child, "exit");
  killedHolder.child.kill("SIGKILL");
  await killed;
  const rebound = await acquireGovernanceOperationLock(options);
  assert.deepEqual(rebound.endpoint, killedHolder.endpoint);
  await releaseGovernanceOperationLock(rebound);
});

test("Studio runtime listener loss exits 70 before the governed action can continue", async (t) => {
  const home = await temporaryHome(t); writeAccount(home);
  const continuedMarker = path.join(home, "studio-action-continued.txt");
  const governanceUrl = pathToFileURL(path.resolve("lib", "governance-client.mjs")).href;
  const childSource = `
    import fs from "node:fs";
    import net from "node:net";
    const originalCreateServer = net.createServer.bind(net);
    let lockServer;
    net.createServer = (...args) => {
      lockServer = originalCreateServer(...args);
      return lockServer;
    };
    const { runGovernedCapability } = await import(${JSON.stringify(governanceUrl)});
    const fetchImpl = async (_input, options = {}) => {
      if ((options.method || "GET") === "GET") return new Response(JSON.stringify(${JSON.stringify(policy())}), { status: 200 });
      const count = JSON.parse(options.body).events.length;
      return new Response(JSON.stringify({ accepted: count, stored: count, rejected: [] }), { status: 200 });
    };
    await runGovernedCapability({
      home: ${JSON.stringify(home)}, fetchImpl, clientVersion: ${JSON.stringify(VERSION)}, stepCode: "MEMORY_GET"
    }, async () => {
      lockServer.close();
      await new Promise((resolve) => setTimeout(resolve, 250));
      fs.writeFileSync(${JSON.stringify(continuedMarker)}, "must-not-run", "utf8");
    });
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: path.resolve("."), encoding: "utf8", timeout: 5000,
  });
  assert.equal(child.status, 70, child.stdout + child.stderr);
  assert.match(child.stderr, /operating-system governance lock was lost/u);
  assert.equal(fs.existsSync(continuedMarker), false);
});

test("Studio terminal persistence failure retains the live-process OS mutex", async (t) => {
  const home = await temporaryHome(t); writeAccount(home);
  const fetchImpl = async (_url, options) => {
    if (options.method === "GET") return json(policy());
    const events = JSON.parse(options.body).events;
    return json({ accepted: events.length, stored: events.length, rejected: [] });
  };
  let actionCalls = 0;
  await assert.rejects(runGovernedCapability({ home, fetchImpl, clientVersion: VERSION, stepCode: "CHAT" }, () => {
    actionCalls += 1;
    fs.writeFileSync(accountPaths(home).governanceSpool, "not-a-directory", "utf8");
    return "locally completed";
  }), /真实目录|private storage|directory/iu);
  assert.equal(actionCalls, 1);
  await assert.rejects(acquireGovernanceOperationLock({
    home,
    lockName: "studio",
    accountBinding: BINDING,
    clientKind: "studio",
    clientVersion: VERSION,
    waitMs: 0,
  }), /Another governed capability/u);
});
