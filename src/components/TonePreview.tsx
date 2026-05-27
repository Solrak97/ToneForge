import type { TonePreviewRow } from "../lib/tonePreview";
import type { ToneRecord } from "../types/library";
import type { ChannelInfo } from "../types/device";
import { channelLabel } from "../lib/channels";
import { toneParamCount } from "../lib/tonePreview";

const GROUP_LABELS: Record<string, string> = {
  amp: "Amp",
  fx_switch: "Switches",
  booster: "Booster",
  mod_fx: "Mod / FX",
  delay: "Delay",
  reverb: "Reverb",
  patch: "Patch",
  color: "Colors",
  other: "Other",
};

interface TonePreviewProps {
  tone: ToneRecord;
  rows: TonePreviewRow[];
  channels: ChannelInfo[];
  showHeader?: boolean;
}

export function TonePreview({
  tone,
  rows,
  channels,
  showHeader = true,
}: TonePreviewProps) {
  const grouped = new Map<string, TonePreviewRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.group) ?? [];
    list.push(row);
    grouped.set(row.group, list);
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      {showHeader && (
        <div>
          <p className="text-sm font-medium text-zinc-100">{tone.name}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {tone.device_model}
            {tone.channel !== undefined && tone.channel !== null
              ? ` · ${channelLabel(tone.channel, channels)}`
              : ""}
            · {toneParamCount(tone.patch)} params
          </p>
          {tone.notes && <p className="mt-2 text-xs text-zinc-400">{tone.notes}</p>}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500">No preview parameters in this tone.</p>
      ) : (
        <div className="max-h-48 space-y-3 overflow-y-auto">
          {Array.from(grouped.entries()).map(([group, groupRows]) => (
            <section key={group}>
              <h4 className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">
                {GROUP_LABELS[group] ?? group}
              </h4>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
                {groupRows.map((row) => (
                  <div key={row.id} className="contents">
                    <dt className="truncate text-[11px] text-zinc-500">{row.label}</dt>
                    <dd className="truncate text-right text-[11px] text-zinc-200">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
