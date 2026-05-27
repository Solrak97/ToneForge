import { create } from "zustand";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface DebugLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  target: string;
  message: string;
}

const MAX_ENTRIES = 500;

interface DebugLogStore {
  entries: DebugLogEntry[];
  expanded: boolean;
  logFilePath: string | null;
  append: (entry: Omit<DebugLogEntry, "id">) => void;
  clear: () => void;
  setExpanded: (expanded: boolean) => void;
  setLogFilePath: (path: string | null) => void;
}

let entryCounter = 0;

export const useDebugLogStore = create<DebugLogStore>((set) => ({
  entries: [],
  expanded: true,
  logFilePath: null,
  append: (entry) =>
    set((state) => {
      const next: DebugLogEntry = {
        ...entry,
        id: `${Date.now()}-${entryCounter++}`,
      };
      const entries = [...state.entries, next].slice(-MAX_ENTRIES);
      return { entries };
    }),
  clear: () => set({ entries: [] }),
  setExpanded: (expanded) => set({ expanded }),
  setLogFilePath: (logFilePath) => set({ logFilePath }),
}));
