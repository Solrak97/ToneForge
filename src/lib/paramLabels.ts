import type { ParamDef } from "../types/device";

const COLOR_SLOT_NAMES: Record<number, string> = {
  1: "Green",
  2: "Red",
  3: "Yellow",
};

function parseSlot(id: string): number | null {
  const m = id.match(/_slot(\d+)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isColorScopedGroup(group?: string): boolean {
  return (
    group === "booster" ||
    group === "mod_fx" ||
    group === "mod_fx_detail" ||
    group === "delay" ||
    group === "reverb"
  );
}

export function formatParamLabel(param: ParamDef): string {
  const slot = parseSlot(param.id);
  if (!slot) return param.label;

  // For the effect blocks that have the 3 color memories, name them.
  if (isColorScopedGroup(param.group) && slot >= 1 && slot <= 3) {
    const color = COLOR_SLOT_NAMES[slot] ?? `Slot ${slot}`;
    return `${param.label} (${color})`;
  }

  // Everything else: at least make the slot explicit.
  return `${param.label} (Slot ${slot})`;
}

function stripPrefix(label: string, prefixes: string[]): string {
  for (const p of prefixes) {
    if (label.startsWith(p)) return label.slice(p.length);
  }
  return label;
}

/**
 * Short labels are used when the surrounding UI already provides category context
 * (e.g. inside an "Amp" or "Delay" section).
 */
export function formatParamLabelShort(
  param: ParamDef,
  opts?: { hideColorSlot?: boolean },
): string {
  let full = formatParamLabel(param);
  if (opts?.hideColorSlot) {
    full = full.replace(/ \((Green|Red|Yellow)\)$/i, "");
  }

  const group = param.group ?? "";
  if (group === "amp") return stripPrefix(full, ["Amp "]);
  if (group === "booster") return stripPrefix(full, ["Booster ", "OD/DS ", "OD / DS "]);
  if (group === "delay") return stripPrefix(full, ["Delay ", "Delay2 "]);
  if (group === "reverb") return stripPrefix(full, ["Reverb "]);
  if (group === "fx_switch") return stripPrefix(full, ["Effect ", "Fx ", "FX ", "Switch "]);
  if (group === "color") return stripPrefix(full, ["Color ", "Effect Color "]);
  if (group === "mod_fx") return stripPrefix(full, ["Mod / FX ", "Mod/Fx ", "Mod ", "FX "]);
  if (group === "mod_fx_detail") return stripPrefix(full, ["Fx Detail ", "FX Detail ", "Mod Fx Detail ", "Mod / FX Detail "]);

  return full;
}

