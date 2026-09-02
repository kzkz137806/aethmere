"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function ensureUnredirectedDirectory(directory, { create = false } = {}) {
  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved)) {
    if (!create) return false;
    fs.mkdirSync(resolved, { mode: 0o700 });
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Aethmere 私有存储必须是真实目录。");
  return true;
}

function regularFileIdentity(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Aethmere 私有文件不是普通文件。");
  return { dev: stat.dev, ino: stat.ino };
}

function readBoundedRegularFileRecord(file, maximumBytes) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maximumBytes)) {
    throw new Error("Aethmere 私有文件不安全或超过大小上限。");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.size > BigInt(maximumBytes) || !sameFileIdentity(before, opened)) {
      throw new Error("Aethmere 私有文件在打开时发生变化。");
    }
    const output = Buffer.allocUnsafe(maximumBytes + 1);
    let total = 0;
    while (total <= maximumBytes) {
      const bytesRead = fs.readSync(descriptor, output, total, maximumBytes + 1 - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maximumBytes) throw new Error("Aethmere 私有文件超过大小上限。");
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(opened, after) || after.size !== BigInt(total)) throw new Error("Aethmere 私有文件在读取时发生变化。");
    return { bytes: output.subarray(0, total), identity: { dev: opened.dev, ino: opened.ino } };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readBoundedUtf8FileRecord(file, maximumBytes) {
  const record = readBoundedRegularFileRecord(file, maximumBytes);
  return {
    text: new TextDecoder("utf-8", { fatal: true }).decode(record.bytes),
    identity: record.identity,
  };
}

function fsyncDirectoryIfSupported(directory) {
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

function publishImmutableJson(finalFile, value, { candidateDirectory } = {}) {
  const parent = path.dirname(finalFile);
  ensureUnredirectedDirectory(parent, { create: true });
  const candidates = path.resolve(candidateDirectory || path.join(parent, ".candidates"));
  ensureUnredirectedDirectory(candidates, { create: true });
  const candidate = path.join(candidates, `candidate-${process.pid}-${crypto.randomUUID()}.json`);
  let candidateIdentity = null;
  let descriptor;
  try {
    descriptor = fs.openSync(candidate, "wx", 0o600);
    candidateIdentity = fs.fstatSync(descriptor, { bigint: true });
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try { fs.linkSync(candidate, finalFile); }
    catch (error) {
      if (error?.code === "EEXIST") return { created: false, identity: regularFileIdentity(finalFile) };
      throw error;
    }
    const published = regularFileIdentity(finalFile);
    if (!sameFileIdentity(candidateIdentity, published)) throw new Error("Aethmere immutable file identity verification failed.");
    fsyncDirectoryIfSupported(parent);
    return { created: true, identity: published };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (candidateIdentity && fs.existsSync(candidate)) {
      try {
        if (sameFileIdentity(candidateIdentity, regularFileIdentity(candidate))) fs.unlinkSync(candidate);
      } catch { /* Candidate cleanup cannot authorize changing a published file. */ }
    }
  }
}

function removeImmutableFile(file, expectedIdentity) {
  if (!fs.existsSync(file)) return false;
  const current = regularFileIdentity(file);
  if (!sameFileIdentity(current, expectedIdentity)) throw new Error("拒绝删除身份已变化的 immutable 文件。");
  fs.unlinkSync(file);
  fsyncDirectoryIfSupported(path.dirname(file));
  return true;
}

module.exports = {
  ensureUnredirectedDirectory,
  fsyncDirectoryIfSupported,
  publishImmutableJson,
  readBoundedRegularFileRecord,
  readBoundedUtf8FileRecord,
  regularFileIdentity,
  removeImmutableFile,
  sameFileIdentity,
};
