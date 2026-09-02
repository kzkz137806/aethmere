"use strict";

const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MINIMUM_AGENT_VERSION = "0.12.0";
const UPDATE_URL = "https://aethmere.com/downloads/";
const VERSION_LINE = /^Aethmere Agent Client ((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/u;
const READY_LINE = '{"schema":"aethmere.stdin-ready.v1","ready":true}';
const MAX_OUTPUT_BYTES = 1_000_000;
const MAX_STDIN_BYTES = 100_000;
const MAX_READY_BYTES = 256;
const BLOCKED_ENVIRONMENT = new Set([
  "AETHMERE_ALLOW_LOCAL_SERVER",
  "AETHMERE_HOME",
  "NODE_OPTIONS",
  "NODE_PATH",
]);

class AgentClientError extends Error {
  constructor(message, code = "AGENT_CLIENT_REQUIRED", cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "AgentClientError";
    this.code = code;
  }
}

function parseSemver(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(String(value || ""));
  if (!match) return null;
  const prerelease = match[4] ? match[4].split(".") : [];
  if (prerelease.some((part) => !part || (/^\d+$/u.test(part) && part.length > 1 && part.startsWith("0")))) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease };
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) throw new AgentClientError("Aethmere Agent returned an invalid semantic version.", "AGENT_VERSION_INVALID");
  for (const key of ["major", "minor", "patch"]) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function assertSupportedVersion(output, expectedVersion = null) {
  const match = VERSION_LINE.exec(String(output || "").trim());
  if (!match) {
    throw new AgentClientError(`Aethmere Agent version could not be verified exactly. Install ${MINIMUM_AGENT_VERSION} or later from ${UPDATE_URL}`, "AGENT_VERSION_INVALID");
  }
  const version = match[1];
  if (compareSemver(version, MINIMUM_AGENT_VERSION) < 0) {
    throw new AgentClientError(`Aethmere Agent ${version} is unsupported. Install ${MINIMUM_AGENT_VERSION} or later from ${UPDATE_URL}`, "AGENT_VERSION_UNSUPPORTED");
  }
  if (expectedVersion !== null && version !== expectedVersion) {
    throw new AgentClientError("Aethmere Agent runtime version does not match its verified package manifest.", "AGENT_VERSION_INVALID");
  }
  return version;
}

function sanitizedEnvironment(source = process.env, additions = {}) {
  const environment = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!BLOCKED_ENVIRONMENT.has(key.toUpperCase()) && value !== undefined) environment[key] = value;
  }
  return { ...environment, ...additions };
}

function verifiedPackage(packageRoot) {
  const manifestFile = path.join(packageRoot, "package.json");
  let manifestStat;
  try { manifestStat = fs.lstatSync(manifestFile); } catch { return null; }
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 64_000) return null;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); } catch { return null; }
  if (manifest?.name !== "aethmere-agent") return null;
  if (!parseSemver(manifest.version) || compareSemver(manifest.version, MINIMUM_AGENT_VERSION) < 0) return null;
  const relative = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.["aethmere-agent"];
  if (typeof relative !== "string" || !relative) return null;
  const entry = path.resolve(packageRoot, relative);
  const within = path.relative(path.resolve(packageRoot), entry);
  if (!within || within.startsWith("..") || path.isAbsolute(within)) return null;
  try {
    const stat = fs.lstatSync(entry);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
  } catch { return null; }
  return { entry, packageVersion: manifest.version };
}

function packageInvocation(packageRoot, nodeExecutable) {
  const verified = verifiedPackage(packageRoot);
  if (!verified) return null;
  return {
    command: nodeExecutable,
    argsPrefix: [verified.entry],
    env: { ELECTRON_RUN_AS_NODE: "1" },
    packageVersion: verified.packageVersion,
  };
}

function invocationFromWindowsCandidates(candidates, nodeExecutable = process.execPath) {
  for (const candidateValue of candidates || []) {
    const rawCandidate = String(candidateValue || "").trim();
    if (!rawCandidate) continue;
    const candidate = path.resolve(rawCandidate);
    const basename = path.basename(candidate).toLowerCase();
    if (basename !== "aethmere-agent.cmd") continue;
    const roots = [
      path.join(path.dirname(candidate), "node_modules", "aethmere-agent"),
      path.resolve(path.dirname(candidate), "..", "aethmere-agent"),
    ];
    for (const packageRoot of roots) {
      const invocation = packageInvocation(packageRoot, nodeExecutable);
      if (invocation) return invocation;
    }
  }
  return null;
}

