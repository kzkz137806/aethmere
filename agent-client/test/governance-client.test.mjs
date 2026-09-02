import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  cloudPaths,
  loadCloudAccount,
  loginWithDeviceCode,
  logoutCloudAccount,
  safeServer,
} from "../lib/cloud-client.mjs";
import {
  GOVERNANCE_EVENT_SCHEMA,
  GOVERNANCE_POLICY_DIGEST,
  GOVERNANCE_STATUS_SCHEMA,
  UPDATE_URL,
  buildGovernanceEvent,
  flushGovernanceOutbox,
  runGovernedCapability,
} from "../lib/governance-client.mjs";
import {
  acquireGovernanceOperationLock,
  releaseGovernanceOperationLock,
} from "../lib/operation-lock.mjs";
import { initializeStore, readStore } from "../lib/store.mjs";

const TOKEN = "aet_dev_" + "A".repeat(48);
const OFFICIAL_SERVER = "https://app.aethmere.com";
const EVENT_FIELDS = [
  "attempt_bucket", "client_kind", "client_version", "duration_bucket", "event_id",
  "flow_id", "outcome", "platform_family", "policy_digest", "reason_code",
  "schema_version", "sequence", "skill_ref", "step_code", "time_bucket",
];

function temporaryHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aethmere-agent-governance-"));
}

function status(overrides = {}) {
  return {
    schema: GOVERNANCE_STATUS_SCHEMA,
    ok: true,
    required: true,
    policyDigest: GOVERNANCE_POLICY_DIGEST,
    eventSchema: GOVERNANCE_EVENT_SCHEMA,
    rawContentAccepted: false,
    minimumClientVersions: {
      agent_client: "0.12.0",
      studio: "0.12.0",
      vscode: "0.12.0",
    },
    latestClientVersions: {
      agent_client: "0.12.0",
      studio: "0.12.0",
      vscode: "0.12.0",
    },
    updateUrl: UPDATE_URL,
    ...overrides,
  };
}

function writeAccount(home, {
  server = OFFICIAL_SERVER,
  tokenExpiresAt = "2099-01-01T00:00:00.000Z",
  accountId = "account-test-primary",
} = {}) {
  const directory = path.join(home, ".aethmere");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "account.json"), JSON.stringify({
    schema: "aethmere.desktop-account.v1",
    server,
    accessToken: TOKEN,
    accountBinding: crypto.createHash("sha256").update(accountId, "utf8").digest("hex"),
    tokenExpiresAt,
    linkedAt: "2026-09-02T00:00:00.000Z",
  }), "utf8");
}

function writeOutbox(home, eventsOrText) {
  const directory = cloudPaths(home).governanceOutbox;
  fs.mkdirSync(directory, { recursive: true });
  const values = typeof eventsOrText === "string" ? [eventsOrText] : eventsOrText;
  const files = values.map((value) => {
    const eventId = typeof value === "string" ? crypto.randomUUID() : value.event_id;
    const file = path.join(directory, "terminal-" + eventId + ".json");
    const text = typeof value === "string"
      ? value
      : JSON.stringify({
          schema: "aethmere.governance-spool-entry.v1",
          account_binding: loadCloudAccount(home).accountBinding,
          state: "terminal",
          event: value,
        }) + "\n";
    fs.writeFileSync(file, text, "utf8");
    return file;
  });
  return { directory, files };
}

function spoolCount(home) {
  const directory = cloudPaths(home).governanceOutbox;
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory).filter((name) => name.startsWith("terminal-")).length;
}

