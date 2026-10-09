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
const VISIBLE_KEY = "toneforge.debugLogVisible";

interface DebugLogStore {
  entries: DebugLogEntry[];
  visible: boolean;
  expanded: boolean;
  logFilePath: string | null;
  append: (entry: Omit<DebugLogEntry, "id">) => void;
  clear: () => void;
  setVisible: (visible: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  setLogFilePath: (path: string | null) => void;
}

/** A patch read logs thousands of lines; rendering each one separately freezes the UI. */
const FLUSH_INTERVAL_MS = 100;

let entryCounter = 0;
let pending: DebugLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export const useDebugLogStore = create<DebugLogStore>((set) => ({
  entries: [],
  visible: localStorage.getItem(VISIBLE_KEY) !== "false",
  expanded: true,
  logFilePath: null,
  append: (entry) => {
    pending.push({ ...entry, id: `${Date.now()}-${entryCounter++}` });
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      const batch = pending.slice(-MAX_ENTRIES);
      pending = [];
      flushTimer = null;
      set((state) => ({ entries: [...state.entries, ...batch].slice(-MAX_ENTRIES) }));
    }, FLUSH_INTERVAL_MS);
  },
  clear: () => {
    pending = [];
    set({ entries: [] });
  },
  setVisible: (visible) => {
    localStorage.setItem(VISIBLE_KEY, String(visible));
    set({ visible });
  },
  setExpanded: (expanded) => set({ expanded }),
  setLogFilePath: (logFilePath) => set({ logFilePath }),
}));