function invocationFromPosixCandidates(candidates, nodeExecutable = process.execPath) {
  for (const candidateValue of candidates || []) {
    const rawCandidate = String(candidateValue || "").trim();
    if (!rawCandidate) continue;
    const candidate = path.resolve(rawCandidate);
    if (path.basename(candidate) !== "aethmere-agent") continue;
    let realEntry;
    try {
      const candidateStat = fs.lstatSync(candidate);
      if (!candidateStat.isFile() && !candidateStat.isSymbolicLink()) continue;
      realEntry = fs.realpathSync(candidate);
      if (!fs.statSync(realEntry).isFile()) continue;
    } catch { continue; }
    let directory = path.dirname(realEntry);
    for (let depth = 0; depth < 12; depth += 1) {
      const invocation = packageInvocation(directory, nodeExecutable);
      if (invocation) {
        let verifiedRealEntry;
        try { verifiedRealEntry = fs.realpathSync(invocation.argsPrefix[0]); } catch { break; }
        if (verifiedRealEntry === realEntry) return invocation;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return null;
}

function pathCandidates(environment = process.env, platform = process.platform) {
  const pathValue = Object.entries(environment || {}).find(([key]) => key.toUpperCase() === "PATH")?.[1];
  if (typeof pathValue !== "string") return [];
  const separator = platform === "win32" ? ";" : ":";
  const names = platform === "win32" ? ["aethmere-agent.cmd", "aethmere-agent.exe"] : ["aethmere-agent"];
  const candidates = [];
  for (const rawDirectory of pathValue.split(separator)) {
    const directory = rawDirectory.trim().replace(/^"|"$/gu, "");
    if (!directory) continue;
    for (const name of names) candidates.push(path.resolve(directory, name));
  }
  return candidates;
}

async function resolveAgentInvocation(options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.environment || process.env;
  const nodeExecutable = options.nodeExecutable || process.execPath;
  const candidates = options.candidates || pathCandidates(environment, platform);
  const invocation = platform === "win32"
    ? invocationFromWindowsCandidates(candidates, nodeExecutable)
    : invocationFromPosixCandidates(candidates, nodeExecutable);
  if (!invocation) throw new AgentClientError(`The official Aethmere Agent package was not found or could not be verified. Install ${MINIMUM_AGENT_VERSION} or later from ${UPDATE_URL}`, "AGENT_CLIENT_MISSING");
  return invocation;
}

function agentFailure(stdout, stderr, code) {
  try {
    const payload = JSON.parse(stdout);
    if (payload && payload.ok === false && typeof payload.error === "string") return payload.error.slice(0, 1000);
  } catch { /* fall through to bounded process output */ }
  const bounded = String(stderr || "").trim() || String(stdout || "").trim();
  return (bounded || `Aethmere Agent exited with code ${code}.`).slice(0, 1000);
}

function runProcess(invocation, args, {
  cwd,
  stdinText = "",
  timeoutMs = 0,
  spawnImpl = cp.spawn,
  environment = process.env,
} = {}) {
  const input = String(stdinText || "");
  if (Buffer.byteLength(input, "utf8") > MAX_STDIN_BYTES) return Promise.reject(new AgentClientError("Agent stdin exceeded the safety limit.", "AGENT_INPUT_TOO_LARGE"));
  return new Promise((resolve, reject) => {
    let settled = false;
    let overflow = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout = [];
    const stderr = [];
    let child;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    try {
      child = spawnImpl(invocation.command, [...(invocation.argsPrefix || []), ...args], {
        cwd,
        env: sanitizedEnvironment(environment, invocation.env || {}),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new AgentClientError(`Aethmere Agent could not start. Install it from ${UPDATE_URL}`, "AGENT_CLIENT_MISSING", error));
      return;
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new AgentClientError("Aethmere Agent timed out.", "AGENT_TIMEOUT")));
      }, timeoutMs);
    }
    const collect = (target, chunk, kind) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (kind === "stdout") stdoutBytes += value.length;
      else stderrBytes += value.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES || stderrBytes > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill();
        return;
      }
      target.push(value);
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk) => collect(stderr, chunk, "stderr"));
    child.on("error", (error) => finish(() => reject(new AgentClientError(`Aethmere Agent could not start. Install it from ${UPDATE_URL}`, "AGENT_CLIENT_MISSING", error))));
    child.on("close", (code) => finish(() => {
      if (overflow) return reject(new AgentClientError("Aethmere Agent output exceeded the safety limit.", "AGENT_OUTPUT_TOO_LARGE"));
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) return reject(new AgentClientError(agentFailure(out, err, code), "AGENT_COMMAND_FAILED"));
      resolve({ stdout: out, stderr: err, code });
    }));
    child.stdin.on("error", () => { /* close/error handlers own the result */ });
    child.stdin.end(input, "utf8");
  });
}

