const vscode = require("vscode");
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const STORE_SCHEMA = "aethmere.local-context.v1";
const ITEM_ID = /^[A-Z][A-Z0-9_-]{0,63}$/u;

function workspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a folder before using Aethmere.");
  return folder.uri.fsPath;
}

function storeFile() {
  return path.join(workspaceRoot(), ".aethmere", "context.json");
}

function assertSafeStore(file) {
  const directory = path.dirname(file);
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(".aethmere must be a real folder inside this workspace.");
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error("context.json must not be a symbolic link.");
}

function emptyStore() {
  return { schema: STORE_SCHEMA, items: [] };
}

function readStore() {
  const file = storeFile();
  assertSafeStore(file);
  if (!fs.existsSync(file)) return emptyStore();
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value?.schema !== STORE_SCHEMA || !Array.isArray(value.items)) throw new Error(`context.json must use schema ${STORE_SCHEMA}.`);
  return value;
}

function writeStore(value) {
  const file = storeFile();
  assertSafeStore(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertSafeStore(file);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  return file;
}

class ContextProvider {
  constructor() {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  refresh() {
    this.emitter.fire(undefined);
  }

  getTreeItem(item) {
    return item;
  }

  getChildren() {
    let items;
    try {
      items = readStore().items;
    } catch (error) {
      const item = new vscode.TreeItem("Context file needs attention");
      item.description = error.message;
      item.iconPath = new vscode.ThemeIcon("warning");
      return [item];
    }
    if (!items.length) {
      const item = new vscode.TreeItem("No saved context yet");
      item.description = "Save an editor selection";
      item.iconPath = new vscode.ThemeIcon("info");
      return [item];
    }
    return items.map((entry) => {
      const item = new vscode.TreeItem(entry.title || entry.id);
      item.description = entry.id;
      item.tooltip = Array.isArray(entry.tags) && entry.tags.length ? `${entry.id} · ${entry.tags.join(", ")}` : entry.id;
      item.iconPath = new vscode.ThemeIcon("bookmark");
      item.command = { command: "aethmere.openContext", title: "Open Local Context File" };
      return item;
    });
  }
}

async function initialize(provider) {
  const file = storeFile();
  assertSafeStore(file);
  if (!fs.existsSync(file)) writeStore(emptyStore());
  provider.refresh();
  void vscode.window.showInformationMessage(`Aethmere local context is ready: ${vscode.workspace.asRelativePath(file)}`);
}

async function saveSelection(provider) {
  const editor = vscode.window.activeTextEditor;
  const text = editor?.document.getText(editor.selection).trim() || "";
  if (!text) {
    void vscode.window.showWarningMessage("Select the exact text you want to save first.");
    return;
  }
  if (text.length > 20_000) {
    void vscode.window.showWarningMessage("A context item can contain at most 20,000 characters.");
    return;
  }
  const idInput = await vscode.window.showInputBox({ prompt: "Context ID (A-Z, 0-9, _ or -)", placeHolder: "PROJECT_GOAL", validateInput: (value) => ITEM_ID.test(value.trim().toUpperCase()) ? undefined : "Use A-Z, 0-9, _ or -; start with A-Z." });
  if (!idInput) return;
  const id = idInput.trim().toUpperCase();
  const title = await vscode.window.showInputBox({ prompt: "Short title", value: editor.document.fileName ? path.basename(editor.document.fileName) : id, validateInput: (value) => value.trim() && value.trim().length <= 160 ? undefined : "Use 1-160 characters." });
  if (!title) return;
  const store = readStore();
  const index = store.items.findIndex((item) => item.id === id);
  if (index >= 0) {
    const answer = await vscode.window.showWarningMessage(`Replace existing context ${id}?`, { modal: true }, "Replace");
    if (answer !== "Replace") return;
  }
  const entry = { id, title: title.trim(), text, tags: [], updated_at: new Date().toISOString() };
  if (index >= 0) store.items[index] = entry;
  else store.items.push(entry);
  store.items.sort((a, b) => a.id.localeCompare(b.id));
  writeStore(store);
  provider.refresh();
  void vscode.window.showInformationMessage(`Saved ${id} locally.`);
}

async function openContext() {
  const file = storeFile();
  if (!fs.existsSync(file)) throw new Error("Initialize Aethmere local context first.");
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
}

async function copyConnectCommand() {
  const root = workspaceRoot();
  const escaped = root.replaceAll('"', '\\"');
  const command = `aethmere-agent connect --client all --root "${escaped}"`;
  await vscode.env.clipboard.writeText(command);
  void vscode.window.showInformationMessage("Aethmere connection command copied. Run it in a terminal, then restart your AI client.");
}

function runVersionCheck() {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "aethmere-agent";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "aethmere-agent --version"] : ["--version"];
    cp.execFile(executable, args, { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout).trim());
    });
  });
}

async function checkSetup() {
  try {
    const version = await runVersionCheck();
    void vscode.window.showInformationMessage(`${version} is installed. Run the copied connection command to attach this workspace.`);
  } catch {
    void vscode.window.showErrorMessage("Aethmere Agent Client was not found. Download and install aethmere-agent first.");
  }
}

function command(id, handler) {
  return vscode.commands.registerCommand(id, async () => {
    try {
      await handler();
    } catch (error) {
      void vscode.window.showErrorMessage(`Aethmere: ${error.message}`);
    }
  });
}

function activate(context) {
  const provider = new ContextProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("aethmere.contextView", provider),
    command("aethmere.initialize", () => initialize(provider)),
    command("aethmere.saveSelection", () => saveSelection(provider)),
    command("aethmere.openContext", openContext),
    command("aethmere.copyConnectCommand", copyConnectCommand),
    command("aethmere.checkSetup", checkSetup),
    command("aethmere.refresh", () => provider.refresh()),
  );
  if (vscode.workspace.workspaceFolders?.length) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/.aethmere/context.json");
    watcher.onDidCreate(() => provider.refresh());
    watcher.onDidChange(() => provider.refresh());
    watcher.onDidDelete(() => provider.refresh());
    context.subscriptions.push(watcher);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
