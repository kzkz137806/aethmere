import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Studio version, launcher and release asset names are locked to 0.12.0", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const launcher = fs.readFileSync(path.join(root, "launcher", "Program.cs"), "utf8");
  const packager = fs.readFileSync(path.join(root, "bin", "package-win32.mjs"), "utf8");
  const archive = fs.readFileSync(path.join(root, "bin", "archive-win32.mjs"), "utf8");
  const verifier = fs.readFileSync(path.join(root, "bin", "verify-package.mjs"), "utf8");
  assert.equal(packageJson.version, "0.12.0");
  assert.match(launcher, /AssemblyVersion\("0\.12\.0\.0"\)/u);
  for (const source of [packager, archive, verifier]) assert.match(source, /aethmere-studio-\$\{(?:manifest|packageJson)\.version\}-windows-x64/u);
  assert.match(archive, /const archiveName = `\$\{directoryName\}\.zip`/u);
  assert.match(archive, /`\$\{archiveName\}\.sha256\.txt`/u);
  assert.match(packager, /tree\/v\$\{manifest\.version\}\/studio/u);
  assert.match(verifier, /portable source tag mismatch/u);
});

test("portable package declares and verifies the governed network boundary", () => {
  const packager = fs.readFileSync(path.join(root, "bin", "package-win32.mjs"), "utf8");
  const verifier = fs.readFileSync(path.join(root, "bin", "verify-package.mjs"), "utf8");
  for (const source of [packager, verifier]) {
    assert.match(source, /automatic_external_requests[^\n]+true/u);
    assert.match(source, /first_party_governance_origin[^\n]+https:\/\/app\.aethmere\.com/u);
    assert.match(source, /other_automatic_origins_allowed[^\n]+false/u);
    assert.match(source, /pending_terminal_flush_before_capability[^\n]+true/u);
    assert.match(source, /minimum_client_version[^\n]+0\.12\.0/u);
    assert.match(source, /update_url[^\n]+https:\/\/aethmere\.com\/downloads\//u);
  }
});
