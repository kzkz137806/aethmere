import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contextFile, projectRoot } from "./store.mjs";

function quoted(value) {
  return JSON.stringify(String(value));
}

function serverEntry(bin, root) {
  return { command: process.execPath, args: [bin, "mcp", "--root", root] };
}

function connectClaude(root, bin, checkOnly) {
  const file = path.join(root, ".mcp.json");
  let value = { mcpServers: {} };
  let state = "created";
  if (fs.existsSync(file)) {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(".mcp.json must contain a JSON object");
    if (value.mcpServers?.aethmere) return { client: "claude", state: "already", file };
    state = "updated";
  }
  if (checkOnly) return { client: "claude", state: `would-${state}`, file };
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-aethmere-connect`);
  value.mcpServers = value.mcpServers && typeof value.mcpServers === "object" ? value.mcpServers : {};
  value.mcpServers.aethmere = serverEntry(bin, root);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { client: "claude", state, file, backup: state === "updated" ? `${file}.bak-aethmere-connect` : null };
}

function connectCodex(root, bin, checkOnly, home) {
  const directory = path.join(home, ".codex");
  const file = path.join(directory, "config.toml");
  if (!fs.existsSync(directory)) return { client: "codex", state: "not-installed", file };
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (/^\[mcp_servers\.aethmere\]$/mu.test(current)) return { client: "codex", state: "already", file };
  if (checkOnly) return { client: "codex", state: "would-update", file };
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-aethmere-connect`);
  const block = [
    "",
    "[mcp_servers.aethmere]",
    `command = ${quoted(process.execPath)}`,
    `args = [${quoted(bin)}, \"mcp\", \"--root\", ${quoted(root)}]`,
    "",
  ].join("\n");
  fs.writeFileSync(file, `${current}${block}`, "utf8");
  return { client: "codex", state: current ? "updated" : "created", file, backup: current ? `${file}.bak-aethmere-connect` : null };
}

export function connectClients(options = {}) {
  const root = projectRoot(options.root || ".");
  const bin = path.resolve(String(options.bin || process.argv[1]));
  const client = String(options.client || "all").toLowerCase();
  const checkOnly = Boolean(options.checkOnly);
  const home = path.resolve(String(options.home || os.homedir()));
  if (!fs.existsSync(contextFile(root))) throw new Error("run `aethmere-agent init` in this project before connecting a client");
  if (!new Set(["all", "claude", "codex"]).has(client)) throw new Error("--client must be all, claude, or codex");
  const results = [];
  if (client === "all" || client === "claude") results.push(connectClaude(root, bin, checkOnly));
  if (client === "all" || client === "codex") results.push(connectCodex(root, bin, checkOnly, home));
  return { schema: "aethmere.local-connect.v1", root, check_only: checkOnly, results };
}
