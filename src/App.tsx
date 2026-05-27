import { useEffect } from "react";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { DebugLogPanel } from "./components/DebugLogPanel";
import { PatchEditor } from "./components/PatchEditor";
import {
  subscribeDeviceEvents,
  getConnectionStatus,
  listEditableParams,
  listChannels,
  getLogPath,
} from "./lib/tauri-api";
import { useToneForgeStore } from "./stores/toneforge";
import { useDebugLogStore } from "./stores/debugLog";

function App() {
  const setConnection = useToneForgeStore((s) => s.setConnection);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setParams = useToneForgeStore((s) => s.setParams);
  const setChannels = useToneForgeStore((s) => s.setChannels);
  const setError = useToneForgeStore((s) => s.setError);
  const appendLog = useDebugLogStore((s) => s.append);
  const setLogFilePath = useDebugLogStore((s) => s.setLogFilePath);

  useEffect(() => {
    void listEditableParams().then(setParams).catch((err) => setError(String(err)));
    void listChannels().then(setChannels).catch(() => undefined);
    void getConnectionStatus().then(setConnection).catch(() => undefined);
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
    <div className="min-h-screen p-4 md:p-6">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-orange-400">ToneForge</p>
          <h1 className="text-2xl font-semibold text-zinc-50">Katana Gen 3 Editor</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Connect, read, edit, and save patches with offline JSON support.
          </p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <ConnectionPanel />
        <PatchEditor />
      </div>

      <DebugLogPanel />
    </div>
  );
}

export default App;
