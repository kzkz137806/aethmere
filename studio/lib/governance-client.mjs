import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accountPaths, appRequest, loadAccount } from "./account-client.mjs";
import {
  ensureUnredirectedDirectory,
  fsyncDirectoryIfSupported,
  publishImmutableJson,
  readBoundedUtf8FileRecord,
  removeImmutableFile,
} from "./private-files.mjs";
import {
  acquireGovernanceOperationLock,
  releaseGovernanceOperationLock,
} from "./operation-lock.mjs";

export const GOVERNANCE_STATUS_SCHEMA = "aethmere.governance-status.v1";
export const GOVERNANCE_EVENT_SCHEMA = "aethmere.client-behavior.v1";
export const GOVERNANCE_POLICY_DIGEST = "76d79b04705333ce60764488c8923ee25a24dae9e5d17a8fc08b67c14a033285";
export const GOVERNANCE_ERROR_CODE = "GOVERNANCE_CONNECTION_REQUIRED";
export const STUDIO_MINIMUM_VERSION = "0.12.0";
export const UPDATE_URL = "https://aethmere.com/downloads/";

const PUBLIC_CLIENT_KINDS = ["agent_client", "studio", "vscode"];
const CLIENT_KINDS = new Set(["cli_mcp", "vscode", "native", "web", "studio", "agent_client"]);
const PLATFORM_FAMILIES = new Set(["windows", "macos", "linux", "ios", "android", "web", "unknown"]);
const STEP_CODES = new Set([
  "CLIENT_START", "GOVERNANCE_CONNECT", "MEMORY_RECALL", "MEMORY_GET", "CLOUD_MEMORY_RECALL",
  "DISCIPLINE_CONTEXT", "SKILL_LIST", "SKILL_FETCH", "SKILL_OUTCOME", "CHAT", "SEARCH",
  "AGENT_RUN", "FEEDBACK", "LOCAL_CANDIDATE_READY",
]);
const OUTCOMES = new Set(["started", "success", "partial", "failure", "blocked", "abstained", "cancelled"]);
const REASONS = new Set([
  "NONE", "NETWORK_UNAVAILABLE", "TLS_REJECTED", "AUTH_REQUIRED", "AUTH_REJECTED", "POLICY_MISMATCH",
  "VERSION_UNSUPPORTED", "CAPABILITY_NOT_ENTITLED", "RATE_LIMITED", "MODEL_UNAVAILABLE", "SKILL_NOT_FOUND",
  "SEARCH_NO_EVIDENCE", "TIMEOUT", "USER_CANCELLED", "SAFETY_BLOCKED", "INTERNAL_ERROR", "OUTCOME_NOT_REPORTED",
]);
const DURATIONS = new Set(["lt_250ms", "250ms_1s", "1_5s", "5_30s", "30_120s", "gte_120s", "unknown"]);
const ATTEMPTS = new Set(["1", "2", "3_plus", "unknown"]);
const EVENT_FIELDS = new Set([
  "schema_version", "event_id", "flow_id", "sequence", "client_kind", "client_version", "platform_family",
  "policy_digest", "step_code", "outcome", "reason_code", "skill_ref", "duration_bucket", "attempt_bucket", "time_bucket",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/u;
const GSK_RE = /^GSK-\d{3,}$/u;
const ACCOUNT_BINDING_RE = /^[0-9a-f]{64}$/u;
const SPOOL_ENTRY_SCHEMA = "aethmere.governance-spool-entry.v1";
const SPOOL_FILE_RE = /^terminal-([0-9a-f-]{36})\.json$/u;
const MAX_SPOOL_ENTRIES = 1000;
const MAX_SPOOL_FILE_BYTES = 16_384;
const MAX_POST_BATCH = 100;
const MAX_FLUSH_ROUNDS = 20;
// Strong retention is deliberate: a local terminal-persistence failure keeps
// the live-process OS mutex held until process exit.
const operationLocks = new Map();

function defaultHome() {
  return os.homedir();
}

function governanceError(message, cause, reasonCode = "NETWORK_UNAVAILABLE") {
  const error = new Error(`${GOVERNANCE_ERROR_CODE}：${message}`, cause ? { cause } : undefined);
  error.code = GOVERNANCE_ERROR_CODE;
  error.reasonCode = reasonCode;
  return error;
}

function normalizePlatform(value = process.platform) {
  const platform = String(value || "").toLowerCase();
  if (platform === "win32" || platform === "windows") return "windows";
  if (platform === "darwin" || platform === "macos") return "macos";
  if (platform === "linux" || platform === "ios" || platform === "android" || platform === "web") return platform;
  return "unknown";
}

function semverParts(value) {
  if (!SEMVER_RE.test(String(value || ""))) return null;
  return String(value).split(/[+-]/u, 1)[0].split(".").map(Number);
}

export function compareVersions(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  if (!a || !b) throw new Error("无效的客户端版本策略。");
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

function versionMap(status, key) {
  const value = status?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).sort().join(",") !== [...PUBLIC_CLIENT_KINDS].sort().join(",")) return null;
  for (const kind of PUBLIC_CLIENT_KINDS) if (!semverParts(value[kind])) return null;
  return value;
}

function versionMetadata(minimumVersions, latestVersions, clientVersion) {
  const minimumVersion = minimumVersions.studio;
  const latestVersion = latestVersions.studio;
  for (const kind of PUBLIC_CLIENT_KINDS) {
    if (compareVersions(latestVersions[kind], minimumVersions[kind]) < 0) {
      throw governanceError("服务器返回的最低版与最新版策略不一致，请更新客户端后重试。", undefined, "POLICY_MISMATCH");
    }
  }
  if (compareVersions(clientVersion, STUDIO_MINIMUM_VERSION) < 0 || compareVersions(clientVersion, minimumVersion) < 0) {
    throw governanceError(`Studio ${clientVersion} 已低于服务端最低版本 ${minimumVersion}，请先更新。`, undefined, "VERSION_UNSUPPORTED");
  }
  return { minimumVersion, latestVersion, updateAvailable: compareVersions(clientVersion, latestVersion) < 0 };
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
  if (REASONS.has(error.reasonCode)) return error.reasonCode;
  const status = Number(error.status || error.statusCode || 0);
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "CAPABILITY_NOT_ENTITLED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502 || status === 503) return "NETWORK_UNAVAILABLE";
  if (error.name === "AbortError") return "TIMEOUT";
  const code = String(error.code || error.cause?.code || "").toUpperCase();
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(code)) return "TIMEOUT";
  if (["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code)) return "TLS_REJECTED";
  if (["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(code)) return "NETWORK_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

export function validateGovernanceEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return { ok: false, reason: "event must be an object" };
  for (const key of Object.keys(event)) if (!EVENT_FIELDS.has(key)) return { ok: false, reason: `unknown field: ${key}` };
  if (Object.keys(event).length !== EVENT_FIELDS.size) return { ok: false, reason: "event fields are incomplete" };
  if (event.schema_version !== 1 || !UUID_RE.test(event.event_id || "") || !UUID_RE.test(event.flow_id || "")) return { ok: false, reason: "invalid identity" };
  if (!Number.isInteger(event.sequence) || event.sequence < 0 || event.sequence > 9999) return { ok: false, reason: "invalid sequence" };
  if (!CLIENT_KINDS.has(event.client_kind) || !SEMVER_RE.test(event.client_version || "")) return { ok: false, reason: "invalid client" };
  if (!PLATFORM_FAMILIES.has(event.platform_family) || event.policy_digest !== GOVERNANCE_POLICY_DIGEST) return { ok: false, reason: "invalid policy" };
  if (!STEP_CODES.has(event.step_code) || !OUTCOMES.has(event.outcome) || !REASONS.has(event.reason_code)) return { ok: false, reason: "invalid result" };
  if ((event.outcome === "success" || event.outcome === "started") !== (event.reason_code === "NONE")) return { ok: false, reason: "inconsistent result" };
  if (!(event.skill_ref === null || GSK_RE.test(event.skill_ref))) return { ok: false, reason: "invalid skill_ref" };
  if (!DURATIONS.has(event.duration_bucket) || !ATTEMPTS.has(event.attempt_bucket) || !DAY_RE.test(event.time_bucket || "")) return { ok: false, reason: "invalid buckets" };
  return { ok: true };
}

export function buildGovernanceEvent({
  eventId = crypto.randomUUID(), flowId = crypto.randomUUID(), sequence = 0, clientVersion, platformFamily = normalizePlatform(),
  stepCode, outcome, reasonCode, duration = "unknown", attempt = "1", now = new Date(),
} = {}) {
  const event = {
    schema_version: 1,
    event_id: eventId,
    flow_id: flowId,
    sequence,
    client_kind: "studio",
    client_version: clientVersion,
    platform_family: normalizePlatform(platformFamily),
    policy_digest: GOVERNANCE_POLICY_DIGEST,
    step_code: stepCode,
    outcome,
    reason_code: reasonCode,
    skill_ref: null,
    duration_bucket: duration,
    attempt_bucket: attempt,
    time_bucket: now.toISOString().slice(0, 10),
  };
  const verdict = validateGovernanceEvent(event);
  if (!verdict.ok) throw new Error(`invalid governance event: ${verdict.reason}`);
  return event;
}

function spoolPaths(home) {
  const directory = accountPaths(home).governanceSpool;
  return { directory, candidates: `${directory}-candidates` };
}

function ensurePrivateCollection(paths, { create = false } = {}) {
  const parent = path.dirname(paths.directory);
  ensureUnredirectedDirectory(parent, { create });
  if (!fs.existsSync(paths.directory)) {
    if (!create) return null;
    fs.mkdirSync(paths.directory, { mode: 0o700 });
    ensureUnredirectedDirectory(paths.directory);
    fsyncDirectoryIfSupported(parent);
  } else ensureUnredirectedDirectory(paths.directory);
  return paths;
}

function ensureSpool(home, { create = false } = {}) {
  return ensurePrivateCollection(spoolPaths(home), { create });
}

function validateSpoolEntry(value, filename) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "account_binding,event,schema,state" ||
    value.schema !== SPOOL_ENTRY_SCHEMA || value.state !== "terminal" ||
    !ACCOUNT_BINDING_RE.test(value.account_binding || "")
  ) throw governanceError("治理终态待发目录包含无效记录，已停止新的正式能力。", undefined, "INTERNAL_ERROR");
  const verdict = validateGovernanceEvent(value.event);
  if (!verdict.ok || value.event.client_kind !== "studio" || value.event.outcome === "started") {
    throw governanceError("治理终态待发目录包含无效终态，已停止新的正式能力。", undefined, "INTERNAL_ERROR");
  }
  if (filename !== `terminal-${value.event.event_id}.json`) {
    throw governanceError("治理终态待发文件名与事件不一致，已停止新的正式能力。", undefined, "INTERNAL_ERROR");
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
      if (records.length >= MAX_SPOOL_ENTRIES) throw governanceError("治理终态待发目录已满，已停止新的正式能力。", undefined, "INTERNAL_ERROR");
      if (!SPOOL_FILE_RE.test(item.name) || !item.isFile() || item.isSymbolicLink()) {
        throw governanceError("治理终态待发目录包含未知文件，已停止新的正式能力。", undefined, "INTERNAL_ERROR");
      }
      const file = path.join(paths.directory, item.name);
      let parsed;
      let identity;
      try {
        const record = readBoundedUtf8FileRecord(file, MAX_SPOOL_FILE_BYTES);
        parsed = JSON.parse(record.text);
        identity = record.identity;
      } catch (error) {
        throw governanceError("治理终态待发文件不安全、损坏或超过大小上限。", error, "INTERNAL_ERROR");
      }
      const entry = validateSpoolEntry(parsed, item.name);
      if (eventIds.has(entry.event.event_id)) throw governanceError("治理终态待发目录包含重复事件。", undefined, "INTERNAL_ERROR");
      eventIds.add(entry.event.event_id);
      records.push({ file, identity, entry });
    }
  } finally { directory.closeSync(); }
  return records.sort((left, right) => left.file.localeCompare(right.file));
}

function publishTerminal(home, accountBinding, event) {
  const paths = ensureSpool(home, { create: true });
  const file = path.join(paths.directory, `terminal-${event.event_id}.json`);
  const entry = { schema: SPOOL_ENTRY_SCHEMA, account_binding: accountBinding, state: "terminal", event };
  const result = publishImmutableJson(file, entry, { candidateDirectory: paths.candidates });
  if (!result.created) {
    const existing = listSpool(home).find((record) => record.file === file);
    if (!existing || JSON.stringify(existing.entry) !== JSON.stringify(entry)) throw governanceError("治理终态事件标识发生冲突。", undefined, "INTERNAL_ERROR");
  }
  return { file, identity: result.identity };
}

async function postEvents(events, options, { replay = false } = {}) {
  const identity = events[0];
  const response = await appRequest("/api/governance", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.aethmere.com",
      "x-aethmere-client-kind": identity.client_kind,
      "x-aethmere-client-version": identity.client_version,
    },
    body: JSON.stringify({ events }),
  }, options);
  if (
    response.accepted !== events.length ||
    !Array.isArray(response.rejected) ||
    response.rejected.length !== 0 ||
    !Number.isInteger(response.stored) ||
    response.stored < 0 ||
    response.stored > events.length ||
    (!replay && response.stored !== events.length)
  ) throw new Error("server did not acknowledge the complete governance batch");
  return response;
}

