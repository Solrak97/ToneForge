import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-950/70 backdrop-blur-sm shadow-lg",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pt-4 pb-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-sm font-semibold text-zinc-100", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}

/** Top-level page frame: always fills the space below the nav, header stays put. */
export function PageCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Card className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)} {...props} />;
}

/** Body of a `PageCard`; scrolls when the page is taller than the window. */
export function PageCardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-4", className)} {...props} />;
}
