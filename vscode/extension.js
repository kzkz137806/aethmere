"use strict";

const vscode = require("vscode");
const {
  AgentRunner,
  MINIMUM_AGENT_VERSION,
  UPDATE_URL,
  parseAgentJson,
} = require("./lib/agent-runner.js");
const {
  createVscodeGovernance,
  GovernanceCancelledError,
  isGovernanceCancellation,
} = require("./lib/governance-client.js");

const ITEM_ID = /^[A-Z][A-Z0-9_-]{0,63}$/u;
const FORMAL_COMMAND_IDS = Object.freeze([
  "aethmere.initialize",
  "aethmere.saveSelection",
  "aethmere.openContext",
  "aethmere.refresh",
  "aethmere.connectClients",
]);
const SUPPORT_COMMAND_IDS = Object.freeze([
  "aethmere.checkSetup",
  "aethmere.openDownloads",
]);

function workspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a folder before using Aethmere.");
  return folder.uri.fsPath;
}

function validateSummary(item, index = 0) {
  const id = String(item?.id || "").trim().toUpperCase();
  const title = String(item?.title || "").trim();
  const tags = Array.isArray(item?.tags) ? item.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 12) : [];
  if (!ITEM_ID.test(id) || !title || title.length > 160 || tags.some((tag) => tag.length > 40)) {
    throw new Error(`Aethmere Agent returned an invalid context summary at index ${index}.`);
  }
  return { id, title, tags, updated_at: String(item?.updated_at || "") };
}

function validateItem(item) {
  const summary = validateSummary(item);
  const text = String(item?.text || "");
  if (!text || text.length > 20_000) throw new Error("Aethmere Agent returned invalid context text.");
  return { ...summary, text };
}

async function formalJson(runner, root, args, schema, options = {}) {
  const result = await runner.formal([...args, "--json"], {
    cwd: root,
    stdinText: options.stdinText || "",
  });
  return parseAgentJson(result.stdout, schema);
}

async function formalReadyJson(runner, root, args, schema, requestFactory) {
  const result = await runner.formalReady([...args, "--json"], { cwd: root, requestFactory });
  return parseAgentJson(result.stdout, schema);
}

async function listContext(runner, root) {
  const payload = await formalJson(runner, root, ["list"], "aethmere.context-list.v1");
  if (!Array.isArray(payload.items) || payload.items.length > 100) throw new Error("Aethmere Agent returned an invalid context list.");
  return payload.items.map(validateSummary);
}

class ContextProvider {
  constructor(runner, governance) {
    this.runner = runner;
    this.governance = governance;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.items = [];
    this.loaded = false;
    this.error = null;
    this.loading = null;
  }

  async load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        this.items = await this.governance.run("MEMORY_RECALL", () => listContext(this.runner, workspaceRoot()));
        this.loaded = true;
        this.error = null;
        return this.items;
      } catch (error) {
        this.items = [];
        this.loaded = true;
        this.error = error;
        throw error;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  async reload() {
    this.loaded = false;
    try { await this.load(); }
    finally { this.emitter.fire(undefined); }
  }

  upsert(item) {
    const summary = validateSummary(item);
    const index = this.items.findIndex((candidate) => candidate.id === summary.id);
    if (index >= 0) this.items[index] = summary;
    else this.items.push(summary);
    this.items.sort((left, right) => left.id.localeCompare(right.id));
    this.loaded = true;
    this.error = null;
    this.emitter.fire(undefined);
  }

  replace(items) {
    this.items = items.map(validateSummary).sort((left, right) => left.id.localeCompare(right.id));
    this.loaded = true;
    this.error = null;
    this.emitter.fire(undefined);
  }

  getTreeItem(item) {
    return item;
  }

  async getChildren(element) {
    if (element) return [];
    if (!this.loaded) {
      try { await this.load(); } catch { /* represented as a warning row */ }
    }
    if (this.error) {
      const warning = new vscode.TreeItem("Governed context is unavailable");
      warning.description = String(this.error.message || "Agent connection failed").slice(0, 160);
      warning.iconPath = new vscode.ThemeIcon("warning");
      return [warning];
    }
    if (!this.items.length) {
      const empty = new vscode.TreeItem("No saved context yet");
      empty.description = "Save an editor selection";
      empty.iconPath = new vscode.ThemeIcon("info");
      return [empty];
    }
    return this.items.map((entry) => {
      const item = new vscode.TreeItem(entry.title);
      item.description = entry.id;
      item.tooltip = entry.tags.length ? `${entry.id} · ${entry.tags.join(", ")}` : entry.id;
      item.iconPath = new vscode.ThemeIcon("bookmark");
      item.command = { command: "aethmere.openContext", title: "Show Governed Context", arguments: [entry.id] };
      return item;
    });
  }
}

