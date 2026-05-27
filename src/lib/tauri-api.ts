import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save, open } from "@tauri-apps/plugin-dialog";
import type { ConnectionStatus, DeviceInfo, ParamDef, Patch, ChannelInfo } from "../types/device";
import type { SaveToneRequest, ToneRecord, ToneSummary } from "../types/library";
import type { DebugLogEntry, LogLevel } from "../stores/debugLog";

async function loggedInvoke<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    console.debug(`[ToneForge] ${label} OK (${(performance.now() - start).toFixed(0)}ms)`);
    return result;
  } catch (err) {
    console.error(`[ToneForge] ${label} FAILED (${(performance.now() - start).toFixed(0)}ms)`, err);
    throw err;
  }
}

export async function listDevices(): Promise<DeviceInfo[]> {
  return loggedInvoke("listDevices", () => invoke<DeviceInfo[]>("list_devices"));
}

export async function connectDevice(portName: string): Promise<ConnectionStatus> {
  return loggedInvoke("connectDevice", () =>
    invoke<ConnectionStatus>("connect_device", { portName }),
  );
}

export async function disconnectDevice(): Promise<ConnectionStatus> {
  return loggedInvoke("disconnectDevice", () => invoke<ConnectionStatus>("disconnect_device"));
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  return invoke<ConnectionStatus>("get_connection_status");
}

export async function readPatch(): Promise<Patch> {
  return loggedInvoke("readPatch", () => invoke<Patch>("read_patch"));
}

export async function listChannels(): Promise<ChannelInfo[]> {
  return invoke<ChannelInfo[]>("list_channels");
}

export async function selectChannel(channel: number): Promise<Patch> {
  return loggedInvoke(`selectChannel(${channel})`, () =>
    invoke<Patch>("select_channel", { channel }),
  );
}

export async function setParam(paramId: string, value: number): Promise<Patch> {
  return loggedInvoke(`setParam(${paramId}=${value})`, () =>
    invoke<Patch>("set_param", { paramId, value }),
  );
}

export async function listEditableParams(): Promise<ParamDef[]> {
  return invoke<ParamDef[]>("list_editable_params");
}

export async function getLogPath(): Promise<string> {
  return invoke<string>("get_log_path");
}

export async function savePresetToDialog(): Promise<void> {
  const path = await save({
    filters: [{ name: "ToneForge Preset", extensions: ["json"] }],
    defaultPath: "preset.json",
  });
  if (!path) return;
  await invoke("save_preset", { path });
}

export async function loadPresetFromDialog(): Promise<Patch> {
  const path = await open({
    filters: [{ name: "ToneForge Preset", extensions: ["json"] }],
    multiple: false,
  });
  if (!path || Array.isArray(path)) {
    throw new Error("No preset selected");
  }
  return invoke<Patch>("load_preset", { path });
}

export async function listLibraryTones(query?: string): Promise<ToneSummary[]> {
  return invoke<ToneSummary[]>("list_library_tones", { query: query ?? null });
}

export async function saveLibraryTone(request: SaveToneRequest): Promise<ToneRecord> {
  return loggedInvoke(`saveLibraryTone(${request.name})`, () =>
    invoke<ToneRecord>("save_library_tone", { request }),
  );
}

export async function loadLibraryTone(id: number, writeToDevice: boolean): Promise<Patch> {
  return loggedInvoke(`loadLibraryTone(${id})`, () =>
    invoke<Patch>("load_library_tone", { id, writeToDevice }),
  );
}

export async function deleteLibraryTone(id: number): Promise<void> {
  return loggedInvoke(`deleteLibraryTone(${id})`, () =>
    invoke("delete_library_tone", { id }),
  );
}

export async function renameLibraryTone(id: number, name: string): Promise<ToneRecord> {
  return loggedInvoke(`renameLibraryTone(${id})`, () =>
    invoke<ToneRecord>("rename_library_tone", { id, name }),
  );
}

export async function getLibraryDbPath(): Promise<string> {
  return invoke<string>("get_library_db_path");
}

export function subscribeDeviceEvents(
  onConnection: (status: ConnectionStatus, error?: string | null) => void,
  onPatch: (patch: Patch) => void,
  onDebugLog?: (entry: Omit<DebugLogEntry, "id">) => void,
) {
  const unsubs: Array<() => void> = [];

  listen<{ status: ConnectionStatus; error?: string | null }>(
    "connection-changed",
    (event) => {
      onConnection(event.payload.status, event.payload.error ?? null);
    },
  ).then((unlisten) => unsubs.push(unlisten));

  listen<{ patch: Patch }>("patch-updated", (event) => {
    onPatch(event.payload.patch);
  }).then((unlisten) => unsubs.push(unlisten));

  if (onDebugLog) {
    listen<{
      timestamp: string;
      level: string;
      target: string;
      message: string;
    }>("debug-log", (event) => {
      onDebugLog({
        timestamp: event.payload.timestamp,
        level: normalizeLogLevel(event.payload.level),
        target: event.payload.target,
        message: event.payload.message,
      });
    }).then((unlisten) => unsubs.push(unlisten));
  }

  return () => {
    unsubs.forEach((fn) => fn());
  };
}

function normalizeLogLevel(level: string): LogLevel {
  if (level === "trace" || level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return "info";
}
