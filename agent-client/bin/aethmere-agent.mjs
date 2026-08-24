#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { connectClients } from "../lib/connect.mjs";
import { runMcpServer } from "../lib/mcp-server.mjs";
import { addItem, contextFile, getItem, initializeStore, listItems, projectRoot, readStore, removeItem } from "../lib/store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));

function option(args, name) {
  const exact = `--${name}`;
  const index = args.findIndex((arg) => arg === exact || arg.startsWith(`${exact}=`));
  if (index < 0) return "";
  if (args[index].startsWith(`${exact}=`)) return args[index].slice(exact.length + 1);
  return args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : "";
}

function flag(args, name) {
  return args.includes(`--${name}`);
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
  console.log(`Aethmere Agent Client ${packageJson.version}`);
  console.log("");
  console.log("Usage:");
  console.log("  aethmere-agent init [--root .]");
  console.log("  aethmere-agent add --id ID --title TITLE (--text TEXT | --file FILE) [--tags a,b] [--replace]");
  console.log("  aethmere-agent list [--query TEXT]");
  console.log("  aethmere-agent get --id ID");
  console.log("  aethmere-agent remove --id ID --yes");
  console.log("  aethmere-agent connect [--client all|claude|codex] [--check]");
  console.log("  aethmere-agent doctor");
  console.log("  aethmere-agent mcp [--root .]");
  console.log("");
  console.log("All project context stays in .aethmere/context.json. This client makes no network requests.");
}

function readText(args) {
  const literal = option(args, "text");
  const file = option(args, "file");
  if (literal && file) throw new Error("use either --text or --file, not both");
  if (file) return fs.readFileSync(path.resolve(file), "utf8");
  return literal;
}

function doctor(root) {
  const checks = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: major >= 20, detail: process.version });
  const file = contextFile(root);
  try {
    const store = readStore(root);
    checks.push({ name: "local-context", ok: true, detail: `${store.items.length} items at ${file}` });
  } catch (error) {
    checks.push({ name: "local-context", ok: false, detail: error.message });
  }
  checks.push({ name: "network", ok: true, detail: "disabled; no network implementation is bundled" });
  return { schema: "aethmere.local-doctor.v1", version: packageJson.version, ok: checks.every((check) => check.ok), checks };
}

const [command = "help", ...args] = process.argv.slice(2);
const asJson = flag(args, "json");

try {
  if (["help", "--help", "-h"].includes(command)) {
    help();
  } else if (["version", "--version", "-v"].includes(command)) {
    console.log(`Aethmere Agent Client ${packageJson.version}`);
  } else if (command === "init") {
    const report = initializeStore(rootFrom(args));
    print({ schema: "aethmere.local-init.v1", ok: true, created: report.created, file: report.file }, asJson);
  } else if (command === "add") {
    const report = addItem(rootFrom(args), {
      id: option(args, "id"),
      title: option(args, "title"),
      text: readText(args),
      tags: option(args, "tags").split(",").map((tag) => tag.trim()).filter(Boolean),
    }, { replace: flag(args, "replace") });
    print({ schema: "aethmere.local-add.v1", ok: true, ...report }, asJson);
  } else if (command === "list") {
    print({ schema: "aethmere.context-list.v1", items: listItems(rootFrom(args), option(args, "query"), option(args, "limit")) }, asJson);
  } else if (command === "get") {
    print({ schema: "aethmere.context-item.v1", item: getItem(rootFrom(args), option(args, "id")) }, asJson);
  } else if (command === "remove") {
    if (!flag(args, "yes")) throw new Error("removal requires --yes");
    print({ schema: "aethmere.local-remove.v1", ok: true, ...removeItem(rootFrom(args), option(args, "id")) }, asJson);
  } else if (command === "doctor") {
    const report = doctor(rootFrom(args));
    print(report, asJson);
    if (!report.ok) process.exitCode = 1;
  } else if (command === "connect") {
    print(connectClients({ root: rootFrom(args), bin: process.argv[1], client: option(args, "client") || "all", checkOnly: flag(args, "check"), home: option(args, "home") }), asJson);
  } else if (command === "mcp") {
    runMcpServer(rootFrom(args));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  else console.error(`Aethmere Agent Client: ${error.message}`);
  process.exitCode = 1;
}
