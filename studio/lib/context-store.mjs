import fs from "node:fs";
import path from "node:path";

export const STORE_SCHEMA = "aethmere.local-context.v1";
export const ITEM_ID = /^[A-Z][A-Z0-9_-]{0,63}$/u;
const MAX_ITEMS = 100;
const MAX_TEXT = 20_000;

function projectRoot(root) {
  const resolved = path.resolve(String(root || ""));
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("请选择真实的项目文件夹");
  return resolved;
}

export function contextFile(root) {
  return path.join(projectRoot(root), ".aethmere", "context.json");
}

function assertSafeStorePath(file) {
  const directory = path.dirname(file);
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(".aethmere 必须是项目内的真实文件夹");
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error(".aethmere/context.json 不能是符号链接");
  }
}

function normalizeItem(input, index = 0) {
  const id = String(input?.id || "").trim().toUpperCase();
  const title = String(input?.title || "").trim();
  const text = String(input?.text || "").trim();
  const tags = Array.isArray(input?.tags)
    ? [...new Set(input.tags.map(String).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12)
    : String(input?.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
  if (!ITEM_ID.test(id)) throw new Error(`第 ${index + 1} 条上下文的 ID 无效`);
  if (!title || title.length > 160) throw new Error("标题需要 1–160 个字符");
  if (!text || text.length > MAX_TEXT) throw new Error("内容需要 1–20,000 个字符");
  if (tags.some((tag) => tag.length > 40)) throw new Error("单个标签不能超过 40 个字符");
  return { id, title, text, tags, updated_at: String(input?.updated_at || "") };
}

function normalizeStore(value) {
  if (!value || typeof value !== "object" || value.schema !== STORE_SCHEMA || !Array.isArray(value.items)) {
    throw new Error(`上下文文件必须使用 ${STORE_SCHEMA} 格式`);
  }
  if (value.items.length > MAX_ITEMS) throw new Error(`上下文最多保存 ${MAX_ITEMS} 条`);
  const seen = new Set();
  const items = value.items.map((item, index) => {
    const normalized = normalizeItem(item, index);
    if (seen.has(normalized.id)) throw new Error(`上下文 ID 重复：${normalized.id}`);
    seen.add(normalized.id);
    return normalized;
  });
  return { schema: STORE_SCHEMA, items };
}

export function readStore(root) {
  const file = contextFile(root);
  assertSafeStorePath(file);
  if (!fs.existsSync(file)) return { schema: STORE_SCHEMA, items: [] };
  return normalizeStore(JSON.parse(fs.readFileSync(file, "utf8")));
}

function writeStore(root, store) {
  const file = contextFile(root);
  assertSafeStorePath(file);
  const normalized = normalizeStore(store);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertSafeStorePath(file);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  return normalized;
}

export function saveItem(root, input) {
  const store = readStore(root);
  const item = normalizeItem({ ...input, updated_at: new Date().toISOString() });
  const index = store.items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0 && store.items.length >= MAX_ITEMS) throw new Error(`上下文最多保存 ${MAX_ITEMS} 条`);
  if (index >= 0) store.items[index] = item;
  else store.items.push(item);
  store.items.sort((left, right) => left.id.localeCompare(right.id));
  writeStore(root, store);
  return item;
}

export function removeItem(root, idValue) {
  const id = String(idValue || "").trim().toUpperCase();
  if (!ITEM_ID.test(id)) throw new Error("上下文 ID 无效");
  const store = readStore(root);
  const next = store.items.filter((item) => item.id !== id);
  if (next.length === store.items.length) throw new Error(`没有找到 ${id}`);
  writeStore(root, { schema: STORE_SCHEMA, items: next });
  return id;
}

export function getItem(root, idValue) {
  const id = String(idValue || "").trim().toUpperCase();
  if (!ITEM_ID.test(id)) throw new Error("上下文 ID 无效");
  const item = readStore(root).items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`没有找到 ${id}`);
  return item;
}

export function listSummaries(root) {
  return readStore(root).items.map(({ id, title, tags, updated_at: updatedAt }) => ({
    id,
    title,
    tags,
    updated_at: updatedAt,
  }));
}

export function selectedContext(root, idsValue) {
  const ids = Array.isArray(idsValue) ? [...new Set(idsValue.map(String).map((id) => id.trim().toUpperCase()))].slice(0, 6) : [];
  if (ids.some((id) => !ITEM_ID.test(id))) throw new Error("所选上下文 ID 无效");
  const byId = new Map(readStore(root).items.map((item) => [item.id, item]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`上下文已发生变化：${missing.join(", ")}`);
  return ids.map((id) => byId.get(id));
}
