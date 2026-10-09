import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface SegmentedOption<T> {
  value: T;
  label: string;
  /** Shown instead of the label, which then becomes the tooltip and accessible name. */
  icon?: ReactNode;
}

/** Pick one of a few options (view modes, tabs, amp channels). Same height as fields and buttons. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Accessible name for the group. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex h-9 shrink-0 items-center rounded-lg border border-zinc-700 bg-zinc-950 p-0.5",
        disabled && "opacity-50",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.icon ? option.label : undefined}
            title={option.icon ? option.label : undefined}
            disabled={disabled}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            className={cn(
              "flex h-full items-center rounded-md text-sm transition disabled:pointer-events-none",
              option.icon ? "px-2" : "px-3",
              selected ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            {option.icon ?? option.label}
          </button>
        );
      })}
    </div>
  );
}
