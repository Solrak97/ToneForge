import {
  COLOR_BLOCKS,
  COLOR_PRESETS,
  memorySlotForColor,
  parseParamSlot,
  readActiveColorIndex,
  type ColorBlockConfig,
  type ColorPresetIndex,
} from "./colorPresets";
import type { ParamDef, ParamValue, Patch } from "../types/device";

export function paramValueToNumber(value?: ParamValue): number {
  if (!value) return 0;
  if (typeof value.value === "number") return value.value;
  return 0;
}

/** A copy of `patch` with `paramId` set, keeping the value's existing type. */
export function withParamValue(
  patch: Patch,
  params: ParamDef[],
  paramId: string,
  value: number,
): Patch {
  const kind = params.find((p) => p.id === paramId)?.kind;
  const type = patch.params[paramId]?.type ?? (kind === "u16" ? "u16" : kind === "i8" ? "i8" : "u8");
  return { ...patch, params: { ...patch.params, [paramId]: { type, value } } };
}

/** Detail-param prefix for each `patch_fx_type_slotN` option, in option order. */
const FX_DETAIL_PREFIXES = [
  "twah", "awah", "pedalwah", "comp", "limiter", "geq", "peq", "guitarsim", "slowgear",
  "wavesynth", "octave", "pitchshift", "harmonist", "acprocess", "phaser", "flanger",
  "tremolo", "rotary", "univ", "slicer", "vibrato", "ringmod", "humanizer", "2x2chorus",
  "acsim", "ephaser", "eflanger", "ewah", "dc30", "heavyoctave", "bend",
];

/** The harmonist's 24 per-key scale entries belong in the advanced editor. */
const HARMONIST_SCALE_KEY = /^harmonist_(c|db|d|eb|e|f|fs|g|ab|a|bb|b)[12]$/;

/**
 * A block of the hand-editing view: one color memory at a time, and only the selected effect
 * type's details.
 */
export interface QuickBlock {
  title: string;
  switchId?: string;
  color?: ColorBlockConfig;
  /** Effect type param of a color memory slot; names each Green/Red/Yellow version. */
  typeParamId?: (slot: number) => string;
  /** Param ids to show for a color memory slot. */
  paramIds: (slot: number, patch: Patch, params: ParamDef[]) => string[];
}

export const QUICK_BLOCKS: QuickBlock[] = [
  {
    title: "Amp",
    paramIds: () =>
      ["type", "gain", "volume", "bass", "middle", "treble", "presence"].map((p) => `patch_amp_${p}`),
  },
  {
    title: "Booster",
    switchId: "patch_sw_booster_sw",
    color: COLOR_BLOCKS.booster,
    typeParamId: (slot) => `patch_booster_type_slot${slot}`,
    paramIds: (slot) =>
      ["type", "drive", "tone", "bottom", "effect_level"].map((p) => `patch_booster_${p}_slot${slot}`),
  },
  {
    title: "Mod",
    switchId: "patch_sw_mod_sw",
    color: COLOR_BLOCKS.mod,
    typeParamId: (slot) => `patch_fx_type_slot${slot}`,
    paramIds: fxParamIds,
  },
  {
    title: "FX",
    switchId: "patch_sw_fx_sw",
    color: COLOR_BLOCKS.fx,
    typeParamId: (slot) => `patch_fx_type_slot${slot}`,
    paramIds: fxParamIds,
  },
  {
    title: "Delay",
    switchId: "patch_sw_delay_sw",
    color: COLOR_BLOCKS.delay1,
    typeParamId: (slot) => `patch_delay_type_slot${slot}`,
    paramIds: (slot) =>
      ["type", "time", "feedback", "effect_level", "high_cut"].map((p) => `patch_delay_${p}_slot${slot}`),
  },
  {
    title: "Reverb",
    switchId: "patch_sw_reverb_sw",
    color: COLOR_BLOCKS.reverb,
    typeParamId: (slot) => `patch_reverb_type_slot${slot}`,
    paramIds: (slot) =>
      ["type", "layer_mode", "time", "pre_delay", "effect_level"].map((p) => `patch_reverb_${p}_slot${slot}`),
  },
  {
    title: "Noise Gate",
    switchId: "patch_ns_sw",
    paramIds: () => ["patch_ns_threshold", "patch_ns_release"],
  },
];

function fxParamIds(slot: number, patch: Patch, params: ParamDef[]): string[] {
  const typeId = `patch_fx_type_slot${slot}`;
  const prefix = FX_DETAIL_PREFIXES[paramValueToNumber(patch.params[typeId])];
  if (!prefix) return [typeId];
  const detailPrefix = `patch_fx_detail_${prefix}_`;
  const slotSuffix = `_slot${slot}`;
  const details = params
    .map((p) => p.id)
    .filter((id) => id.startsWith(detailPrefix) && id.endsWith(slotSuffix))
    .filter((id) => !HARMONIST_SCALE_KEY.test(id.slice("patch_fx_detail_".length, -slotSuffix.length)));
  return [typeId, ...details];
}

export function liveSlot(block: QuickBlock, patch: Patch): number {
  if (!block.color) return 0;
  return memorySlotForColor(block.color, readActiveColorIndex(patch, block.color));
}

export interface BlockVersion {
  color: ColorPresetIndex;
  slot: number;
  /** Effect type of this version ("Blues Drive"). */
  typeLabel?: string;
  /** The version the amp plays (its color button is lit). */
  live: boolean;
}

/** The Green, Red and Yellow versions of a block; empty for blocks without color memories. */
export function blockVersions(
  block: QuickBlock,
  patch: Patch,
  paramsById: Map<string, ParamDef>,
): BlockVersion[] {
  const color = block.color;
  if (!color) return [];
  const live = readActiveColorIndex(patch, color);
  return COLOR_PRESETS.map((preset) => {
    const slot = memorySlotForColor(color, preset.index);
    const typeId = block.typeParamId?.(slot);
    const typeLabel = typeId
      ? paramsById.get(typeId)?.options?.[paramValueToNumber(patch.params[typeId])]
      : undefined;
    return { color: preset.index, slot, typeLabel, live: preset.index === live };
  });
}

export function isBlockEnabled(block: QuickBlock, patch: Patch): boolean {
  return block.switchId ? paramValueToNumber(patch.params[block.switchId]) === 1 : true;
}

export function quickLabel(id: string): string {
  const core = id
    .replace(/^patch_fx_detail_[a-z0-9]+_/, "")
    .replace(/^patch_fx_/, "")
    .replace(/^patch_(amp|booster|delay|reverb|ns)_/, "")
    .replace(/_slot\d+$/, "");
  return core
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function colorNameForSlot(block: QuickBlock, paramId: string): string | null {
  const slot = parseParamSlot(paramId);
  if (!block.color || slot === null) return null;
  const index = block.color.memorySlots.indexOf(slot as 1 | 2 | 3 | 4 | 5 | 6);
  return COLOR_PRESETS[index]?.label ?? null;
}
