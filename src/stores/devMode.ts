import { create } from "zustand";
import { getDevMode, setDevMode } from "../lib/tauri-api";

/** Experimental mode (stored as "dev mode") unlocks the debug log, the amp emulator and unfinished tabs (Agent, MIDI, Devices). */
interface DevModeStore {
  enabled: boolean;
  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export const useDevModeStore = create<DevModeStore>((set) => ({
  enabled: false,
  load: async () => set({ enabled: await getDevMode() }),
  setEnabled: async (enabled) => set({ enabled: await setDevMode(enabled) }),
}));
