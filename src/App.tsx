import { useEffect } from "react";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { PatchEditor } from "./components/PatchEditor";
import { subscribeDeviceEvents, getConnectionStatus, listEditableParams } from "./lib/tauri-api";
import { useToneForgeStore } from "./stores/toneforge";

function App() {
  const setConnection = useToneForgeStore((s) => s.setConnection);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setParams = useToneForgeStore((s) => s.setParams);
  const setError = useToneForgeStore((s) => s.setError);

  useEffect(() => {
    void listEditableParams().then(setParams).catch((err) => setError(String(err)));
    void getConnectionStatus().then(setConnection).catch(() => undefined);

    const unsubscribe = subscribeDeviceEvents(
      (status, error) => {
        setConnection(status);
        if (error) setError(error);
      },
      (patch) => setPatch(patch),
    );

    return unsubscribe;
  }, [setConnection, setPatch, setParams, setError]);

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
    </div>
  );
}

export default App;
