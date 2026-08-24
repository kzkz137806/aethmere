# Aethmere · 识海

让本机模型、Codex 或 Claude Code 接得上你明确保存的项目上下文。桌面端可直接管理上下文并调用本机 Ollama；CLI 与插件负责把同一份本地资料接入开发工具。项目文件不必上传给 Aethmere。

## 现在可以下载

| 下载 | 用途 | 安装 |
|---|---|---|
| **Agent Studio 0.10.1（Windows x64）** | 可视化上下文管理 + 本机 Ollama 对话 | 下载 [`aethmere-agent-studio-0.10.1-win32-x64.zip`](https://github.com/kzkz137806/aethmere/releases/download/v0.10.1/aethmere-agent-studio-0.10.1-win32-x64.zip) |
| **Agent Client 0.10.0** | 本地上下文 + MCP 接入 | `npm install -g https://aethmere.com/downloads/aethmere-agent-0.10.0.tgz` |
| **VS Code 插件 0.10.0** | 保存选中文字、查看本地上下文 | 下载 [`aethmere-vscode-0.10.0.vsix`](https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-vscode-0.10.0.vsix) |
| **评测 CLI 0.10.2** | 查看 V3/V5、受 Aethmere 支持的 7B 模型与同一 7B 无记忆模型的对照 | `npm install -g https://aethmere.com/downloads/aethmere-cli-0.10.2.tgz` |

所有发行文件同时提供 SHA-256。Studio 是未签名的 Windows 便携预览版：请先完整解压 ZIP，再运行 `Aethmere Agent Studio.exe`；Windows 可能显示“未知发布者”。它不会扫描项目，自动 HTTP 只允许本机 `127.0.0.1:11434` 的 Ollama，没有遥测。源码见 [`studio/`](studio/)、[`agent-client/`](agent-client/) 和 [`vscode/`](vscode/)。

## Windows 桌面端

1. 从 [v0.10.1 Release](https://github.com/kzkz137806/aethmere/releases/tag/v0.10.1) 下载 Studio ZIP 和 `.sha256.txt`；
2. 校验 SHA-256 后完整解压，不要单独移动 EXE；
3. 双击 `Aethmere Agent Studio.exe`，选择项目并保存上下文；
4. 如需本机对话，先启动 Ollama 并安装至少一个模型。没有 Ollama 时，上下文管理仍可使用。

Studio 与命令行 Agent Client 使用同一份 `.aethmere/context.json`，可以按需要组合使用。

## 命令行接入 Codex 或 Claude Code

需要 Node.js 20 或更高版本。`aethmere-agent` 才是智能体接入客户端；`aethmere` 只是评测验证工具。

```bash
node --version
npm install --global https://aethmere.com/downloads/aethmere-agent-0.10.0.tgz
aethmere-agent --version
cd your-project
aethmere-agent init
aethmere-agent add --id PROJECT_GOAL --title "项目目标" --text "写入你希望 AI 长期接得上的背景"
aethmere-agent list
aethmere-agent doctor
aethmere-agent connect --client all --check
aethmere-agent connect --client all
```

重启 Codex 或 Claude Code 后，智能体可以通过 MCP 列出和读取当前项目的本地上下文。完整说明见 [QUICKSTART.md](QUICKSTART.md)。

## 同题封存评测

V5 中文和英文合计 4,800 题：

| 系统 | 正确 | 正确率 |
|---|---:|---:|
| 受 Aethmere 支持的 7B 模型（V5） | 4,800/4,800 | 100.0% |
| 同一 7B 模型（无记忆、直接回答） | 1,982/4,800 | 41.3% |

两组使用同一 7B 模型、同一套封存题、相同语言和分母，区别是是否受 Aethmere 支持并使用记忆。无记忆基线的中文结果为 1,346/2,400（56.1%），英文结果为 636/2,400（26.5%）。受 Aethmere 支持的 7B 模型修复了无记忆基线的 2,818/2,818 个失败项，对基线原本正确的题 0 回退。评测设计、V3 结果和限制见 [EVALUATION.md](EVALUATION.md)。

## 公开边界

这个仓库只承载可公开审计的本地 Studio、Agent Client、VS Code 插件、验证 CLI、聚合评测和使用说明。Aethmere 的私有服务运行时、内部提示词、召回排序算法、私有评测题、原始模型输出、客户数据和项目资料不在这里。

- 官网：[aethmere.com](https://aethmere.com)
- 下载：[GitHub Releases](https://github.com/kzkz137806/aethmere/releases)
- 私密安全报告：[GitHub private vulnerability reporting](https://github.com/kzkz137806/aethmere/security/advisories/new)

许可范围见 [LICENSE.txt](LICENSE.txt)。