async function initialize(provider, runner) {
  const root = workspaceRoot();
  await formalJson(runner, root, ["init"], "aethmere.local-init.v1");
  provider.replace(await listContext(runner, root));
  void vscode.window.showInformationMessage("Aethmere governed context is initialized for this workspace.");
}

async function saveSelection(provider, runner) {
  const idInput = await vscode.window.showInputBox({
    prompt: "Context ID (A-Z, 0-9, _ or -)",
    placeHolder: "PROJECT_GOAL",
    validateInput: (value) => ITEM_ID.test(value.trim().toUpperCase()) ? undefined : "Use A-Z, 0-9, _ or -; start with A-Z.",
  });
  if (!idInput) throw new GovernanceCancelledError();
  const id = idInput.trim().toUpperCase();
  const title = await vscode.window.showInputBox({
    prompt: "Short title",
    value: id,
    validateInput: (value) => value.trim() && value.trim().length <= 160 ? undefined : "Use 1-160 characters.",
  });
  if (!title) throw new GovernanceCancelledError();

  const root = workspaceRoot();
  const existing = (await listContext(runner, root)).some((item) => item.id === id);
  if (existing) {
    const answer = await vscode.window.showWarningMessage(`Replace existing context ${id}?`, { modal: true }, "Replace");
    if (answer !== "Replace") throw new GovernanceCancelledError();
  }
  const payload = await formalReadyJson(runner, root, ["add", "--request-stdin"], "aethmere.local-add.v1", () => {
    const editor = vscode.window.activeTextEditor;
    const text = editor?.document.getText(editor.selection).trim() || "";
    if (!text) throw new Error("Select the exact text you want to save before the Agent requests it.");
    if (text.length > 20_000) throw new Error("A context item can contain at most 20,000 characters.");
    return JSON.stringify({ id, title: title.trim(), text, tags: [], replace: existing });
  });
  const item = validateItem(payload.item);
  provider.upsert(item);
  void vscode.window.showInformationMessage(`Saved ${id} through Aethmere Agent ${MINIMUM_AGENT_VERSION}+ governance.`);
}

async function openContext(runner, idValue) {
  const root = workspaceRoot();
  let snapshot;
  if (idValue) {
    const id = String(idValue).trim().toUpperCase();
    if (!ITEM_ID.test(id)) throw new Error("A valid context ID is required.");
    const payload = await formalReadyJson(
      runner,
      root,
      ["get", "--request-stdin"],
      "aethmere.context-item.v1",
      () => JSON.stringify({ id }),
    );
    snapshot = { schema: payload.schema, item: validateItem(payload.item) };
  } else {
    snapshot = { schema: "aethmere.context-list.v1", items: await listContext(runner, root) };
  }
  const document = await vscode.workspace.openTextDocument({ language: "json", content: `${JSON.stringify(snapshot, null, 2)}\n` });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function connectClients(runner) {
  const root = workspaceRoot();
  await formalJson(runner, root, ["connect", "--client", "all"], "aethmere.local-connect.v1");
  void vscode.window.showInformationMessage("Aethmere clients are connected through live governance.");
}

async function checkSetup(runner) {
  try {
    const version = await runner.version();
    void vscode.window.showInformationMessage(`Aethmere Agent ${version} is installed and meets the ${MINIMUM_AGENT_VERSION} minimum.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Aethmere Agent check failed: ${error.message}`);
  }
}

async function openDownloads() {
  await vscode.env.openExternal(vscode.Uri.parse(UPDATE_URL));
}

function command(id, handler) {
  return vscode.commands.registerCommand(id, async (...args) => {
    try { await handler(...args); }
    catch (error) {
      if (isGovernanceCancellation(error)) return;
      void vscode.window.showErrorMessage(`Aethmere: ${error.message}`);
    }
  });
}

function activate(context) {
  const governance = createVscodeGovernance(context.extensionPath);
  const runner = new AgentRunner();
  const provider = new ContextProvider(runner, governance);
  const handlers = {
    "aethmere.initialize": () => governance.run("LOCAL_CANDIDATE_READY", () => initialize(provider, runner)),
    "aethmere.saveSelection": () => governance.run("LOCAL_CANDIDATE_READY", () => saveSelection(provider, runner)),
    "aethmere.openContext": (id) => governance.run("MEMORY_GET", () => openContext(runner, id)),
    "aethmere.refresh": () => provider.reload(),
    "aethmere.connectClients": () => governance.run("GOVERNANCE_CONNECT", () => connectClients(runner)),
    "aethmere.checkSetup": () => checkSetup(runner),
    "aethmere.openDownloads": openDownloads,
  };
  context.subscriptions.push(vscode.window.registerTreeDataProvider("aethmere.contextView", provider));
  for (const id of [...FORMAL_COMMAND_IDS, ...SUPPORT_COMMAND_IDS]) context.subscriptions.push(command(id, handlers[id]));
}

function deactivate() {}

module.exports = { activate, deactivate };
