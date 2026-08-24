# Aethmere · 识海

让 AI 的长期上下文有证据、有边界、可撤回。

Aethmere 面向需要长期研究、项目协作和复杂判断的人：减少重复解释，让重要结论能追溯到可见依据，并在事实变化时保留清楚的更新边界。

## 现在就能测试

公开的 `0.8.1` 验证 CLI 不包含私有运行时，也不会上传你的文件。它提供三件可复核的事：

- 运行公开的严格证据 ID 正反例；
- 用你自己的 context/answer JSON 检查引用是否可见、精确且没有伪造 ID。
- 核对官网与 GitHub Release 的版本和 SHA-256。

```bash
npm install -g https://github.com/kzkz137806/aethmere/releases/download/v0.8.1/aethmere-cli-0.8.1.tgz
aethmere doctor --online
aethmere trial
```

安装和自测见 [QUICKSTART.md](QUICKSTART.md)。

## 产品与公开仓的边界

这个仓库承载可公开验证的 CLI、安装说明和安全联系渠道。Aethmere 的私有服务源码、内部提示词、私有评测题与原始输出、客户数据和项目资料不在这里。

- 官网：[aethmere.com](https://aethmere.com)
- 私密安全报告：[GitHub private vulnerability reporting](https://github.com/kzkz137806/aethmere/security/advisories/new)

本仓库不是完整产品源码仓；许可范围见 [LICENSE.txt](LICENSE.txt)。
