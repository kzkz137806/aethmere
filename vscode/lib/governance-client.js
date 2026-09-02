"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ensureUnredirectedDirectory,
  fsyncDirectoryIfSupported,
  publishImmutableJson,
  readBoundedUtf8FileRecord,
  removeImmutableFile,
} = require("./private-files.js");
const {
  acquireGovernanceOperationLock,
  releaseGovernanceOperationLock,
} = require("./operation-lock.js");

const EXTENSION_VERSION = "0.12.0";
const ACCOUNT_SCHEMA = "aethmere.desktop-account.v1";
const AETHMERE_APP_ORIGIN = "https://app.aethmere.com";
const GOVERNANCE_STATUS_SCHEMA = "aethmere.governance-status.v1";
const GOVERNANCE_EVENT_SCHEMA = "aethmere.client-behavior.v1";
const GOVERNANCE_POLICY_DIGEST = "76d79b04705333ce60764488c8923ee25a24dae9e5d17a8fc08b67c14a033285";
const GOVERNANCE_ERROR_CODE = "GOVERNANCE_CONNECTION_REQUIRED";
const UPDATE_URL = "https://aethmere.com/downloads/";
const PUBLIC_CLIENT_KINDS = ["agent_client", "studio", "vscode"];
const STEP_CODES = new Set(["CLIENT_START", "GOVERNANCE_CONNECT", "MEMORY_RECALL", "MEMORY_GET", "LOCAL_CANDIDATE_READY"]);
const OUTCOMES = new Set(["started", "success", "failure", "blocked", "cancelled"]);
const REASON_CODES = new Set([
  "NONE", "NETWORK_UNAVAILABLE", "TLS_REJECTED", "AUTH_REQUIRED", "AUTH_REJECTED", "POLICY_MISMATCH",
  "VERSION_UNSUPPORTED", "CAPABILITY_NOT_ENTITLED", "RATE_LIMITED", "MODEL_UNAVAILABLE", "TIMEOUT",
  "USER_CANCELLED", "INTERNAL_ERROR",
]);
const DURATION_BUCKETS = new Set(["lt_250ms", "250ms_1s", "1_5s", "5_30s", "30_120s", "gte_120s", "unknown"]);
const EVENT_FIELDS = new Set([
  "schema_version", "event_id", "flow_id", "sequence", "client_kind", "client_version", "platform_family",
  "policy_digest", "step_code", "outcome", "reason_code", "skill_ref", "duration_bucket", "attempt_bucket", "time_bucket",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const TOKEN_RE = /^aet_dev_[A-Za-z0-9_-]{40,100}$/u;
const ACCOUNT_BINDING_RE = /^[0-9a-f]{64}$/u;
const ACCOUNT_FIELDS = ["accessToken", "accountBinding", "linkedAt", "schema", "server", "tokenExpiresAt"];
const SPOOL_ENTRY_SCHEMA = "aethmere.governance-spool-entry.v1";
const SPOOL_FILE_RE = /^terminal-([0-9a-f-]{36})\.json$/u;
const MAX_MANIFEST_BYTES = 64_000;
const MAX_ACCOUNT_BYTES = 16_384;
const MAX_SPOOL_FILE_BYTES = 16_384;
const MAX_SPOOL_ENTRIES = 1000;
const MAX_POST_BATCH = 100;
const MAX_FLUSH_ROUNDS = 20;
const MAX_RESPONSE_BYTES = 64_000;
const REQUEST_TIMEOUT_MS = 20_000;
// Strong retention is deliberate: a local terminal-persistence failure keeps
// the live extension-host OS mutex held until process exit.
const retainedFailedLocks = new Set();

function governanceError(message, cause, reasonCode = "NETWORK_UNAVAILABLE") {
  const error = new Error(`${GOVERNANCE_ERROR_CODE}: ${message}`, cause ? { cause } : undefined);
  error.code = GOVERNANCE_ERROR_CODE;
  error.reasonCode = reasonCode;
  return error;
}

class GovernanceCancelledError extends Error {
  constructor() {
    super("The governed capability was cancelled by the user.");
    this.name = "GovernanceCancelledError";
    this.code = "GOVERNANCE_USER_CANCELLED";
    this.reasonCode = "USER_CANCELLED";
  }
}

function isGovernanceCancellation(error) {
  return error instanceof GovernanceCancelledError && error.code === "GOVERNANCE_USER_CANCELLED";
}

function semverParts(value) {
  if (!SEMVER_RE.test(String(value || ""))) return null;
  return String(value).split(".").map(Number);
}

function compareVersions(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  if (!a || !b) throw governanceError("The client version policy is invalid.", undefined, "POLICY_MISMATCH");
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function verifyExtensionManifest(extensionRoot) {
  const root = path.resolve(String(extensionRoot || ""));
  if (!extensionRoot || !ensureUnredirectedDirectory(root)) {
    throw governanceError("The installed VS Code extension directory could not be verified.", undefined, "VERSION_UNSUPPORTED");
  }
  let manifest;
  try {
    manifest = JSON.parse(readBoundedUtf8FileRecord(path.join(root, "package.json"), MAX_MANIFEST_BYTES).text);
  } catch (error) {
    throw governanceError("The installed VS Code extension manifest could not be verified.", error, "VERSION_UNSUPPORTED");
  }
  if (
    !manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
    manifest.name !== "aethmere-vscode" || manifest.publisher !== "aethmere" ||
    manifest.main !== "./extension.js" || manifest.version !== EXTENSION_VERSION ||
    !SEMVER_RE.test(manifest.version)
  ) {
    throw governanceError(`Install Aethmere VS Code ${EXTENSION_VERSION} from ${UPDATE_URL}`, undefined, "VERSION_UNSUPPORTED");
  }
  return manifest.version;
}

function accountPaths(home) {
  const directory = path.join(path.resolve(home || os.homedir()), ".aethmere");
  return {
    directory,
    account: path.join(directory, "account.json"),
    spool: path.join(directory, "governance-spool-vscode"),
    spoolCandidates: path.join(directory, "governance-spool-vscode-candidates"),
  };
}

function loadAccount(home) {
  const file = accountPaths(home).account;
  let value;
  try {
    value = JSON.parse(readBoundedUtf8FileRecord(file, MAX_ACCOUNT_BYTES).text);
  } catch (error) {
    if (error?.code === "ENOENT") throw governanceError("Connect this computer to an Aethmere account first.", error, "AUTH_REQUIRED");
    throw governanceError("The shared Aethmere account file is unsafe or invalid.", error, "AUTH_REJECTED");
  }
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...ACCOUNT_FIELDS].sort().join(",") ||
    value.schema !== ACCOUNT_SCHEMA || value.server !== AETHMERE_APP_ORIGIN ||
    !TOKEN_RE.test(value.accessToken || "") || !ACCOUNT_BINDING_RE.test(value.accountBinding || "")
  ) throw governanceError("The shared Aethmere account file has an unsupported format.", undefined, "AUTH_REJECTED");
  const expiresAt = Date.parse(String(value.tokenExpiresAt || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw governanceError("The shared Aethmere account authorization expired.", undefined, "AUTH_REQUIRED");
  }
  return {
    accessToken: value.accessToken,
    accountBinding: value.accountBinding,
    tokenExpiresAt: value.tokenExpiresAt,
  };
}

async function readBoundedText(response) {
  const declaredValue = response.headers?.get?.("content-length");
  if (declaredValue && !/^\d+$/u.test(declaredValue)) throw new Error("Aethmere returned an invalid Content-Length.");
  const declared = declaredValue ? Number(declaredValue) : 0;
  if (!Number.isSafeInteger(declared) || declared > MAX_RESPONSE_BYTES) throw new Error("Aethmere response exceeded the safety limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Aethmere response exceeded the safety limit.");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(merged);
}

async function governanceRequest(method, { home, fetchImpl, clientVersion, expectedAccountBinding, events = null }) {
  const account = loadAccount(home);
  if (account.accountBinding !== expectedAccountBinding) {
    throw governanceError("The connected Aethmere account changed during governance.", undefined, "AUTH_REJECTED");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${AETHMERE_APP_ORIGIN}/api/governance`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${account.accessToken}`,
        ...(events ? { "content-type": "application/json", origin: AETHMERE_APP_ORIGIN } : {}),
        "x-aethmere-client-kind": "vscode",
        "x-aethmere-client-version": clientVersion,
      },
      body: events ? JSON.stringify({ events }) : undefined,
      redirect: "error",
      signal: controller.signal,
    });
    const text = await readBoundedText(response);
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* rejected below */ }
    if (!response.ok) {
      const error = governanceError(`Aethmere governance returned HTTP ${response.status}.`, undefined, response.status === 401 ? "AUTH_REQUIRED" : "AUTH_REJECTED");
      error.status = response.status;
      throw error;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Aethmere governance returned invalid JSON.");
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw governanceError("Aethmere governance timed out.", error, "TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizePlatform(value = process.platform) {
  if (value === "win32" || value === "windows") return "windows";
  if (value === "darwin" || value === "macos") return "macos";
  if (value === "linux") return "linux";
  return "unknown";
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

function governanceReasonForError(error) {
  if (REASON_CODES.has(error?.reasonCode)) return error.reasonCode;
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "CAPABILITY_NOT_ENTITLED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502 || status === 503) return "NETWORK_UNAVAILABLE";
  if (error?.name === "AbortError") return "TIMEOUT";
  if (error?.code === GOVERNANCE_ERROR_CODE) return "NETWORK_UNAVAILABLE";
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code)) return "TLS_REJECTED";
  if (["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(code)) return "NETWORK_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  if (Object.keys(event).length !== EVENT_FIELDS.size || Object.keys(event).some((key) => !EVENT_FIELDS.has(key))) return false;
  return event.schema_version === 1 && UUID_RE.test(event.event_id || "") && UUID_RE.test(event.flow_id || "") &&
    Number.isInteger(event.sequence) && event.sequence >= 0 && event.sequence <= 9999 &&
    event.client_kind === "vscode" && SEMVER_RE.test(event.client_version || "") &&
    ["windows", "macos", "linux", "unknown"].includes(event.platform_family) &&
    event.policy_digest === GOVERNANCE_POLICY_DIGEST && STEP_CODES.has(event.step_code) &&
    OUTCOMES.has(event.outcome) && REASON_CODES.has(event.reason_code) &&
    ((event.outcome === "started" || event.outcome === "success") === (event.reason_code === "NONE")) &&
    event.skill_ref === null && DURATION_BUCKETS.has(event.duration_bucket) && event.attempt_bucket === "1" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(event.time_bucket || "");
}

function buildEvent({ flowId = crypto.randomUUID(), sequence = 0, clientVersion, stepCode, outcome, reasonCode, duration = "unknown" }) {
  const event = {
    schema_version: 1,
    event_id: crypto.randomUUID(),
    flow_id: flowId,
    sequence,
    client_kind: "vscode",
    client_version: clientVersion,
    platform_family: normalizePlatform(),
    policy_digest: GOVERNANCE_POLICY_DIGEST,
    step_code: stepCode,
    outcome,
    reason_code: reasonCode,
    skill_ref: null,
    duration_bucket: duration,
    attempt_bucket: "1",
    time_bucket: new Date().toISOString().slice(0, 10),
  };
  if (!validateEvent(event)) throw governanceError("A local governance event was invalid.", undefined, "INTERNAL_ERROR");
  return event;
}

function ensureSpool(home, { create = false } = {}) {
  const paths = accountPaths(home);
  ensureUnredirectedDirectory(paths.directory, { create });
  if (!fs.existsSync(paths.spool)) {
    if (!create) return null;
    fs.mkdirSync(paths.spool, { mode: 0o700 });
    ensureUnredirectedDirectory(paths.spool);
    fsyncDirectoryIfSupported(paths.directory);
  } else ensureUnredirectedDirectory(paths.spool);
  return paths;
}

function validateSpoolEntry(value, filename) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "account_binding,event,schema,state" ||
    value.schema !== SPOOL_ENTRY_SCHEMA || value.state !== "terminal" ||
    !ACCOUNT_BINDING_RE.test(value.account_binding || "") || !validateEvent(value.event) ||
    value.event.outcome === "started" || filename !== `terminal-${value.event.event_id}.json`
  ) throw governanceError("The VS Code governance spool contains an invalid terminal event.", undefined, "INTERNAL_ERROR");
  return value;
}

