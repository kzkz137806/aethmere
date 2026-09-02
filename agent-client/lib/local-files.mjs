import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export function ensureUnredirectedDirectory(directory, { create = false } = {}) {
  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved)) {
    if (!create) return false;
    fs.mkdirSync(resolved, { mode: 0o700 });
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Aethmere private storage must be an unredirected directory.");
  }
  return true;
}

export function regularFileIdentity(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Aethmere private file is not a regular file.");
  }
  return { dev: stat.dev, ino: stat.ino };
}

export function readBoundedRegularFileRecord(file, maximumBytes) {
  const before = fs.lstatSync(file, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > BigInt(maximumBytes)
  ) {
    throw new Error("Aethmere private file is not a bounded regular file.");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile() ||
      opened.size > BigInt(maximumBytes) ||
      !sameFileIdentity(before, opened)
    ) {
      throw new Error("Aethmere private file identity changed while opening.");
    }
    const output = Buffer.allocUnsafe(maximumBytes + 1);
    let total = 0;
    while (total <= maximumBytes) {
      const read = fs.readSync(descriptor, output, total, maximumBytes + 1 - total, null);
      if (read === 0) break;
      total += read;
    }
    if (total > maximumBytes) throw new Error("Aethmere private file exceeded its byte limit.");
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(opened, after) || after.size !== BigInt(total)) {
      throw new Error("Aethmere private file changed while reading.");
    }
    return {
      bytes: output.subarray(0, total),
      identity: { dev: opened.dev, ino: opened.ino },
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function readBoundedRegularFile(file, maximumBytes) {
  return readBoundedRegularFileRecord(file, maximumBytes).bytes;
}

export function readBoundedUtf8File(file, maximumBytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(readBoundedRegularFile(file, maximumBytes));
}

export function readBoundedUtf8FileRecord(file, maximumBytes) {
  const record = readBoundedRegularFileRecord(file, maximumBytes);
  return {
    text: new TextDecoder("utf-8", { fatal: true }).decode(record.bytes),
    identity: record.identity,
  };
}

export function fsyncDirectoryIfSupported(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!new Set(["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"]).has(error?.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function publishImmutableJson(finalFile, value, { candidateDirectory } = {}) {
  const parent = path.dirname(finalFile);
  ensureUnredirectedDirectory(parent, { create: true });
  const candidates = path.resolve(candidateDirectory || path.join(parent, ".candidates"));
  ensureUnredirectedDirectory(candidates, { create: true });
  const candidate = path.join(candidates, "candidate-" + process.pid + "-" + crypto.randomUUID() + ".json");
  let candidateIdentity = null;
  let descriptor;
  try {
    descriptor = fs.openSync(candidate, "wx", 0o600);
    candidateIdentity = fs.fstatSync(descriptor, { bigint: true });
    fs.writeFileSync(descriptor, JSON.stringify(value) + "\n", "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try {
      fs.linkSync(candidate, finalFile);
    } catch (error) {
      if (error?.code === "EEXIST") {
        return { created: false, identity: regularFileIdentity(finalFile) };
      }
      throw error;
    }
    const published = regularFileIdentity(finalFile);
    if (!sameFileIdentity(candidateIdentity, published)) {
      throw new Error("Aethmere immutable file identity verification failed.");
    }
    fsyncDirectoryIfSupported(parent);
    return { created: true, identity: published };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (candidateIdentity && fs.existsSync(candidate)) {
      try {
        const current = regularFileIdentity(candidate);
        if (sameFileIdentity(candidateIdentity, current)) fs.unlinkSync(candidate);
      } catch {
        /* Candidate cleanup cannot authorize changing a published immutable file. */
      }
    }
  }
}

export function removeImmutableFile(file, expectedIdentity) {
  let current;
  try {
    current = regularFileIdentity(file);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!sameFileIdentity(current, expectedIdentity)) {
    throw new Error("Refusing to remove an immutable file whose identity changed.");
  }
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  fsyncDirectoryIfSupported(path.dirname(file));
  return true;
}
