#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const BARE_EVIDENCE_ID = /^[A-Z][A-Z0-9_-]{0,63}$/u;

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function option(args, name) {
  const exact = `--${name}`;
  const index = args.findIndex((arg) => arg === exact || arg.startsWith(`${exact}=`));
  if (index < 0) return "";
  if (args[index].startsWith(`${exact}=`)) return args[index].slice(exact.length + 1);
  return args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : "";
}

function printHelp() {
  console.log(`Aethmere public verification CLI ${packageJson.version}`);
  console.log("");
  console.log("Usage:");
  console.log("  aethmere doctor [--online] [--json]");
  console.log("  aethmere trial [--json]");
  console.log("  aethmere check --context context.json --answer answer.json [--expected E1,E2] [--json]");
  console.log("");
  console.log("The verification commands run locally. --online only fetches public release URLs.");
}

function normalizeEvidence(context) {
  const items = Array.isArray(context) ? context : context?.evidence;
  if (!Array.isArray(items)) throw new Error("context JSON must be an array or contain an evidence array");
  return items.map((item, index) => {
    if (typeof item === "string") return { id: item, text: "" };
    if (!item || typeof item !== "object") throw new Error(`context evidence[${index}] must be an object or ID string`);
    return { id: String(item.id || ""), text: String(item.text || "") };
  });
}

function validateCitationContract(context, answer, expected = []) {
  const errors = [];
  const evidence = normalizeEvidence(context);
  const visible = new Set();
  for (const item of evidence) {
    if (!BARE_EVIDENCE_ID.test(item.id)) errors.push({ code: "invalid-visible-id", id: item.id });
    if (visible.has(item.id)) errors.push({ code: "duplicate-visible-id", id: item.id });
    visible.add(item.id);
  }

  if (!answer || typeof answer !== "object") errors.push({ code: "invalid-answer-object" });
  if (!String(answer?.answer || "").trim()) errors.push({ code: "empty-answer" });
  const cited = Array.isArray(answer?.evidence_ids) ? answer.evidence_ids.map(String) : [];
  if (!Array.isArray(answer?.evidence_ids)) errors.push({ code: "missing-evidence-ids" });
  if (new Set(cited).size !== cited.length) errors.push({ code: "duplicate-citation" });
  for (const id of cited) {
    if (!BARE_EVIDENCE_ID.test(id)) errors.push({ code: "decorated-or-invalid-citation", id });
    else if (!visible.has(id)) errors.push({ code: "invisible-or-fabricated-citation", id });
  }
  if (expected.length) {
    const actual = [...new Set(cited)].sort();
    const wanted = [...new Set(expected)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      errors.push({ code: "expected-citation-set-mismatch", expected: wanted, actual });
    }
  }
  return { ok: errors.length === 0, visible_evidence: evidence.length, cited_evidence: cited.length, errors };
}

