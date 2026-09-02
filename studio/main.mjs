import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loginWithDeviceCode, logoutAccount, publicAccountStatus } from "./lib/account-client.mjs";
import { readBoundedText } from "./lib/bounded-response.mjs";
import { contextFile, getItem, listSummaries, removeItem, saveItem, selectedContext } from "./lib/context-store.mjs";
import { checkGovernanceConnection, runGovernedCapability, STUDIO_MINIMUM_VERSION, UPDATE_URL } from "./lib/governance-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
const OLLAMA_ORIGIN = "http://127.0.0.1:11434";
const MAX_OLLAMA_RESPONSE_BYTES = 20_000_000;
const PUBLIC_SYSTEM_MESSAGE = [
  "You are a local assistant inside Aethmere Agent Studio Public Preview.",
  "Answer the user's current request directly and clearly.",
  "Use only context explicitly supplied in this request; never claim to have read other project files.",
  "If required information is missing, say what is missing instead of inventing it.",
].join(" ");
const OFFICIAL_LINKS = Object.freeze({
  website: "https://aethmere.com/",
  release: "https://github.com/kzkz137806/aethmere/releases",
  downloads: UPDATE_URL,
});
const SUPPORT_CLIPBOARD = Object.freeze({
  "agent-install": "npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.12.0/aethmere-agent-client-0.12.0.tgz",
  "agent-connect": "aethmere-agent connect --client all",
});

let mainWindow;
let currentProject = "";
let capabilityTail = Promise.resolve();

function publicError(error) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

function modelError(message, reasonCode = "MODEL_UNAVAILABLE") {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  return error;
}

function governed(stepCode, action) {
  const run = () => runGovernedCapability({
    clientVersion: packageJson.version,
    stepCode,
  }, action);
  const result = capabilityTail.then(run, run);
  capabilityTail = result.then(() => undefined, () => undefined);
  return result;
}

function validProject(candidate) {
  if (!candidate) return "";
  try {
    const resolved = path.resolve(candidate);
    const stat = fs.lstatSync(resolved);
    return stat.isDirectory() && !stat.isSymbolicLink() ? resolved : "";
  } catch {
    return "";
  }
}

function projectSnapshot() {
  if (!currentProject) return { connected: false, project: "", name: "", context_file: "", items: [] };
  return {
    connected: true,
    project: currentProject,
    name: path.basename(currentProject),
    context_file: contextFile(currentProject),
    items: listSummaries(currentProject),
  };
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) throw new Error("对话记录格式无效");
  return value.slice(-20).map((message) => {
    const role = message?.role === "assistant" ? "assistant" : "user";
    const content = String(message?.content || "").trim();
    if (!content || content.length > 8_000) throw new Error("单条消息需要 1–8,000 个字符");
    return { role, content };
  });
}

function normalizeModel(value) {
  const model = String(value || "").trim();
  if (!model || model.length > 120 || !/^[A-Za-z0-9_.:/-]+$/u.test(model)) throw new Error("请选择有效的本机模型");
  return model;
}

