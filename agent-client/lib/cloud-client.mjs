import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureUnredirectedDirectory, readBoundedUtf8File } from "./local-files.mjs";

export const DEFAULT_SERVER = "https://app.aethmere.com";
const ACCOUNT_SCHEMA = "aethmere.desktop-account.v1";
const TOKEN_RE = /^aet_dev_[A-Za-z0-9_-]{40,100}$/u;
const ACCOUNT_BINDING_RE = /^[0-9a-f]{64}$/u;
const MAX_ACCOUNT_BYTES = 16_384;
const MAX_RESPONSE_BYTES = 512_000;
const REQUEST_TIMEOUT_MS = 20_000;

function clean(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function accountBinding(accountId) {
  if (
    typeof accountId !== "string" ||
    !accountId ||
    accountId !== accountId.trim() ||
    accountId.length > 200
  ) {
    throw new Error("The Aethmere account service did not return a stable account identifier.");
  }
  return crypto.createHash("sha256").update(accountId, "utf8").digest("hex");
}

export function safeServer(value = DEFAULT_SERVER) {
  const raw = clean(value) || DEFAULT_SERVER;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The Aethmere account server URL is invalid.");
  }
  if (url.username || url.password) {
    throw new Error("Refusing an Aethmere account server URL containing credentials.");
  }
  if (url.pathname !== "/" || raw.includes("?") || raw.includes("#")) {
    throw new Error("The Aethmere account server must be an origin without a path, query, or fragment.");
  }
  if (url.origin !== DEFAULT_SERVER) {
    throw new Error("Refusing to send an Aethmere device authorization outside " + DEFAULT_SERVER + ".");
  }
  return DEFAULT_SERVER;
}

export function cloudPaths(home = process.env.AETHMERE_HOME || os.homedir()) {
  const directory = path.join(path.resolve(home), ".aethmere");
  return {
    directory,
    account: path.join(directory, "account.json"),
    governanceOutbox: path.join(directory, "governance-spool-agent-client"),
  };
}

function ensurePrivateDirectory(directory) {
  ensureUnredirectedDirectory(directory, { create: true });
  try { fs.chmodSync(directory, 0o700); } catch { /* Windows ACLs are platform-managed. */ }
}

function writePrivateJson(file, value) {
  ensurePrivateDirectory(path.dirname(file));
  const temporary = file + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(temporary, 0o600); } catch { /* best effort on Windows */ }
  ensureUnredirectedDirectory(path.dirname(file));
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort on Windows */ }
}

export function loadCloudAccount(home) {
  const file = cloudPaths(home).account;
  if (!ensureUnredirectedDirectory(path.dirname(file))) return null;
  if (!fs.existsSync(file)) return null;
  let value;
  try {
    value = JSON.parse(readBoundedUtf8File(file, MAX_ACCOUNT_BYTES));
  } catch {
    throw new Error("The Aethmere device authorization file is unreadable. Log out and connect again.");
  }
  if (
    value?.schema !== ACCOUNT_SCHEMA ||
    !TOKEN_RE.test(value.accessToken || "") ||
    !ACCOUNT_BINDING_RE.test(value.accountBinding || "")
  ) {
    throw new Error("The Aethmere device authorization is invalid. Log out and connect again.");
  }
  const tokenExpiresAt = clean(value.tokenExpiresAt, 80);
  const expiryMs = Date.parse(tokenExpiresAt);
  if (!tokenExpiresAt || !Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    throw new Error("The Aethmere device authorization has expired. Log out and connect again.");
  }
  return {
    schema: ACCOUNT_SCHEMA,
    server: safeServer(value.server),
    accessToken: value.accessToken,
    accountBinding: value.accountBinding,
    tokenExpiresAt,
    linkedAt: clean(value.linkedAt, 80),
  };
}