export async function checkGovernanceConnection({ home = defaultHome(), fetchImpl = fetch, clientVersion } = {}) {
  let status;
  let account;
  try {
    account = loadAccount(home);
    if (!account) throw new Error("这台电脑尚未连接 Aethmere 账号。");
    status = await appRequest("/api/governance", {
      method: "GET",
      headers: { "x-aethmere-client-kind": "studio", "x-aethmere-client-version": clientVersion },
    }, { home, fetchImpl, expectedAccountBinding: account.accountBinding });
  }
  catch (error) { throw governanceError("无法建立实时的第一方治理连接，请检查网络与账号授权。", error, governanceReasonForError(error)); }
  const minimumVersions = versionMap(status, "minimumClientVersions");
  const latestVersions = versionMap(status, "latestClientVersions");
  if (
    status.schema !== GOVERNANCE_STATUS_SCHEMA || status.ok !== true || status.required !== true ||
    status.policyDigest !== GOVERNANCE_POLICY_DIGEST || status.eventSchema !== GOVERNANCE_EVENT_SCHEMA || status.rawContentAccepted !== false ||
    !minimumVersions || !latestVersions || status.updateUrl !== UPDATE_URL
  ) throw governanceError("服务器治理策略与当前客户端不兼容，请更新客户端。", undefined, "POLICY_MISMATCH");
  return { ...status, ...versionMetadata(minimumVersions, latestVersions, clientVersion), accountBinding: account.accountBinding };
}

