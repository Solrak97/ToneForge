#!/usr/bin/env node
/**
 * One chat turn against a local Cursor agent, spawned by the ToneForge app.
 *
 * stdin:  one JSON request
 *   { prompt, agentId?, apiKey, model, cwd, mcpServerScript, toneforgeApiUrl }
 * stdout: newline-delimited JSON events
 *   { type: "agent", agentId }
 *   { type: "text", text }
 *   { type: "tool", name, status, args, result }
 *   { type: "done", status, result, error?, agentId }
 *   { type: "error", message, retryable }
 */

import { Agent, CursorAgentError } from "@cursor/sdk";

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

async function readRequest() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function agentOptions(req) {
  return {
    apiKey: req.apiKey,
    model: { id: req.model },
    local: { cwd: req.cwd },
    // No built-in file/shell tools: the agent may only act through ToneForge.
    tools: [],
    // Inline MCP servers are not persisted across resume, so they are passed every turn.
    mcpServers: {
      toneforge: {
        type: "stdio",
        command: process.execPath,
        args: [req.mcpServerScript],
        env: { TONEFORGE_MCP_URL: req.toneforgeApiUrl },
      },
    },
  };
}

async function openAgent(req) {
  const options = agentOptions(req);
  if (req.agentId) {
    try {
      return await Agent.resume(req.agentId, options);
    } catch (err) {
      process.stderr.write(`[cursor-agent] resume failed, starting fresh: ${err?.message ?? err}\n`);
    }
  }
  return Agent.create(options);
}

function toolLabel(event) {
  const args = event.args && typeof event.args === "object" ? event.args : {};
  return args.toolName ?? args.tool_name ?? event.name;
}

function errorMessage(error) {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  return error.message ?? JSON.stringify(error);
}

async function main() {
  const req = await readRequest();
  let agent;
  try {
    agent = await openAgent(req);
    emit({ type: "agent", agentId: agent.agentId });

    const run = await agent.send(req.prompt);
    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) emit({ type: "text", text: block.text });
        }
      } else if (event.type === "tool_call" && event.status !== "running") {
        emit({
          type: "tool",
          name: toolLabel(event),
          status: event.status,
          args: event.args ?? null,
          result: event.result ?? null,
        });
      }
    }

    const result = await run.wait();
    emit({
      type: "done",
      status: result.status,
      result: result.result ?? "",
      error: errorMessage(result.error),
      agentId: agent.agentId,
    });
  } catch (err) {
    emit({
      type: "error",
      message: err?.message ?? String(err),
      retryable: err instanceof CursorAgentError ? err.isRetryable : false,
    });
    process.exitCode = 1;
  } finally {
    await agent?.[Symbol.asyncDispose]?.();
  }
}

main();
