const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aethmere", Object.freeze({
  info: () => ipcRenderer.invoke("app:info"),
  accountStatus: () => ipcRenderer.invoke("account:status"),
  login: (code) => ipcRenderer.invoke("account:login", code),
  logout: () => ipcRenderer.invoke("account:logout"),
  governanceStatus: () => ipcRenderer.invoke("governance:check"),
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  currentProject: () => ipcRenderer.invoke("project:current"),
  listContext: () => ipcRenderer.invoke("context:list"),
  getContext: (id) => ipcRenderer.invoke("context:get", id),
  saveContext: (input) => ipcRenderer.invoke("context:save", input),
  removeContext: (id) => ipcRenderer.invoke("context:remove", id),
  listModels: () => ipcRenderer.invoke("models:list"),
  chat: (input) => ipcRenderer.invoke("chat:send", input),
  copySupport: (key) => ipcRenderer.invoke("clipboard:copy", key),
  openOfficial: (target) => ipcRenderer.invoke("external:open", target),
}));
