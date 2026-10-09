import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { CardContent, CardHeader, CardTitle, PageCard } from "./ui/card";
import {
  agentCancel,
  agentChat,
  agentReset,
  getAgentSettings,
  subscribeAgentEvents,
} from "../lib/tauri-api";
import { useAgentStore } from "../stores/agent";
import { useToneForgeStore } from "../stores/toneforge";

/** `onOpenSettings` jumps to the Agent section of the Settings page. */
export function AgentPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const settings = useAgentStore((s) => s.settings);
  const messages = useAgentStore((s) => s.messages);
  const streaming = useAgentStore((s) => s.streaming);
  const error = useAgentStore((s) => s.error);
  const setSettings = useAgentStore((s) => s.setSettings);
  const addMessage = useAgentStore((s) => s.addMessage);
  const appendAssistantText = useAgentStore((s) => s.appendAssistantText);
  const setStreaming = useAgentStore((s) => s.setStreaming);
  const setError = useAgentStore((s) => s.setError);
  const clearMessages = useAgentStore((s) => s.clearMessages);

  const connection = useToneForgeStore((s) => s.connection);

  useEffect(() => {
    void getAgentSettings()
      .then(setSettings)
      .catch((err) => setError(String(err)));
  }, [setSettings, setError]);

  useEffect(() => {
    const unsub = subscribeAgentEvents({
      onToken: (payload) => {
        appendAssistantText(payload.text);
      },
      onTool: (payload) => {
        addMessage({
          id: `tool-${Date.now()}-${payload.name}`,
          role: "tool",
          content: payload.ok
            ? `${payload.name}: ${payload.result_summary}`
            : `${payload.name} failed: ${payload.result_summary}`,
          toolName: payload.name,
          toolOk: payload.ok,
        });
      },
      onDone: () => {
        setStreaming(false);
      },
      onError: (payload) => {
        setStreaming(false);
        if (payload.error !== "cancelled") {
          setError(payload.error);
        }
      },
    });
    return unsub;
  }, [addMessage, appendAssistantText, setStreaming, setError]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    addMessage({ id: `u-${Date.now()}`, role: "user", content: text });
    setStreaming(true);

    const history = [
      ...messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    try {
      await agentChat(history);
    } catch (err) {
      setError(String(err));
      setStreaming(false);
    }
  }

  function handleClear() {
    clearMessages();
    void agentReset().catch((err) => setError(String(err)));
  }

  return (
    <PageCard>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Tone Agent</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            {settings?.mode === "cursor"
              ? `Cursor agent (${settings.cursor_model}) with ToneForge tools.`
              : "Local-first LLM with cloud fallback. Tools drive the amp via localhost API."}
            {connection?.connected
              ? ` Connected: ${connection.port_name ?? "amp"}`
              : " Not connected"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onOpenSettings}>
            Settings
          </Button>
          <Button variant="ghost" onClick={handleClear} disabled={streaming}>
            Clear
          </Button>
          {streaming && (
            <Button variant="danger" onClick={() => void agentCancel()}>
              Cancel
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          {messages.length === 0 && (
            <p className="text-sm text-zinc-500">
              Ask for a tone — e.g. “post-rock like God Is An Astronaut” or “Comfortably Numb solo,
              quieter.”
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "ml-8 rounded-lg bg-orange-500/15 border border-orange-500/30 px-3 py-2 text-sm text-zinc-100"
                  : m.role === "tool"
                    ? "rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1.5 text-xs font-mono text-zinc-400"
                    : "mr-8 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 whitespace-pre-wrap"
              }
            >
              {m.role === "tool" && (
                <span
                  className={
                    m.toolOk === false ? "text-red-400 mr-2" : "text-emerald-400 mr-2"
                  }
                >
                  {m.toolOk === false ? "✗" : "✓"}
                </span>
              )}
              {m.content}
            </div>
          ))}
          {streaming && (
            <p className="text-xs text-zinc-500 animate-pulse">Agent working…</p>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <p className="text-xs text-red-400 break-words">{error}</p>
        )}

        <div className="flex gap-2">
          <textarea
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm min-h-[44px] max-h-32"
            placeholder="Describe the tone you want…"
            value={input}
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <Button onClick={() => void handleSend()} disabled={streaming || !input.trim()}>
            Send
          </Button>
        </div>
      </CardContent>
    </PageCard>
  );
}
