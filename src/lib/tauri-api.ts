import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save, open } from "@tauri-apps/plugin-dialog";
import type { ConnectionStatus, DeviceInfo, ParamDef, Patch, ChannelInfo } from "../types/device";
import type {
  LibraryImport,
  LiveSetRecord,
  LiveSetSummary,
  SaveToneRequest,
  ToneRecord,
  ToneSummary,
} from "../types/library";
import type { AgentSettings } from "../types/agent";
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

export async function getCachedPatch(): Promise<Patch | null> {
  return invoke<Patch | null>("get_cached_patch");
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

export async function getDevMode(): Promise<boolean> {
  return invoke<boolean>("get_dev_mode");
}

export async function setDevMode(enabled: boolean): Promise<boolean> {
  return loggedInvoke(`setDevMode(${enabled})`, () => invoke<boolean>("set_dev_mode", { enabled }));
}

export async function getLogPath(): Promise<string> {
  return invoke<string>("get_log_path");
}

const TSL_FILTER = { name: "BOSS TONE STUDIO liveset", extensions: ["tsl"] };
const OPEN_FILTERS = [
  { name: "Liveset or preset", extensions: ["tsl", "json"] },
  TSL_FILTER,
  { name: "ToneForge preset (legacy)", extensions: ["json"] },
];

function tslFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, " ").trim();
  return `${safe || "liveset"}.tsl`;
}

async function pickTslSavePath(name: string): Promise<string | null> {
  return save({ filters: [TSL_FILTER], defaultPath: tslFileName(name) });
}

async function pickOpenPath(): Promise<string | null> {
  const path = await open({ filters: OPEN_FILTERS, multiple: false });
  return path && !Array.isArray(path) ? path : null;
}

export async function listLibraryTones(query?: string): Promise<ToneSummary[]> {
  return invoke<ToneSummary[]>("list_library_tones", { query: query ?? null });
}

export async function getLibraryTone(id: number): Promise<ToneRecord> {
  return invoke<ToneRecord>("get_library_tone", { id });
}

export async function importLibraryToneFromAmp(request: SaveToneRequest): Promise<ToneRecord> {
  return loggedInvoke(`importLibraryToneFromAmp(${request.name})`, () =>
    invoke<ToneRecord>("import_library_tone_from_amp", { request }),
  );
}

/** Imports a `.tsl` (one tone, or a whole liveset) or a legacy JSON preset. */
export async function importLibraryFileFromDialog(): Promise<LibraryImport | null> {
  const path = await pickOpenPath();
  if (!path) return null;
  return loggedInvoke("importLibraryFile", () =>
    invoke<LibraryImport>("import_library_file", { path }),
  );
}

export async function exportLibraryToneToDialog(id: number, name: string): Promise<boolean> {
  const path = await pickTslSavePath(name);
  if (!path) return false;
  await loggedInvoke(`exportLibraryTone(${id})`, () =>
    invoke("export_library_tone", { id, path }),
  );
  return true;
}

export async function exportLivesetToDialog(id: number, name: string): Promise<boolean> {
  const path = await pickTslSavePath(name);
  if (!path) return false;
  await loggedInvoke(`exportLiveset(${id})`, () => invoke("export_liveset", { id, path }));
  return true;
}

export async function listLivesets(): Promise<LiveSetSummary[]> {
  return invoke<LiveSetSummary[]>("list_livesets");
}

export async function getLiveset(id: number): Promise<LiveSetRecord> {
  return invoke<LiveSetRecord>("get_liveset", { id });
}

export async function createLiveset(name: string): Promise<LiveSetRecord> {
  return loggedInvoke(`createLiveset(${name})`, () =>
    invoke<LiveSetRecord>("create_liveset", { name }),
  );
}

export async function renameLiveset(id: number, name: string): Promise<LiveSetRecord> {
  return loggedInvoke(`renameLiveset(${id})`, () =>
    invoke<LiveSetRecord>("rename_liveset", { id, name }),
  );
}

export async function deleteLiveset(id: number): Promise<void> {
  return loggedInvoke(`deleteLiveset(${id})`, () => invoke("delete_liveset", { id }));
}