async function readBoundedResponse(response) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
      throw new Error("Aethmere account response exceeded the safety limit.");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel("response exceeded the safety limit");
        throw new Error("Aethmere account response exceeded the safety limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

async function request(server, pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(safeServer(server) + pathname, {
      ...options,
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await readBoundedResponse(response);
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }
    if (!response.ok) {
      const error = new Error(clean(payload?.error) || "Aethmere account request failed (" + response.status + ").");
      error.status = response.status;
      throw error;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Aethmere account service returned an invalid response.");
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeout = new Error("Aethmere account request timed out.");
      timeout.code = "ETIMEDOUT";
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function loginWithDeviceCode(code, { home } = {}) {
  const normalized = clean(code, 40).toUpperCase();
  if (!normalized) throw new Error("Enter the one-time computer connection code from the Aethmere app.");
  const payload = await request(DEFAULT_SERVER, "/api/auth/device-code", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: normalized }),
  });
  if (!TOKEN_RE.test(payload.accessToken || "")) {
    throw new Error("The Aethmere account service did not return a valid device authorization.");
  }
  const stableAccountBinding = accountBinding(payload.account?.id);
  const tokenExpiresAt = clean(payload.tokenExpiresAt, 80);
  const expiryMs = Date.parse(tokenExpiresAt);
  if (!tokenExpiresAt || !Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    throw new Error("The Aethmere account service returned an expired device authorization.");
  }
  const account = {
    schema: ACCOUNT_SCHEMA,
    server: DEFAULT_SERVER,
    accessToken: payload.accessToken,
    accountBinding: stableAccountBinding,
    tokenExpiresAt,
    linkedAt: new Date().toISOString(),
  };
  writePrivateJson(cloudPaths(home).account, account);
  return { connected: true, server: account.server, tokenExpiresAt: account.tokenExpiresAt };
}

export function logoutCloudAccount({ home } = {}) {
  const paths = cloudPaths(home);
  if (!ensureUnredirectedDirectory(paths.directory)) return { connected: false };
  fs.rmSync(paths.account, { force: true });
  return { connected: false };
}

function authorization(account) {
  return { authorization: "Bearer " + account.accessToken };
}

function clientHeaders(account, clientKind, clientVersion) {
  return {
    ...authorization(account),
    "x-aethmere-client-kind": String(clientKind || ""),
    "x-aethmere-client-version": String(clientVersion || ""),
  };
}

function requireExpectedAccount(account, expectedAccountBinding) {
  if (expectedAccountBinding && account.accountBinding !== expectedAccountBinding) {
    throw new Error("The connected Aethmere account changed during the governed operation.");
  }
}

export async function fetchGovernanceStatus({
  home,
  clientKind,
  clientVersion,
  expectedAccountBinding,
} = {}) {
  const account = loadCloudAccount(home);
  if (!account) {
    const error = new Error("GOVERNANCE_CONNECTION_REQUIRED: connect this computer to an Aethmere account first.");
    error.code = "GOVERNANCE_CONNECTION_REQUIRED";
    throw error;
  }
  requireExpectedAccount(account, expectedAccountBinding);
  return request(account.server, "/api/governance", {
    method: "GET",
    headers: clientHeaders(account, clientKind, clientVersion),
  });
}

export async function postGovernanceEvents(events, {
  home,
  clientKind,
  clientVersion,
  expectedAccountBinding,
} = {}) {
  const account = loadCloudAccount(home);
  if (!account) {
    const error = new Error("GOVERNANCE_CONNECTION_REQUIRED: connect this computer to an Aethmere account first.");
    error.code = "GOVERNANCE_CONNECTION_REQUIRED";
    throw error;
  }
  requireExpectedAccount(account, expectedAccountBinding);
  return request(account.server, "/api/governance", {
    method: "POST",
    headers: {
      ...clientHeaders(account, clientKind, clientVersion),
      "content-type": "application/json",
    },
    body: JSON.stringify({ events }),
  });
}
