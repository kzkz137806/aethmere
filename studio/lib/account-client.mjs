import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBoundedText } from "./bounded-response.mjs";
import { readBoundedUtf8FileRecord } from "./private-files.mjs";

export const ACCOUNT_SCHEMA = "aethmere.desktop-account.v1";
export const AETHMERE_APP_ORIGIN = "https://app.aethmere.com";

const TOKEN_RE = /^aet_dev_[A-Za-z0-9_-]{40,100}$/u;
const ACCOUNT_BINDING_RE = /^[0-9a-f]{64}$/u;
const ACCOUNT_FIELDS = ["accessToken", "accountBinding", "linkedAt", "schema", "server", "tokenExpiresAt"];
const SPOOL_ENTRY_SCHEMA = "aethmere.governance-spool-entry.v1";
const SPOOL_FILE_RE = /^terminal-[0-9a-f-]{36}\.json$/u;
const MAX_ACCOUNT_BYTES = 16_384;
const MAX_SPOOL_FILE_BYTES = 16_384;
const MAX_SPOOL_ENTRIES = 1000;
const MAX_RESPONSE_BYTES = 64_000;
const REQUEST_TIMEOUT_MS = 20_000;

function clean(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function defaultHome() {
  return os.homedir();
}

export function accountPaths(home = defaultHome()) {
  const directory = path.join(path.resolve(home), ".aethmere");
  return {
    directory,
    account: path.join(directory, "account.json"),
    governanceSpool: path.join(directory, "governance-spool-studio"),
  };
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw accountError("Aethmere 本地授权目录不安全。", "AUTH_REJECTED");
  try { fs.chmodSync(directory, 0o700); } catch { /* Windows ACLs remain authoritative. */ }
}

function writePrivateJson(file, value) {
  ensurePrivateDirectory(path.dirname(file));
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw accountError("Aethmere 账号授权文件不安全。", "AUTH_REJECTED");
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try { fs.chmodSync(temporary, 0o600); } catch { /* Best effort on Windows. */ }
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Best effort on Windows. */ }
}

function accountError(message, code = "AUTH_REQUIRED") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeAccount(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...ACCOUNT_FIELDS].sort().join(",") ||
    value.schema !== ACCOUNT_SCHEMA ||
    value.server !== AETHMERE_APP_ORIGIN ||
    !TOKEN_RE.test(value.accessToken || "") ||
    !ACCOUNT_BINDING_RE.test(value.accountBinding || "")
  ) {
    throw accountError("Aethmere 账号授权格式无效，请重新连接。", "AUTH_REJECTED");
  }
  const expiresAt = Date.parse(clean(value.tokenExpiresAt, 80));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw accountError("Aethmere 设备授权已过期，请重新连接。", "AUTH_REQUIRED");
  }
  return {
    schema: ACCOUNT_SCHEMA,
    server: AETHMERE_APP_ORIGIN,
    accessToken: value.accessToken,
    accountBinding: value.accountBinding,
    tokenExpiresAt: clean(value.tokenExpiresAt, 80),
    linkedAt: clean(value.linkedAt, 80),
  };
}

export function accountBinding(accountId) {
  if (typeof accountId !== "string" || !accountId || accountId !== accountId.trim() || accountId.length > 200) {
    throw new Error("Aethmere 服务没有返回稳定的账号标识。");
  }
  return crypto.createHash("sha256").update(accountId, "utf8").digest("hex");
}

function readPrivateJson(file, maximumBytes, label) {
  try { return JSON.parse(readBoundedUtf8FileRecord(file, maximumBytes).text); }
  catch { throw accountError(`${label}不安全、损坏或超过大小上限。`, "AUTH_REJECTED"); }
}

function assertSpoolBinding(home, binding) {
  const directory = accountPaths(home).governanceSpool;
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw accountError("治理终态待发目录不安全，拒绝切换账号。", "AUTH_REJECTED");
  let count = 0;
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    count += 1;
    if (count > MAX_SPOOL_ENTRIES || !SPOOL_FILE_RE.test(item.name) || !item.isFile() || item.isSymbolicLink()) {
      throw accountError("治理终态待发目录包含无效记录，拒绝切换账号。", "AUTH_REJECTED");
    }
    let entry;
    try { entry = readPrivateJson(path.join(directory, item.name), MAX_SPOOL_FILE_BYTES, "治理终态待发文件"); }
    catch (error) {
      if (error?.code === "AUTH_REJECTED") throw error;
      throw accountError("治理终态待发文件损坏，拒绝切换账号。", "AUTH_REJECTED");
    }
    if (
      !entry || typeof entry !== "object" || Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== "account_binding,event,schema,state" ||
      entry.schema !== SPOOL_ENTRY_SCHEMA || entry.state !== "terminal" ||
      !ACCOUNT_BINDING_RE.test(entry.account_binding || "") || entry.account_binding !== binding
    ) throw accountError("待发治理终态属于另一个账号，拒绝切换账号。", "AUTH_REJECTED");
  }
}