function jsonResponse(value, statusCode = 200) {
  return new Response(JSON.stringify(value), {
    status: statusCode,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch(handler, action) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = typeof input === "string" ? input : input.url;
    return handler({
      url,
      method: String(options.method || "GET").toUpperCase(),
      headers: new Headers(options.headers || {}),
      body: options.body || "",
    });
  };
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
}

function acknowledged(count, stored = count) {
  return jsonResponse({ accepted: count, stored, rejected: [] });
}

async function startOperationLockHolder(home, accountBinding) {
  const moduleUrl = pathToFileURL(path.resolve("lib", "operation-lock.mjs")).href;
  const childSource = `
    import { acquireGovernanceOperationLock, releaseGovernanceOperationLock } from ${JSON.stringify(moduleUrl)};
    const lock = await acquireGovernanceOperationLock({
      home: ${JSON.stringify(home)},
      lockName: "agent-client",
      accountBinding: ${JSON.stringify(accountBinding)},
      clientKind: "agent_client",
      clientVersion: "0.12.0",
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
    cwd: path.resolve("."),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.setEncoding("utf8");
  const endpoint = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("lock holder did not become ready: " + stderr)), 5000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(buffer.slice(0, newline))); }
      catch (error) { reject(error); }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("lock holder exited before ready (" + code + "): " + stderr));
    });
  });
  return { child, endpoint };
}

async function startTerminalPersistenceFailureHolder(home) {
  const governanceUrl = pathToFileURL(path.resolve("lib", "governance-client.mjs")).href;
  const cloudUrl = pathToFileURL(path.resolve("lib", "cloud-client.mjs")).href;
  const childSource = `
    import fs from "node:fs";
    import { runGovernedCapability } from ${JSON.stringify(governanceUrl)};
    import { cloudPaths } from ${JSON.stringify(cloudUrl)};
    globalThis.fetch = async (_input, options = {}) => {
      if ((options.method || "GET") === "GET") {
        return new Response(JSON.stringify({
          schema: "aethmere.governance-status.v1",
          ok: true,
          required: true,
          policyDigest: "76d79b04705333ce60764488c8923ee25a24dae9e5d17a8fc08b67c14a033285",
          eventSchema: "aethmere.client-behavior.v1",
          rawContentAccepted: false,
          minimumClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
          latestClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
          updateUrl: "https://aethmere.com/downloads/"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const count = JSON.parse(options.body).events.length;
      return new Response(JSON.stringify({ accepted: count, stored: count, rejected: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    try {
      await runGovernedCapability({
        home: ${JSON.stringify(home)},
        clientKind: "agent_client",
        clientVersion: "0.12.0",
        stepCode: "MEMORY_GET"
      }, () => {
        fs.writeFileSync(cloudPaths(${JSON.stringify(home)}).governanceOutbox, "not-a-private-directory", "utf8");
        return "locally completed";
      });
      process.exit(3);
    } catch (error) {
      process.stdout.write(JSON.stringify({ locked: true, message: error.message }) + "\\n");
      setInterval(() => {}, 1000);
    }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: path.resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.setEncoding("utf8");
  const report = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("persistence-failure holder did not become ready: " + stderr)), 5000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(buffer.slice(0, newline))); }
      catch (error) { reject(error); }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("persistence-failure holder exited before ready (" + code + "): " + stderr));
    });
  });
  return { child, report };
}

test("formal action runs only after official policy and durable start acknowledgement", async () => {
  const requests = [];
  let startAcknowledged = false;
  await withFetch(async (request) => {
    assert.match(request.url, /^https:\/\/app\.aethmere\.com\/api\/governance$/u);
    assert.equal(request.headers.get("origin"), OFFICIAL_SERVER);
    assert.equal(request.headers.get("authorization"), "Bearer " + TOKEN);
    assert.equal(request.headers.get("x-aethmere-client-kind"), "agent_client");
    assert.equal(request.headers.get("x-aethmere-client-version"), "0.12.0");
    if (request.method === "GET") {
      requests.push({ method: "GET" });
      return jsonResponse(status());
    }
    const body = JSON.parse(request.body);
    requests.push({ method: "POST", body });
    if (body.events[0].outcome === "started") startAcknowledged = true;
    return acknowledged(body.events.length);
  }, async () => {
    const home = temporaryHome();
    writeAccount(home);
    const result = await runGovernedCapability({
      home,
      clientKind: "agent_client",
      clientVersion: "0.12.0",
      stepCode: "MEMORY_GET",
    }, () => {
      assert.equal(startAcknowledged, true);
      return "TOP_SECRET_LOCAL_RESULT";
    });
    assert.equal(result, "TOP_SECRET_LOCAL_RESULT");
  });
  assert.deepEqual(requests.map((entry) => entry.method), ["GET", "POST", "POST"]);
  const eventBodies = requests.filter((entry) => entry.body).flatMap((entry) => entry.body.events);
  assert.deepEqual(eventBodies.map((event) => Object.keys(event).sort()), [EVENT_FIELDS, EVENT_FIELDS]);
  assert.equal(JSON.stringify(eventBodies).includes("TOP_SECRET"), false);
});

test("a start acknowledgement must explicitly confirm one durable store", async () => {
  await withFetch((request) => request.method === "GET"
    ? jsonResponse(status())
    : jsonResponse({ accepted: 1, rejected: [] }), async () => {
    const home = temporaryHome();
    writeAccount(home);
    let ran = false;
    await assert.rejects(
      runGovernedCapability({
        home,
        clientKind: "agent_client",
        clientVersion: "0.12.0",
        stepCode: "MEMORY_GET",
      }, () => { ran = true; }),
      /start event was not .*acknowledged/u,
    );
    assert.equal(ran, false);
  });
});

test("every exact version map and the first-party update URL are mandatory", async () => {
  const incompatible = [
    { minimumClientVersions: undefined },
    { latestClientVersions: undefined },
    { minimumClientVersions: { agent_client: "0.12.0", studio: "0.12.0" } },
    { latestClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0", extra: "0.12.0" } },
    {
      minimumClientVersions: { agent_client: "0.13.0", studio: "0.12.0", vscode: "0.12.0" },
      latestClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
    },
    { updateUrl: undefined },
    { updateUrl: "https://example.com/downloads/" },
  ];
  for (const overrides of incompatible) {
    await withFetch(() => jsonResponse(status(overrides)), async () => {
      const home = temporaryHome();
      writeAccount(home);
      let ran = false;
      await assert.rejects(
        runGovernedCapability({
          home,
          clientKind: "agent_client",
          clientVersion: "0.12.0",
          stepCode: "MEMORY_RECALL",
        }, () => { ran = true; }),
        (error) => error.code === "POLICY_MISMATCH",
      );
      assert.equal(ran, false);
    });
  }
});

test("minimum-version floor fails closed with the update location", async () => {
  await withFetch(() => jsonResponse(status({
    minimumClientVersions: {
      agent_client: "0.13.0",
      studio: "0.12.0",
      vscode: "0.12.0",
    },
    latestClientVersions: {
      agent_client: "0.13.0",
      studio: "0.12.0",
      vscode: "0.12.0",
    },
  })), async () => {
    const home = temporaryHome();
    writeAccount(home);
    let ran = false;
    await assert.rejects(
      runGovernedCapability({
        home,
        clientKind: "agent_client",
        clientVersion: "0.12.0",
        stepCode: "MEMORY_RECALL",
      }, () => { ran = true; }),
      (error) => error.code === "VERSION_UNSUPPORTED" && error.message.includes(UPDATE_URL),
    );
    assert.equal(ran, false);
  });
});

test("undelivered terminal event blocks the next action until flushed", async () => {
  let failPosts = false;
  let postCount = 0;
  await withFetch((request) => {
    if (request.method === "GET") return jsonResponse(status());
    postCount += 1;
    if (failPosts) return jsonResponse({ error: "temporarily unavailable" }, 503);
    const body = JSON.parse(request.body);
    return acknowledged(body.events.length);
  }, async () => {
    const home = temporaryHome();
    writeAccount(home);
    const first = await runGovernedCapability({
      home,
      clientKind: "agent_client",
      clientVersion: "0.12.0",
      stepCode: "MEMORY_GET",
    }, () => {
      failPosts = true;
      return "completed locally";
    });
    assert.equal(first, "completed locally");
    assert.equal(spoolCount(home), 1);

    let secondRan = false;
    await assert.rejects(runGovernedCapability({
      home,
      clientKind: "agent_client",
      clientVersion: "0.12.0",
      stepCode: "MEMORY_GET",
    }, () => { secondRan = true; }), /terminal event is still pending/u);
    assert.equal(secondRan, false);

    failPosts = false;
    let thirdRan = false;
    await runGovernedCapability({
      home,
      clientKind: "agent_client",
      clientVersion: "0.12.0",
      stepCode: "MEMORY_GET",
    }, () => { thirdRan = true; });
    assert.equal(thirdRan, true);
    assert.equal(spoolCount(home), 0);
    assert.equal(postCount >= 6, true);
  });
});

test("the immutable operation lock covers the full action and blocks a concurrent action", async () => {
  const home = temporaryHome();
  writeAccount(home);
  let releaseFirstAction;
  let signalFirstAction;
  const firstActionStarted = new Promise((resolve) => { signalFirstAction = resolve; });
  const firstActionRelease = new Promise((resolve) => { releaseFirstAction = resolve; });

  await withFetch((request) => {
    if (request.method === "GET") return jsonResponse(status());
    const body = JSON.parse(request.body);
    return acknowledged(body.events.length);
  }, async () => {
    const firstCapability = runGovernedCapability({
      home,
      clientKind: "agent_client",
      clientVersion: "0.12.0",
      stepCode: "MEMORY_GET",
    }, async () => {
      signalFirstAction();
      await firstActionRelease;
      return "first";
    });
    await firstActionStarted;

    let concurrentActionCalls = 0;
    try {
      await assert.rejects(runGovernedCapability({
        home,
        clientKind: "agent_client",
        clientVersion: "0.12.0",
        stepCode: "MEMORY_RECALL",
      }, () => {
        concurrentActionCalls += 1;
      }), /Another governed capability is still running/u);
      assert.equal(concurrentActionCalls, 0);
    } finally {
      releaseFirstAction();
    }
    assert.equal(await firstCapability, "first");
  });
});

test("an operation-lock token releases once and cannot remove a later owner", async () => {
  const home = temporaryHome();
  writeAccount(home);
  const options = {
    home,
    lockName: "agent-client",
    accountBinding: loadCloudAccount(home).accountBinding,
    clientKind: "agent_client",
    clientVersion: "0.12.0",
    waitMs: 100,
  };
  const first = await acquireGovernanceOperationLock(options);
  await releaseGovernanceOperationLock(first);
  await assert.rejects(releaseGovernanceOperationLock(first), /already released/u);

  const second = await acquireGovernanceOperationLock(options);
  await assert.rejects(releaseGovernanceOperationLock(first), /already released/u);
  await assert.rejects(
    acquireGovernanceOperationLock({ ...options, waitMs: 0 }),
    /Another governed capability is still running/u,
  );
  await releaseGovernanceOperationLock(second);
});

test("the machine-global endpoint survives aliases and directory replacement, then SIGKILL releases it", async () => {
  const firstHome = temporaryHome();
  const otherHome = temporaryHome();
  writeAccount(firstHome, { accountId: "machine-global-first" });
  writeAccount(otherHome, { accountId: "machine-global-other" });
  const firstAccount = loadCloudAccount(firstHome);
  const otherAccount = loadCloudAccount(otherHome);
  const aliasParent = temporaryHome();
  const physicalAlias = path.join(aliasParent, "physical-home-alias");
  fs.symlinkSync(firstHome, physicalAlias, process.platform === "win32" ? "junction" : "dir");
  const holder = await startOperationLockHolder(firstHome, firstAccount.accountBinding);
  try {
    const originalPrivate = path.join(firstHome, ".aethmere");
    fs.renameSync(originalPrivate, path.join(firstHome, ".aethmere-before-replacement"));
    writeAccount(firstHome, { accountId: "machine-global-replacement" });
    const replacementAccount = loadCloudAccount(firstHome);
    for (const candidate of [
      { home: physicalAlias, accountBinding: firstAccount.accountBinding },
      { home: otherHome, accountBinding: otherAccount.accountBinding },
      { home: firstHome, accountBinding: replacementAccount.accountBinding },
    ]) {
      await assert.rejects(acquireGovernanceOperationLock({
        ...candidate,
        lockName: "agent-client",
        clientKind: "agent_client",
        clientVersion: "0.12.0",
        waitMs: 100,
      }), /Another governed capability is still running/u);
    }
    const exited = once(holder.child, "exit");
    holder.child.kill("SIGKILL");
    await exited;
    const rebound = await acquireGovernanceOperationLock({
      home: otherHome,
      lockName: "agent-client",
      accountBinding: otherAccount.accountBinding,
      clientKind: "agent_client",
      clientVersion: "0.12.0",
      waitMs: 1000,
    });
    assert.deepEqual(rebound.endpoint, holder.endpoint);
    await releaseGovernanceOperationLock(rebound);
  } finally {
    if (holder.child.exitCode === null) holder.child.kill("SIGKILL");
  }
});

test("the three client kinds use distinct fixed OS endpoints for nested governance", async () => {
  const home = temporaryHome();
  writeAccount(home);
  const binding = loadCloudAccount(home).accountBinding;
  const agent = await acquireGovernanceOperationLock({
    home,
    lockName: "agent-client",
    accountBinding: binding,
    clientKind: "agent_client",
    clientVersion: "0.12.0",
  });
  const studio = await acquireGovernanceOperationLock({
    home,
    lockName: "studio",
    accountBinding: binding,
    clientKind: "studio",
    clientVersion: "0.12.0",
  });
  const vscode = await acquireGovernanceOperationLock({
    home,
    lockName: "vscode",
    accountBinding: binding,
    clientKind: "vscode",
    clientVersion: "0.12.0",
  });
  assert.deepEqual([agent.endpoint.port, studio.endpoint.port, vscode.endpoint.port], [62_461, 62_462, 62_463]);
  await releaseGovernanceOperationLock(vscode);
  await releaseGovernanceOperationLock(studio);
  await releaseGovernanceOperationLock(agent);
});

test("an unrelated loopback listener causes bounded denial without random fallback", async () => {
  const home = temporaryHome();
  writeAccount(home);
  const account = loadCloudAccount(home);
  const options = {
    home,
    lockName: "agent-client",
    accountBinding: account.accountBinding,
    clientKind: "agent_client",
    clientVersion: "0.12.0",
    waitMs: 100,
  };
  const probe = await acquireGovernanceOperationLock(options);
  const endpoint = probe.endpoint;
  await releaseGovernanceOperationLock(probe);

  const unrelated = net.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    unrelated.once("error", reject);
    unrelated.listen({ ...endpoint, exclusive: true }, resolve);
  });
  try {
    await assert.rejects(
      acquireGovernanceOperationLock(options),
      /Another governed capability is still running/u,
    );
  } finally {
    await new Promise((resolve, reject) => unrelated.close((error) => error ? reject(error) : resolve()));
  }
  const rebound = await acquireGovernanceOperationLock({ ...options, waitMs: 1000 });
  assert.deepEqual(rebound.endpoint, endpoint);
  await releaseGovernanceOperationLock(rebound);
});

