# Aethmere Agent Client

把你明确保存的项目上下文，通过本地 MCP 接给 Codex 或 Claude Code。资料保存在当前项目的 `.aethmere/context.json`；客户端没有网络请求代码，也不会上传项目文件。

## 安装

需要 Node.js 20 或更高版本。

```bash
npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.10.0/aethmere-agent-0.10.0.tgz
aethmere-agent --version
```

## 三步开始

```bash
cd your-project
aethmere-agent init
aethmere-agent add --id PROJECT_GOAL --title "项目目标" --text "在这里写入你希望智能体长期接得上的背景"
aethmere-agent connect --client all
```

重启已连接的 AI 客户端后，它可以通过 MCP 列出和读取这些本地上下文。你也可以先运行：

```bash
aethmere-agent doctor
aethmere-agent list
```

## 当前公开能力

- 本地初始化、添加、列出、读取和删除上下文；
- 通过 MCP 向已连接的智能体提供只读的上下文列表、单项读取和证据 ID 检查；
- 一条命令接入 Codex、Claude Code，修改前保留配置备份；
- 零第三方依赖、零遥测、零网络请求。

公开客户端是可审计的本地连接器，不包含 Aethmere 的私有服务运行时、召回排序算法、内部提示词或私有评测题。公开封存评测也不代表这个客户端或当前线上版本在开放世界问题上的准确率。

## 卸载

```bash
npm uninstall -g aethmere-agent
```

项目里的 `.aethmere/context.json` 属于你；卸载不会删除它。
