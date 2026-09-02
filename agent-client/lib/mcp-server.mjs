import { checkEvidence, getItem, listItems, projectRoot, readStore } from "./store.mjs";
import { runGovernedCapability } from "./governance-client.mjs";

const PROTOCOL = "2024-11-05";
const CLIENT_VERSION = "0.12.0";

const TOOLS = [
  {
    name: "aethmere_context_list",
    description: "List user-saved context IDs and titles after a live Aethmere governance acknowledgement.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional plain-text filter." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "aethmere_context_get",
    description: "Read one user-saved local context item by exact ID after a live governance acknowledgement.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "aethmere_evidence_check",
    description: "Check local context evidence IDs after a live governance acknowledgement.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, maxItems: 100 } },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "aethmere_status",
    description: "Report whether the local context store is readable after a live governance acknowledgement.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const GOVERNED_TOOL_STEPS = Object.freeze({
  aethmere_context_list: "MEMORY_RECALL",
  aethmere_context_get: "MEMORY_GET",
  aethmere_evidence_check: "MEMORY_GET",
  aethmere_status: "CLIENT_START",
});

function result(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError };
}

function callTool(root, name, args = {}) {
  if (name === "aethmere_context_list") {
    return result({ schema: "aethmere.context-list.v1", items: listItems(root, args.query, args.limit) });
  }
  if (name === "aethmere_context_get") {
    return result({ schema: "aethmere.context-item.v1", item: getItem(root, args.id) });
  }
  if (name === "aethmere_evidence_check") {
    return result({ schema: "aethmere.evidence-check.v1", ...checkEvidence(root, args.ids) });
  }
  if (name === "aethmere_status") {
    return result({
      schema: "aethmere.governed-local-status.v1",
      ok: true,
      items: readStore(root).items.length,
      governance_required: true,
    });
  }
  throw new Error("unknown tool: " + name);
}

export async function callToolGoverned(root, name, args = {}, { home } = {}) {
  const stepCode = GOVERNED_TOOL_STEPS[name];
  if (!stepCode) throw new Error("unknown tool: " + name);
  return runGovernedCapability({
    home,
    clientKind: "agent_client",
    clientVersion: CLIENT_VERSION,
    stepCode,
  }, () => callTool(root, name, args));
}

function response(id, value) {
  return { jsonrpc: "2.0", id, result: value };
}

function failure(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handle(root, message) {
  const { id, method, params } = message || {};
  if (method === "initialize") {
    return response(id, {
      protocolVersion: params?.protocolVersion || PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: "aethmere-governed", version: CLIENT_VERSION },
    });
  }
  if (method === "notifications/initialized") return null;
  if (method === "ping") return response(id, {});
  if (method === "tools/list") return response(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      return response(id, await callToolGoverned(root, params?.name, params?.arguments || {}));
    } catch (error) {
      return response(id, result({
        ok: false,
        code: error.code || "CAPABILITY_FAILED",
        error: error.message,
      }, true));
    }
  }
  return failure(id, -32601, "method not found: " + method);
}

export function runMcpServer(rootArg = ".", input = process.stdin, output = process.stdout) {
  const root = projectRoot(rootArg);
  let buffer = "";
  let queue = Promise.resolve();
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      queue = queue.then(async () => {
        let reply;
        try {
          reply = await handle(root, JSON.parse(line));
        } catch (error) {
          reply = failure(null, -32700, error.message);
        }
        if (reply) output.write(JSON.stringify(reply) + "\n");
      });
    }
  });
}
