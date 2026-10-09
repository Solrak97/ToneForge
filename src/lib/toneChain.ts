import { COLOR_BLOCKS, type ColorPresetIndex } from "./colorPresets";
import { paramValueToNumber } from "./quickParams";
import type { ParamDef, Patch } from "../types/device";
import type { ToneSummary } from "../types/library";

/** What a chain block shows: bypassed, the amp itself, or the live color memory of an effect. */
export type ChainSlot = "off" | "amp" | ColorPresetIndex;

export interface ChainBlock {
  id: string;
  label: string;
  short: string;
  slot: ChainSlot;
}

const EFFECT_BLOCKS = [
  { id: "booster", label: "Booster", short: "BST", switchId: "patch_sw_booster_sw", color: COLOR_BLOCKS.booster },
  { id: "mod", label: "Mod", short: "MOD", switchId: "patch_sw_mod_sw", color: COLOR_BLOCKS.mod },
  { id: "fx", label: "FX", short: "FX", switchId: "patch_sw_fx_sw", color: COLOR_BLOCKS.fx },
  { id: "delay", label: "Delay", short: "DLY", switchId: "patch_sw_delay_sw", color: COLOR_BLOCKS.delay1 },
  { id: "reverb", label: "Reverb", short: "REV", switchId: "patch_sw_reverb_sw", color: COLOR_BLOCKS.reverb },
] as const;

type ReadParam = (id: string) => number | undefined;

/** The tone's signal chain in amp order: booster, amp, mod, FX, delay, reverb. */
export function toneChain(read: ReadParam): ChainBlock[] {
  const effect = (index: number): ChainBlock => {
    const block = EFFECT_BLOCKS[index];
    const on = (read(block.switchId) ?? 0) !== 0;
    const color = read(block.color.activeColorParamId) ?? 0;
    return {
      id: block.id,
      label: block.label,
      short: block.short,
      slot: on ? ((color >= 0 && color <= 2 ? color : 0) as ColorPresetIndex) : "off",
    };
  };
  return [
    effect(0),
    { id: "amp", label: "Amp", short: "AMP", slot: "amp" },
    effect(1),
    effect(2),
    effect(3),
    effect(4),
  ];
}

export function summaryReader(tone: Pick<ToneSummary, "preview">): ReadParam {
  return (id) => tone.preview?.[id];
}

export function patchReader(patch: Patch): ReadParam {
  return (id) => (id in patch.params ? paramValueToNumber(patch.params[id]) : undefined);
}

/** Amp type name ("Crunch"), or undefined when the tone doesn't say. */
export function ampTypeLabel(read: ReadParam, params: ParamDef[]): string | undefined {
  const value = read("patch_amp_type");
  if (value === undefined) return undefined;
  return params.find((p) => p.id === "patch_amp_type")?.options?.[value];
}
