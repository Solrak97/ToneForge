import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { useToneForgeStore } from "../stores/toneforge";
import {
  connectDevice,
  disconnectDevice,
  listDevices,
  readPatch,
} from "../lib/tauri-api";

export function ConnectionPanel() {
  const devices = useToneForgeStore((s) => s.devices);
  const connection = useToneForgeStore((s) => s.connection);
  const busy = useToneForgeStore((s) => s.busy);
  const error = useToneForgeStore((s) => s.error);
  const setDevices = useToneForgeStore((s) => s.setDevices);
  const setConnection = useToneForgeStore((s) => s.setConnection);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setBusy = useToneForgeStore((s) => s.setBusy);
  const setError = useToneForgeStore((s) => s.setError);

  const [selectedPort, setSelectedPort] = useState("");

  useEffect(() => {
    void refreshDevices();
  }, []);

  useEffect(() => {
    if (!selectedPort && devices.length > 0) {
      setSelectedPort(devices[0].name);
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
      const patch = await readPatch();
      setPatch(patch);
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
      const patch = await readPatch();
      setPatch(patch);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Device Connection</CardTitle>
        <Badge tone={connection.connected ? "success" : "neutral"}>
          {connection.connected ? "Connected" : "Disconnected"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
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
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
      </CardContent>
    </Card>
  );
}
