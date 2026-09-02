"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("every context command stays behind the Agent runner and save reads selection only after READY", async () => {
  const commandHandlers = new Map();
  const formalCalls = [];
  const readyCalls = [];
  const governanceCalls = [];
  const opened = [];
  const messages = { error: [], info: [], warning: [] };
  const promptAnswers = ["SAFE", "Safe title"];
  let getTextCalls = 0;
  let readyObserved = false;
  let provider;

  class FakeAgentRunner {
    async version() { return "0.12.0"; }

    async formal(args, options) {
      formalCalls.push({ args: [...args], options: { ...options } });
      assert.equal(args.some((arg) => arg.includes("workspace-$()") || arg === "--root"), false);
      const command = args[0];
      if (command === "list") return { stdout: JSON.stringify({ schema: "aethmere.context-list.v1", ok: true, items: [] }) };
      if (command === "init") return { stdout: JSON.stringify({ schema: "aethmere.local-init.v1", ok: true, created: true }) };
      if (command === "connect") return { stdout: JSON.stringify({ schema: "aethmere.local-connect.v1", ok: true, results: [] }) };
      throw new Error(`unexpected formal command: ${command}`);
    }

    async formalReady(args, options) {
      readyCalls.push({ args: [...args], options: { ...options } });
      if (args[0] === "get") {
        assert.equal(args.join(" "), "get --request-stdin --json");
        assert.deepEqual(JSON.parse(await options.requestFactory()), { id: "SAFE" });
        return { stdout: JSON.stringify({ schema: "aethmere.context-item.v1", ok: true, item: { id: "SAFE", title: "Safe title", text: "governed text", tags: [] } }) };
      }
      assert.equal(args.some((arg) => arg === "SAFE" || arg === "Safe title" || arg.includes("selected secret")), false);
      assert.equal(getTextCalls, 0);
      readyObserved = true;
      const request = JSON.parse(await options.requestFactory());
      assert.deepEqual(request, { id: "SAFE", title: "Safe title", text: "selected secret", tags: [], replace: false });
      return { stdout: JSON.stringify({ schema: "aethmere.local-add.v1", ok: true, item: { ...request, updated_at: "" } }) };
    }
  }

  const emitter = class {
    constructor() { this.event = () => undefined; }
    fire() {}
  };
  const document = {
    get fileName() { throw new Error("filename must not be read before governance"); },
    getText() {
      assert.equal(readyObserved, true);
      getTextCalls += 1;
      return " selected secret ";
    },
  };
  const vscodeMock = {
    EventEmitter: emitter,
    ThemeIcon: class { constructor(id) { this.id = id; } },
    TreeItem: class { constructor(label) { this.label = label; } },
    Uri: { parse: (value) => ({ value }) },
    commands: {
      registerCommand(id, handler) {
        commandHandlers.set(id, handler);
        return { dispose() {} };
      },
    },
    env: {
      openExternal: async (uri) => opened.push(uri.value),
    },
    window: {
      activeTextEditor: { document, selection: { start: 0, end: 1 } },
      registerTreeDataProvider(_id, value) {
        provider = value;
        return { dispose() {} };
      },
      showErrorMessage: async (value) => messages.error.push(value),
      showInformationMessage: async (value) => messages.info.push(value),
      showInputBox: async () => promptAnswers.shift(),
      showTextDocument: async (value) => opened.push(value),
      showWarningMessage: async (value) => {
        messages.warning.push(value);
        return undefined;
      },
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "C:\\workspace-$()" } }],
      openTextDocument: async (value) => value,
    },
  };

  const runnerPath = require.resolve("../lib/agent-runner.js");
  const governancePath = require.resolve("../lib/governance-client.js");
  const extensionPath = require.resolve("../extension.js");
  const actualRunner = require(runnerPath);
  const actualGovernance = require(governancePath);
  const oldRunnerCache = require.cache[runnerPath];
  const oldGovernanceCache = require.cache[governancePath];
  const oldLoad = Module._load;
  require.cache[runnerPath] = {
    id: runnerPath,
    filename: runnerPath,
    loaded: true,
    exports: { ...actualRunner, AgentRunner: FakeAgentRunner },
    children: [],
    paths: [],
  };
  require.cache[governancePath] = {
    id: governancePath,
    filename: governancePath,
    loaded: true,
    exports: {
      ...actualGovernance,
      createVscodeGovernance() {
        return {
          async run(stepCode, action) {
            governanceCalls.push(stepCode);
            return action();
          },
        };
      },
    },
    children: [],
    paths: [],
  };
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "vscode") return vscodeMock;
    return oldLoad.call(this, request, parent, isMain);
  };
  delete require.cache[extensionPath];
  try {
    const extension = require(extensionPath);
    const subscriptions = [];
    extension.activate({ extensionPath: require("node:path").resolve(__dirname, ".."), subscriptions: { push: (...items) => subscriptions.push(...items) } });
    assert.ok(provider);
    assert.deepEqual([...commandHandlers.keys()].sort(), [
      "aethmere.checkSetup",
      "aethmere.connectClients",
      "aethmere.initialize",
      "aethmere.openContext",
      "aethmere.openDownloads",
      "aethmere.refresh",
      "aethmere.saveSelection",
    ]);

    await provider.getChildren();
    const governanceBeforeInitialize = governanceCalls.length;
    await commandHandlers.get("aethmere.initialize")();
    assert.deepEqual(governanceCalls.slice(governanceBeforeInitialize), ["LOCAL_CANDIDATE_READY"], "initialize must not reacquire VS Code governance inside its existing lock");
    await commandHandlers.get("aethmere.saveSelection")();
    await commandHandlers.get("aethmere.openContext")("SAFE");
    await commandHandlers.get("aethmere.refresh")();
    await commandHandlers.get("aethmere.connectClients")();
    const readyBeforeCancellation = readyCalls.length;
    const errorsBeforeCancellation = messages.error.length;
    await commandHandlers.get("aethmere.saveSelection")();
    assert.equal(readyCalls.length, readyBeforeCancellation);
    assert.equal(messages.error.length, errorsBeforeCancellation, "user cancellation must remain silent");

    const formalCount = formalCalls.length;
    await commandHandlers.get("aethmere.checkSetup")();
    await commandHandlers.get("aethmere.openDownloads")();
    assert.equal(formalCalls.length, formalCount);
    assert.equal(readyCalls.length, 2);
    assert.equal(getTextCalls, 1);
    assert.equal(readyCalls[0].args.join(" "), "add --request-stdin --json");
    assert.equal(readyCalls[1].args.join(" "), "get --request-stdin --json");
    assert.equal(opened.includes("https://aethmere.com/downloads/"), true);
    assert.deepEqual(governanceCalls, [
      "MEMORY_RECALL",
      "LOCAL_CANDIDATE_READY",
      "LOCAL_CANDIDATE_READY",
      "MEMORY_GET",
      "MEMORY_RECALL",
      "GOVERNANCE_CONNECT",
      "LOCAL_CANDIDATE_READY",
    ]);
    assert.deepEqual(messages.error, []);
    assert.ok(subscriptions.length >= commandHandlers.size + 1);
  } finally {
    Module._load = oldLoad;
    delete require.cache[extensionPath];
    if (oldRunnerCache) require.cache[runnerPath] = oldRunnerCache;
    else delete require.cache[runnerPath];
    if (oldGovernanceCache) require.cache[governancePath] = oldGovernanceCache;
    else delete require.cache[governancePath];
  }
});
