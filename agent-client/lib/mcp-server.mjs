import { checkEvidence, getItem, listItems, projectRoot, readStore } from "./store.mjs";

const PROTOCOL = "2024-11-05";

const TOOLS = [
  {
    name: "aethmere_context_list",
    description: "List user-saved context IDs and titles from this project. Data stays in the local project store.",
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
    description: "Read one user-saved local context item by its exact ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "aethmere_evidence_check",
    description: "Check that a set of context IDs exists in the current local store and contains no invalid or duplicate IDs.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, maxItems: 100 } },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "aethmere_status",
    description: "Report whether the local Aethmere context store is readable and how many items it contains.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function result(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError };
}

function callTool(root, name, args = {}) {
  if (name === "aethmere_context_list") return result({ schema: "aethmere.context-list.v1", items: listItems(root, args.query, args.limit) });
  if (name === "aethmere_context_get") return result({ schema: "aethmere.context-item.v1", item: getItem(root, args.id) });
  if (name === "aethmere_evidence_check") return result({ schema: "aethmere.evidence-check.v1", ...checkEvidence(root, args.ids) });
  if (name === "aethmere_status") return result({ schema: "aethmere.local-status.v1", ok: true, items: readStore(root).items.length, network: "disabled" });
  throw new Error(`unknown tool: ${name}`);
}

function response(id, value) {
  return { jsonrpc: "2.0", id, result: value };
}

function failure(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function handle(root, message) {
  const { id, method, params } = message || {};
  if (method === "initialize") {
    return response(id, { protocolVersion: params?.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "aethmere-local", version: "0.10.0" } });
  }
  if (method === "notifications/initialized") return null;
  if (method === "ping") return response(id, {});
  if (method === "tools/list") return response(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      return response(id, callTool(root, params?.name, params?.arguments || {}));
    } catch (error) {
      return response(id, result({ ok: false, error: error.message }, true));
    }
  }
  return failure(id, -32601, `method not found: ${method}`);
}

export function runMcpServer(rootArg = ".", input = process.stdin, output = process.stdout) {
  const root = projectRoot(rootArg);
  readStore(root);
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let reply;
      try {
        reply = handle(root, JSON.parse(line));
      } catch (error) {
        reply = failure(null, -32700, error.message);
      }
      if (reply) output.write(`${JSON.stringify(reply)}\n`);
    }
  });
}
