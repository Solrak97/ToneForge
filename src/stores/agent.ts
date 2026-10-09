import { create } from "zustand";
import type { AgentChatMessage, AgentSettings } from "../types/agent";

interface AgentState {
  settings: AgentSettings | null;
  messages: AgentChatMessage[];
  streaming: boolean;
  error: string | null;
  setSettings: (settings: AgentSettings) => void;
  addMessage: (message: AgentChatMessage) => void;
  appendAssistantText: (text: string) => void;
  setStreaming: (streaming: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  settings: null,
  messages: [],
  streaming: false,
  error: null,
  setSettings: (settings) => set({ settings }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  appendAssistantText: (text) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: last.content + text };
        return { messages: msgs };
      }
      msgs.push({
        id: `a-${Date.now()}`,
        role: "assistant",
        content: text,
      });
      return { messages: msgs };
    }),
  setStreaming: (streaming) => set({ streaming }),
  setError: (error) => set({ error }),
  clearMessages: () => set({ messages: [], error: null }),
}));
