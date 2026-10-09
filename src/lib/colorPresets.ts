import type { ParamDef, Patch } from "../types/device";

/** Amp color buttons: three saved presets per effect block. */
export type ColorPresetIndex = 0 | 1 | 2;

export const COLOR_PRESETS: ReadonlyArray<{
  index: ColorPresetIndex;
  label: string;
  dotClass: string;
  ringClass: string;
}> = [
  { index: 0, label: "Green", dotClass: "bg-emerald-400", ringClass: "ring-emerald-400/60" },
  { index: 1, label: "Red", dotClass: "bg-red-500", ringClass: "ring-red-400/60" },
  { index: 2, label: "Yellow", dotClass: "bg-amber-400", ringClass: "ring-amber-400/60" },
];

export type ColorBlockId = "booster" | "mod" | "fx" | "delay1" | "delay2" | "reverb";

export interface ColorBlockConfig {
  id: ColorBlockId;
  label: string;
  /** SysEx param that selects which color is live on the amp (0=Green, 1=Red, 2=Yellow). */
  activeColorParamId: string;
  /** `_slotN` values used for this block's three color memories. */
  memorySlots: [number, number, number];
  /** Param groups included when filtering. */
  groups: string[];
}

export const COLOR_BLOCKS: Record<ColorBlockId, ColorBlockConfig> = {
  booster: {
    id: "booster",
    label: "Booster",
    activeColorParamId: "patch_color_booster_color",
    memorySlots: [1, 2, 3],
    groups: ["booster"],
  },
  mod: {
    id: "mod",
    label: "Mod",
    activeColorParamId: "patch_color_mod_color",
    memorySlots: [1, 2, 3],
    groups: ["mod_fx", "mod_fx_detail"],
  },
  fx: {
    id: "fx",
    label: "FX",
    activeColorParamId: "patch_color_fx_color",
    memorySlots: [4, 5, 6],
    groups: ["mod_fx", "mod_fx_detail"],
  },
  delay1: {
    id: "delay1",
    label: "Delay",
    activeColorParamId: "patch_color_delay_color",
    memorySlots: [1, 2, 3],
    groups: ["delay"],
  },
  delay2: {
    id: "delay2",
    label: "Delay 2",
    // The amp has no Delay 2 button: the reverb button's color picks the Delay 2 memory too, and each
    // reverb memory's layer mode decides whether Delay 2, Reverb or both play.
    activeColorParamId: "patch_color_reverb_color",
    memorySlots: [4, 5, 6],
    groups: ["delay"],
  },
  reverb: {
    id: "reverb",
    label: "Reverb",
    activeColorParamId: "patch_color_reverb_color",
    memorySlots: [1, 2, 3],
    groups: ["reverb"],
  },
};

const ACTIVE_COLOR_PARAM_IDS = new Set(
  Object.values(COLOR_BLOCKS).map((b) => b.activeColorParamId),
);

export function isActiveColorParam(paramId: string): boolean {
  return ACTIVE_COLOR_PARAM_IDS.has(paramId);
}

export function parseParamSlot(paramId: string): number | null {
  const m = paramId.match(/_slot(\d+)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function memorySlotForColor(
  block: ColorBlockConfig,
  color: ColorPresetIndex,
): number {
  return block.memorySlots[color];
}

export function colorIndexForMemorySlot(
  block: ColorBlockConfig,
  slot: number,
): ColorPresetIndex | null {
  const idx = block.memorySlots.indexOf(slot as 1 | 2 | 3 | 4 | 5 | 6);
  if (idx < 0 || idx > 2) return null;
  return idx as ColorPresetIndex;
}

export function readActiveColorIndex(
  patch: Patch | null,
  block: ColorBlockConfig,
): ColorPresetIndex {
  const raw = patch?.params[block.activeColorParamId];
  if (raw && typeof raw.value === "number" && raw.value >= 0 && raw.value <= 2) {
    return raw.value as ColorPresetIndex;
  }
  return 0;
}

export function paramBelongsToColorBlock(param: ParamDef, block: ColorBlockConfig): boolean {
  const group = param.group ?? "";
  if (!block.groups.includes(group)) return false;
  const slot = parseParamSlot(param.id);
  if (slot === null) return false;
  return block.memorySlots.includes(slot as 1 | 2 | 3 | 4 | 5 | 6);
}

export function paramMatchesColorMemory(
  param: ParamDef,
  block: ColorBlockConfig,
  color: ColorPresetIndex,
): boolean {
  if (!paramBelongsToColorBlock(param, block)) return false;
  return parseParamSlot(param.id) === memorySlotForColor(block, color);
}

/** Blocks shown for each effects sub-tab. */
export function colorBlocksForEffectsTab(
  effectsTab: "booster" | "mod_fx" | "delay" | "reverb",
  modFxSection: "mod" | "fx",
  delaySection: "delay1" | "delay2",
): ColorBlockConfig | null {
  if (effectsTab === "booster") return COLOR_BLOCKS.booster;
  if (effectsTab === "mod_fx") return modFxSection === "mod" ? COLOR_BLOCKS.mod : COLOR_BLOCKS.fx;
  if (effectsTab === "delay") return delaySection === "delay1" ? COLOR_BLOCKS.delay1 : COLOR_BLOCKS.delay2;
  if (effectsTab === "reverb") return COLOR_BLOCKS.reverb;
  return null;
}
