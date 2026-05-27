import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save, open } from "@tauri-apps/plugin-dialog";
import type { ConnectionStatus, DeviceInfo, ParamDef, Patch } from "../types/device";

export async function listDevices(): Promise<DeviceInfo[]> {
  return invoke<DeviceInfo[]>("list_devices");
}

export async function connectDevice(portName: string): Promise<ConnectionStatus> {
  return invoke<ConnectionStatus>("connect_device", { portName });
}

export async function disconnectDevice(): Promise<ConnectionStatus> {
  return invoke<ConnectionStatus>("disconnect_device");
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  return invoke<ConnectionStatus>("get_connection_status");
}

export async function readPatch(): Promise<Patch> {
  return invoke<Patch>("read_patch");
}

export async function setParam(paramId: string, value: number): Promise<Patch> {
  return invoke<Patch>("set_param", { paramId, value });
}

export async function listEditableParams(): Promise<ParamDef[]> {
  return invoke<ParamDef[]>("list_editable_params");
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

export function subscribeDeviceEvents(
  onConnection: (status: ConnectionStatus, error?: string | null) => void,
  onPatch: (patch: Patch) => void,
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

  return () => {
    unsubs.forEach((fn) => fn());
  };
}
