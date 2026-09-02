import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cloudPaths,
  fetchGovernanceStatus,
  loadCloudAccount,
  postGovernanceEvents,
} from "./cloud-client.mjs";
import {
  ensureUnredirectedDirectory,
  fsyncDirectoryIfSupported,
  publishImmutableJson,
  readBoundedUtf8FileRecord,
  removeImmutableFile,
} from "./local-files.mjs";
import {
  acquireGovernanceOperationLock,
  releaseGovernanceOperationLock,
} from "./operation-lock.mjs";

export const GOVERNANCE_STATUS_SCHEMA = "aethmere.governance-status.v1";
export const GOVERNANCE_EVENT_SCHEMA = "aethmere.client-behavior.v1";
export const GOVERNANCE_POLICY_DIGEST = "76d79b04705333ce60764488c8923ee25a24dae9e5d17a8fc08b67c14a033285";
export const GOVERNANCE_ERROR_CODE = "GOVERNANCE_CONNECTION_REQUIRED";
export const UPDATE_URL = "https://aethmere.com/downloads/";

const CLIENT_KINDS = new Set(["agent_client", "studio", "vscode"]);
const PLATFORM_FAMILIES = new Set(["windows", "macos", "linux", "unknown"]);
const STEP_CODES = new Set([
  "CLIENT_START", "GOVERNANCE_CONNECT", "MEMORY_RECALL", "MEMORY_GET",
  "CHAT", "LOCAL_CANDIDATE_READY",
]);
const OUTCOMES = new Set(["started", "success", "failure", "blocked", "cancelled"]);
const REASON_CODES = new Set([
  "NONE", "NETWORK_UNAVAILABLE", "TLS_REJECTED", "AUTH_REQUIRED", "AUTH_REJECTED",
  "POLICY_MISMATCH", "VERSION_UNSUPPORTED", "CAPABILITY_NOT_ENTITLED", "RATE_LIMITED",
  "MODEL_UNAVAILABLE", "TIMEOUT", "USER_CANCELLED", "INTERNAL_ERROR",
]);
const DURATION_BUCKETS = new Set(["lt_250ms", "250ms_1s", "1_5s", "5_30s", "30_120s", "gte_120s", "unknown"]);
const EVENT_FIELDS = new Set([
  "schema_version", "event_id", "flow_id", "sequence", "client_kind", "client_version",
  "platform_family", "policy_digest", "step_code", "outcome", "reason_code", "skill_ref",
  "duration_bucket", "attempt_bucket", "time_bucket",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const ACCOUNT_BINDING_RE = /^[0-9a-f]{64}$/u;
const SPOOL_ENTRY_SCHEMA = "aethmere.governance-spool-entry.v1";
const SPOOL_FILE_RE = /^terminal-([0-9a-f-]{36})\.json$/u;
const MAX_SPOOL_ENTRIES = 1000;
const MAX_SPOOL_FILE_BYTES = 16_384;
const SPOOL_BATCH_SIZE = 100;
const MAX_FLUSH_ROUNDS = 20;
// A strong map is intentional: after a local terminal-persistence failure the
// live process must retain its OS lock and fail closed until it exits.
const operationLocks = new Map();

function governanceError(message, cause, code = GOVERNANCE_ERROR_CODE) {
  const error = new Error(code + ": " + message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function normalizePlatform(value = process.platform) {
  if (value === "win32" || value === "windows") return "windows";
  if (value === "darwin" || value === "macos") return "macos";
  if (value === "linux") return "linux";
  return "unknown";
}

function semverParts(value) {
  if (!SEMVER_RE.test(String(value || ""))) return null;
  return String(value).split(".").map(Number);
}

export function compareSemver(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  if (!a || !b) throw new Error("invalid semantic version");
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function durationBucket(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "unknown";
  if (milliseconds < 250) return "lt_250ms";
  if (milliseconds < 1000) return "250ms_1s";
  if (milliseconds < 5000) return "1_5s";
  if (milliseconds < 30000) return "5_30s";
  if (milliseconds < 120000) return "30_120s";
  return "gte_120s";
}

export function governanceReasonForError(error) {
  if (!error || typeof error !== "object") return "INTERNAL_ERROR";
  if (error.code === "VERSION_UNSUPPORTED") return "VERSION_UNSUPPORTED";
  const status = Number(error.status || error.statusCode || 0);
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "AUTH_REJECTED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  if ([502, 503].includes(status)) return "NETWORK_UNAVAILABLE";
  if (error.name === "AbortError") return "TIMEOUT";
  const code = String(error.code || error.cause?.code || "").toUpperCase();
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(code)) return "TIMEOUT";
  if (["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code)) {
    return "TLS_REJECTED";
  }
  if (["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    return "NETWORK_UNAVAILABLE";
  }
  return "INTERNAL_ERROR";
}

export function validateGovernanceEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return { ok: false, reason: "event must be an object" };
  for (const key of Object.keys(event)) if (!EVENT_FIELDS.has(key)) return { ok: false, reason: "unknown field: " + key };
  if (Object.keys(event).length !== EVENT_FIELDS.size) return { ok: false, reason: "event fields are incomplete" };
  if (event.schema_version !== 1 || !UUID_RE.test(event.event_id || "") || !UUID_RE.test(event.flow_id || "")) {
    return { ok: false, reason: "invalid event identity" };
  }
  if (!Number.isInteger(event.sequence) || event.sequence < 0 || event.sequence > 9999) return { ok: false, reason: "invalid sequence" };
  if (!CLIENT_KINDS.has(event.client_kind) || !SEMVER_RE.test(event.client_version || "")) return { ok: false, reason: "invalid client identity" };
  if (!PLATFORM_FAMILIES.has(event.platform_family) || event.policy_digest !== GOVERNANCE_POLICY_DIGEST) {
    return { ok: false, reason: "invalid platform or policy" };
  }
  if (!STEP_CODES.has(event.step_code) || !OUTCOMES.has(event.outcome) || !REASON_CODES.has(event.reason_code)) {
    return { ok: false, reason: "invalid step outcome" };
  }
  if ((event.outcome === "started" || event.outcome === "success") !== (event.reason_code === "NONE")) {
    return { ok: false, reason: "outcome and reason code are inconsistent" };
  }
  if (event.skill_ref !== null || !DURATION_BUCKETS.has(event.duration_bucket) || event.attempt_bucket !== "1") {
    return { ok: false, reason: "invalid closed metadata" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(event.time_bucket || "")) return { ok: false, reason: "invalid time bucket" };
  return { ok: true };
}

export function buildGovernanceEvent({
  eventId = crypto.randomUUID(),
  flowId = crypto.randomUUID(),
  sequence = 0,
  clientKind = "agent_client",
  clientVersion = "0.12.0",
  platformFamily = normalizePlatform(),
  stepCode,
  outcome,
  reasonCode,
  duration = "unknown",
  now = new Date(),
} = {}) {
  const event = {
    schema_version: 1,
    event_id: eventId,
    flow_id: flowId,
    sequence,
    client_kind: clientKind,
    client_version: clientVersion,
    platform_family: normalizePlatform(platformFamily),
    policy_digest: GOVERNANCE_POLICY_DIGEST,
    step_code: stepCode,
    outcome,
    reason_code: reasonCode,
    skill_ref: null,
    duration_bucket: duration,
    attempt_bucket: "1",
    time_bucket: now.toISOString().slice(0, 10),
  };
  const verdict = validateGovernanceEvent(event);
  if (!verdict.ok) throw new Error("invalid governance event: " + verdict.reason);
  return event;
}

function spoolPaths(home) {
  const directory = cloudPaths(home).governanceOutbox;
  return {
    directory,
    candidates: directory + "-candidates",
  };
}

function ensurePrivateCollection(paths, { create = false } = {}) {
  const parent = path.dirname(paths.directory);
  ensureUnredirectedDirectory(parent, { create });
  if (!fs.existsSync(paths.directory)) {
    if (!create) return null;
    fs.mkdirSync(paths.directory, { mode: 0o700 });
    ensureUnredirectedDirectory(paths.directory);
    fsyncDirectoryIfSupported(parent);
  } else {
    ensureUnredirectedDirectory(paths.directory);
  }
  return paths;
}

function ensureSpool(home, { create = false } = {}) {
  return ensurePrivateCollection(spoolPaths(home), { create });
}

function validateSpoolEntry(value, filename) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== SPOOL_ENTRY_SCHEMA ||
    value.state !== "terminal" ||
    !ACCOUNT_BINDING_RE.test(value.account_binding || "") ||
    Object.keys(value).sort().join(",") !== "account_binding,event,schema,state"
  ) {
    throw governanceError("The terminal-event spool contains an invalid entry; formal capabilities remain blocked.");
  }
  const verdict = validateGovernanceEvent(value.event);
  if (!verdict.ok || value.event.outcome === "started") {
    throw governanceError("The terminal-event spool contains an invalid terminal event; formal capabilities remain blocked.");
  }
  if (filename !== "terminal-" + value.event.event_id + ".json") {
    throw governanceError("The terminal-event spool filename does not match its event; formal capabilities remain blocked.");
  }
  return value;
}

function listSpool(home) {
  const paths = ensureSpool(home);
  if (!paths) return [];
  const records = [];
  const eventIds = new Set();
  const directory = fs.opendirSync(paths.directory);
  try {
    while (true) {
      const item = directory.readSync();
      if (!item) break;
      if (records.length >= MAX_SPOOL_ENTRIES) {
        throw governanceError("The terminal-event spool is full. No new formal capability can run.");
      }
      const match = SPOOL_FILE_RE.exec(item.name);
      if (!match || !item.isFile() || item.isSymbolicLink()) {
        throw governanceError("The terminal-event spool contains an unknown file; formal capabilities remain blocked.");
      }
      const file = path.join(paths.directory, item.name);
      let parsed;
      let identity;
      try {
        const record = readBoundedUtf8FileRecord(file, MAX_SPOOL_FILE_BYTES);
        parsed = JSON.parse(record.text);
        identity = record.identity;
      } catch (error) {
        throw governanceError("The terminal-event spool contains an unreadable file; formal capabilities remain blocked.", error);
      }
      const entry = validateSpoolEntry(parsed, item.name);
      if (eventIds.has(entry.event.event_id)) {
        throw governanceError("The terminal-event spool contains a duplicate event; formal capabilities remain blocked.");
      }
      eventIds.add(entry.event.event_id);
      records.push({ file, identity, entry });
    }
  } finally {
    directory.closeSync();
  }
  return records.sort((left, right) => left.file.localeCompare(right.file));
}

function publishTerminal(home, accountBinding, event) {
  const paths = ensureSpool(home, { create: true });
  const filename = "terminal-" + event.event_id + ".json";
  const file = path.join(paths.directory, filename);
  const entry = {
    schema: SPOOL_ENTRY_SCHEMA,
    account_binding: accountBinding,
    state: "terminal",
    event,
  };
  const result = publishImmutableJson(file, entry, { candidateDirectory: paths.candidates });
  if (!result.created) {
    const existing = listSpool(home).find((record) => record.file === file);
    if (!existing || JSON.stringify(existing.entry) !== JSON.stringify(entry)) {
      throw governanceError("A terminal-event spool identity collision was rejected.");
    }
  }
  return { file, identity: result.identity };
}

function versionMap(status, key) {
  const value = status?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).length !== CLIENT_KINDS.size) return null;
  for (const kind of CLIENT_KINDS) {
    if (!Object.hasOwn(value, kind) || !SEMVER_RE.test(String(value[kind] || ""))) return null;
  }
  return value;
}

function fullyAcknowledged(response, expected, { allowDuplicate = false } = {}) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false;
  if (!Number.isInteger(response.accepted) || response.accepted !== expected) return false;
  if (!Number.isInteger(response.stored) || response.stored < 0 || response.stored > expected) return false;
  if (!allowDuplicate && response.stored !== expected) return false;
  return Array.isArray(response.rejected) && response.rejected.length === 0;
}

export async function checkGovernanceConnection({
  home,
  clientKind = "agent_client",
  clientVersion = "0.12.0",
} = {}) {
  let status;
  let account;
  try {
    account = loadCloudAccount(home);
    if (!account) throw new Error("connect this computer to an Aethmere account first");
    status = await fetchGovernanceStatus({
      home,
      clientKind,
      clientVersion,
      expectedAccountBinding: account.accountBinding,
    });
  } catch (error) {
    throw governanceError("A live first-party governance connection could not be established.", error);
  }
  const minimum = versionMap(status, "minimumClientVersions");
  const latest = versionMap(status, "latestClientVersions");
  const coherentVersions = minimum && latest
    ? [...CLIENT_KINDS].every((kind) => compareSemver(latest[kind], minimum[kind]) >= 0)
    : false;
  if (
    status.schema !== GOVERNANCE_STATUS_SCHEMA ||
    status.ok !== true ||
    status.required !== true ||
    status.policyDigest !== GOVERNANCE_POLICY_DIGEST ||
    status.eventSchema !== GOVERNANCE_EVENT_SCHEMA ||
    status.rawContentAccepted !== false ||
    !minimum ||
    !latest ||
    !coherentVersions ||
    status.updateUrl !== UPDATE_URL
  ) {
    throw governanceError("The server governance policy is incompatible with this client.", null, "POLICY_MISMATCH");
  }
  if (!CLIENT_KINDS.has(clientKind) || compareSemver(clientVersion, minimum[clientKind]) < 0) {
    throw governanceError("This client version is no longer supported. Update from " + UPDATE_URL, null, "VERSION_UNSUPPORTED");
  }
  return {
    ...status,
    minimumClientVersion: minimum[clientKind],
    latestClientVersion: latest[clientKind],
    updateAvailable: compareSemver(clientVersion, latest[clientKind]) < 0,
    accountBinding: account.accountBinding,
  };
}

export async function flushGovernanceOutbox({
  home,
  clientKind = "agent_client",
  clientVersion = "0.12.0",
  accountBinding,
} = {}) {
  const account = loadCloudAccount(home);
  const expectedBinding = accountBinding || account?.accountBinding;
  if (!account || account.accountBinding !== expectedBinding) {
    throw governanceError("Connect the account that owns the pending terminal-event spool.");
  }
  let flushed = 0;
  for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
    const snapshot = listSpool(home);
    if (!snapshot.length) return { flushed };
    if (snapshot.some((record) => record.entry.account_binding !== expectedBinding)) {
      throw governanceError("The terminal-event spool belongs to a different account; formal capabilities remain blocked.");
    }
    if (snapshot.some((record) => record.entry.event.client_kind !== clientKind)) {
      throw governanceError("The terminal-event spool belongs to a different client; formal capabilities remain blocked.");
    }
    const batch = snapshot.slice(0, SPOOL_BATCH_SIZE);
    try {
      const response = await postGovernanceEvents(batch.map((record) => record.entry.event), {
        home,
        clientKind,
        clientVersion,
        expectedAccountBinding: expectedBinding,
      });
      if (!fullyAcknowledged(response, batch.length, { allowDuplicate: true })) {
        throw new Error("server did not acknowledge the full terminal batch");
      }
      for (const record of batch) removeImmutableFile(record.file, record.identity);
      flushed += batch.length;
    } catch (error) {
      if (error?.code === GOVERNANCE_ERROR_CODE) throw error;
      throw governanceError("A previous terminal event is still pending; the next formal capability is blocked.", error);
    }
  }
  throw governanceError("The terminal-event spool kept changing during flush; the next formal capability is blocked.");
}

