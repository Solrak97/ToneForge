import { useEffect, useState } from "react";
import type { ParamDef } from "../types/device";

export function ParamControl({
  param,
  value,
  disabled,
  onChange,
  onCommit,
}: {
  param: ParamDef;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const min = param.min ?? 0;
  const max = param.max ?? 100;
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (param.kind === "enum" && param.options?.length) {
    return (
      <select
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
        value={value}
        disabled={disabled}
        onChange={(e) => onCommit(Number(e.target.value))}
      >
        {param.options.map((option, index) => (
          <option key={option} value={index}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-1">
      <input
        type="range"
        min={min}
        max={max}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          setDraft(next);
          onChange(next);
        }}
        onPointerUp={() => onCommit(draft)}
        onKeyUp={() => onCommit(draft)}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{min}</span>
        <span className="text-zinc-300">{draft}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
