# Aethmere — Local Context for VS Code

把当前编辑器里选中的重要背景保存到项目自己的 `.aethmere/context.json`，并通过 Aethmere Agent Client 接给 Codex 或 Claude Code。

## 你可以做什么

- 在 Explorer 的 **Aethmere Context** 视图查看已保存条目；
- 右键选中的文字，选择 **Aethmere: Save Selection as Context**；
- 初始化或打开本地上下文文件；
- 检查 `aethmere-agent` 是否已经安装；
- 复制当前项目的一键 MCP 接入命令。

## 先安装 Agent Client

```bash
npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-agent-0.10.0.tgz
```

然后在 VS Code 命令面板运行：

1. `Aethmere: Initialize Local Context`
2. `Aethmere: Copy Agent Connection Command`
3. 在终端运行复制的命令并重启 AI 客户端

## 隐私边界

插件只读写当前工作区的 `.aethmere/context.json`，没有网络请求、遥测、账号或后台上传。它不包含 Aethmere 私有运行时、内部提示词、召回排序算法或私有评测题。
