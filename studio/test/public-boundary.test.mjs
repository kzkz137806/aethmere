import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = [
  "main.mjs", "preload.cjs", "lib/context-store.mjs", "renderer/index.html", "renderer/app.js", "renderer/styles.css",
  "launcher/Program.cs",
].map((file) => path.join(root, file));
const source = sourceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");

test("public Studio contains no private workspace paths, credentials or internal mechanism imports", () => {
  for (const pattern of [
    /docs\/(?:memory|projects|sessions|tools)\//iu,
    /global-memory\//iu,
    /sensitivity\s*:\s*P[01]/iu,
    /export\s*:\s*false/iu,
    /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/iu,
    /(?:API_KEY|ACCESS_TOKEN|BEARER_TOKEN|CLIENT_SECRET|PRIVATE_KEY)/iu,
    /governed-(?:deliberation|knowledge|library)/iu,
    /ProofIR/iu,
    /[A-Z]:\\Users\\/u,
  ]) assert.equal(pattern.test(source), false, `forbidden public source pattern: ${pattern}`);
});

test("renderer has no network capability and main process permits only loopback Ollama plus fixed official links", () => {
  const html = fs.readFileSync(path.join(root, "renderer", "index.html"), "utf8");
  const main = fs.readFileSync(path.join(root, "main.mjs"), "utf8");
  assert.match(html, /connect-src 'none'/u);
  assert.match(main, /http:\/\/127\.0\.0\.1:11434/u);
  assert.doesNotMatch(main, /(?:PRIVATE|INTERNAL)_(?:SERVICE_)?URL/u);
  const external = [...main.matchAll(/https:\/\/[^"\s]+/gu)].map((match) => match[0]);
  assert.deepEqual(external.sort(), ["https://aethmere.com/", "https://github.com/kzkz137806/aethmere/releases"].sort());
});
