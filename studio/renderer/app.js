const state = {
  project: null,
  selected: new Set(),
  messages: [],
  editingId: "",
  busy: false,
};

const elements = {
  chooseProject: document.querySelector("#choose-project"),
  projectName: document.querySelector("#project-name"),
  projectPath: document.querySelector("#project-path"),
  contextList: document.querySelector("#context-list"),
  newContext: document.querySelector("#new-context"),
  selectedContext: document.querySelector("#selected-context"),
  modelSelect: document.querySelector("#model-select"),
  refreshModels: document.querySelector("#refresh-models"),
  conversation: document.querySelector("#conversation"),
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#send"),
  notice: document.querySelector("#notice"),
  dialog: document.querySelector("#context-dialog"),
  form: document.querySelector("#context-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  contextId: document.querySelector("#context-id"),
  contextTitle: document.querySelector("#context-title"),
  contextText: document.querySelector("#context-text"),
  contextTags: document.querySelector("#context-tags"),
  deleteContext: document.querySelector("#delete-context"),
  copyInstall: document.querySelector("#copy-install"),
  openRelease: document.querySelector("#open-release"),
};

function text(value) {
  return String(value ?? "");
}

function showNotice(message, type = "") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${type}`.trim();
  elements.notice.hidden = !message;
  if (message) window.setTimeout(() => { elements.notice.hidden = true; }, 5_000);
}

function userError(error) {
  return text(error?.message || error || "操作失败").replace(/^Error invoking remote method '[^']+':\s*/u, "");
}

function currentItems() {
  return Array.isArray(state.project?.items) ? state.project.items : [];
}

function renderProject() {
  const connected = Boolean(state.project?.connected);
  elements.projectName.textContent = connected ? state.project.name : "选择项目文件夹";
  elements.projectPath.textContent = connected ? state.project.project : "只读取你明确保存的本地上下文";
  elements.newContext.disabled = !connected;
  const items = currentItems();
  for (const id of [...state.selected]) if (!items.some((item) => item.id === id)) state.selected.delete(id);
  if (!connected) {
    elements.contextList.innerHTML = '<div class="empty-context">选择项目后，在这里保存模型需要记住的信息。</div>';
  } else if (!items.length) {
    elements.contextList.innerHTML = '<div class="empty-context">这个项目还没有上下文。点右上角“＋”保存第一条。</div>';
  } else {
    elements.contextList.replaceChildren(...items.map((item) => {
      const row = document.createElement("label");
      row.className = "context-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.selected.has(item.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selected.add(item.id); else state.selected.delete(item.id);
        renderSelected();
      });
      const copy = document.createElement("span");
      copy.className = "context-copy";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const meta = document.createElement("small");
      meta.textContent = [item.id, ...(item.tags || [])].join(" · ");
      copy.append(title, meta);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "edit-context";
      edit.textContent = "编辑";
      edit.addEventListener("click", (event) => { event.preventDefault(); openEditor(item); });
      row.append(checkbox, copy, edit);
      return row;
    }));
  }
  renderSelected();
}

function renderSelected() {
  const selected = currentItems().filter((item) => state.selected.has(item.id));
  elements.selectedContext.replaceChildren();
  if (!selected.length) {
    const empty = document.createElement("span");
    empty.textContent = "未选择上下文";
    elements.selectedContext.append(empty);
    return;
  }
  for (const item of selected) {
    const chip = document.createElement("span");
    chip.textContent = `${item.id} · ${item.title}`;
    elements.selectedContext.append(chip);
  }
}

function renderMessages() {
  if (!state.messages.length) return;
  elements.conversation.replaceChildren(...state.messages.map((message) => {
    const article = document.createElement("article");
    article.className = `message ${message.role}`;
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = message.role === "assistant" ? "A" : "你";
    const body = document.createElement("div");
    body.className = "message-body";
    const paragraph = document.createElement("p");
    paragraph.textContent = message.content;
    body.append(paragraph);
    if (message.meta) {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      meta.textContent = message.meta;
      body.append(meta);
    }
    article.append(avatar, body);
    return article;
  }));
  elements.conversation.scrollTop = elements.conversation.scrollHeight;
}

function openEditor(item = null) {
  if (!state.project?.connected) return showNotice("请先选择项目", "error");
  state.editingId = item?.id || "";
  elements.dialogTitle.textContent = item ? "编辑上下文" : "新建上下文";
  elements.contextId.value = item?.id || "";
  elements.contextId.readOnly = Boolean(item);
  elements.contextTitle.value = item?.title || "";
  elements.contextText.value = item?.text || "";
  elements.contextTags.value = (item?.tags || []).join(", ");
  elements.deleteContext.hidden = !item;
  elements.dialog.showModal();
  (item ? elements.contextTitle : elements.contextId).focus();
}

function closeEditor() {
  state.editingId = "";
  elements.dialog.close();
  elements.form.reset();
}

async function refreshModels() {
  elements.refreshModels.disabled = true;
  const previous = elements.modelSelect.value;
  try {
    const result = await window.aethmere.listModels();
    elements.modelSelect.replaceChildren();
    if (!result.ok || !result.models.length) {
      const option = new Option("未检测到 Ollama 模型", "");
      elements.modelSelect.add(option);
      showNotice("没有检测到本机 Ollama 模型；上下文管理仍可正常使用。", "error");
      return;
    }
    for (const model of result.models) elements.modelSelect.add(new Option(model, model));
    if (result.models.includes(previous)) elements.modelSelect.value = previous;
  } finally {
    elements.refreshModels.disabled = false;
  }
}

async function sendMessage() {
  const content = elements.prompt.value.trim();
  const model = elements.modelSelect.value;
  if (!content || state.busy) return;
  if (!model) return showNotice("请先在本机安装 Ollama 模型并刷新列表", "error");
  state.busy = true;
  elements.send.disabled = true;
  elements.prompt.disabled = true;
  state.messages.push({ role: "user", content });
  elements.prompt.value = "";
  resizePrompt();
  renderMessages();
  try {
    const result = await window.aethmere.chat({
      model,
      contextIds: [...state.selected],
      messages: state.messages.map(({ role, content: value }) => ({ role, content: value })),
    });
    state.messages.push({
      role: "assistant",
      content: result.content,
      meta: result.contextIds.length ? `本机模型 · 使用 ${result.contextIds.length} 条已选上下文` : "本机模型 · 未使用项目上下文",
    });
  } catch (error) {
    state.messages.push({ role: "assistant", content: `未能完成本机调用：${userError(error)}`, meta: "没有向外网发送项目资料" });
  } finally {
    state.busy = false;
    elements.send.disabled = false;
    elements.prompt.disabled = false;
    elements.prompt.focus();
    renderMessages();
  }
}

function resizePrompt() {
  elements.prompt.style.height = "0px";
  elements.prompt.style.height = `${Math.min(Math.max(elements.prompt.scrollHeight, 38), 150)}px`;
}

elements.chooseProject.addEventListener("click", async () => {
  try { state.project = await window.aethmere.chooseProject(); renderProject(); }
  catch (error) { showNotice(userError(error), "error"); }
});
elements.newContext.addEventListener("click", () => openEditor());
document.querySelector("#close-dialog").addEventListener("click", closeEditor);
document.querySelector("#cancel-dialog").addEventListener("click", closeEditor);
elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state.project = await window.aethmere.saveContext({
      id: elements.contextId.value,
      title: elements.contextTitle.value,
      text: elements.contextText.value,
      tags: elements.contextTags.value,
    });
    closeEditor();
    renderProject();
    showNotice("上下文已保存到当前项目", "success");
  } catch (error) { showNotice(userError(error), "error"); }
});
elements.deleteContext.addEventListener("click", async () => {
  try {
    state.project = await window.aethmere.removeContext(state.editingId);
    closeEditor();
    renderProject();
  } catch (error) { showNotice(userError(error), "error"); }
});
elements.refreshModels.addEventListener("click", refreshModels);
elements.send.addEventListener("click", sendMessage);
elements.prompt.addEventListener("input", resizePrompt);
elements.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
});
elements.copyInstall.addEventListener("click", async () => {
  await window.aethmere.copy("npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-agent-0.10.0.tgz");
  showNotice("Agent Client 安装命令已复制", "success");
});
elements.openRelease.addEventListener("click", () => window.aethmere.openOfficial("release"));

try {
  state.project = await window.aethmere.currentProject();
  renderProject();
  await refreshModels();
} catch (error) {
  showNotice(userError(error), "error");
}
