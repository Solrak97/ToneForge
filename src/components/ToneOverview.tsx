import { useMemo } from "react";
import { ToneChain } from "./ToneChain";
import { COLOR_PRESETS } from "../lib/colorPresets";
import { blockVersions, isBlockEnabled, paramValueToNumber, QUICK_BLOCKS } from "../lib/quickParams";
import { ampTypeLabel, patchReader, toneChain } from "../lib/toneChain";
import { cn } from "../lib/utils";
import type { ParamDef, Patch } from "../types/device";

const AMP_KNOBS = ["gain", "volume", "bass", "middle", "treble", "presence"] as const;

/** Read-only summary of a tone: chain, amp settings, effect versions and notes. Editing lives in its own tab. */
export function ToneOverview({ patch, params, notes }: { patch: Patch; params: ParamDef[]; notes: string }) {
  const paramsById = useMemo(() => new Map(params.map((p) => [p.id, p])), [params]);
  const read = patchReader(patch);
  const amp = ampTypeLabel(read, params);
  return (
    <div className="space-y-6">
      <ToneChain chain={toneChain(read)} size="labeled" />

      <section className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Amp{amp ? <span className="ml-2 normal-case tracking-normal text-zinc-300">{amp}</span> : null}
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {AMP_KNOBS.map((knob) => {
            const id = `patch_amp_${knob}`;
            const def = paramsById.get(id);
            const value = paramValueToNumber(patch.params[id]);
            const min = def?.min ?? 0;
            const max = def?.max ?? 100;
            const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
            return (
              <div key={knob} className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">{def?.label.replace(/^Amp /, "") ?? knob}</span>
                  <span className="tabular-nums text-zinc-300">{value}</span>
                </div>
                <div className="h-1 rounded-full bg-zinc-800">
                  <div className="h-1 rounded-full bg-zinc-400" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Effects</h3>
        <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] items-center gap-x-3 gap-y-1.5 text-xs">
          {QUICK_BLOCKS.filter((block) => block.color).map((block) => {
            const enabled = isBlockEnabled(block, patch);
            return [
              <span key={block.title} className={enabled ? "text-zinc-300" : "text-zinc-600"}>
                {block.title}
                {!enabled && <span className="ml-1.5 text-[10px] uppercase">off</span>}
              </span>,
              ...blockVersions(block, patch, paramsById).map((version) => {
                const preset = COLOR_PRESETS[version.color];
                return (
                  <span
                    key={`${block.title}-${version.color}`}
                    title={`${preset.label}${version.live ? " (live)" : ""}`}
                    className={cn(
                      "flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1",
                      version.live && enabled ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-500",
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        preset.dotClass,
                        !(version.live && enabled) && "opacity-40",
                      )}
                    />
                    <span className="truncate">{version.typeLabel ?? preset.label}</span>
                  </span>
                );
              }),
            ];
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Notes</h3>
        <p className="whitespace-pre-wrap text-sm text-zinc-300">
          {notes.trim() || <span className="text-zinc-600">No notes.</span>}
        </p>
      </section>
    </div>
  );
}