async function ollamaJson(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 12_000);
  try {
    const response = await fetch(`${OLLAMA_ORIGIN}${pathname}`, {
      method: options.method || "GET",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: "error",
      signal: controller.signal,
    });
    const text = await readBoundedText(response, MAX_OLLAMA_RESPONSE_BYTES, "本机模型返回内容超过 20 MB 安全上限");
    if (!response.ok) throw modelError(`本机模型服务返回 ${response.status}`);
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* handled below */ }
    if (!body || typeof body !== "object") throw modelError("本机模型返回了无效结果");
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw modelError("本机模型响应超时", "TIMEOUT");
    if (!error?.reasonCode) error.reasonCode = "MODEL_UNAVAILABLE";
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function bindIpc() {
  ipcMain.handle("app:info", () => ({
    name: "Aethmere Agent Studio",
    version: packageJson.version,
    platform: process.platform,
    minimumVersion: STUDIO_MINIMUM_VERSION,
    privacy: "项目内容只发送到 127.0.0.1 的本机 Ollama；Studio 会向 app.aethmere.com 发送不含内容的封闭治理事件。",
  }));
  ipcMain.handle("account:status", () => publicAccountStatus());
  ipcMain.handle("account:login", async (_event, code) => {
    await capabilityTail;
    return loginWithDeviceCode(code);
  });
  ipcMain.handle("account:logout", async () => {
    await capabilityTail;
    currentProject = "";
    return logoutAccount();
  });
  ipcMain.handle("governance:check", () => checkGovernanceConnection({ clientVersion: packageJson.version }).then((status) => ({
    ok: true,
    minimumVersion: status.minimumVersion,
    latestVersion: status.latestVersion,
    updateAvailable: status.updateAvailable,
    updateUrl: status.updateUrl,
  })));
  ipcMain.handle("project:current", () => governed("MEMORY_RECALL", projectSnapshot));
  ipcMain.handle("project:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择项目文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    return governed("MEMORY_RECALL", () => {
      const selected = validProject(result.filePaths[0]);
      if (!selected) throw new Error("未能打开这个项目文件夹");
      currentProject = selected;
      return projectSnapshot();
    });
  });
  ipcMain.handle("context:list", () => governed("MEMORY_RECALL", projectSnapshot));
  ipcMain.handle("context:get", (_event, id) => governed("MEMORY_GET", () => {
    if (!currentProject) throw new Error("请先选择项目");
    return getItem(currentProject, id);
  }));
  ipcMain.handle("context:save", (_event, input) => governed("LOCAL_CANDIDATE_READY", () => {
    if (!currentProject) throw new Error("请先选择项目");
    saveItem(currentProject, input);
    return projectSnapshot();
  }));
  ipcMain.handle("context:remove", async (_event, id) => {
    if (!currentProject) throw new Error("请先选择项目");
    const normalized = String(id || "").trim().toUpperCase();
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["取消", "删除"],
      defaultId: 0,
      cancelId: 0,
      title: "删除本地上下文",
      message: `确定删除 ${normalized}？`,
      detail: "这会修改当前项目的 .aethmere/context.json，无法在 Studio 内撤销。",
      noLink: true,
    });
    if (choice.response !== 1) return null;
    return governed("LOCAL_CANDIDATE_READY", () => {
      removeItem(currentProject, normalized);
      return projectSnapshot();
    });
  });
  ipcMain.handle("models:list", () => governed("SEARCH", async () => {
      const result = await ollamaJson("/api/tags");
      const models = Array.isArray(result.models)
        ? result.models.map((model) => String(model?.name || "")).filter(Boolean).slice(0, 100)
        : [];
      return { ok: true, models };
  }));
  ipcMain.handle("chat:send", (_event, input) => governed("CHAT", async () => {
    const model = normalizeModel(input?.model);
    const messages = normalizeMessages(input?.messages);
    if (!messages.length || messages.at(-1).role !== "user") throw new Error("请输入消息");
    const contexts = currentProject ? selectedContext(currentProject, input?.contextIds) : [];
    const contextMessage = contexts.length
      ? `User-selected local project context:\n\n${contexts.map((item) => `[${item.id}] ${item.title}\n${item.text}`).join("\n\n")}`
      : "";
    const response = await ollamaJson("/api/chat", {
      method: "POST",
      timeout: 90_000,
      body: {
        model,
        stream: false,
        messages: [
          { role: "system", content: PUBLIC_SYSTEM_MESSAGE },
          ...(contextMessage ? [{ role: "system", content: contextMessage }] : []),
          ...messages,
        ],
        options: { temperature: 0.2 },
      },
    });
    const content = String(response?.message?.content || "").trim();
    if (!content) throw modelError("本机模型没有返回正文");
    return { ok: true, content, model, contextIds: contexts.map((item) => item.id) };
  }));
  ipcMain.handle("clipboard:copy", (_event, key) => {
    const value = SUPPORT_CLIPBOARD[String(key || "")];
    if (!value) throw new Error("不允许复制这个命令");
    clipboard.writeText(value);
    return { ok: true };
  });
  ipcMain.handle("external:open", async (_event, target) => {
    const url = OFFICIAL_LINKS[String(target || "")];
    if (!url) throw new Error("不允许打开这个链接");
    await shell.openExternal(url);
    return { ok: true };
  });
}

async function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    title: "Aethmere Agent Studio",
    width: 1320,
    height: 840,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#f3f0e8",
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  await mainWindow.loadFile(path.join(here, "renderer", "index.html"));
  mainWindow.show();
}

app.setName("Aethmere Agent Studio");
app.setAppLogsPath(path.join(app.getPath("userData"), "logs"));
app.setPath("crashDumps", path.join(app.getPath("userData"), "crash-dumps"));
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  bindIpc();
  await createWindow();
});
app.on("window-all-closed", () => app.quit());
process.on("uncaughtException", (error) => {
  dialog.showErrorBox("Aethmere Agent Studio", publicError(error));
  app.exit(1);
});
