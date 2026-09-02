#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { connectClients } from "../lib/connect.mjs";
import { runMcpServer } from "../lib/mcp-server.mjs";
import {
  checkGovernanceConnection,
  runGovernedCapability,
  UPDATE_URL,
} from "../lib/governance-client.mjs";
import {
  loadCloudAccount,
  loginWithDeviceCode,
  logoutCloudAccount,
} from "../lib/cloud-client.mjs";
import {
  addItem,
  contextFile,
  getItem,
  initializeStore,
  listItems,
  projectRoot,
  readStore,
  removeItem,
} from "../lib/store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const MAX_CONTEXT_INPUT_BYTES = 100_000;

function option(args, name) {
  const exact = "--" + name;
  const index = args.findIndex((arg) => arg === exact || arg.startsWith(exact + "="));
  if (index < 0) return "";
  if (args[index].startsWith(exact + "=")) return args[index].slice(exact.length + 1);
  return args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : "";
}

function flag(args, name) {
  return args.includes("--" + name);
}

function hasOption(args, name) {
  const exact = "--" + name;
  return args.some((argument) => argument === exact || argument.startsWith(exact + "="));
}

function rootFrom(args) {
  return projectRoot(option(args, "root") || ".");
}

function print(value, asJson) {
  if (asJson) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function help() {
  console.log("Aethmere Agent Client " + packageJson.version);
  console.log("");
  console.log("Usage:");
  console.log("  aethmere-agent login --code CODE");
  console.log("  aethmere-agent logout");
  console.log("  aethmere-agent update-check");
  console.log("  aethmere-agent init [--root .]");
  console.log("  aethmere-agent add --id ID --title TITLE (--stdin | --text TEXT | --file FILE) [--tags a,b] [--replace]");
  console.log("  aethmere-agent list [--query TEXT]");
  console.log("  aethmere-agent get --id ID");
  console.log("  aethmere-agent get --request-stdin --json");
  console.log("  aethmere-agent remove --id ID --yes");
  console.log("  aethmere-agent connect [--client all|claude|codex] [--check]");
  console.log("  aethmere-agent doctor");
  console.log("  aethmere-agent mcp [--root .]");
  console.log("");
  console.log("Formal capabilities require an authenticated live connection to app.aethmere.com.");
  console.log("Governance event bodies contain closed result metadata, never context text, prompts, paths or tokens.");
  console.log("Login, logout, diagnosis, update checks and user-data deletion remain available for recovery.");
}

async function readStdinBounded() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_CONTEXT_INPUT_BYTES) throw new Error("context input exceeds the 100000-byte safety limit");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readText(args) {
  const literal = option(args, "text");
  const file = option(args, "file");
  const stdin = flag(args, "stdin");
  if ([Boolean(literal), Boolean(file), stdin].filter(Boolean).length !== 1) {
    throw new Error("use exactly one of --stdin, --text or --file");
  }
  if (stdin) return readStdinBounded();
  if (file) {
    const resolved = path.resolve(file);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > MAX_CONTEXT_INPUT_BYTES) {
      throw new Error("context input exceeds the 100000-byte safety limit");
    }
    return fs.readFileSync(resolved, "utf8");
  }
  return literal;
}

async function readAddRequest(args) {
  const conflicts = ["id", "title", "text", "file", "stdin", "tags", "replace"]
    .filter((name) => hasOption(args, name));
  if (conflicts.length) {
    throw new Error("--request-stdin cannot be combined with per-field add arguments");
  }
  process.stdout.write(JSON.stringify({ schema: "aethmere.stdin-ready.v1", ready: true }) + "\n");
  let request;
  try {
    request = JSON.parse(await readStdinBounded());
  } catch {
    throw new Error("request stdin must contain one valid JSON object");
  }
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).sort().join(",") !== "id,replace,tags,text,title" ||
    typeof request.id !== "string" ||
    typeof request.title !== "string" ||
    typeof request.text !== "string" ||
    !Array.isArray(request.tags) ||
    request.tags.some((tag) => typeof tag !== "string") ||
    typeof request.replace !== "boolean"
  ) {
    throw new Error("request stdin must use exact fields id, title, text, tags and replace");
  }
  return request;
}

async function readGetRequest(args) {
  if (hasOption(args, "id")) {
    throw new Error("--request-stdin cannot be combined with --id");
  }
  process.stdout.write(JSON.stringify({ schema: "aethmere.stdin-ready.v1", ready: true }) + "\n");
  let request;
  try {
    request = JSON.parse(await readStdinBounded());
  } catch {
    throw new Error("request stdin must contain one valid JSON object");
  }
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).join(",") !== "id" ||
    typeof request.id !== "string"
  ) {
    throw new Error("request stdin must use the exact field id");
  }
  return request;
}

