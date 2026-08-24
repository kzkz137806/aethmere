# Quick start

需要 Node.js 20 或更高版本。

## 安装

```bash
npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.8.1/aethmere-cli-0.8.1.tgz
aethmere --version
```

## 验证官方文件

```bash
aethmere doctor --online
```

该命令只读取官网与 GitHub 的公开文件，不发送项目内容。离线检查使用 `aethmere doctor`。

## 跑公开正反例

```bash
aethmere trial
```

## 检查自己的引用输出

`context.json`：

```json
{
  "evidence": [
    { "id": "E1", "text": "The launch date is 24 August." },
    { "id": "E2", "text": "The CLI has zero dependencies." }
  ]
}
```

`answer.json`：

```json
{
  "answer": "The launch date is 24 August.",
  "evidence_ids": ["E1"]
}
```

运行：

```bash
aethmere check --context context.json --answer answer.json --expected E1
```

这个检查器验证 ID 形状、可见性和精确集合；它不会把“格式通过”冒充成“答案语义一定正确”。

## 卸载

```bash
npm uninstall -g aethmere-cli
```
