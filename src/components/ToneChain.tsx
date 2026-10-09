import { COLOR_PRESETS } from "../lib/colorPresets";
import type { ChainBlock, ChainSlot } from "../lib/toneChain";
import { cn } from "../lib/utils";

function slotClass(slot: ChainSlot): string {
  if (slot === "off") return "bg-zinc-800";
  if (slot === "amp") return "bg-orange-500";
  return COLOR_PRESETS[slot].dotClass;
}

function slotTitle(block: ChainBlock): string {
  if (block.slot === "off") return `${block.label}: off`;
  if (block.slot === "amp") return block.label;
  return `${block.label}: ${COLOR_PRESETS[block.slot].label}`;
}

/**
 * The tone's signal chain at a glance: one block per stage, colored by its live memory and dark
 * when bypassed. `labeled` adds the stage names underneath.
 */
export function ToneChain({
  chain,
  size = "sm",
  className,
}: {
  chain: ChainBlock[];
  size?: "sm" | "md" | "labeled";
  className?: string;
}) {
  if (size === "labeled") {
    return (
      <div className={cn("flex gap-1.5", className)}>
        {chain.map((block) => (
          <div key={block.id} title={slotTitle(block)} className="flex flex-col items-center gap-1">
            <span className={cn("h-5 w-10 rounded", slotClass(block.slot))} />
            <span
              className={cn(
                "text-[10px] font-medium tracking-wide",
                block.slot === "off" ? "text-zinc-600" : "text-zinc-400",
              )}
            >
              {block.short}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      className={cn("flex shrink-0", size === "md" ? "gap-1" : "gap-0.5", className)}
      aria-label={chain.map(slotTitle).join(", ")}
      title={chain.map(slotTitle).join(" · ")}
    >
      {chain.map((block) => (
        <span
          key={block.id}
          className={cn("rounded-[2px]", size === "md" ? "h-3 w-3" : "h-2 w-2", slotClass(block.slot))}
        />
      ))}
    </div>
  );
}
