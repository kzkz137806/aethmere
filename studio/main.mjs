import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contextFile, readStore, removeItem, saveItem, selectedContext } from "./lib/context-store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
const OLLAMA_ORIGIN = "http://127.0.0.1:11434";
const PUBLIC_SYSTEM_MESSAGE = [
  "You are a local assistant inside Aethmere Agent Studio Public Preview.",
  "Answer the user's current request directly and clearly.",
  "Use only context explicitly supplied in this request; never claim to have read other project files.",
  "If required information is missing, say what is missing instead of inventing it.",
].join(" ");
const OFFICIAL_LINKS = Object.freeze({
  website: "https://aethmere.com/",
  release: "https://github.com/kzkz137806/aethmere/releases",
});

let mainWindow;
let currentProject = "";

function publicError(error) {
  return error instanceof Error ? error.message : String(error || "未知错误");
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
  const store = readStore(currentProject);
  return {
    connected: true,
    project: currentProject,
    name: path.basename(currentProject),
    context_file: contextFile(currentProject),
    items: store.items,
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
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`本机模型服务返回 ${response.status}`);
    const body = await response.json();
    if (!body || typeof body !== "object") throw new Error("本机模型返回了无效结果");
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("本机模型响应超时");
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
    privacy: "本地项目上下文只发送到 127.0.0.1 的本机 Ollama；无遥测、无自动外网请求。",
  }));
  ipcMain.handle("project:current", () => projectSnapshot());
  ipcMain.handle("project:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择项目文件夹",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length !== 1) return projectSnapshot();
    currentProject = validProject(result.filePaths[0]);
    if (!currentProject) throw new Error("未能打开这个项目文件夹");
    return projectSnapshot();
  });
  ipcMain.handle("context:list", () => projectSnapshot());
  ipcMain.handle("context:save", (_event, input) => {
    if (!currentProject) throw new Error("请先选择项目");
    saveItem(currentProject, input);
    return projectSnapshot();
  });
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
    if (choice.response !== 1) return projectSnapshot();
    removeItem(currentProject, normalized);
    return projectSnapshot();
  });
  ipcMain.handle("models:list", async () => {
    try {
      const result = await ollamaJson("/api/tags");
      const models = Array.isArray(result.models)
        ? result.models.map((model) => String(model?.name || "")).filter(Boolean).slice(0, 100)
        : [];
      return { ok: true, models };
    } catch (error) {
      return { ok: false, models: [], error: publicError(error) };
    }
  });
  ipcMain.handle("chat:send", async (_event, input) => {
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
    if (!content) throw new Error("本机模型没有返回正文");
    return { ok: true, content, model, contextIds: contexts.map((item) => item.id) };
  });
  ipcMain.handle("clipboard:copy", (_event, text) => {
    const value = String(text || "");
    if (!value || value.length > 4_000) throw new Error("可复制内容无效");
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
  bindIpc();
  await createWindow();
});
app.on("window-all-closed", () => app.quit());
process.on("uncaughtException", (error) => {
  dialog.showErrorBox("Aethmere Agent Studio", publicError(error));
});