export async function beginGovernedOperation({
  home,
  clientKind = "agent_client",
  clientVersion = "0.12.0",
  stepCode,
} = {}) {
  const initialAccount = loadCloudAccount(home);
  if (!initialAccount) {
    throw governanceError("Connect this computer to an Aethmere account before using a formal capability.");
  }
  const lock = await acquireGovernanceOperationLock({
    home,
    lockName: "agent-client",
    accountBinding: initialAccount.accountBinding,
    clientKind,
    clientVersion,
  });
  let retained = false;
  try {
    const status = await checkGovernanceConnection({ home, clientKind, clientVersion });
    if (status.accountBinding !== initialAccount.accountBinding) {
      throw governanceError("The connected Aethmere account changed while acquiring the governance operation lock.");
    }
    await flushGovernanceOutbox({
      home,
      clientKind,
      clientVersion,
      accountBinding: status.accountBinding,
    });
    const event = buildGovernanceEvent({
      clientKind,
      clientVersion,
      stepCode,
      outcome: "started",
      reasonCode: "NONE",
    });
    try {
      const response = await postGovernanceEvents([event], {
        home,
        clientKind,
        clientVersion,
        expectedAccountBinding: status.accountBinding,
      });
      if (!fullyAcknowledged(response, 1)) throw new Error("start event was not durably acknowledged");
    } catch (error) {
      throw governanceError("The governance start event was not acknowledged; the capability did not run.", error);
    }
    const operation = {
      ...event,
      startedAtMs: Date.now(),
      updateAvailable: status.updateAvailable,
      accountBinding: status.accountBinding,
    };
    operationLocks.set(operation, lock);
    retained = true;
    return operation;
  } finally {
    if (!retained) await releaseGovernanceOperationLock(lock);
  }
}

