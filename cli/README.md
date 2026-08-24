# Aethmere public verification CLI

This small, zero-dependency CLI lets you run the public evidence-ID trial and
check the same contract against your own JSON files. It is deliberately
separate from Aethmere's private product runtime.

```bash
aethmere doctor
aethmere trial
aethmere check --context context.json --answer answer.json
```

`trial` and `check` run locally and do not upload your files. The optional
`aethmere doctor --online` mode only fetches the official release files and
does not send project content.

Full quick-start: <https://github.com/kzkz137806/aethmere>
