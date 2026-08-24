import fs from "node:fs";
import path from "node:path";

export const STORE_SCHEMA = "aethmere.local-context.v1";
export const ITEM_ID = /^[A-Z][A-Z0-9_-]{0,63}$/u;

export function projectRoot(rootArg = ".") {
  return path.resolve(String(rootArg || "."));
}

export function contextFile(rootArg = ".") {
  return path.join(projectRoot(rootArg), ".aethmere", "context.json");
}

function emptyStore() {
  return { schema: STORE_SCHEMA, items: [] };
}

function assertSafeContextPath(file) {
  const directory = path.dirname(file);
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(".aethmere must be a real directory inside the selected project");
    }
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error(".aethmere/context.json must not be a symbolic link");
  }
}

function normalizeStore(value) {
  if (!value || typeof value !== "object" || value.schema !== STORE_SCHEMA || !Array.isArray(value.items)) {
    throw new Error(`context store must use schema ${STORE_SCHEMA}`);
  }
  const seen = new Set();
  const items = value.items.map((item, index) => {
    const id = String(item?.id || "").trim();
    const title = String(item?.title || "").trim();
    const text = String(item?.text || "").trim();
    const tags = Array.isArray(item?.tags) ? [...new Set(item.tags.map(String).map((tag) => tag.trim()).filter(Boolean))] : [];
    if (!ITEM_ID.test(id)) throw new Error(`items[${index}].id is invalid`);
    if (seen.has(id)) throw new Error(`duplicate context id: ${id}`);
    if (!title || title.length > 160) throw new Error(`items[${index}].title must contain 1-160 characters`);
    if (!text || text.length > 20_000) throw new Error(`items[${index}].text must contain 1-20000 characters`);
    seen.add(id);
    return { id, title, text, tags, updated_at: String(item?.updated_at || "") };
  });
  return { schema: STORE_SCHEMA, items };
}

export function readStore(rootArg = ".") {
  const file = contextFile(rootArg);
  assertSafeContextPath(file);
  if (!fs.existsSync(file)) return emptyStore();
  return normalizeStore(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writeStore(rootArg, value) {
  const file = contextFile(rootArg);
  assertSafeContextPath(file);
  const normalized = normalizeStore(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertSafeContextPath(file);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  return { file, store: normalized };
}

export function initializeStore(rootArg = ".") {
  const file = contextFile(rootArg);
  if (fs.existsSync(file)) return { created: false, file, store: readStore(rootArg) };
  const written = writeStore(rootArg, emptyStore());
  return { created: true, ...written };
}

export function addItem(rootArg, input, options = {}) {
  const store = readStore(rootArg);
  const id = String(input?.id || "").trim().toUpperCase();
  const title = String(input?.title || "").trim();
  const text = String(input?.text || "").trim();
  const tags = Array.isArray(input?.tags) ? input.tags : [];
  if (!ITEM_ID.test(id)) throw new Error("id must start with A-Z and contain only A-Z, 0-9, _ or - (maximum 64 characters)");
  if (!title || title.length > 160) throw new Error("title must contain 1-160 characters");
  if (!text || text.length > 20_000) throw new Error("text must contain 1-20000 characters");
  const index = store.items.findIndex((item) => item.id === id);
  if (index >= 0 && !options.replace) throw new Error(`context id already exists: ${id}; pass --replace to update it`);
  const item = { id, title, text, tags, updated_at: new Date().toISOString() };
  if (index >= 0) store.items[index] = item;
  else store.items.push(item);
  store.items.sort((a, b) => a.id.localeCompare(b.id));
  writeStore(rootArg, store);
  return { replaced: index >= 0, item };
}

export function removeItem(rootArg, idArg) {
  const id = String(idArg || "").trim().toUpperCase();
  if (!ITEM_ID.test(id)) throw new Error("a valid --id is required");
  const store = readStore(rootArg);
  const next = store.items.filter((item) => item.id !== id);
  if (next.length === store.items.length) throw new Error(`context id not found: ${id}`);
  writeStore(rootArg, { ...store, items: next });
  return { removed: id };
}

export function listItems(rootArg = ".", queryArg = "", limitArg = 50) {
  const query = String(queryArg || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(100, Number(limitArg) || 50));
  return readStore(rootArg).items
    .filter((item) => !query || [item.id, item.title, item.text, ...item.tags].join("\n").toLowerCase().includes(query))
    .slice(0, limit)
    .map(({ id, title, tags, updated_at }) => ({ id, title, tags, updated_at }));
}

export function getItem(rootArg, idArg) {
  const id = String(idArg || "").trim().toUpperCase();
  if (!ITEM_ID.test(id)) throw new Error("a valid context id is required");
  const item = readStore(rootArg).items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`context id not found: ${id}`);
  return item;
}

export function checkEvidence(rootArg, idsArg) {
  const ids = Array.isArray(idsArg) ? idsArg.map(String).map((id) => id.trim().toUpperCase()).filter(Boolean) : [];
  const visible = new Set(readStore(rootArg).items.map((item) => item.id));
  const invalid = ids.filter((id) => !ITEM_ID.test(id));
  const missing = ids.filter((id) => ITEM_ID.test(id) && !visible.has(id));
  const duplicate = ids.filter((id, index) => ids.indexOf(id) !== index);
  return {
    ok: invalid.length === 0 && missing.length === 0 && duplicate.length === 0,
    requested: ids,
    invalid: [...new Set(invalid)],
    missing: [...new Set(missing)],
    duplicate: [...new Set(duplicate)],
  };
}
