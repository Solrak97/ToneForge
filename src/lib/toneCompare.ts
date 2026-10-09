import { colorNameForSlot, liveSlot, QUICK_BLOCKS, quickLabel } from "./quickParams";
import type { ParamDef, Patch } from "../types/device";

export interface ToneDiffRow {
  id: string;
  label: string;
  a: string;
  b: string;
}

export interface ToneDiffSection {
  title: string;
  rows: ToneDiffRow[];
}

export interface ToneDiff {
  sections: ToneDiffSection[];
  /** Every stored value that differs, including inactive colors and effect types. */
  rawDifferences: number;
}

function display(patch: Patch, id: string, def: ParamDef | undefined, isSwitch: boolean): string {
  const value = patch.params[id]?.value;
  if (value === undefined) return "—";
  if (typeof value !== "number") return String(value);
  if (isSwitch) return value === 1 ? "On" : "Off";
  if (def?.kind === "enum" && def.options?.[value]) return def.options[value];
  return String(value);
}

/** Differences you can hear: live colors, selected effect types and their settings. */
export function compareTones(a: Patch, b: Patch, params: ParamDef[]): ToneDiff {
  const byId = new Map(params.map((p) => [p.id, p]));

  const sections = QUICK_BLOCKS.map((block) => {
    const slotA = liveSlot(block, a);
    const slotB = liveSlot(block, b);
    const ids = [
      ...(block.switchId ? [block.switchId] : []),
      ...(block.color ? [block.color.activeColorParamId] : []),
      ...block.paramIds(slotA, a, params),
      ...block.paramIds(slotB, b, params),
    ];

    const rows: ToneDiffRow[] = [];
    for (const id of new Set(ids)) {
      const isSwitch = id === block.switchId;
      const valueA = display(a, id, byId.get(id), isSwitch);
      const valueB = display(b, id, byId.get(id), isSwitch);
      if (valueA === valueB) continue;

      let label = isSwitch ? "On / Off" : id === block.color?.activeColorParamId ? "Live color" : quickLabel(id);
      const color = slotA !== slotB ? colorNameForSlot(block, id) : null;
      if (color) label += ` (${color})`;
      rows.push({ id, label, a: valueA, b: valueB });
    }
    return { title: block.title, rows };
  }).filter((section) => section.rows.length > 0);

  const keys = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  let rawDifferences = 0;
  for (const key of keys) {
    if (a.params[key]?.value !== b.params[key]?.value) rawDifferences += 1;
  }

  return { sections, rawDifferences };
}
