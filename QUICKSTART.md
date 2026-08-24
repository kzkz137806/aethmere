# Quick start

## Windows：先用桌面端

从 [v0.10.1 Release](https://github.com/kzkz137806/aethmere/releases/tag/v0.10.1) 下载：

- `aethmere-agent-studio-0.10.1-win32-x64.zip`
- `aethmere-agent-studio-0.10.1-win32-x64.zip.sha256.txt`

校验后完整解压 ZIP，双击 `Aethmere Agent Studio.exe`。这是未签名的便携预览版，Windows 可能显示“未知发布者”；不要把 EXE 单独移出解压目录。

Studio 可以选择项目、创建和勾选本地上下文。若本机已启动 Ollama，Studio 还可以把你明确勾选的上下文发送给 `127.0.0.1:11434` 上的本机模型；它不会自动读取其他项目文件，也没有遥测。

## 开发工具：安装 Agent Client

需要 Node.js 20 或更高版本。

### 1. 安装

```bash
npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-agent-0.10.0.tgz
aethmere-agent --version
```

### 2. 在项目中保存第一条上下文

```bash
cd your-project
aethmere-agent init
aethmere-agent add --id PROJECT_GOAL --title "项目目标" --text "在这里写入你希望 AI 长期接得上的背景"
aethmere-agent list
```

上下文保存在当前项目的 `.aethmere/context.json`。公开客户端没有网络请求或遥测；运行 `aethmere-agent doctor` 可以检查本地状态。

### 3. 接入 Codex 或 Claude Code

```bash
aethmere-agent connect --client all
```

该命令会为现有配置保留备份，并写入名为 `aethmere` 的本地 MCP server。重启 AI 客户端后即可使用：

- `aethmere_context_list`：列出本地上下文 ID 和标题；
- `aethmere_context_get`：按精确 ID 读取一条上下文；
- `aethmere_evidence_check`：检查引用的上下文 ID 是否存在；
- `aethmere_status`：查看本地连接状态。

只想预览配置变化时运行：

```bash
aethmere-agent connect --client all --check
```

## VS Code 插件

从 [v0.10.0 Release](https://github.com/kzkz137806/aethmere/releases/tag/v0.10.0) 下载 `aethmere-vscode-0.10.0.vsix`，然后运行：

```bash
code --install-extension aethmere-vscode-0.10.0.vsix
```

插件可以把编辑器里选中的文字保存为本地上下文，并显示当前项目已有的条目。它同样没有网络请求或遥测。

## 核验公开评测和发行文件

```bash
npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-cli-0.10.0.tgz
aethmere doctor --online
aethmere eval
aethmere trial
```

评测边界见 [EVALUATION.md](EVALUATION.md)。

## 卸载

```bash
npm uninstall -g aethmere-agent aethmere-cli
```

卸载不会删除项目里的 `.aethmere/context.json`。如需删除上下文，请先确认内容已不再需要，再由你自己处理该文件。