function runTrial(asJson) {
  const context = { evidence: [{ id: "E1", text: "The release date is 24 August." }, { id: "E2", text: "The CLI has zero dependencies." }] };
  const cases = [
    { name: "exact visible IDs", shouldPass: true, answer: { answer: "24 August; zero dependencies.", evidence_ids: ["E1", "E2"] }, expected: ["E1", "E2"] },
    { name: "missing required ID", shouldPass: false, answer: { answer: "24 August; zero dependencies.", evidence_ids: ["E1"] }, expected: ["E1", "E2"] },
    { name: "decorated ID", shouldPass: false, answer: { answer: "24 August.", evidence_ids: ["[E1]"] }, expected: ["E1"] },
    { name: "fabricated ID", shouldPass: false, answer: { answer: "Unknown claim.", evidence_ids: ["E9"] }, expected: [] },
  ];
  const results = cases.map((item) => {
    const report = validateCitationContract(context, item.answer, item.expected);
    return { name: item.name, expected: item.shouldPass ? "pass" : "reject", observed: report.ok ? "pass" : "reject", ok: report.ok === item.shouldPass, errors: report.errors };
  });
  const report = { schema: "aethmere.public-cli-trial.v1", ok: results.every((item) => item.ok), results };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("Aethmere strict evidence-ID public trial");
    for (const item of results) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}: expected ${item.expected}, observed ${item.observed}`);
    console.log("");
    console.log("This transparent trial tests the public citation contract, not semantic answer quality or the private runtime.");
  }
  return report.ok ? 0 : 1;
}

function readJsonOption(args, name) {
  const file = option(args, name);
  if (!file) throw new Error(`--${name} <file> is required`);
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function runCheck(args, asJson) {
  const context = readJsonOption(args, "context");
  const answer = readJsonOption(args, "answer");
  const expected = option(args, "expected").split(",").map((item) => item.trim()).filter(Boolean);
  const report = { schema: "aethmere.public-citation-check.v1", ...validateCitationContract(context, answer, expected) };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(report.ok ? "Citation contract: PASS" : "Citation contract: REJECT");
    for (const error of report.errors) console.log(`- ${error.code}${error.id ? `: ${error.id}` : ""}`);
    console.log("This check validates citation shape and visibility; it does not judge whether the prose is true.");
  }
  return report.ok ? 0 : 1;
}

async function fetchPublic(url) {
  const response = await fetch(url, { headers: { "user-agent": `aethmere-public-cli/${packageJson.version}` }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

async function runDoctor(asJson, online) {
  const checks = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", ok: major >= 20, detail: process.version });
  const dependencyFields = ["dependencies", "optionalDependencies", "peerDependencies"];
  const dependencyCount = dependencyFields.reduce((sum, field) => sum + Object.keys(packageJson[field] || {}).length, 0);
  checks.push({ name: "zero-dependency-package", ok: dependencyCount === 0, detail: `${dependencyCount} dependencies` });
  if (online) {
    try {
      const manifestBuffer = await fetchPublic("https://aethmere.com/downloads/latest.json");
      const manifest = JSON.parse(manifestBuffer.toString("utf8"));
      const filename = `aethmere-cli-${packageJson.version}.tgz`;
      const manifestOk = manifest.version === packageJson.version
        && manifest.filename === filename
        && /^[a-f0-9]{64}$/u.test(manifest.sha256)
        && manifest.official_url === `https://aethmere.com/downloads/${filename}`;
      checks.push({ name: "official-release-manifest", ok: manifestOk, detail: manifestOk ? `${filename} sha256:${manifest.sha256}` : "release manifest mismatch" });

      const official = await fetchPublic(manifest.official_url);
      const officialHash = crypto.createHash("sha256").update(official).digest("hex");
      checks.push({ name: "official-release", ok: officialHash === manifest.sha256, detail: `sha256:${officialHash}` });

      const github = await fetchPublic(manifest.github_url);
      const githubHash = crypto.createHash("sha256").update(github).digest("hex");
      checks.push({ name: "github-release", ok: githubHash === manifest.sha256, detail: `sha256:${githubHash}` });

      const checksumUrl = `https://github.com/kzkz137806/aethmere/releases/download/v${packageJson.version}/aethmere-cli-${packageJson.version}.sha256.txt`;
      const checksum = (await fetchPublic(checksumUrl)).toString("utf8");
      checks.push({ name: "github-checksum", ok: checksum === `${manifest.sha256}  ${filename}\n`, detail: `${Buffer.byteLength(checksum)} bytes` });
    } catch (error) {
      checks.push({ name: "public-release", ok: false, detail: error.message });
    }
  }
  const report = { schema: "aethmere.public-cli-doctor.v1", version: packageJson.version, online, ok: checks.every((item) => item.ok), checks };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Aethmere public CLI ${packageJson.version}`);
    for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.name}: ${item.detail}`);
    if (!online) console.log("Network checks skipped. Run `aethmere doctor --online` to verify the public website and GitHub release.");
  }
  return report.ok ? 0 : 1;
}

const [command = "help", ...args] = process.argv.slice(2);
const asJson = hasFlag(args, "json");

try {
  if (["--version", "-v", "version"].includes(command)) {
    console.log(`Aethmere CLI ${packageJson.version}`);
  } else if (["help", "--help", "-h"].includes(command)) {
    printHelp();
  } else if (command === "trial") {
    process.exitCode = runTrial(asJson);
  } else if (command === "check") {
    process.exitCode = runCheck(args, asJson);
  } else if (command === "doctor") {
    process.exitCode = await runDoctor(asJson, hasFlag(args, "online"));
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 2;
  }
} catch (error) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
  else console.error(`Aethmere ${command} failed: ${error.message}`);
  process.exitCode = 1;
}