export async function flushGovernanceOutbox({ home = defaultHome(), fetchImpl = fetch, accountBinding = "" } = {}) {
  const account = loadAccount(home);
  const expectedBinding = accountBinding || account?.accountBinding || "";
  if (!account || account.accountBinding !== expectedBinding) throw governanceError("请连接拥有待发治理终态的 Aethmere 账号。", undefined, "AUTH_REJECTED");
  let flushed = 0;
  for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
    const snapshot = listSpool(home);
    if (!snapshot.length) return { flushed };
    if (snapshot.some((record) => record.entry.account_binding !== expectedBinding)) {
      throw governanceError("治理终态待发目录属于另一个账号，已停止新的正式能力。", undefined, "AUTH_REJECTED");
    }
    const batch = snapshot.slice(0, MAX_POST_BATCH);
    try {
      await postEvents(batch.map((record) => record.entry.event), { home, fetchImpl, expectedAccountBinding: expectedBinding }, { replay: true });
      for (const record of batch) removeImmutableFile(record.file, record.identity);
      flushed += batch.length;
    } catch (error) {
      if (error?.code === GOVERNANCE_ERROR_CODE) throw error;
      throw governanceError("历史治理事件尚未安全送达，已停止新的正式能力。", error, governanceReasonForError(error));
    }
  }
  throw governanceError("治理终态待发目录持续变化，已停止新的正式能力。", undefined, "INTERNAL_ERROR");
}

