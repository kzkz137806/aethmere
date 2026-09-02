# Quick start

## 安装给用户用的 Aethmere CLI

**`aethmere-agent` 才是产品 CLI**：它在项目中保存你明确选择的上下文，并通过 MCP 接给 Codex 或 Claude Code。另一个 `aethmere` 命令只是可选的公开评测复核工具，不提供项目记忆或 MCP 接入。

需要 Node.js 20 或更高版本。

### 1. 检查 Node.js

```bash
node --version
npm --version
```

如果找不到命令，请先从 Node.js 官网安装 LTS 版本，再关闭并重新打开终端。

### 2. 安装 Agent Client

```bash
npm install --global https://aethmere.com/downloads/aethmere-agent-client-0.12.0.tgz
aethmere-agent --version
```

看到 `Aethmere Agent Client 0.12.0` 就表示安装成功。

### 3. 连接 Aethmere 账号

在 Aethmere 账号页面取得一次性设备代码，然后运行：

```bash
aethmere-agent login --code CODE
```

成功提示为：`Aethmere account connected. Live governance will be verified before every formal capability.`

### 4. 在项目中保存第一条上下文

```bash
cd your-project
aethmere-agent init
aethmere-agent add --id PROJECT_GOAL --title "项目目标" --text "在这里写入你希望 AI 长期接得上的背景"
aethmere-agent list
```

上下文保存在当前项目的 `.aethmere/context.json`。每次正式能力都必须先连接 `https://app.aethmere.com`，刷新治理策略、送达此前待发终态，并取得本次开始事件的持久化确认；任一步失败都会在读取或修改上下文前停止。封闭治理事件不包含上下文正文、项目路径或账号令牌。运行 `aethmere-agent doctor` 可以检查账号、版本与在线治理状态。

### 5. 先预览，再接入 Codex 或 Claude Code

```bash
aethmere-agent doctor
aethmere-agent connect --client all --check
aethmere-agent connect --client all
```

该命令会为现有配置保留备份，并写入名为 `aethmere` 的本地 MCP server。重启 AI 客户端后即可使用：

- `aethmere_context_list`：列出本地上下文 ID 和标题；
- `aethmere_context_get`：按精确 ID 读取一条上下文；
- `aethmere_evidence_check`：检查引用的上下文 ID 是否存在；
- `aethmere_status`：查看本地连接状态。

`--check` 只显示将要修改的配置；确认无误后，再运行不带 `--check` 的命令。连接命令会为现有配置保留备份。

## Windows 桌面端（可选）

如果你更喜欢图形界面，可以从 [v0.12.0 Release](https://github.com/kzkz137806/aethmere/releases/tag/v0.12.0) 下载：

- `aethmere-studio-0.12.0-windows-x64.zip`
- `aethmere-studio-0.12.0-windows-x64.zip.sha256.txt`

校验后完整解压 ZIP，双击 `Aethmere Agent Studio.exe`。这是未签名的便携预览版，Windows 可能显示“未知发布者”；不要把 EXE 单独移出解压目录。

Studio 可以选择项目、创建和勾选本地上下文。若本机已启动 Ollama，Studio 还可以把你明确勾选的上下文发送给 `127.0.0.1:11434` 上的本机模型。Studio 不会自动扫描其他项目文件；每次正式能力仍须先在 `app.aethmere.com` 完成在线治理，且发送的封闭治理事件不含项目内容、上下文正文、路径或令牌。

## VS Code 插件

从 [v0.12.0 Release](https://github.com/kzkz137806/aethmere/releases/tag/v0.12.0) 下载 `aethmere-vscode-0.12.0.vsix`，然后运行：

```bash
code --install-extension aethmere-vscode-0.12.0.vsix
```

插件可以把编辑器里选中的文字保存为本地上下文，并显示当前项目已有的条目。插件先以自身 0.12.0 版本完成在线治理，再通过已安装的官方 Agent Client 0.12.0 执行上下文操作；任一层失败都不会继续读取选区或调用正式 Agent 能力。

## 可选：核验公开评测和发行文件

下面的 `aethmere` 是单独的评测复核工具。正常使用 Aethmere 不需要安装它。

```bash
npm install --global https://aethmere.com/downloads/aethmere-cli-0.10.2.tgz
aethmere --version
aethmere doctor --online
aethmere eval
aethmere trial
```

评测边界见 [EVALUATION.md](EVALUATION.md)。

## 常见问题

- **找不到 `aethmere-agent`**：关闭并重新打开终端；Windows PowerShell 若阻止脚本，可运行 `aethmere-agent.cmd --version`，或改用“命令提示符”。
- **项目资料会不会上传**：项目上下文保存在当前项目的 `.aethmere/context.json`，不会放入治理事件。正式能力会向 `app.aethmere.com` 发送不含正文、路径或令牌的封闭治理事件；Studio 只有在你主动调用本机模型时，才把你明确选择的内容发送给本机 Ollama。
- **换项目怎么办**：进入另一个项目目录后重新运行 `aethmere-agent init`，每个项目维护自己的上下文文件。

## 卸载

```bash
npm uninstall -g aethmere-agent aethmere-cli
```

卸载不会删除项目里的 `.aethmere/context.json`。如需删除上下文，请先确认内容已不再需要，再由你自己处理该文件。
