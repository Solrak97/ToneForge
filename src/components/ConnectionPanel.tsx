import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Modal } from "./ui/modal";
import { useToneForgeStore } from "../stores/toneforge";
import { useDevModeStore } from "../stores/devMode";
import { DEFAULT_CHANNELS } from "../lib/channels";
import {
  connectDevice,
  disconnectDevice,
  listChannels,
  listDevices,
  readPatch,
} from "../lib/tauri-api";

interface ConnectionControlsProps {
  /** Called after a successful connect (e.g. to close the modal). */
  onConnected?: () => void;
}

export function ConnectionControls({ onConnected }: ConnectionControlsProps) {
  const devices = useToneForgeStore((s) => s.devices);
  const connection = useToneForgeStore((s) => s.connection);
  const busy = useToneForgeStore((s) => s.busy);
  const error = useToneForgeStore((s) => s.error);
  const setDevices = useToneForgeStore((s) => s.setDevices);
  const setConnection = useToneForgeStore((s) => s.setConnection);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setChannels = useToneForgeStore((s) => s.setChannels);
  const setBusy = useToneForgeStore((s) => s.setBusy);
  const setError = useToneForgeStore((s) => s.setError);
  const devMode = useDevModeStore((s) => s.enabled);

  const [selectedPort, setSelectedPort] = useState("");

  useEffect(() => {
    void refreshDevices();
  }, [devMode]);

  useEffect(() => {
    if (!devices.some((device) => device.name === selectedPort)) {
      setSelectedPort(devices[0]?.name ?? "");
    }
  }, [devices, selectedPort]);

  async function refreshDevices() {
    setBusy(true);
    setError(null);
    try {
      const list = await listDevices();
      setDevices(list);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect() {
    if (!selectedPort) return;
    setBusy(true);
    setError(null);
    try {
      const status = await connectDevice(selectedPort);
      setConnection(status);
      const channelList = await listChannels();
      setChannels(channelList);
      const loaded = await readPatch();
      setPatch(loaded);
      onConnected?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    try {
      const status = await disconnectDevice();
      setConnection(status);
      setPatch(null);
      setChannels(DEFAULT_CHANNELS);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleReadPatch() {
    setBusy(true);
    setError(null);
    try {
      const loaded = await readPatch();
      setPatch(loaded);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-zinc-400">MIDI Port</label>
        <select
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          value={selectedPort}
          onChange={(e) => setSelectedPort(e.target.value)}
          disabled={connection.connected || busy}
        >
          {devices.length === 0 ? (
            <option value="">No Katana devices found</option>
          ) : (
            devices.map((device) => (
              <option key={device.id} value={device.name}>
                {device.name}
              </option>
            ))
          )}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void refreshDevices()} disabled={busy}>
          Refresh
        </Button>
        {!connection.connected ? (
          <Button onClick={() => void handleConnect()} disabled={busy || !selectedPort}>
            Connect
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => void handleReadPatch()} disabled={busy}>
              Read Patch
            </Button>
            <Button variant="danger" onClick={() => void handleDisconnect()} disabled={busy}>
              Disconnect
            </Button>
          </>
        )}
      </div>

      {connection.connected && (
        <div className="text-xs text-zinc-400 space-y-1">
          <p>Port: {connection.port_name}</p>
          <p>Model: {connection.device_model}</p>
          <p>Editor mode: {connection.editor_mode ? "active" : "inactive"}</p>
          {connection.emulated && (
            <p className="text-amber-300">
              Emulated amp — changes stay in memory and never reach hardware.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function ConnectionModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const connection = useToneForgeStore((s) => s.connection);

  return (
    <Modal
      open={open}
      title="Device Connection"
      description="Select your Katana MIDI port and connect to read or edit patches."
      onClose={onClose}
      footer={
        connection.connected ? (
          <p className="text-xs text-zinc-500">
            Connected — you can close this dialog and keep editing.
          </p>
        ) : (
          <p className="text-xs text-zinc-500">
            You can close this and connect later from the status button in the header.
          </p>
        )
      }
    >
      <ConnectionControls onConnected={onClose} />
    </Modal>
  );
}

export function ConnectionStatusButton({ onClick }: { onClick: () => void }) {
  const connection = useToneForgeStore((s) => s.connection);

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-left transition hover:border-zinc-600 hover:bg-zinc-800"
      title="Open device connection"
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          connection.connected
            ? connection.emulated
              ? "bg-amber-400"
              : "bg-emerald-400"
            : "bg-zinc-500"
        }`}
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-zinc-200">
          {connection.connected ? "Connected" : "Not connected"}
        </span>
        <span className="block truncate text-[10px] text-zinc-500 max-w-[140px] sm:max-w-[200px]">
          {connection.connected
            ? connection.port_name || "Katana"
            : "Click to connect"}
        </span>
      </span>
      <span className="hidden sm:inline-flex">
        <Badge
          tone={connection.connected ? (connection.emulated ? "warning" : "success") : "neutral"}
        >
          {connection.connected ? (connection.emulated ? "EMU" : "ON") : "OFF"}
        </Badge>
      </span>
    </button>
  );
}