function listSpool(home) {
  const paths = ensureSpool(home);
  if (!paths) return [];
  const records = [];
  const eventIds = new Set();
  const directory = fs.opendirSync(paths.spool);
  try {
    while (true) {
      const item = directory.readSync();
      if (!item) break;
      if (records.length >= MAX_SPOOL_ENTRIES) throw governanceError("The VS Code governance spool is full.", undefined, "INTERNAL_ERROR");
      if (!SPOOL_FILE_RE.test(item.name) || !item.isFile() || item.isSymbolicLink()) {
        throw governanceError("The VS Code governance spool contains an unknown file.", undefined, "INTERNAL_ERROR");
      }
      const file = path.join(paths.spool, item.name);
      let record;
      let entry;
      try {
        record = readBoundedUtf8FileRecord(file, MAX_SPOOL_FILE_BYTES);
        entry = validateSpoolEntry(JSON.parse(record.text), item.name);
      } catch (error) {
        if (error?.code === GOVERNANCE_ERROR_CODE) throw error;
        throw governanceError("A VS Code governance spool file is unsafe or unreadable.", error, "INTERNAL_ERROR");
      }
      if (eventIds.has(entry.event.event_id)) throw governanceError("The VS Code governance spool contains a duplicate event.", undefined, "INTERNAL_ERROR");
      eventIds.add(entry.event.event_id);
      records.push({ file, identity: record.identity, entry });
    }
  } finally {
    directory.closeSync();
  }
  return records.sort((left, right) => left.file.localeCompare(right.file));
}

