import { DEFAULT_CHANNELS } from "../lib/channels";
import { selectChannel } from "../lib/tauri-api";
import { useToneForgeStore } from "../stores/toneforge";
import { Segmented } from "./ui/segmented";

/** Switches the amp's channel; the editor then shows what's on it. Hidden while disconnected. */
export function ChannelSelector() {
  const connection = useToneForgeStore((s) => s.connection);
  const patch = useToneForgeStore((s) => s.patch);
  const channels = useToneForgeStore((s) => s.channels);
  const busy = useToneForgeStore((s) => s.busy);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setBusy = useToneForgeStore((s) => s.setBusy);
  const setError = useToneForgeStore((s) => s.setError);

  if (!connection.connected) return null;

  async function handleSelect(channel: number) {
    setBusy(true);
    setError(null);
    try {
      setPatch(await selectChannel(channel));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Segmented
      label="Amp channel"
      options={(channels.length > 0 ? channels : DEFAULT_CHANNELS).map((channel) => ({
        value: channel.index,
        label: channel.label,
      }))}
      value={patch?.meta.channel ?? null}
      onChange={(channel) => void handleSelect(channel)}
      disabled={busy}
    />
  );
}
