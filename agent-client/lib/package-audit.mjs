import path from "node:path";
import { isBuiltin } from "node:module";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";

const PARSER = `import fs from 'node:fs'; import vm from 'node:vm';
const files=JSON.parse(fs.readFileSync(0,'utf8'));const result=[];
for(const file of files){try{if(file.name.endsWith('.cjs')){new vm.Script('(function(require,module,exports){'+file.source+'\\n})');result.push({name:file.name,specifiers:[]});}
else{const module=new vm.SourceTextModule(file.source);result.push({name:file.name,specifiers:[...module.dependencySpecifiers]});}}
catch{result.push({name:file.name,error:'runtime source does not parse'});}}
process.stdout.write(JSON.stringify(result));`;

// Only call expressions need lexical inspection: static ESM is parsed by V8.
// Strings, comments and regular-expression literals are not executable calls.
function callImports(source) {
  const tokens = [];
  let index = 0;
  let regexAllowed = true;
  function scan(templateExpression = false) {
    let braces = 0;
    while (index < source.length) {
      const char = source[index];
      if (/\s/u.test(char)) { index++; continue; }
      if (source.startsWith("//", index)) { index = source.indexOf("\n", index); if (index < 0) index = source.length; continue; }
      if (source.startsWith("/*", index)) { const end = source.indexOf("*/", index + 2); index = end < 0 ? source.length : end + 2; continue; }
      if (char === '"' || char === "'") {
        const start = ++index;
        while (index < source.length && source[index] !== char) { if (source[index] === "\\") index++; index++; }
        const raw = source.slice(start, index++);
        const value = raw.replace(/\\(?:u([a-f0-9]{4})|x([a-f0-9]{2})|(.))/giu, (_, unicode, hex, escaped) => unicode || hex ? String.fromCodePoint(Number.parseInt(unicode || hex, 16)) : ({ n: "\n", r: "\r", t: "\t" }[escaped] ?? escaped));
        tokens.push({ type: "string", value }); regexAllowed = false; continue;
      }
      if (char === "`") {
        index++;
        while (index < source.length) {
          if (source[index] === "\\") { index += 2; continue; }
          if (source[index] === "`") { index++; break; }
          if (source.startsWith("${", index)) { index += 2; regexAllowed = true; scan(true); continue; }
          index++;
        }
        regexAllowed = false; continue;
      }
      if (char === "/" && regexAllowed) {
        index++; let inClass = false;
        while (index < source.length) {
          const next = source[index++];
          if (next === "\\") { index++; continue; }
          if (next === "[") inClass = true;
          if (next === "]") inClass = false;
          if (next === "/" && !inClass) break;
        }
        while (/[a-z]/iu.test(source[index] || "")) index++;
        regexAllowed = false; continue;
      }
      if (/[A-Za-z_$]/u.test(char)) {
        const start = index++;
        while (/[A-Za-z0-9_$]/u.test(source[index] || "")) index++;
        const value = source.slice(start, index);
        tokens.push({ type: "word", value });
        regexAllowed = /^(?:return|throw|case|delete|void|typeof|new|yield|await)$/u.test(value); continue;
      }
      if (char === "}") {
        if (templateExpression && braces === 0) { index++; return; }
        braces--;
      }
      if (char === "{") braces++;
      tokens.push({ type: "punctuation", value: char });
      regexAllowed = /[=({\[,;:!?&|+*%~^<>-]/u.test(char);
      index++;
    }
  }
  scan();
  const specifiers = [];
  let nonliteral = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "word" || !["import", "require"].includes(token.value) || tokens[i - 1]?.value === "." || tokens[i + 1]?.value !== "(") continue;
    if (tokens[i + 2]?.type === "string" && [")", ","].includes(tokens[i + 3]?.value)) specifiers.push(tokens[i + 2].value);
    else nonliteral = true;
  }
  return { specifiers, nonliteral };
}

export function extractPackageEntries(buffer) {
  const tar = gunzipSync(buffer, { maxOutputLength: 8 * 1024 * 1024 });
  const entries = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) {
      if (!tar.subarray(offset).every(value => value === 0)) throw new Error("nonzero trailing tar payload");
      return entries;
    }
    const field = (start, end) => header.subarray(start, end).toString("utf8").replace(/\0.*$/u, "");
    const octal = (start, end) => {
      const value = field(start, end).trim();
      if (!/^[0-7]+$/u.test(value)) throw new Error("invalid tar integer");
      return Number.parseInt(value, 8);
    };
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (octal(148, 156) !== checksum) throw new Error("invalid tar header checksum");
    const prefix = field(345, 500);
    const name = (prefix ? prefix + "/" : "") + field(0, 100);
    const size = octal(124, 136);
    const end = offset + 512 + size;
    if (end > tar.length) throw new Error("truncated package tar entry");
    const type = field(156, 157);
    if (type !== "0" && type !== "") throw new Error("package must contain regular files only: " + name);
    if (!name.startsWith("package/") || name.split("/").some(part => !part || part === "." || part === "..") || name.includes("\\")) throw new Error("unsafe package tar path");
    entries.push({ name, mode: octal(100, 108), data: Buffer.from(tar.subarray(offset + 512, end)) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("package tar terminator is missing");
}

// Audit the bytes being shipped, rather than the larger source checkout.
// V8 parses static ESM; literal dynamic imports/require are tokenized separately.
// Unresolved dynamic call inputs refuse release. Installed-entry smoke tests
// also cover the shipped runtime and process paths.
export function auditPackageDependencyClosure(entries) {
  const files = new Map();
  const issues = [];
  for (const entry of entries) {
    const name = String(entry.name || "").replaceAll("\\", "/");
    if (!name || name.startsWith("/") || name.split("/").some(p => !p || p === ".." || p === ".") || files.has(name)) {
      issues.push({ code: "unsafe-package-entry", path: name });
      continue;
    }
    files.set(name, Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || "")));
  }
  let manifest = {};
  try { manifest = JSON.parse(files.get("package/package.json")?.toString("utf8") || "{}"); }
  catch { issues.push({ code: "invalid-package-manifest", path: "package/package.json" }); }
  const declared = new Set(Object.keys(manifest.dependencies || {}).concat(Object.keys(manifest.optionalDependencies || {})));
  const references = [];
  const sources = [...files].filter(([name]) => /\.(?:mjs|cjs|js)$/u.test(name)).map(([name, data]) => ({ name, source: data.toString("utf8") }));
  const parsed = spawnSync(process.execPath, ["--experimental-vm-modules", "--input-type=module", "-e", PARSER], {
    input: JSON.stringify(sources), encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (parsed.error || parsed.status !== 0) return { schema: "aethmere.package-dependency-closure.v1", ok: false, files: files.size, references, issues: [...issues, { code: "package-source-parser-failed" }] };
  const imports = new Map(JSON.parse(parsed.stdout).map(entry => [entry.name, entry]));
  for (const [name, data] of files) {
    if (!/\.(?:mjs|cjs|js)$/u.test(name)) continue;
    const source = data.toString("utf8");
    const module = imports.get(name);
    if (!module || module.error) { issues.push({ code: "invalid-runtime-source", path: name }); continue; }
    const calls = callImports(source);
    if (calls.nonliteral) issues.push({ code: "nonliteral-runtime-import", path: name });
    const specifiers = new Set([...module.specifiers, ...calls.specifiers]);
    for (const specifier of specifiers) {
      if (isBuiltin(specifier)) continue;
      if (specifier.startsWith(".")) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
        references.push({ file: name, specifier, target });
        if (!target.startsWith("package/") || !files.has(target)) issues.push({ code: "missing-package-import", path: name, specifier, target });
      } else {
        const dependency = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
        references.push({ file: name, specifier, dependency });
        if (!declared.has(dependency)) issues.push({ code: "undeclared-package-import", path: name, specifier });
      }
    }
  }
  return { schema: "aethmere.package-dependency-closure.v1", ok: issues.length === 0, files: files.size, references, issues };
}