async function doctor(root) {
  const checks = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: major >= 20, detail: process.version });
  const file = contextFile(root);
  try {
    const store = readStore(root);
    checks.push({ name: "local-context", ok: true, detail: store.items.length + " items at " + file });
  } catch (error) {
    checks.push({ name: "local-context", ok: false, detail: error.message });
  }
  try {
    const account = loadCloudAccount();
    checks.push({ name: "account", ok: Boolean(account), detail: account ? "device authorization present" : "run aethmere-agent login" });
  } catch (error) {
    checks.push({ name: "account", ok: false, detail: error.message });
  }
  try {
    const status = await checkGovernanceConnection({ clientKind: "agent_client", clientVersion: packageJson.version });
    checks.push({
      name: "governance",
      ok: true,
      detail: status.updateAvailable ? "connected; update available at " + UPDATE_URL : "connected; supported version",
    });
  } catch (error) {
    checks.push({ name: "governance", ok: false, detail: error.code || "GOVERNANCE_CONNECTION_REQUIRED" });
  }
  return {
    schema: "aethmere.agent-doctor.v2",
    version: packageJson.version,
    ok: checks.every((check) => check.ok),
    checks,
  };
}

function governed(stepCode, action, home) {
  return runGovernedCapability({
    home,
    clientKind: "agent_client",
    clientVersion: packageJson.version,
    stepCode,
  }, action);
}

const [command = "help", ...args] = process.argv.slice(2);
const asJson = flag(args, "json");

try {
  if (["help", "--help", "-h"].includes(command)) {
    help();
  } else if (["version", "--version", "-v"].includes(command)) {
    console.log("Aethmere Agent Client " + packageJson.version);
  } else if (command === "login") {
    const login = await loginWithDeviceCode(option(args, "code"));
    if (asJson) print({ schema: "aethmere.device-login.v1", ok: true, ...login }, true);
    else console.log("Aethmere account connected. Live governance will be verified before every formal capability.");
  } else if (command === "logout") {
    print(logoutCloudAccount(), asJson);
  } else if (command === "update-check") {
    const status = await checkGovernanceConnection({
      clientKind: "agent_client",
      clientVersion: packageJson.version,
    });
    print({
      schema: "aethmere.update-check.v1",
      ok: true,
      current: packageJson.version,
      minimum: status.minimumClientVersion,
      latest: status.latestClientVersion,
      update_available: status.updateAvailable,
      update_url: status.updateUrl,
    }, asJson);
  } else if (command === "init") {
    const report = await governed("CLIENT_START", () => initializeStore(rootFrom(args)));
    print({ schema: "aethmere.local-init.v1", ok: true, created: report.created, file: report.file }, asJson);
  } else if (command === "add") {
    const requestProtocol = flag(args, "request-stdin");
    if (requestProtocol && !asJson) throw new Error("--request-stdin requires --json");
    const report = await governed("LOCAL_CANDIDATE_READY", async () => {
      const request = requestProtocol
        ? await readAddRequest(args)
        : {
            id: option(args, "id"),
            title: option(args, "title"),
            text: await readText(args),
            tags: option(args, "tags").split(",").map((tag) => tag.trim()).filter(Boolean),
            replace: flag(args, "replace"),
          };
      return addItem(rootFrom(args), {
        id: request.id,
        title: request.title,
        text: request.text,
        tags: request.tags,
      }, { replace: request.replace });
    });
    const response = { schema: "aethmere.local-add.v1", ok: true, ...report };
    if (requestProtocol) console.log(JSON.stringify(response));
    else print(response, asJson);
  } else if (command === "list") {
    const items = await governed("MEMORY_RECALL", () => listItems(
      rootFrom(args),
      option(args, "query"),
      option(args, "limit"),
    ));
    print({ schema: "aethmere.context-list.v1", items }, asJson);
  } else if (command === "get") {
    const requestProtocol = flag(args, "request-stdin");
    if (requestProtocol && !asJson) throw new Error("--request-stdin requires --json");
    const item = await governed("MEMORY_GET", async () => {
      const id = requestProtocol ? (await readGetRequest(args)).id : option(args, "id");
      return getItem(rootFrom(args), id);
    });
    const response = { schema: "aethmere.context-item.v1", item };
    if (requestProtocol) console.log(JSON.stringify(response));
    else print(response, asJson);
  } else if (command === "remove") {
    if (!flag(args, "yes")) throw new Error("removal requires --yes");
    print({ schema: "aethmere.local-remove.v1", ok: true, ...removeItem(rootFrom(args), option(args, "id")) }, asJson);
  } else if (command === "doctor") {
    const report = await doctor(rootFrom(args));
    print(report, asJson);
    if (!report.ok) process.exitCode = 1;
  } else if (command === "connect") {
    const home = option(args, "home") || undefined;
    const report = await governed("GOVERNANCE_CONNECT", () => connectClients({
      root: rootFrom(args),
      bin: process.argv[1],
      client: option(args, "client") || "all",
      checkOnly: flag(args, "check"),
      home,
    }), home);
    print(report, asJson);
  } else if (command === "mcp") {
    runMcpServer(rootFrom(args));
  } else {
    throw new Error("unknown command: " + command);
  }
} catch (error) {
  if (asJson) console.log(JSON.stringify({ ok: false, code: error.code || "", error: error.message }, null, 2));
  else console.error("Aethmere Agent Client: " + error.message);
  process.exitCode = 1;
}
