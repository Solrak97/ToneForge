import { useEffect, useMemo, useState } from "react";
import { ParamControl } from "./ParamControl";
import { COLOR_PRESETS, memorySlotForColor, readActiveColorIndex, type ColorPresetIndex } from "../lib/colorPresets";
import {
  blockVersions,
  isBlockEnabled,
  paramValueToNumber,
  QUICK_BLOCKS,
  quickLabel,
} from "../lib/quickParams";
import { cn } from "../lib/utils";
import type { ParamDef, Patch } from "../types/device";

export function QuickEditor({
  patch,
  params,
  disabled,
  pendingParam,
  onPreview,
  onCommit,
}: {
  patch: Patch;
  params: ParamDef[];
  disabled: boolean;
  pendingParam: string | null;
  onPreview: (paramId: string, value: number) => void;
  onCommit: (paramId: string, value: number) => void;
}) {
  const paramsById = useMemo(() => new Map(params.map((p) => [p.id, p])), [params]);
  /** Color memory being edited per block, when it isn't the live one. */
  const [editing, setEditing] = useState<Record<string, ColorPresetIndex>>({});

  const liveColors = QUICK_BLOCKS.map((block) =>
    block.color ? readActiveColorIndex(patch, block.color) : null,
  );
  const liveKey = liveColors.join(",");
  // Once a version goes live (here or from the amp's buttons), editing follows the live color again.
  useEffect(() => {
    setEditing((current) => {
      const next = { ...current };
      QUICK_BLOCKS.forEach((block, i) => {
        if (next[block.title] === liveColors[i]) delete next[block.title];
      });
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [liveKey]);

  return (
    <div className="@container">
      <div className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
        {QUICK_BLOCKS.map((block, blockIndex) => {
          const liveColor = liveColors[blockIndex];
          const editColor = editing[block.title] ?? liveColor;
          const versions = blockVersions(block, patch, paramsById);
          const enabled = isBlockEnabled(block, patch);
          const slot = block.color && editColor !== null ? memorySlotForColor(block.color, editColor) : 0;
          const defs = block
            .paramIds(slot, patch, params)
            .map((id) => paramsById.get(id))
            .filter((p): p is ParamDef => !!p);
          const editingOther = editColor !== null && editColor !== liveColor;

          return (
            <section key={block.title} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <header className="mb-3 space-y-2">
                <div className="flex h-7 items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {block.switchId && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onCommit(block.switchId!, enabled ? 0 : 1)}
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition",
                          enabled
                            ? "border-orange-500/60 bg-orange-500/20 text-orange-300"
                            : "border-zinc-700 text-zinc-500 hover:text-zinc-300",
                          disabled && "opacity-50 pointer-events-none",
                        )}
                      >
                        {enabled ? "On" : "Off"}
                      </button>
                    )}
                    <h3 className="text-sm font-medium text-zinc-100">{block.title}</h3>
                  </div>
                  {editingOther && block.color && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onCommit(block.color!.activeColorParamId, editColor)}
                      title={`Play the ${COLOR_PRESETS[editColor].label} version, like pressing the color button on the amp`}
                      className="h-7 rounded-md border border-zinc-700 px-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-50"
                    >
                      Make live
                    </button>
                  )}
                </div>

                {versions.length > 0 && (
                  <div
                    role="radiogroup"
                    aria-label={`${block.title} version to edit`}
                    className="grid grid-cols-3 gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-0.5"
                  >
                    {versions.map((version) => {
                      const preset = COLOR_PRESETS[version.color];
                      const selected = version.color === editColor;
                      return (
                        <button
                          key={version.color}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={disabled}
                          title={`${preset.label}: ${version.typeLabel ?? "—"}${version.live ? " (live)" : ""}`}
                          onClick={() =>
                            setEditing((current) => {
                              const next = { ...current };
                              if (version.color === liveColor) delete next[block.title];
                              else next[block.title] = version.color;
                              return next;
                            })
                          }
                          className={cn(
                            "flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition disabled:pointer-events-none",
                            selected ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-200",
                          )}
                        >
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              preset.dotClass,
                              version.live
                                ? cn("ring-2 ring-offset-1 ring-offset-zinc-950", preset.ringClass)
                                : "opacity-50",
                            )}
                          />
                          <span className="truncate">{version.typeLabel ?? preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </header>

              <div className={cn("space-y-3", !enabled && "opacity-50")}>
                {defs.map((param) => (
                  <div key={param.id}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-zinc-400">{quickLabel(param.id)}</span>
                      {pendingParam === param.id && <span className="text-orange-400">syncing…</span>}
                    </div>
                    <ParamControl
                      param={param}
                      value={paramValueToNumber(patch.params[param.id])}
                      disabled={disabled}
                      onChange={(value) => onPreview(param.id, value)}
                      onCommit={(value) => onCommit(param.id, value)}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
