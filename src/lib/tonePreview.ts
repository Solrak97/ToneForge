import type { ParamDef, Patch } from "../types/device";

export interface TonePreviewRow {
  id: string;
  label: string;
  value: string;
  group: string;
}

const PREVIEW_PARAM_IDS = [
  "patch_amp_type",
  "patch_amp_gain",
  "patch_amp_volume",
  "patch_amp_bass",
  "patch_amp_middle",
  "patch_amp_treble",
  "patch_amp_presence",
  "patch_amp_resonance",
  "patch_sw_booster_sw",
  "patch_sw_mod_sw",
  "patch_sw_fx_sw",
  "patch_sw_delay_sw",
  "patch_sw_reverb_sw",
  "patch_booster_type_slot1",
  "patch_booster_drive_slot1",
  "patch_booster_effect_level_slot1",
  "patch_fx_type_slot1",
  "patch_delay_type_slot1",
  "patch_delay_time_slot1",
  "patch_delay_effect_level_slot1",
  "patch_reverb_type_slot1",
  "patch_reverb_effect_level_slot1",
  "patch_other_chain",
];

function formatParamValue(param: ParamDef | undefined, raw: number | string): string {
  if (param?.kind === "enum" && param.options?.length && typeof raw === "number") {
    return param.options[raw] ?? String(raw);
  }
  if (param?.kind === "enum" && typeof raw === "number") {
    return raw === 0 ? "Off" : raw === 1 ? "On" : String(raw);
  }
  if (typeof raw === "number" && param?.min !== undefined && param?.max !== undefined) {
    return String(raw);
  }
  return String(raw);
}

function paramValueToDisplay(
  patch: Patch,
  paramId: string,
): number | string | undefined {
  const value = patch.params[paramId];
  if (!value) return undefined;
  if (typeof value.value === "number" || typeof value.value === "string") {
    return value.value;
  }
  return undefined;
}

export function buildTonePreviewRows(patch: Patch, params: ParamDef[]): TonePreviewRow[] {
  const byId = new Map(params.map((param) => [param.id, param]));
  const rows: TonePreviewRow[] = [];

  for (const id of PREVIEW_PARAM_IDS) {
    const raw = paramValueToDisplay(patch, id);
    if (raw === undefined) continue;
    const def = byId.get(id);
    rows.push({
      id,
      label: def?.label ?? id,
      value: formatParamValue(def, raw),
      group: def?.group ?? "other",
    });
  }

  if (rows.length > 0) return rows;

  return Object.keys(patch.params)
    .slice(0, 12)
    .map((id) => {
      const def = byId.get(id);
      const raw = paramValueToDisplay(patch, id) ?? "?";
      return {
        id,
        label: def?.label ?? id,
        value: formatParamValue(def, raw),
        group: def?.group ?? "other",
      };
    });
}

export function toneParamCount(patch: Patch): number {
  return Object.keys(patch.params).length;
}
