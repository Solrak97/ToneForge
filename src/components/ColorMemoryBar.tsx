import {
  COLOR_PRESETS,
  readActiveColorIndex,
  type ColorBlockConfig,
  type ColorPresetIndex,
} from "../lib/colorPresets";
import type { Patch } from "../types/device";
import { cn } from "../lib/utils";

export function ColorMemoryBar({
  block,
  patch,
  editingColor,
  disabled,
  onEditingColorChange,
  onLiveColorChange,
}: {
  block: ColorBlockConfig;
  patch: Patch;
  editingColor: ColorPresetIndex;
  disabled?: boolean;
  onEditingColorChange: (color: ColorPresetIndex) => void;
  onLiveColorChange: (color: ColorPresetIndex) => void;
}) {
  const liveColor = readActiveColorIndex(patch, block);
  const editingLabel = COLOR_PRESETS[editingColor]?.label ?? "Green";

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-3">
      <p className="text-xs text-zinc-500">
        Three color presets per block — switch which one you edit, then set which one is live on
        the amp.
      </p>

      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-zinc-500">Editing preset</p>
        <div
          className="inline-flex rounded-lg border border-zinc-700 bg-zinc-950 p-0.5"
          role="tablist"
          aria-label={`${block.label} color preset`}
        >
          {COLOR_PRESETS.map((preset) => {
            const active = editingColor === preset.index;
            return (
              <button
                key={preset.index}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => onEditingColorChange(preset.index)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition",
                  active
                    ? "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80",
                  disabled && "opacity-50 pointer-events-none",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full shrink-0", preset.dotClass)} />
                {preset.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-zinc-500">
          Controls below apply to the <span className="text-zinc-300">{editingLabel}</span> memory.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] uppercase tracking-wide text-zinc-500" htmlFor={`live-${block.id}`}>
          Live on amp
        </label>
        <select
          id={`live-${block.id}`}
          className="w-full max-w-xs rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          value={liveColor}
          disabled={disabled}
          onChange={(e) => onLiveColorChange(Number(e.target.value) as ColorPresetIndex)}
        >
          {COLOR_PRESETS.map((preset) => (
            <option key={preset.index} value={preset.index}>
              {preset.label}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-zinc-600">
          Same as pressing the {block.label.toLowerCase()} color button on the amp.
        </p>
      </div>
    </div>
  );
}
