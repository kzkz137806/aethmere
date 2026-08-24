# Aethmere · 识海

把你明确保存的本地项目上下文，通过 MCP 接给 Codex 或 Claude Code。少重复解释，重要内容按需读取，项目资料不必上传给 Aethmere。

## 现在可以下载

| 下载 | 用途 | 安装 |
|---|---|---|
| **Agent Client 0.10.0** | 本地上下文 + MCP 接入 | `npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-agent-0.10.0.tgz` |
| **VS Code 插件 0.10.0** | 保存选中文字、查看本地上下文 | 下载 [`aethmere-vscode-0.10.0.vsix`](https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-vscode-0.10.0.vsix) |
| **评测 CLI 0.10.0** | 查看 V3/V5、7B 对照和发行哈希 | `npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-cli-0.10.0.tgz` |

所有发行文件同时提供 SHA-256。源码见 [`agent-client/`](agent-client/) 和 [`vscode/`](vscode/)；公开客户端与插件均为零第三方依赖，不包含网络请求或遥测。

## 三步接入

```bash
cd your-project
aethmere-agent init
aethmere-agent add --id PROJECT_GOAL --title "项目目标" --text "写入你希望 AI 长期接得上的背景"
aethmere-agent connect --client all
```

重启 Codex 或 Claude Code 后，智能体可以通过 MCP 列出和读取当前项目的本地上下文。完整说明见 [QUICKSTART.md](QUICKSTART.md)。

## 同题封存评测

V5 中文和英文合计 4,800 题：

| 系统 | 正确 | 正确率 |
|---|---:|---:|
| Aethmere V5 | 4,800/4,800 | 100.0% |
| 本地 7B 无记忆直接回答基线 | 1,982/4,800 | 41.3% |

中文基线为 1,346/2,400（56.1%），英文基线为 636/2,400（26.5%）。Aethmere 修复了基线的 2,818/2,818 个失败项，对基线原本正确的题 0 回退。评测设计、V3 结果和限制见 [EVALUATION.md](EVALUATION.md)。

## 公开边界

这个仓库只承载用户可运行的最小本地客户端、VS Code 插件、验证 CLI、聚合评测和使用说明。Aethmere 的私有服务运行时、内部提示词、召回排序算法、私有评测题、原始模型输出、客户数据和项目资料不在这里。

- 官网：[aethmere.com](https://aethmere.com)
- 下载：[GitHub Releases](https://github.com/kzkz137806/aethmere/releases)
- 私密安全报告：[GitHub private vulnerability reporting](https://github.com/kzkz137806/aethmere/security/advisories/new)

许可范围见 [LICENSE.txt](LICENSE.txt)。
