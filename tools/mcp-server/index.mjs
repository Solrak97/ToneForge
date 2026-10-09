#!/usr/bin/env node
/**
 * ToneForge MCP server — exposes amp/tone control to Cursor and other MCP clients.
 *
 * Requires ToneForge desktop app running (starts localhost API on 127.0.0.1:17352).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL =
  process.env.TONEFORGE_MCP_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:17352";

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

function textResult(obj) {
  return {
    content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
  };
}

const server = new McpServer({
  name: "toneforge",
  version: "0.1.0",
});

server.tool(
  "toneforge_status",
  "Get ToneForge connection status (is the Katana connected?)",
  {},
  async () => {
    const data = await api("GET", "/status");
    return textResult(data);
  },
);

server.tool(
  "toneforge_list_devices",
  "List available MIDI devices (Katana ports)",
  {},
  async () => {
    const data = await api("GET", "/devices");
    return textResult(data);
  },
);

server.tool(
  "toneforge_connect",
  "Connect to a Katana MIDI port and read the current patch. Omit port_name to use the first device.",
  {
    port_name: z.string().optional().describe("MIDI port name, e.g. KATANA3"),
  },
  async ({ port_name }) => {
    const data = await api("POST", "/connect", { port_name: port_name ?? null });
    return textResult(data);
  },
);

server.tool(
  "toneforge_read_patch",
  "Read the current patch from the connected amp",
  {},
  async () => {
    const data = await api("POST", "/patch/read");
    return textResult(data);
  },
);

server.tool(
  "toneforge_get_patch",
  "Get the in-memory patch summary (last read or edited)",
  {},
  async () => {
    const data = await api("GET", "/patch");
    return textResult(data);
  },
);

server.tool(
  "toneforge_set_param",
  "Set a single amp parameter on the connected Katana. Use toneforge_list_params to find param IDs (e.g. patch_amp_gain, patch_sw_reverb_sw).",
  {
    param_id: z.string().describe("Parameter id from the address map"),
    value: z.number().int().describe("Parameter value"),
  },
  async ({ param_id, value }) => {
    const data = await api("POST", "/patch/param", { param_id, value });
    return textResult(data);
  },
);

server.tool(
  "toneforge_set_params",
  "Set multiple amp parameters at once. Keys are param IDs, values are numbers.",
  {
    params: z
      .record(z.number().int())
      .describe("Map of param_id -> value, e.g. { patch_amp_gain: 80, patch_sw_reverb_sw: 1 }"),
  },
  async ({ params }) => {
    const data = await api("POST", "/patch/params", { params });
    return textResult(data);
  },
);

server.tool(
  "toneforge_list_params",
  "Search the parameter catalog for valid param IDs and ranges",
  {
    q: z.string().optional().describe("Search query (id, label, group)"),
    limit: z.number().int().optional().describe("Max results (default 80)"),
  },
  async ({ q, limit }) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (limit != null) qs.set("limit", String(limit));
    const suffix = qs.toString() ? `?${qs}` : "";
    const data = await api("GET", `/params${suffix}`);
    return textResult(data);
  },
);

server.tool(
  "toneforge_list_channels",
  "List available amp channels (PANEL, CH1, CH2, …)",
  {},
  async () => {
    const data = await api("GET", "/channels");
    return textResult(data);
  },
);

server.tool(
  "toneforge_select_channel",
  "Switch the amp to a channel and read its patch",
  {
    channel: z.number().int().min(0).describe("Channel index (0 = PANEL)"),
  },
  async ({ channel }) => {
    const data = await api("POST", "/channel", { channel });
    return textResult(data);
  },
);

server.tool(
  "toneforge_list_library_tones",
  "List tones saved in the local ToneForge library",
  {
    query: z.string().optional().describe("Search by name or tag"),
  },
  async ({ query }) => {
    const qs = query ? `?query=${encodeURIComponent(query)}` : "";
    const data = await api("GET", `/library/tones${qs}`);
    return textResult(data);
  },
);

server.tool(
  "toneforge_load_library_tone",
  "Load a tone from the library and optionally send it to the amp",
  {
    id: z.number().int().optional().describe("Tone library id"),
    name: z.string().optional().describe("Tone name (if id not provided)"),
    write_to_device: z
      .boolean()
      .optional()
      .describe("Send to amp (default true). Set false to load into editor only."),
    channel: z
      .number()
      .int()
      .optional()
      .describe("Amp channel index to switch to before sending (default: current channel)"),
  },
  async ({ id, name, write_to_device, channel }) => {
    const data = await api("POST", "/library/load", {
      id: id ?? null,
      name: name ?? null,
      write_to_device: write_to_device ?? true,
      channel: channel ?? null,
    });
    return textResult(data);
  },
);

server.tool(
  "toneforge_save_library_tone",
  "Save the current patch into the ToneForge library",
  {
    name: z.string().describe("Tone name"),
    notes: z.string().optional().describe("Optional notes"),
    tags: z.array(z.string()).optional().describe("Optional tags"),
  },
  async ({ name, notes, tags }) => {
    const data = await api("POST", "/library/save", {
      name,
      notes: notes ?? "",
      tags: tags ?? [],
    });
    return textResult(data);
  },
);

server.tool(
  "toneforge_disconnect",
  "Disconnect from the Katana MIDI port",
  {},
  async () => {
    const data = await api("POST", "/disconnect", {});
    return textResult(data);
  },
);

async function main() {
  try {
    await api("GET", "/health");
  } catch {
    console.error(
      `[toneforge-mcp] Cannot reach ToneForge API at ${BASE_URL}. Start ToneForge first (npm run tauri dev).`,
    );
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[toneforge-mcp] Connected to ${BASE_URL}`);
}

main().catch((err) => {
  console.error("[toneforge-mcp]", err);
  process.exit(1);
});
