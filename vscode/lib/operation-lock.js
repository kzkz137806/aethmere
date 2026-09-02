"use strict";

const net = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");

const ACCOUNT_BINDING_RE = /^[0-9a-f]{64}$/u;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const DEFAULT_WAIT_MS = 2000;
const POLL_MS = 25;
const LOOPBACK_HOST = "127.0.0.1";
const LOCK_PORTS = Object.freeze({
  "agent-client": 62_461,
  studio: 62_462,
  vscode: 62_463,
});
const LOCK_CLIENT_KINDS = Object.freeze({
  "agent-client": "agent_client",
  studio: "studio",
  vscode: "vscode",
});
const issuedLocks = new WeakSet();
const releasedLocks = new WeakSet();
const lockServers = new WeakMap();
const lockStates = new WeakMap();

function lockError(message, cause) {
  const error = new Error("GOVERNANCE_CONNECTION_REQUIRED: " + message, cause ? { cause } : undefined);
  error.code = "GOVERNANCE_CONNECTION_REQUIRED";
  return error;
}

function monotonicMilliseconds() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function deterministicEndpoint(lockName) {
  return {
    host: LOOPBACK_HOST,
    port: LOCK_PORTS[lockName],
  };
}

function createLockServer() {
  return net.createServer((socket) => socket.destroy());
}

function fatalRuntimeLockLoss(state, cause) {
  if (state.releasing || state.lost) return;
  state.lost = true;
  const error = lockError("The operating-system governance lock was lost during a formal capability.", cause);
  try { process.stderr.write(error.message + "\n"); } catch { /* exit remains mandatory */ }
  process.exit(70);
}

function listenExclusive(server, endpoint, state) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      server.on("error", (error) => fatalRuntimeLockLoss(state, error));
      server.on("close", () => fatalRuntimeLockLoss(state));
      server.unref();
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({
      host: endpoint.host,
      port: endpoint.port,
      exclusive: true,
    });
  });
}

function issueLock(server, endpoint, value, state) {
  const token = Object.freeze({
    endpoint: Object.freeze({ ...endpoint }),
    value: Object.freeze({ ...value }),
  });
  issuedLocks.add(token);
  lockServers.set(token, server);
  lockStates.set(token, state);
  return token;
}

async function acquireGovernanceOperationLock({
  home,
  lockName = "agent-client",
  accountBinding,
  clientKind,
  clientVersion,
  waitMs = DEFAULT_WAIT_MS,
} = {}) {
  if (
    !ACCOUNT_BINDING_RE.test(accountBinding || "") ||
    !["agent_client", "studio", "vscode"].includes(clientKind) ||
    !SEMVER_RE.test(clientVersion || "") ||
    !Object.hasOwn(LOCK_PORTS, lockName) ||
    LOCK_CLIENT_KINDS[lockName] !== clientKind ||
    !Number.isInteger(waitMs) ||
    waitMs < 0 ||
    waitMs > 30_000
  ) {
    throw lockError("The governance operation lock request is invalid.");
  }
  const endpoint = deterministicEndpoint(lockName);
  const deadline = monotonicMilliseconds() + waitMs;
  while (true) {
    const server = createLockServer();
    const state = { releasing: false, lost: false };
    try {
      await listenExclusive(server, endpoint, state);
      return issueLock(server, endpoint, {
        account_binding: accountBinding,
        client_kind: clientKind,
        client_version: clientVersion,
        lock_name: lockName,
      }, state);
    } catch (error) {
      if (error?.code !== "EADDRINUSE") {
        throw lockError("The operating-system governance lock could not be acquired safely.", error);
      }
      if (monotonicMilliseconds() >= deadline) {
        throw lockError("Another governed capability is still running; retry after it finishes.");
      }
      await delay(POLL_MS);
    }
  }
}

async function releaseGovernanceOperationLock(lock) {
  if (!lock || !issuedLocks.has(lock)) {
    throw lockError("The governance operation lock release is invalid.");
  }
  if (releasedLocks.has(lock)) {
    throw lockError("The governance operation lock was already released.");
  }
  const server = lockServers.get(lock);
  const state = lockStates.get(lock);
  if (!server?.listening || !state || state.lost) {
    throw lockError("The operating-system governance lock changed before release.");
  }
  state.releasing = true;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(lockError("The operating-system governance lock could not be released safely.", error));
      else resolve();
    });
  });
  releasedLocks.add(lock);
  lockServers.delete(lock);
  lockStates.delete(lock);
}

module.exports = { acquireGovernanceOperationLock, releaseGovernanceOperationLock };
