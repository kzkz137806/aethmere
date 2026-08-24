const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aethmere", Object.freeze({
  info: () => ipcRenderer.invoke("app:info"),
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  currentProject: () => ipcRenderer.invoke("project:current"),
  listContext: () => ipcRenderer.invoke("context:list"),
  saveContext: (input) => ipcRenderer.invoke("context:save", input),
  removeContext: (id) => ipcRenderer.invoke("context:remove", id),
  listModels: () => ipcRenderer.invoke("models:list"),
  chat: (input) => ipcRenderer.invoke("chat:send", input),
  copy: (text) => ipcRenderer.invoke("clipboard:copy", text),
  openOfficial: (target) => ipcRenderer.invoke("external:open", target),
}));
