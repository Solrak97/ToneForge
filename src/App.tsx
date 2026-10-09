import { useEffect, useRef, useState } from "react";
import { ConnectionModal, ConnectionStatusButton } from "./components/ConnectionPanel";
import { AgentPanel } from "./components/AgentPanel";
import { ChannelSelector } from "./components/ChannelSelector";
import { Button } from "./components/ui/button";
import { IconButton, SettingsIcon } from "./components/ui/icons";
import { CardHeader, CardTitle, PageCard, PageCardContent } from "./components/ui/card";
import { DebugLogPanel } from "./components/DebugLogPanel";
import { PatchEditor } from "./components/PatchEditor";
import { SettingsPanel } from "./components/SettingsPanel";
import { ToneLibraryPanel } from "./components/ToneLibraryPanel";
import {
  subscribeDeviceEvents,
  getConnectionStatus,
  getCachedPatch,
  readPatch,
  listEditableParams,
  listChannels,
  getLogPath,
} from "./lib/tauri-api";
import { useToneForgeStore } from "./stores/toneforge";
import { useDebugLogStore } from "./stores/debugLog";
import { useDevModeStore } from "./stores/devMode";

function App() {
  const [nav, setNav] = useState<
    "editor" | "library" | "agent" | "midi" | "devices" | "settings"
  >("editor");

  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const startupConnectionPrompted = useRef(false);

  const setConnection = useToneForgeStore((s) => s.setConnection);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setParams = useToneForgeStore((s) => s.setParams);
  const setChannels = useToneForgeStore((s) => s.setChannels);
  const setError = useToneForgeStore((s) => s.setError);
  const appendLog = useDebugLogStore((s) => s.append);
  const setLogFilePath = useDebugLogStore((s) => s.setLogFilePath);
  const debugLogVisible = useDebugLogStore((s) => s.visible);
  const devMode = useDevModeStore((s) => s.enabled);
  const loadDevMode = useDevModeStore((s) => s.load);

  useEffect(() => {
    void loadDevMode().catch(() => undefined);
  }, [loadDevMode]);

  useEffect(() => {
    if (!devMode && (nav === "agent" || nav === "midi" || nav === "devices")) setNav("editor");
  }, [devMode, nav]);

  useEffect(() => {
    void listEditableParams().then(setParams).catch((err) => setError(String(err)));
    void listChannels().then(setChannels).catch(() => undefined);
    void getConnectionStatus()
      .then((status) => {
        setConnection(status);
        if (status.connected) {
          void getCachedPatch()
            .then((patch) => patch ?? readPatch())
            .then(setPatch)
            .catch((err) => setError(String(err)));
        }
        if (!startupConnectionPrompted.current) {
          startupConnectionPrompted.current = true;
          if (!status.connected) {
            setConnectionModalOpen(true);
          }
        }
      })
      .catch(() => undefined);
    void getLogPath().then(setLogFilePath).catch(() => undefined);

    const unsubscribe = subscribeDeviceEvents(
      (status, error) => {
        setConnection(status);
        if (error) setError(error);
      },
      (patch) => setPatch(patch),
      (entry) => appendLog(entry),
    );

    return unsubscribe;
  }, [setConnection, setPatch, setParams, setChannels, setError, appendLog, setLogFilePath]);

  return (
    <div className="flex h-screen flex-col gap-4 overflow-hidden p-4 md:p-6">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-orange-400">ToneForge</p>
          <h1 className="text-2xl font-semibold text-zinc-50">Katana Gen 3 Editor</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Connect, read, edit, and save patches locally or in your tone library.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConnectionStatusButton onClick={() => setConnectionModalOpen(true)} />
          <div className="flex items-center gap-2">
            {devMode && (
              <button
                type="button"
                onClick={() => setNav("settings")}
                className="inline-flex h-9 items-center rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 text-xs font-semibold tracking-wide text-amber-300 transition hover:bg-amber-500/20"
                title="Experimental mode is on. Open settings to turn it off."
                aria-label="Experimental mode is on"
              >
                EX
              </button>
            )}
            <ChannelSelector />
            <IconButton
              label="Settings"
              active={nav === "settings"}
              onClick={() => setNav(nav === "settings" ? "editor" : "settings")}
            >
              <SettingsIcon className="h-5 w-5" />
            </IconButton>
          </div>
        </div>
      </header>

      <ConnectionModal
        open={connectionModalOpen}
        onClose={() => setConnectionModalOpen(false)}
      />

      <div className="shrink-0">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 backdrop-blur-sm shadow-lg p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={nav === "editor" ? "secondary" : "ghost"} onClick={() => setNav("editor")}>
              Editor
            </Button>
            <Button variant={nav === "library" ? "secondary" : "ghost"} onClick={() => setNav("library")}>
              Library
            </Button>
            {devMode && (
              <>
                <Button variant={nav === "agent" ? "secondary" : "ghost"} onClick={() => setNav("agent")}>
                  Agent
                </Button>
                <Button variant={nav === "midi" ? "secondary" : "ghost"} onClick={() => setNav("midi")}>
                  MIDI / Assign
                </Button>
                <Button variant={nav === "devices" ? "secondary" : "ghost"} onClick={() => setNav("devices")}>
                  Devices
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <main className="flex min-h-0 flex-1 flex-col">
        {nav === "library" && <ToneLibraryPanel onOpenEditor={() => setNav("editor")} />}
        {nav === "editor" && <PatchEditor />}
        {nav === "agent" && <AgentPanel onOpenSettings={() => setNav("settings")} />}
        {nav === "midi" && <ComingSoon title="MIDI / Assign" />}
        {nav === "devices" && <ComingSoon title="Devices" />}
        {nav === "settings" && <SettingsPanel />}
      </main>

      {devMode && debugLogVisible && (
        <div className="shrink-0">
          <DebugLogPanel />
        </div>
      )}
    </div>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <PageCard>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <PageCardContent>
        <p className="text-xs text-zinc-500">Coming soon.</p>
      </PageCardContent>
    </PageCard>
  );
}

export default App;