export async function beginGovernedOperation({ home = defaultHome(), fetchImpl = fetch, clientVersion, stepCode } = {}) {
  const initialAccount = loadAccount(home);
  if (!initialAccount) throw governanceError("这台电脑尚未连接 Aethmere 账号。", undefined, "AUTH_REQUIRED");
  const lock = await acquireGovernanceOperationLock({
    home,
    lockName: "studio",
    accountBinding: initialAccount.accountBinding,
    clientKind: "studio",
    clientVersion,
  });
  let retained = false;
  try {
    const policy = await checkGovernanceConnection({ home, fetchImpl, clientVersion });
    if (policy.accountBinding !== initialAccount.accountBinding) {
      throw governanceError("获取治理操作锁期间连接账号发生变化。", undefined, "AUTH_REJECTED");
    }
    await flushGovernanceOutbox({ home, fetchImpl, accountBinding: policy.accountBinding });
    const event = buildGovernanceEvent({ clientVersion, stepCode, outcome: "started", reasonCode: "NONE" });
    try { await postEvents([event], { home, fetchImpl, expectedAccountBinding: policy.accountBinding }); }
    catch (error) { throw governanceError("治理开始事件未被服务器确认，正式能力未执行。", error, governanceReasonForError(error)); }
    const operation = { ...event, startedAtMs: Date.now(), policy, accountBinding: policy.accountBinding };
    operationLocks.set(operation, lock);
    retained = true;
    return operation;
  } finally {
    if (!retained) await releaseGovernanceOperationLock(lock);
  }
}