export async function addToneToLiveset(livesetId: number, toneId: number): Promise<LiveSetRecord> {
  return loggedInvoke(`addToneToLiveset(${livesetId}, ${toneId})`, () =>
    invoke<LiveSetRecord>("add_tone_to_liveset", { livesetId, toneId }),
  );
}

export async function removeToneFromLiveset(
  livesetId: number,
  toneId: number,
): Promise<LiveSetRecord> {
  return loggedInvoke(`removeToneFromLiveset(${livesetId}, ${toneId})`, () =>
    invoke<LiveSetRecord>("remove_tone_from_liveset", { livesetId, toneId }),
  );
}

export async function reorderLiveset(livesetId: number, toneIds: number[]): Promise<LiveSetRecord> {
  return invoke<LiveSetRecord>("reorder_liveset", { livesetId, toneIds });
}

export async function saveLibraryTone(request: SaveToneRequest): Promise<ToneRecord> {
  return loggedInvoke(`saveLibraryTone(${request.name})`, () =>
    invoke<ToneRecord>("save_library_tone", { request }),
  );
}

export async function updateLibraryTonePatch(id: number, patch: Patch): Promise<ToneRecord> {
  return loggedInvoke(`updateLibraryTonePatch(${id})`, () =>
    invoke<ToneRecord>("update_library_tone_patch", { id, patch }),
  );
}

/** `channel` switches the amp to that channel before writing; defaults to the current one. */
export async function loadLibraryTone(
  id: number,
  writeToDevice: boolean,
  channel?: number,
): Promise<Patch> {
  return loggedInvoke(`loadLibraryTone(${id})`, () =>
    invoke<Patch>("load_library_tone", { id, writeToDevice, channel: channel ?? null }),
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

export async function seedLibraryDemoTones(): Promise<number> {
  return loggedInvoke("seedLibraryDemoTones", () => invoke<number>("seed_library_demo_tones"));
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

// --- Agent ---

export async function getAgentSettings(): Promise<AgentSettings> {
  return invoke<AgentSettings>("get_agent_settings");
}

export async function setAgentSettings(settings: AgentSettings): Promise<AgentSettings> {
  return loggedInvoke("setAgentSettings", () =>
    invoke<AgentSettings>("set_agent_settings", { settings }),
  );
}

export async function agentChat(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  return loggedInvoke("agentChat", () =>
    invoke<string>("agent_chat", { request: { messages } }),
  );
}

export async function agentCancel(): Promise<void> {
  return invoke("agent_cancel");
}

export async function agentReset(): Promise<void> {
  return invoke("agent_reset");
}

export function subscribeAgentEvents(handlers: {
  onToken?: (payload: { run_id: string; text: string }) => void;
  onTool?: (payload: {
    run_id: string;
    name: string;
    arguments: unknown;
    result_summary: string;
    ok: boolean;
  }) => void;
  onDone?: (payload: { run_id: string; provider: string; message: string }) => void;
  onError?: (payload: { run_id: string; error: string }) => void;
}): () => void {
  const unsubs: Array<() => void> = [];

  if (handlers.onToken) {
    listen<{ run_id: string; text: string }>("agent-token", (e) => {
      handlers.onToken?.(e.payload);
    }).then((u) => unsubs.push(u));
  }
  if (handlers.onTool) {
    listen<{
      run_id: string;
      name: string;
      arguments: unknown;
      result_summary: string;
      ok: boolean;
    }>("agent-tool", (e) => {
      handlers.onTool?.(e.payload);
    }).then((u) => unsubs.push(u));
  }
  if (handlers.onDone) {
    listen<{ run_id: string; provider: string; message: string }>("agent-done", (e) => {
      handlers.onDone?.(e.payload);
    }).then((u) => unsubs.push(u));
  }
  if (handlers.onError) {
    listen<{ run_id: string; error: string }>("agent-error", (e) => {
      handlers.onError?.(e.payload);
    }).then((u) => unsubs.push(u));
  }

  return () => unsubs.forEach((fn) => fn());
}
