# Aethmere public verification CLI

This small, zero-dependency CLI lets you inspect the reviewed V3/V5 sealed
evaluation aggregate—including the same-model comparison between a 7B model with Aethmere and the same 7B model without memory—run the public evidence-ID trial, and check the same
contract against your own JSON files. It is deliberately separate from
Aethmere's private product runtime.

```bash
aethmere doctor
aethmere eval
aethmere trial
aethmere check --context context.json --answer answer.json
```

`eval`, `trial` and `check` run locally and do not upload your files. The optional
`aethmere doctor --online` mode only fetches the official release files and
does not send project content.

Full quick-start and evaluation limits: <https://github.com/kzkz137806/aethmere>
