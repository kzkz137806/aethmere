import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readStore, removeItem, saveItem, selectedContext, STORE_SCHEMA } from "../lib/context-store.mjs";

test("stores only explicit local context and interoperates with the public schema", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aethmere-public-studio-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const saved = saveItem(root, { id: "project_goal", title: "项目目标", text: "只保存用户明确输入的内容", tags: "goal, public" });
  assert.equal(saved.id, "PROJECT_GOAL");
  assert.deepEqual(readStore(root), {
    schema: STORE_SCHEMA,
    items: [{ ...saved }],
  });
  assert.deepEqual(selectedContext(root, ["PROJECT_GOAL"]).map((item) => item.id), ["PROJECT_GOAL"]);
  const disk = JSON.parse(await readFile(path.join(root, ".aethmere", "context.json"), "utf8"));
  assert.equal(disk.schema, "aethmere.local-context.v1");
  removeItem(root, "PROJECT_GOAL");
  assert.equal(readStore(root).items.length, 0);
});

test("fails closed on symlinked stores, invalid IDs and missing selected context", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aethmere-public-studio-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.throws(() => saveItem(root, { id: "bad id", title: "x", text: "y" }), /ID/u);
  saveItem(root, { id: "SAFE", title: "safe", text: "safe" });
  assert.throws(() => selectedContext(root, ["MISSING"]), /发生变化/u);
  const other = await mkdtemp(path.join(os.tmpdir(), "aethmere-public-studio-target-"));
  t.after(() => rm(other, { recursive: true, force: true }));
  const linkedRoot = await mkdtemp(path.join(os.tmpdir(), "aethmere-public-studio-link-"));
  t.after(() => rm(linkedRoot, { recursive: true, force: true }));
  try {
    fs.symlinkSync(other, path.join(linkedRoot, ".aethmere"), "junction");
    assert.throws(() => readStore(linkedRoot), /真实文件夹/u);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  }
});