test("awaited release and a cross-process replacement never expose overlapping owners", async () => {
  const home = temporaryHome();
  writeAccount(home);
  const account = loadCloudAccount(home);
  const holder = await startOperationLockHolder(home, account.accountBinding);
  let replacementEntered = false;
  const replacementPromise = acquireGovernanceOperationLock({
    home,
    lockName: "agent-client",
    accountBinding: account.accountBinding,
    clientKind: "agent_client",
    clientVersion: "0.12.0",
    waitMs: 2000,
  }).then((lock) => {
    replacementEntered = true;
    return lock;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replacementEntered, false);
  const exited = once(holder.child, "exit");
  holder.child.stdin.write("release\n");
  const replacement = await replacementPromise;
  assert.equal(replacementEntered, true);
  assert.deepEqual(replacement.endpoint, holder.endpoint);
  await releaseGovernanceOperationLock(replacement);
  await exited;
});

test("unexpected OS-listener loss terminates a governed action before it can continue", () => {
  const home = temporaryHome();
  writeAccount(home);
  const continuedMarker = path.join(home, "action-continued.txt");
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
    globalThis.fetch = async (_input, options = {}) => {
      if ((options.method || "GET") === "GET") {
        return new Response(JSON.stringify({
          schema: "aethmere.governance-status.v1",
          ok: true,
          required: true,
          policyDigest: "76d79b04705333ce60764488c8923ee25a24dae9e5d17a8fc08b67c14a033285",
          eventSchema: "aethmere.client-behavior.v1",
          rawContentAccepted: false,
          minimumClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
          latestClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
          updateUrl: "https://aethmere.com/downloads/"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const count = JSON.parse(options.body).events.length;
      return new Response(JSON.stringify({ accepted: count, stored: count, rejected: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    await runGovernedCapability({
      home: ${JSON.stringify(home)},
      clientKind: "agent_client",
      clientVersion: "0.12.0",
      stepCode: "MEMORY_GET"
    }, async () => {
      lockServer.close();
      await new Promise((resolve) => setTimeout(resolve, 250));
      fs.writeFileSync(${JSON.stringify(continuedMarker)}, "must-not-run", "utf8");
    });
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: path.resolve("."),
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(child.status, 70, child.stdout + child.stderr);
  assert.match(child.stderr, /operating-system governance lock was lost/u);
  assert.equal(fs.existsSync(continuedMarker), false);
});

test("terminal persistence failure in a long-lived process retains the OS lock and blocks the next action", async () => {
  const home = temporaryHome();
  writeAccount(home);
  const holder = await startTerminalPersistenceFailureHolder(home);
  assert.equal(holder.report.locked, true);
  assert.match(holder.report.message, /unredirected directory/u);
  try {
    let nextActionCalls = 0;
    await withFetch((request) => {
      if (request.method === "GET") return jsonResponse(status());
      const body = JSON.parse(request.body);
      return acknowledged(body.events.length);
    }, async () => {
      await assert.rejects(runGovernedCapability({
        home,
        clientKind: "agent_client",
        clientVersion: "0.12.0",
        stepCode: "MEMORY_GET",
      }, () => {
        nextActionCalls += 1;
      }), /Another governed capability is still running/u);
    });
    assert.equal(nextActionCalls, 0);
  } finally {
    const exited = once(holder.child, "exit");
    holder.child.kill("SIGKILL");
    await exited;
  }
  fs.unlinkSync(cloudPaths(home).governanceOutbox);
  const recovered = await acquireGovernanceOperationLock({
    home,
    lockName: "agent-client",
    accountBinding: loadCloudAccount(home).accountBinding,
    clientKind: "agent_client",
    clientVersion: "0.12.0",
    waitMs: 1000,
  });
  await releaseGovernanceOperationLock(recovered);
});

test("outbox flushes in batches of 100 and accepts explicit duplicate stores", async () => {
  const home = temporaryHome();
  writeAccount(home);
  const events = Array.from({ length: 101 }, () => buildGovernanceEvent({
    clientKind: "agent_client",
    clientVersion: "0.12.0",
    stepCode: "MEMORY_GET",
    outcome: "failure",
    reasonCode: "INTERNAL_ERROR",
  }));
  writeOutbox(home, events);
  const batches = [];
  await withFetch((request) => {
    const body = JSON.parse(request.body);
    batches.push(body.events.length);
    return acknowledged(body.events.length, batches.length === 2 ? 0 : body.events.length);
  }, async () => {
    assert.deepEqual(await flushGovernanceOutbox({
      home,
      clientKind: "agent_client",
      clientVersion: "0.12.0",
    }), { flushed: 101 });
  });
  assert.deepEqual(batches, [100, 1]);
  assert.equal(spoolCount(home), 0);
});

test("corrupt or cross-client outbox rows are preserved and fail closed", async () => {
  const corruptHome = temporaryHome();
  writeAccount(corruptHome);
  const corruptFile = writeOutbox(corruptHome, "{not-json}\n").files[0];
  await assert.rejects(
    flushGovernanceOutbox({ home: corruptHome, clientKind: "agent_client", clientVersion: "0.12.0" }),
    /spool contains an unreadable file/u,
  );
  assert.equal(fs.readFileSync(corruptFile, "utf8"), "{not-json}\n");

  const mismatchHome = temporaryHome();
  writeAccount(mismatchHome);
  const mismatch = buildGovernanceEvent({
    clientKind: "studio",
    clientVersion: "0.12.0",
    stepCode: "CHAT",
    outcome: "failure",
    reasonCode: "INTERNAL_ERROR",
  });
  const mismatchFile = writeOutbox(mismatchHome, [mismatch]).files[0];
  await assert.rejects(
    flushGovernanceOutbox({ home: mismatchHome, clientKind: "agent_client", clientVersion: "0.12.0" }),
    /different client/u,
  );
  assert.equal(fs.existsSync(mismatchFile), true);

  const accountMismatchHome = temporaryHome();
  writeAccount(accountMismatchHome, { accountId: "account-original" });
  const accountMismatchFile = writeOutbox(accountMismatchHome, [buildGovernanceEvent({
    clientKind: "agent_client",
    clientVersion: "0.12.0",
    stepCode: "MEMORY_GET",
    outcome: "failure",
    reasonCode: "INTERNAL_ERROR",
  })]).files[0];
  writeAccount(accountMismatchHome, { accountId: "account-different" });
  await assert.rejects(
    flushGovernanceOutbox({ home: accountMismatchHome, clientKind: "agent_client", clientVersion: "0.12.0" }),
    /different account/u,
  );
  assert.equal(fs.existsSync(accountMismatchFile), true);
});

test("device login requires a stable account id but stores only its SHA-256 binding", async () => {
  const home = temporaryHome();
  await withFetch((request) => {
    assert.equal(request.url, OFFICIAL_SERVER + "/api/auth/device-code");
    assert.equal(request.method, "PUT");
    assert.equal(request.headers.get("origin"), OFFICIAL_SERVER);
    return jsonResponse({
      accessToken: TOKEN,
      tokenExpiresAt: "2099-01-01T00:00:00.000Z",
      account: { id: "stable-account-id-not-for-disk" },
    });
  }, async () => loginWithDeviceCode("ABCD-EFGH", { home }));
  const accountText = fs.readFileSync(cloudPaths(home).account, "utf8");
  assert.equal(accountText.includes("stable-account-id-not-for-disk"), false);
  assert.equal(
    loadCloudAccount(home).accountBinding,
    crypto.createHash("sha256").update("stable-account-id-not-for-disk", "utf8").digest("hex"),
  );

  const missingHome = temporaryHome();
  await withFetch(() => jsonResponse({
    accessToken: TOKEN,
    tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    account: {},
  }), async () => {
    await assert.rejects(loginWithDeviceCode("ABCD-EFGH", { home: missingHome }), /stable account identifier/u);
  });
  assert.equal(fs.existsSync(cloudPaths(missingHome).account), false);
});

test("account origin, expiry and logout boundaries fail closed", () => {
  const rejected = [
    "https://user:password@app.aethmere.com",
    "https://app.aethmere.com:444",
    "https://app.aethmere.com/api",
    "https://app.aethmere.com/?mode=test",
    "https://app.aethmere.com/#fragment",
    "https://example.com",
    "http://127.0.0.1:8000",
  ];
  for (const value of rejected) assert.throws(() => safeServer(value));
  assert.equal(safeServer("https://app.aethmere.com/"), OFFICIAL_SERVER);

  const expiredHome = temporaryHome();
  writeAccount(expiredHome, { tokenExpiresAt: "2020-01-01T00:00:00.000Z" });
  assert.throws(() => loadCloudAccount(expiredHome), /expired/u);

  const logoutHome = temporaryHome();
  writeAccount(logoutHome);
  const outbox = writeOutbox(logoutHome, "{pending-terminal}\n").files[0];
  const account = cloudPaths(logoutHome).account;
  assert.deepEqual(logoutCloudAccount({ home: logoutHome }), { connected: false });
  assert.equal(fs.existsSync(account), false);
  assert.equal(fs.existsSync(outbox), true);
});

test("an oversized chunked response is rejected by bounded stream reading", async () => {
  await withFetch(() => {
    const chunks = [new Uint8Array(300_000).fill(120), new Uint8Array(300_001).fill(120)];
    const body = new ReadableStream({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  }, async () => {
    const home = temporaryHome();
    writeAccount(home);
    await assert.rejects(
      runGovernedCapability({
        home,
        clientKind: "agent_client",
        clientVersion: "0.12.0",
        stepCode: "MEMORY_GET",
      }, () => "must not run"),
      (error) => error.code === "GOVERNANCE_CONNECTION_REQUIRED" && /safety limit/u.test(error.cause?.message || ""),
    );
  });
});

test("CLI init without an account cannot create the local store", () => {
  const home = temporaryHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "aethmere-agent-project-"));
  const executable = path.resolve("bin", "aethmere-agent.mjs");
  const result = spawnSync(process.execPath, [executable, "init", "--root", project, "--json"], {
    cwd: path.resolve("."),
    env: { ...process.env, AETHMERE_HOME: home },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /GOVERNANCE_CONNECTION_REQUIRED/u);
  assert.equal(fs.existsSync(path.join(project, ".aethmere", "context.json")), false);
});

test("real CLI add/get request-stdin emits READY only after start acknowledgement", () => {
  const home = temporaryHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "aethmere-agent-stdin-project-"));
  writeAccount(home);
  initializeStore(project);
  const preload = path.join(temporaryHome(), "mock-official-fetch.mjs");
  const protocolLog = path.join(temporaryHome(), "protocol.jsonl");
  fs.writeFileSync(preload, `
    import fs from "node:fs";
    const policy = "76d79b04705333ce60764488c8923ee25a24dae9e5d17a8fc08b67c14a033285";
    const log = (value) => fs.appendFileSync(process.env.AETHMERE_PROTOCOL_LOG, JSON.stringify(value) + "\\n");
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => {
      log({ kind: "stdout", value: String(chunk) });
      return originalWrite(chunk, ...rest);
    };
    globalThis.fetch = async (_input, options = {}) => {
      if ((options.method || "GET") === "GET") {
        log({ kind: "fetch", value: "status" });
        return new Response(JSON.stringify({
          schema: "aethmere.governance-status.v1",
          ok: true,
          required: true,
          policyDigest: policy,
          eventSchema: "aethmere.client-behavior.v1",
          rawContentAccepted: false,
          minimumClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
          latestClientVersions: { agent_client: "0.12.0", studio: "0.12.0", vscode: "0.12.0" },
          updateUrl: "https://aethmere.com/downloads/"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const events = JSON.parse(options.body).events;
      const count = events.length;
      log({ kind: "fetch", value: events[0].outcome });
      return new Response(JSON.stringify({ accepted: count, stored: count, rejected: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
  `, "utf8");
  const executable = path.resolve("bin", "aethmere-agent.mjs");
  const secret = "selected editor content that must not appear in argv";
  const cliArgs = [
    executable,
    "add",
    "--request-stdin",
    "--json",
  ];
  const request = {
    id: "stdin-contract",
    title: "Stdin contract",
    text: secret,
    tags: [],
    replace: false,
  };
  const result = spawnSync(process.execPath, cliArgs, {
    cwd: project,
    env: {
      ...process.env,
      AETHMERE_HOME: home,
      AETHMERE_PROTOCOL_LOG: protocolLog,
      NODE_OPTIONS: "--import=" + pathToFileURL(preload).href,
    },
    input: JSON.stringify(request),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(cliArgs.includes(secret), false);
  assert.equal(cliArgs.includes(request.id), false);
  assert.equal(cliArgs.includes(request.title), false);
  const lines = result.stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.deepEqual(lines[0], { schema: "aethmere.stdin-ready.v1", ready: true });
  assert.equal(lines[1].schema, "aethmere.local-add.v1");
  const protocol = fs.readFileSync(protocolLog, "utf8").trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.deepEqual(protocol.map((entry) => entry.value), [
    "status",
    "started",
    JSON.stringify({ schema: "aethmere.stdin-ready.v1", ready: true }) + "\n",
    "success",
    JSON.stringify(lines[1]) + "\n",
  ]);
  assert.equal(readStore(project).items[0].text, secret);

  fs.writeFileSync(protocolLog, "", "utf8");
  const getArgs = [
    executable,
    "get",
    "--request-stdin",
    "--json",
  ];
  const getResult = spawnSync(process.execPath, getArgs, {
    cwd: project,
    env: {
      ...process.env,
      AETHMERE_HOME: home,
      AETHMERE_PROTOCOL_LOG: protocolLog,
      NODE_OPTIONS: "--import=" + pathToFileURL(preload).href,
    },
    input: JSON.stringify({ id: request.id }),
    encoding: "utf8",
  });
  assert.equal(getResult.status, 0, getResult.stdout + getResult.stderr);
  assert.equal(getArgs.includes(request.id), false);
  const getLines = getResult.stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.deepEqual(getLines[0], { schema: "aethmere.stdin-ready.v1", ready: true });
  assert.equal(getLines[1].schema, "aethmere.context-item.v1");
  assert.equal(getLines[1].item.id, readStore(project).items[0].id);
  assert.equal(getLines[1].item.text, secret);
  const getProtocol = fs.readFileSync(protocolLog, "utf8").trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.deepEqual(getProtocol.map((entry) => entry.value), [
    "status",
    "started",
    JSON.stringify({ schema: "aethmere.stdin-ready.v1", ready: true }) + "\n",
    "success",
    JSON.stringify(getLines[1]) + "\n",
  ]);
});
