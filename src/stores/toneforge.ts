import { create } from "zustand";
import type { ConnectionStatus, DeviceInfo, ParamDef, Patch, ChannelInfo } from "../types/device";

interface ToneForgeStore {
  devices: DeviceInfo[];
  connection: ConnectionStatus;
  patch: Patch | null;
  params: ParamDef[];
  channels: ChannelInfo[];
  busy: boolean;
  error: string | null;
  setDevices: (devices: DeviceInfo[]) => void;
  setConnection: (connection: ConnectionStatus) => void;
  setPatch: (patch: Patch | null) => void;
  setParams: (params: ParamDef[]) => void;
  setChannels: (channels: ChannelInfo[]) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}

export const useToneForgeStore = create<ToneForgeStore>((set) => ({
  devices: [],
  connection: { connected: false, editor_mode: false },
  patch: null,
  params: [],
  channels: [],
  busy: false,
  error: null,
  setDevices: (devices) => set({ devices }),
  setConnection: (connection) => set({ connection }),
  setPatch: (patch) => set({ patch }),
  setParams: (params) => set({ params }),
  setChannels: (channels) => set({ channels }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
}));
