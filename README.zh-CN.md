# Aethmere · 识宙

[English](README.md) | **简体中文**

让 Codex 或 Claude Code 接得上你明确保存的本地项目上下文。给用户使用的主命令是 **`aethmere-agent`**：它把你主动选择的上下文保存在各项目内，并通过 MCP 接入开发工具。桌面端与 VS Code 插件只是同一份本地上下文的可选界面；项目文件不必上传给 Aethmere。

另一个 **`aethmere`** 命令只用于复核公开评测，不是产品 CLI，也不是日常使用 Aethmere 的必需组件。

## 安装 Aethmere CLI

需要 Node.js 20 或更高版本。

```bash
npm install --global https://aethmere.com/downloads/aethmere-agent-client-0.12.0.tgz
aethmere-agent --version
aethmere-agent login --code CODE
cd your-project
aethmere-agent init
```

`CODE` 是 Aethmere 账号页面显示的一次性设备代码。登录成功会显示：`Aethmere account connected. Live governance will be verified before every formal capability.`

然后按[五分钟快速开始](QUICKSTART.md)保存项目上下文，并接入 Codex 或 Claude Code。

## 产品下载

| 下载 | 用途 | 安装 |
|---|---|---|
| **Aethmere Agent Client 0.12.0（`aethmere-agent`）** | 保存本地项目上下文，并通过 MCP 接入 Codex 或 Claude Code | `npm install -g https://aethmere.com/downloads/aethmere-agent-client-0.12.0.tgz` |
| **Aethmere Studio 0.12.0（Windows x64）** | 可选的可视化上下文管理 + 本机 Ollama 对话 | 下载 [`aethmere-studio-0.12.0-windows-x64.zip`](https://github.com/kzkz137806/aethmere/releases/download/v0.12.0/aethmere-studio-0.12.0-windows-x64.zip) |
| **VS Code 插件 0.12.0** | 通过 Agent Client 保存选中文字、查看本地上下文 | 下载 [`aethmere-vscode-0.12.0.vsix`](https://github.com/kzkz137806/aethmere/releases/download/v0.12.0/aethmere-vscode-0.12.0.vsix) |

所有发行文件同时提供 SHA-256。Studio 是未签名的 Windows 便携预览版：请先完整解压 ZIP，再运行 `Aethmere Agent Studio.exe`；Windows 可能显示“未知发布者”。0.12.0 的每次正式能力都必须先完成设备授权，并在线连接 `https://app.aethmere.com`；用户主动调用本机模型时，Studio 还会访问 `http://127.0.0.1:11434` 的 Ollama。治理事件采用封闭字段，只包含客户端、版本、平台、策略摘要、步骤、结果、结构化原因、粗粒度耗时／次数／日期桶和随机事件标识，不包含提示词、回答、项目内容、上下文正文、路径、URL、IP、User-Agent、账号令牌或密钥。授权、策略、版本或事件送达无法验证时，正式能力停止。源码见 [`studio/`](studio/)、[`agent-client/`](agent-client/) 和 [`vscode/`](vscode/)。

## Windows 桌面端（可选）

1. 从 [v0.12.0 Release](https://github.com/kzkz137806/aethmere/releases/tag/v0.12.0) 下载 Studio ZIP 和 `.sha256.txt`；
2. 校验 SHA-256 后完整解压，不要单独移动 EXE；
3. 双击 `Aethmere Agent Studio.exe`，选择项目并保存上下文；
4. 如需本机对话，先启动 Ollama 并安装至少一个模型。没有 Ollama 时，上下文管理仍可使用。

Studio 与命令行 Agent Client 使用同一份 `.aethmere/context.json`，可以按需要组合使用。

## 命令行接入 Codex 或 Claude Code

需要 Node.js 20 或更高版本。`aethmere-agent` 就是用户安装、用于项目接入的 Aethmere CLI。

```bash
node --version
npm install --global https://aethmere.com/downloads/aethmere-agent-client-0.12.0.tgz
aethmere-agent --version
aethmere-agent login --code CODE
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

## 18 维原生实测综合分（V13）

综合分现在直接服从锁定 V5 证据：`10 × 两轮稳定 PASS ÷ 18`。FAIL、FLAKY 与 N/A 都不加分；另列的适用维度通过率仍排除 N/A，因此覆盖度和正式通过率都能看见。

| 排名 | 产品 | V5 原生实测综合分 |
|---:|---|---:|
| 1 | **Aethmere** | **10.00 / 10** |
| 2 | Letta Code | 7.22 / 10 |
| 2 | MemOS | 7.22 / 10 |
| 4 | Mem0 | 6.67 / 10 |
| 5 | Graphiti | 0.56 / 10 |

V12 已撤回：它把专家判断的文档底分与幅度很小的原生实测修正混在一起，可能出现原生实测更差、单维分却更高。V13 已去掉这些主观底分。10.00 只表示在这份锁定合同中 18/18 两轮稳定通过，不表示任意产品质量满分、第三方认证、全行业绝对总榜或生产 SLA。完整矩阵、公式、哈希和限制见 [EVALUATION.md](EVALUATION.md)，机器可读结果见 [官网 JSON](https://aethmere.com/evaluation/peer-scorecard-v13.json)。

## 原生能力 18 维独立设备盲测（V5）

2026-08-26，由不同操作者在独立物理 Apple Silicon Mac 上，将五个锁定版本放入统一 18 维合同，使用全新实例完成两轮测试。每轮 90 格，共核对 180 格；所有 FAIL、FLAKY 和 N/A 都保留。稳定 PASS 要求同一格两轮都通过且语义一致。

| 锁定产品版本 | 稳定 PASS / 适用维度 | FAIL | FLAKY | N/A |
|---|---:|---:|---:|---:|
| **Aethmere 0.7.0 (`2c1df71`)** | **18/18** | **0** | **0** | **0** |
| Graphiti 0.29.3 | 1/16 | 14 | 1 | 2 |
| Letta Code 0.30.29 | 13/17 | 4 | 0 | 1 |
| Mem0 2.0.18 | 12/16 | 3 | 1 | 2 |
| MemOS 2.0.30 | 13/18 | 5 | 0 | 0 |

Aethmere 两轮均为 18/18，在本次锁定矩阵中的稳定通过数与适用维度通过率均最高。Graphiti 的 14 个稳定 FAIL 都表示原生操作未在锁定时限内完成，不能据此断言功能不存在。协议校验通过，但五产品矩阵仍有非 PASS 项，因此整体 `capability_all_passed` 如实为 `false`；这不表示 Aethmere 未通过。两轮计数、完整性哈希、方法和不可外推边界见 [EVALUATION.md](EVALUATION.md)。

## 可选的评测复核工具

单独版本化的 `aethmere` 命令只用于复核公开聚合评测与发行文件完整性。仅在你确实要审计这些公开凭据时安装：

```bash
npm install --global https://aethmere.com/downloads/aethmere-cli-0.10.2.tgz
aethmere eval
```

这个复核工具不提供项目记忆或 MCP 接入。日常使用请安装上方产品下载表里的 `aethmere-agent`。

## 公开边界

这个仓库的主产品入口是可公开审计的本地 Aethmere CLI（`aethmere-agent`），并提供可选的 Studio 与 VS Code 界面。另附独立的评测复核工具、聚合评测及说明用于复现，但它们不是产品入口。Aethmere 的私有服务运行时、内部提示词、召回排序算法、私有评测题、原始模型输出、客户数据和项目资料不在这里。

- 官网：[aethmere.com](https://aethmere.com)
- 下载：[GitHub Releases](https://github.com/kzkz137806/aethmere/releases)
- 私密安全报告：[GitHub private vulnerability reporting](https://github.com/kzkz137806/aethmere/security/advisories/new)

许可范围见 [LICENSE.txt](LICENSE.txt)。
