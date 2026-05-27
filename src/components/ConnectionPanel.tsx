import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { useToneForgeStore } from "../stores/toneforge";
import { channelLabel, DEFAULT_CHANNELS } from "../lib/channels";
import {
  connectDevice,
  disconnectDevice,
  listChannels,
  listDevices,
  readPatch,
  selectChannel,
} from "../lib/tauri-api";

export function ConnectionPanel() {
  const devices = useToneForgeStore((s) => s.devices);
  const connection = useToneForgeStore((s) => s.connection);
  const patch = useToneForgeStore((s) => s.patch);
  const channels = useToneForgeStore((s) => s.channels);
  const busy = useToneForgeStore((s) => s.busy);
  const error = useToneForgeStore((s) => s.error);
  const setDevices = useToneForgeStore((s) => s.setDevices);
  const setConnection = useToneForgeStore((s) => s.setConnection);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setChannels = useToneForgeStore((s) => s.setChannels);
  const setBusy = useToneForgeStore((s) => s.setBusy);
  const setError = useToneForgeStore((s) => s.setError);

  const [selectedPort, setSelectedPort] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<number | "">("");

  useEffect(() => {
    void refreshDevices();
  }, []);

  useEffect(() => {
    if (!selectedPort && devices.length > 0) {
      setSelectedPort(devices[0].name);
    }
  }, [devices, selectedPort]);

  useEffect(() => {
    if (patch?.meta.channel !== undefined && patch.meta.channel !== null) {
      setSelectedChannel(patch.meta.channel);
    }
  }, [patch?.meta.channel]);

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
      setSelectedChannel("");
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

  async function handleChannelChange(nextChannel: number) {
    if (!connection.connected || busy) return;
    setSelectedChannel(nextChannel);
    setBusy(true);
    setError(null);
    try {
      const loaded = await selectChannel(nextChannel);
      setPatch(loaded);
    } catch (err) {
      setError(String(err));
      if (patch?.meta.channel !== undefined && patch.meta.channel !== null) {
        setSelectedChannel(patch.meta.channel);
      }
    } finally {
      setBusy(false);
    }
  }

  const activeChannelLabel =
    selectedChannel === ""
      ? "—"
      : channels.find((ch) => ch.index === selectedChannel)?.label ??
        channelLabel(Number(selectedChannel), channels);

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

        {connection.connected && (
          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Channel</label>
            <select
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              value={selectedChannel === "" ? "" : String(selectedChannel)}
              onChange={(e) => void handleChannelChange(Number(e.target.value))}
              disabled={busy}
            >
              {channels.length === 0 && <option value="">Select channel…</option>}
              {(channels.length > 0 ? channels : DEFAULT_CHANNELS).map((channel) => (
                <option key={channel.index} value={channel.index}>
                  {channel.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-zinc-500">Active: {activeChannelLabel}</p>
          </div>
        )}

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
