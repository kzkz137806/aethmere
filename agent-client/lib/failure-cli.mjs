import fs from "node:fs";
import path from "node:path";
import {
  bindFailureTask, failureExcerpt, failureModelContext,
  handleFailureStateHook, readFailureContext,
} from "./failure-state.mjs";

function option(args, name) {
  const flag = "--" + name;
  const index = args.findIndex(value => value === flag || value.startsWith(flag + "="));
  if (index < 0) return "";
  return args[index].startsWith(flag + "=") ? args[index].slice(flag.length + 1) : args[index + 1] || "";
}

function scope(args) {
  return option(args, "scope").split(",").map(value => value.trim()).filter(Boolean);
}

function task(args) {
  const value = option(args, "task");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u.test(value)) throw new Error("failure diagnosis requires an explicit stable --task ID");
  return value;
}

function shellQuote(value) { return "'" + String(value).replaceAll("'", "'\\''") + "'"; }
function psQuote(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }

function hookDefinitions(root, bin, args) {
  const argv = [bin, "failure", "hook", "--task", task(args), "--root", root];
  if (scope(args).length) argv.push("--scope", scope(args).join(","));
  const ps = [
    "$utf8 = New-Object System.Text.UTF8Encoding($false)",
    "[Console]::InputEncoding = $utf8",
    "[Console]::OutputEncoding = $utf8",
    "$OutputEncoding = $utf8",
    "& " + [process.execPath, ...argv].map(psQuote).join(" "),
    "exit $LASTEXITCODE",
  ].join("\n");
  const hook = {
    type: "command",
    command: [process.execPath, ...argv].map(shellQuote).join(" "),
    commandWindows: "powershell -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(ps, "utf16le").toString("base64"),
    timeout: 5,
    statusMessage: "Saving and recovering this task's execution diagnostics",
  };
  return { hooks: {
    SessionStart: [{ matcher: "startup|resume|clear|compact", hooks: [{ ...hook }] }],
    PreToolUse: [{ matcher: "*", hooks: [{ ...hook }] }],
    PostToolUse: [{ matcher: "*", hooks: [{ ...hook }] }],
  } };
}

function ignoreLocalState(root) {
  const file = path.join(root, ".aethmere", "failure-state", ".gitignore");
  try { fs.writeFileSync(file, "*\n!.gitignore\n", { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}

function hook(root, args) {
  try {
    const stat = fs.fstatSync(0);
    if (stat.isFile() && stat.size > 256_000) throw new Error("hook input exceeds the capture limit");
    const chunks = [];
    const buffer = Buffer.alloc(16_384);
    let total = 0;
    for (;;) {
      const bytes = fs.readSync(0, buffer, 0, buffer.length, null);
      if (!bytes) break;
      total += bytes;
      if (total > 256_000) throw new Error("hook input exceeds the capture limit");
      chunks.push(Buffer.from(buffer.subarray(0, bytes)));
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (input.hook_event_name === "SessionStart") {
      if (!input.session_id) throw new Error("SessionStart requires its actual session ID");
      bindFailureTask(root, { contextId: input.session_id, taskKey: task(args), scopeFiles: scope(args) });
      ignoreLocalState(root);
    }
    return handleFailureStateHook(root, input);
  } catch (error) {
    // A diagnostics storage failure is visible without denying ordinary tools.
    process.stderr.write("Failure state was not recorded: " + failureExcerpt(error.message, 240) + "\n");
    return {};
  }
}

export async function runFailureCommand({ args, root, bin }) {
  const command = args[0];
  if (command === "hook") return hook(root, args);
  if (command === "hooks") return hookDefinitions(root, bin, args);
  if (command === "bind") {
    const session = option(args, "session");
    if (!session) throw new Error("binding requires the actual --session ID");
    const binding = bindFailureTask(root, { contextId: session, taskKey: task(args), scopeFiles: scope(args) });
    ignoreLocalState(root);
    return { schema: "aethmere.failure-binding.v1", ok: true, ...binding };
  }
  if (command === "resume") return failureModelContext(readFailureContext(root, { taskKey: task(args) }));
  throw new Error("use failure hooks, bind, resume or hook");
}