function runReadyProcess(invocation, args, {
  cwd,
  requestFactory,
  spawnImpl = cp.spawn,
  environment = process.env,
} = {}) {
  if (typeof requestFactory !== "function") return Promise.reject(new AgentClientError("A ready-gated request factory is required.", "AGENT_ARGUMENT_INVALID"));
  return new Promise((resolve, reject) => {
    let settled = false;
    let phase = "waiting_ready";
    let overflow = false;
    let protocolError = null;
    let requestError = null;
    let requestPromise = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let beforeReady = Buffer.alloc(0);
    const finalStdout = [];
    const stderr = [];
    let child;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    try {
      child = spawnImpl(invocation.command, [...(invocation.argsPrefix || []), ...args], {
        cwd,
        env: sanitizedEnvironment(environment, invocation.env || {}),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new AgentClientError(`Aethmere Agent could not start. Install it from ${UPDATE_URL}`, "AGENT_CLIENT_MISSING", error));
      return;
    }
    const rejectProtocol = (message) => {
      if (protocolError) return;
      protocolError = new AgentClientError(message, "AGENT_PROTOCOL_INVALID");
      child.kill();
    };
    child.stdout.on("data", (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += value.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill();
        return;
      }
      if (phase !== "waiting_ready") {
        if (phase === "requesting") {
          rejectProtocol("Aethmere Agent returned final output before receiving the ready-gated request.");
          return;
        }
        finalStdout.push(value);
        return;
      }
      beforeReady = Buffer.concat([beforeReady, value]);
      if (beforeReady.length > MAX_READY_BYTES) {
        rejectProtocol("Aethmere Agent did not provide the bounded stdin-ready acknowledgement.");
        return;
      }
      const newline = beforeReady.indexOf(0x0a);
      if (newline < 0) return;
      const line = beforeReady.subarray(0, newline).toString("utf8").replace(/\r$/u, "");
      if (line !== READY_LINE || beforeReady.length !== newline + 1) {
        rejectProtocol("Aethmere Agent returned an invalid or out-of-order stdin-ready acknowledgement.");
        return;
      }
      beforeReady = Buffer.alloc(0);
      phase = "requesting";
      requestPromise = Promise.resolve().then(requestFactory).then((requestValue) => {
        const request = String(requestValue || "");
        if (!request || /[\r\n]/u.test(request) || Buffer.byteLength(request, "utf8") > MAX_STDIN_BYTES) {
          throw new AgentClientError("The ready-gated Agent request is invalid or too large.", "AGENT_INPUT_TOO_LARGE");
        }
        phase = "waiting_final";
        child.stdin.end(`${request}\n`, "utf8");
      }).catch((error) => {
        requestError = error instanceof Error ? error : new Error(String(error));
        phase = "draining_failure";
        child.stdin.end();
      });
    });
    child.stderr.on("data", (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += value.length;
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill();
        return;
      }
      stderr.push(value);
    });
    child.stdin.on("error", () => { /* close/error handlers own the result */ });
    child.on("error", (error) => finish(() => reject(new AgentClientError(`Aethmere Agent could not start. Install it from ${UPDATE_URL}`, "AGENT_CLIENT_MISSING", error))));
    child.on("close", (code) => finish(async () => {
      if (requestPromise) await requestPromise;
      if (overflow) return reject(new AgentClientError("Aethmere Agent output exceeded the safety limit.", "AGENT_OUTPUT_TOO_LARGE"));
      if (protocolError) return reject(protocolError);
      if (phase === "waiting_ready") return reject(new AgentClientError("Aethmere Agent exited before the stdin-ready acknowledgement.", "AGENT_PROTOCOL_INVALID"));
      if (requestError) return reject(requestError);
      const out = Buffer.concat(finalStdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) return reject(new AgentClientError(agentFailure(out, err, code), "AGENT_COMMAND_FAILED"));
      if (err.trim()) return reject(new AgentClientError("Aethmere Agent returned unexpected diagnostic output.", "AGENT_PROTOCOL_INVALID"));
      resolve({ stdout: out, stderr: err, code });
    }));
  });
}