function publishTerminal(home, accountBinding, event) {
  const paths = ensureSpool(home, { create: true });
  const file = path.join(paths.spool, `terminal-${event.event_id}.json`);
  const entry = { schema: SPOOL_ENTRY_SCHEMA, account_binding: accountBinding, state: "terminal", event };
  const published = publishImmutableJson(file, entry, { candidateDirectory: paths.spoolCandidates });
  if (!published.created) {
    const existing = listSpool(home).find((record) => record.file === file);
    if (!existing || JSON.stringify(existing.entry) !== JSON.stringify(entry)) {
      throw governanceError("A VS Code terminal event identity collided.", undefined, "INTERNAL_ERROR");
    }
  }
}

async function postEvents(events, options, { replay = false } = {}) {
  const response = await governanceRequest("POST", { ...options, events });
  if (
    response.accepted !== events.length || !Array.isArray(response.rejected) || response.rejected.length !== 0 ||
    !Number.isInteger(response.stored) || response.stored < 0 || response.stored > events.length ||
    (!replay && response.stored !== events.length)
  ) throw new Error("Aethmere did not acknowledge the complete governance batch.");
  return response;
}

function versionMap(status, key) {
  const value = status?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).sort().join(",") !== [...PUBLIC_CLIENT_KINDS].sort().join(",")) return null;
  for (const kind of PUBLIC_CLIENT_KINDS) if (!SEMVER_RE.test(String(value[kind] || ""))) return null;
  return value;
}