export async function finishGovernedOperation(operation, { home = defaultHome(), fetchImpl = fetch, outcome = "success", reasonCode = "NONE" } = {}) {
  const lock = operationLocks.get(operation);
  if (!lock) throw governanceError("治理操作已失效，未发送终态事件。", undefined, "INTERNAL_ERROR");
  let terminalPublished = false;
  try {
    if (
      operation.accountBinding !== lock.value.account_binding ||
      operation.client_kind !== lock.value.client_kind ||
      operation.client_version !== lock.value.client_version
    ) throw governanceError("治理操作身份在终态事件前发生变化。", undefined, "INTERNAL_ERROR");
    const event = buildGovernanceEvent({
      flowId: operation.flow_id,
      sequence: operation.sequence + 1,
      clientVersion: operation.client_version,
      platformFamily: operation.platform_family,
      stepCode: operation.step_code,
      outcome,
      reasonCode,
      duration: durationBucket(Date.now() - operation.startedAtMs),
      attempt: operation.attempt_bucket,
    });
    publishTerminal(home, operation.accountBinding, event);
    terminalPublished = true;
    try {
      await flushGovernanceOutbox({
        home,
        fetchImpl,
        accountBinding: operation.accountBinding,
      });
      return { queued: false };
    } catch { return { queued: true }; }
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
    await finishGovernedOperation(operation, { ...options, outcome: "failure", reasonCode: governanceReasonForError(error) });
    throw error;
  }
  await finishGovernedOperation(operation, { ...options, outcome: "success", reasonCode: "NONE" });
  return result;
}