class AgentRunner {
  constructor(options = {}) {
    this.resolveInvocation = options.resolveInvocation || resolveAgentInvocation;
    this.spawnImpl = options.spawnImpl || cp.spawn;
    this.environment = options.environment || process.env;
    this.invocationPromise = null;
  }

  async invocation() {
    if (!this.invocationPromise) this.invocationPromise = Promise.resolve().then(() => this.resolveInvocation());
    try { return await this.invocationPromise; }
    catch (error) {
      this.invocationPromise = null;
      throw error;
    }
  }

  async version() {
    const invocation = await this.invocation();
    const result = await runProcess(invocation, ["--version"], {
      timeoutMs: 5_000,
      spawnImpl: this.spawnImpl,
      environment: this.environment,
    });
    return assertSupportedVersion(result.stdout, invocation.packageVersion || null);
  }

  async formal(args, { cwd, stdinText = "", timeoutMs = 0 } = {}) {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new AgentClientError("Invalid Agent arguments.", "AGENT_ARGUMENT_INVALID");
    if (args.some((arg) => /^--(?:server|home)(?:=|$)/u.test(arg))) {
      throw new AgentClientError("Server and account-home overrides are not allowed from the public extension.", "AGENT_ARGUMENT_INVALID");
    }
    const invocation = await this.invocation();
    const versionResult = await runProcess(invocation, ["--version"], {
      timeoutMs: 5_000,
      spawnImpl: this.spawnImpl,
      environment: this.environment,
    });
    const agentVersion = assertSupportedVersion(versionResult.stdout, invocation.packageVersion || null);
    const result = await runProcess(invocation, args, {
      cwd,
      stdinText,
      timeoutMs,
      spawnImpl: this.spawnImpl,
      environment: this.environment,
    });
    return { ...result, agentVersion };
  }

  async formalReady(args, { cwd, requestFactory } = {}) {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string") || !args.includes("--request-stdin")) {
      throw new AgentClientError("Invalid ready-gated Agent arguments.", "AGENT_ARGUMENT_INVALID");
    }
    if (args.some((arg) => /^--(?:server|home)(?:=|$)/u.test(arg))) {
      throw new AgentClientError("Server and account-home overrides are not allowed from the public extension.", "AGENT_ARGUMENT_INVALID");
    }
    const invocation = await this.invocation();
    const versionResult = await runProcess(invocation, ["--version"], {
      timeoutMs: 5_000,
      spawnImpl: this.spawnImpl,
      environment: this.environment,
    });
    const agentVersion = assertSupportedVersion(versionResult.stdout, invocation.packageVersion || null);
    const result = await runReadyProcess(invocation, args, {
      cwd,
      requestFactory,
      spawnImpl: this.spawnImpl,
      environment: this.environment,
    });
    return { ...result, agentVersion };
  }
}

function parseAgentJson(stdout, schema) {
  let payload;
  try { payload = JSON.parse(String(stdout || "")); }
  catch { throw new AgentClientError("Aethmere Agent returned invalid JSON.", "AGENT_RESPONSE_INVALID"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.schema !== schema || payload.ok === false) {
    throw new AgentClientError("Aethmere Agent returned an incompatible response.", "AGENT_RESPONSE_INVALID");
  }
  return payload;
}

module.exports = {
  AgentClientError,
  AgentRunner,
  MINIMUM_AGENT_VERSION,
  UPDATE_URL,
  assertSupportedVersion,
  compareSemver,
  invocationFromPosixCandidates,
  invocationFromWindowsCandidates,
  parseAgentJson,
  parseSemver,
  pathCandidates,
  runReadyProcess,
  runProcess,
  sanitizedEnvironment,
};