async function checkStatus(options) {
  const status = await governanceRequest("GET", options);
  const minimum = versionMap(status, "minimumClientVersions");
  const latest = versionMap(status, "latestClientVersions");
  if (
    status.schema !== GOVERNANCE_STATUS_SCHEMA || status.ok !== true || status.required !== true ||
    status.policyDigest !== GOVERNANCE_POLICY_DIGEST || status.eventSchema !== GOVERNANCE_EVENT_SCHEMA ||
    status.rawContentAccepted !== false || !minimum || !latest || status.updateUrl !== UPDATE_URL
  ) throw governanceError("The server governance policy is incompatible with this extension.", undefined, "POLICY_MISMATCH");
  for (const kind of PUBLIC_CLIENT_KINDS) {
    if (compareVersions(latest[kind], minimum[kind]) < 0) {
      throw governanceError("The server version policy is inconsistent.", undefined, "POLICY_MISMATCH");
    }
  }
  if (compareVersions(options.clientVersion, EXTENSION_VERSION) < 0 || compareVersions(options.clientVersion, minimum.vscode) < 0) {
    throw governanceError(`Aethmere VS Code ${options.clientVersion} is unsupported. Update from ${UPDATE_URL}`, undefined, "VERSION_UNSUPPORTED");
  }
  return { updateAvailable: compareVersions(options.clientVersion, latest.vscode) < 0 };
}

