import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readFailureContext, readFailureInput, readFailureOutput,
  startFailureAttempt, finishFailureAttempt,
} from "../lib/failure-state.mjs";
import { auditPackageDependencyClosure } from "../lib/package-audit.mjs";

const cli = fileURLToPath(new URL("../bin/aethmere-agent.mjs", import.meta.url));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aethmere-failure-client-"));
  fs.writeFileSync(path.join(root, "state.json"), '{"exit":17}');
  fs.writeFileSync(path.join(root, "probe.cjs"), 'const fs=require("node:fs");const state=JSON.parse(fs.readFileSync("state.json"));console.error("canary-unexpected-result");process.exit(state.exit);');
  return root;
}
function run(root, args, input) {
  const result = spawnSync(process.execPath, [cli, ...args, "--root", root], {
    cwd: root, encoding: "utf8", input, timeout: 15_000,
    env: { ...process.env, AETHMERE_HOME: root },
  });
  assert.equal(result.error, undefined);
  return result;
}
function hook(root, input, task = "task-a") {
  const result = run(root, ["failure", "hook", "--task", task, "--scope", "state.json,probe.cjs"], JSON.stringify(input));
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function execute(root, call, session) {
  const input = { hook_event_name: "PreToolUse", session_id: session, tool_name: "exec_command", tool_use_id: call,
    tool_input: { cmd: "node probe.cjs", workdir: root, authorization: "Bearer " + "X".repeat(32) } };
  hook(root, input);
  const result = spawnSync(process.execPath, ["probe.cjs"], { cwd: root, encoding: "utf8", timeout: 10_000 });
  hook(root, { ...input, hook_event_name: "PostToolUse", tool_response: { exit_code: result.status, output: result.stdout + result.stderr } });
  return result;
}

test("actual failed command survives a fresh SessionStart with input, result and next check", () => {
  const root = fixture();
  try {
    hook(root, { hook_event_name: "SessionStart", session_id: "session-a" });
    assert.equal(execute(root, "failed-call", "session-a").status, 17);
    const context = readFailureContext(root, { taskKey: "task-a" });
    assert.equal(context.observations.length, 1);
    const observation = context.observations[0];
    assert.equal(observation.validity, "snapshot-matches");
    assert.equal(observation.exitCode, 17);
    assert.match(observation.observation, /canary-unexpected-result/u);
    assert.ok(observation.nextStep.length);
    const input = readFailureInput(root, observation.inputReference, "task-a");
    assert.match(input.payload, /node probe.cjs/u);
    assert.ok(!input.payload.includes("X".repeat(32)));
    assert.equal(input.complete, true);
    assert.equal(readFailureOutput(root, observation.outputReference, "task-a").complete, true);
    const next = hook(root, { hook_event_name: "SessionStart", session_id: "session-b" });
    assert.match(next.hookSpecificOutput.additionalContext, /canary-unexpected-result/u);
    assert.match(next.hookSpecificOutput.additionalContext, /nextStep/u);
    assert.match(next.hookSpecificOutput.additionalContext, /untrusted data/u);
    assert.ok(!next.hookSpecificOutput.additionalContext.includes("X".repeat(32)));
    assert.equal(fs.existsSync(path.join(root, "docs")), false);
    assert.equal(fs.readFileSync(path.join(root, ".aethmere", "failure-state", ".gitignore"), "utf8"), "*\n!.gitignore\n");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("changed conditions require diagnosis and an actual same-action success clears the failure", () => {
  const root = fixture();
  try {
    hook(root, { hook_event_name: "SessionStart", session_id: "session-a" });
    execute(root, "failed-call", "session-a");
    fs.writeFileSync(path.join(root, "state.json"), '{"exit":0}');
    assert.equal(readFailureContext(root, { taskKey: "task-a" }).observations[0].validity, "scope-changed");
    assert.equal(execute(root, "passed-call", "session-a").status, 0);
    assert.equal(readFailureContext(root, { taskKey: "task-a" }).observations.length, 0);
    assert.equal(hook(root, { hook_event_name: "SessionStart", session_id: "session-b" }).hookSpecificOutput, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("stale and corrupt failure artifacts never permit confident reuse", () => {
  const root = fixture();
  try {
    const now = Date.now() - 7 * 60 * 60 * 1000;
    const attempt = startFailureAttempt(root, { taskKey: "task-a", sessionId: "session-a", action: "test", input: "input", scopeFiles: ["state.json"], now });
    finishFailureAttempt(attempt, { status: "failed", exitCode: 17, observation: "old failure", now: now + 1 });
    assert.equal(readFailureContext(root, { taskKey: "task-a" }).observations[0].validity, "recheck-required");
    fs.writeFileSync(attempt.file, "{invalid");
    const corrupt = readFailureContext(root, { taskKey: "task-a" });
    assert.ok(corrupt.warnings.length);
    assert.equal(corrupt.automaticRetry, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("another task is empty, malformed hook is fail-open and generated hooks only preview configuration", () => {
  const root = fixture();
  try {
    hook(root, { hook_event_name: "SessionStart", session_id: "session-a" });
    execute(root, "failed-call", "session-a");
    assert.equal(readFailureContext(root, { taskKey: "task-b" }).observations.length, 0);
    const foreign = hook(root, { hook_event_name: "SessionStart", session_id: "foreign-session" }, "task-b");
    assert.equal(foreign.hookSpecificOutput, undefined);
    const malformed = run(root, ["failure", "hook", "--task", "task-a"], "{broken");
    assert.equal(malformed.status, 0);
    assert.deepEqual(JSON.parse(malformed.stdout), {});
    assert.match(malformed.stderr, /was not recorded/u);
    const definitions = JSON.parse(run(root, ["failure", "hooks", "--task", "task-a"]).stdout);
    assert.deepEqual(Object.keys(definitions.hooks).sort(), ["PostToolUse", "PreToolUse", "SessionStart"]);
    assert.equal(fs.existsSync(path.join(root, ".codex")), false);
    assert.equal(run(root, ["failure", "resume"]).status, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("package closure checks multiline, literal dynamic and external imports against the archive", () => {
  const entries = [
    { name: "package/package.json", data: '{"name":"aethmere-agent"}' },
    { name: "package/bin/main.mjs", data: 'import {\n value\n} from "../lib/value.mjs"; import("../lib/value.mjs"); import fs from "node:fs";' },
    { name: "package/lib/value.mjs", data: "export const value=1;" },
  ];
  assert.equal(auditPackageDependencyClosure(entries).ok, true);
  const prose = { name: "package/lib/prose.mjs", data: 'const message="import, { script: "; const pattern=/import("fake")/; const text=`import("fake")`; /* import("fake") */ export const value=1;' };
  assert.equal(auditPackageDependencyClosure([...entries, prose]).ok, true);
  assert.equal(auditPackageDependencyClosure([...entries, { name: "package/lib/dynamic.mjs", data: 'const chosen="node:fs"; import(chosen);' }]).ok, false);
  assert.equal(auditPackageDependencyClosure(entries.slice(0, 2)).ok, false);
  assert.equal(auditPackageDependencyClosure([...entries, { name: "package/lib/external.cjs", data: 'require("missing-runtime");' }]).ok, false);
  assert.equal(auditPackageDependencyClosure([...entries, { name: "package/bin/escape.mjs", data: 'import "../../outside.mjs";' }]).ok, false);
});

test("failure diagnosis remains available without turning formal capabilities into an offline path", () => {
  const root = fixture();
  try {
    const formal = run(root, ["init", "--json"]);
    assert.equal(formal.status, 1);
    assert.equal(fs.existsSync(path.join(root, ".aethmere", "context.json")), false);
    assert.equal(run(root, ["failure", "resume", "--task", "task-a", "--json"]).status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
