import { useEffect, useRef } from "react";
import { Button } from "./ui/button";
import { useDebugLogStore, type LogLevel } from "../stores/debugLog";

const LEVEL_COLORS: Record<LogLevel, string> = {
  trace: "text-zinc-500",
  debug: "text-zinc-400",
  info: "text-sky-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

export function DebugLogPanel() {
  const entries = useDebugLogStore((s) => s.entries);
  const expanded = useDebugLogStore((s) => s.expanded);
  const logFilePath = useDebugLogStore((s) => s.logFilePath);
  const clear = useDebugLogStore((s) => s.clear);
  const setExpanded = useDebugLogStore((s) => s.setExpanded);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, expanded]);

  return (
    <section className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium text-zinc-200"
          onClick={() => setExpanded(!expanded)}
        >
          <span>{expanded ? "▾" : "▸"}</span>
          Debug Log
          <span className="text-xs font-normal text-zinc-500">({entries.length})</span>
        </button>
        <div className="flex items-center gap-2">
          {logFilePath && (
            <span className="hidden text-xs text-zinc-500 md:inline" title={logFilePath}>
              {logFilePath}
            </span>
          )}
          <Button variant="secondary" onClick={clear}>
            Clear
          </Button>
        </div>
      </div>

      {expanded && (
        <div
          ref={scrollRef}
          className="max-h-56 overflow-y-auto p-2 font-mono text-xs leading-relaxed"
        >
          {entries.length === 0 ? (
            <p className="px-1 py-2 text-zinc-500">
              Logs from backend MIDI/IPC activity will appear here.
            </p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="whitespace-pre-wrap break-all px-1 py-0.5">
                <span className="text-zinc-600">{entry.timestamp}</span>{" "}
                <span className={LEVEL_COLORS[entry.level] ?? "text-zinc-400"}>
                  [{entry.level.toUpperCase()}]
                </span>{" "}
                <span className="text-zinc-500">{shortTarget(entry.target)}</span>{" "}
                <span className="text-zinc-200">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function shortTarget(target: string): string {
  return target
    .replace("toneforge_lib::", "")
    .replace("toneforge_devices::", "devices::")
    .replace("toneforge_core::", "core::");
}