export function loadAccount(home = defaultHome()) {
  const file = accountPaths(home).account;
  if (!fs.existsSync(file)) return null;
  let value;
  try { value = readPrivateJson(file, MAX_ACCOUNT_BYTES, "Aethmere 账号授权文件"); }
  catch { throw accountError("Aethmere 账号授权文件损坏，请退出后重新连接。", "AUTH_REJECTED"); }
  return normalizeAccount(value);
}

export function publicAccountStatus(home = defaultHome()) {
  try {
    const account = loadAccount(home);
    if (!account) return { connected: false, email: "", displayName: "", tokenExpiresAt: "", error: "" };
    return {
      connected: true,
      email: "",
      displayName: "",
      tokenExpiresAt: clean(account.tokenExpiresAt, 80),
      error: "",
    };
  } catch (error) {
    return { connected: false, email: "", displayName: "", tokenExpiresAt: "", error: error.message };
  }
}

async function readBoundedJson(response) {
  const text = await readBoundedText(response, MAX_RESPONSE_BYTES, "Aethmere 服务返回内容超过安全上限。");
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!response.ok) {
    const error = accountError(clean(payload?.error, 300) || `Aethmere 服务请求失败（${response.status}）。`, response.status === 401 ? "AUTH_REQUIRED" : "AUTH_REJECTED");
    error.status = response.status;
    throw error;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw accountError("Aethmere 服务返回格式无效。", "INTERNAL_ERROR");
  }
  return payload;
}

export async function appRequest(pathname, options = {}, { home = defaultHome(), fetchImpl = fetch, authenticated = true, expectedAccountBinding = "" } = {}) {
  if (!/^\/api\/[A-Za-z0-9?=&._/-]+$/u.test(pathname)) throw new Error("拒绝无效的 Aethmere 服务路径。");
  const headers = { accept: "application/json", ...(options.headers || {}), origin: AETHMERE_APP_ORIGIN };
  if (authenticated) {
    const account = loadAccount(home);
    if (!account) throw accountError("这台电脑尚未连接 Aethmere 账号。", "AUTH_REQUIRED");
    if (expectedAccountBinding && account.accountBinding !== expectedAccountBinding) throw accountError("治理操作期间连接的 Aethmere 账号发生变化。", "AUTH_REJECTED");
    headers.authorization = `Bearer ${account.accessToken}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${AETHMERE_APP_ORIGIN}${pathname}`, {
      ...options,
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    return await readBoundedJson(response);
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeout = accountError("Aethmere 服务请求超时，请稍后重试。", "TIMEOUT");
      timeout.name = "AbortError";
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function loginWithDeviceCode(code, { home = defaultHome(), fetchImpl = fetch } = {}) {
  const normalizedCode = clean(code, 40).toUpperCase();
  if (!/^[A-Z0-9-]{4,40}$/u.test(normalizedCode)) throw new Error("请输入 Aethmere 应用生成的一次性电脑连接码。");
  const payload = await appRequest("/api/auth/device-code", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: normalizedCode }),
  }, { home, fetchImpl, authenticated: false });
  if (!TOKEN_RE.test(payload.accessToken || "") || !Number.isFinite(Date.parse(payload.tokenExpiresAt || ""))) {
    throw new Error("Aethmere 服务没有返回有效的设备授权。");
  }
  const stableAccountBinding = accountBinding(payload.account?.id);
  assertSpoolBinding(home, stableAccountBinding);
  const account = {
    schema: ACCOUNT_SCHEMA,
    server: AETHMERE_APP_ORIGIN,
    accessToken: payload.accessToken,
    accountBinding: stableAccountBinding,
    tokenExpiresAt: clean(payload.tokenExpiresAt, 80),
    linkedAt: new Date().toISOString(),
  };
  normalizeAccount(account);
  writePrivateJson(accountPaths(home).account, account);
  return publicAccountStatus(home);
}

export async function logoutAccount({ home = defaultHome(), fetchImpl = fetch } = {}) {
  const paths = accountPaths(home);
  let account = null;
  try { account = loadAccount(home); } catch { /* Invalid local credentials must still be removable. */ }
  if (account) {
    try {
      await appRequest("/api/auth/device-code", { method: "DELETE" }, { home, fetchImpl, authenticated: true });
    } catch { /* Local credential removal must still succeed. */ }
  }
  fs.rmSync(paths.account, { force: true });
  return publicAccountStatus(home);
}