async function flushSpool(options) {
  let flushed = 0;
  for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
    const snapshot = listSpool(options.home);
    if (!snapshot.length) return { flushed };
    if (snapshot.some((record) => record.entry.account_binding !== options.expectedAccountBinding)) {
      throw governanceError("The VS Code governance spool belongs to another account.", undefined, "AUTH_REJECTED");
    }
    const batch = snapshot.slice(0, MAX_POST_BATCH);
    try {
      await postEvents(batch.map((record) => record.entry.event), options, { replay: true });
      for (const record of batch) removeImmutableFile(record.file, record.identity);
      flushed += batch.length;
    } catch (error) {
      if (error?.code === GOVERNANCE_ERROR_CODE) throw error;
      throw governanceError("A previous VS Code terminal event is still pending.", error, governanceReasonForError(error));
    }
  }
  throw governanceError("The VS Code governance spool kept changing during flush.", undefined, "INTERNAL_ERROR");
}

class VscodeGovernance {
  constructor({ extensionRoot, home = os.homedir(), fetchImpl = globalThis.fetch } = {}) {
    this.clientVersion = verifyExtensionManifest(extensionRoot);
    this.home = path.resolve(home);
    if (typeof fetchImpl !== "function") throw governanceError("A bounded HTTPS transport is unavailable.", undefined, "NETWORK_UNAVAILABLE");
    this.fetchImpl = fetchImpl;
  }

  async run(stepCode, action) {
    if (!STEP_CODES.has(stepCode) || typeof action !== "function") {
      throw governanceError("The requested governed capability is invalid.", undefined, "INTERNAL_ERROR");
    }
    const initialAccount = loadAccount(this.home);
    const lock = await acquireGovernanceOperationLock({
      home: this.home,
      lockName: "vscode",
      accountBinding: initialAccount.accountBinding,
      clientKind: "vscode",
      clientVersion: this.clientVersion,
    });
    let actionStarted = false;
    let terminalPublished = false;
    try {
      const options = {
        home: this.home,
        fetchImpl: this.fetchImpl,
        clientVersion: this.clientVersion,
        expectedAccountBinding: initialAccount.accountBinding,
      };
      await checkStatus(options);
      await flushSpool(options);
      const started = buildEvent({
        clientVersion: this.clientVersion,
        stepCode,
        outcome: "started",
        reasonCode: "NONE",
      });
      try { await postEvents([started], options); }
      catch (error) { throw governanceError("The VS Code governance start event was not acknowledged; the capability did not run.", error, governanceReasonForError(error)); }

      actionStarted = true;
      const startedAt = Date.now();
      let result;
      let actionError = null;
      try { result = await action(); }
      catch (error) { actionError = error; }
      const terminal = buildEvent({
        flowId: started.flow_id,
        sequence: started.sequence + 1,
        clientVersion: this.clientVersion,
        stepCode,
        outcome: isGovernanceCancellation(actionError) ? "cancelled" : actionError ? "failure" : "success",
        reasonCode: actionError ? governanceReasonForError(actionError) : "NONE",
        duration: durationBucket(Date.now() - startedAt),
      });
      publishTerminal(this.home, initialAccount.accountBinding, terminal);
      terminalPublished = true;
      try { await flushSpool(options); } catch { /* The immutable terminal blocks the next capability until replay succeeds. */ }
      if (actionError) throw actionError;
      return result;
    } finally {
      if (!actionStarted || terminalPublished) await releaseGovernanceOperationLock(lock);
      else retainedFailedLocks.add(lock);
    }
  }
}

function createVscodeGovernance(extensionRoot) {
  return new VscodeGovernance({ extensionRoot });
}

module.exports = {
  AETHMERE_APP_ORIGIN,
  EXTENSION_VERSION,
  GOVERNANCE_EVENT_SCHEMA,
  GOVERNANCE_POLICY_DIGEST,
  GOVERNANCE_STATUS_SCHEMA,
  GovernanceCancelledError,
  UPDATE_URL,
  VscodeGovernance,
  createVscodeGovernance,
  isGovernanceCancellation,
  verifyExtensionManifest,
};