export async function finishGovernedOperation(operation, {
  home,
  outcome = "success",
  reasonCode = outcome === "success" ? "NONE" : "INTERNAL_ERROR",
} = {}) {
  const lock = operationLocks.get(operation);
  if (!lock) {
    throw governanceError("The governed operation is not active; no terminal event was sent.");
  }
  let terminalPublished = false;
  try {
    if (
      operation.accountBinding !== lock.value.account_binding ||
      operation.client_kind !== lock.value.client_kind ||
      operation.client_version !== lock.value.client_version
    ) {
      throw governanceError("The governed operation identity changed before its terminal event.");
    }
    const event = buildGovernanceEvent({
      flowId: operation.flow_id,
      sequence: Number(operation.sequence) + 1,
      clientKind: operation.client_kind,
      clientVersion: operation.client_version,
      platformFamily: operation.platform_family,
      stepCode: operation.step_code,
      outcome,
      reasonCode,
      duration: durationBucket(Date.now() - Number(operation.startedAtMs || Date.now())),
    });
    publishTerminal(home, operation.accountBinding, event);
    terminalPublished = true;
    try {
      await flushGovernanceOutbox({
        home,
        clientKind: operation.client_kind,
        clientVersion: operation.client_version,
        accountBinding: operation.accountBinding,
      });
      return { queued: false };
    } catch {
      return { queued: true };
    }
  } finally {
    if (terminalPublished) {
      await releaseGovernanceOperationLock(lock);
      operationLocks.delete(operation);
    }
  }
}

export async function runGovernedCapability(options, action) {
  const operation = await beginGovernedOperation(options);
  let result;
  try {
    result = await action();
  } catch (error) {
    await finishGovernedOperation(operation, {
      home: options.home,
      outcome: "failure",
      reasonCode: governanceReasonForError(error),
    });
    throw error;
  }
  await finishGovernedOperation(operation, { home: options.home, outcome: "success", reasonCode: "NONE" });
  return result;
}

export function defaultGovernanceHome() {
  return process.env.AETHMERE_HOME || os.homedir();
}
