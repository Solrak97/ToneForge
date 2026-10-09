/**
 * Single-line controls (input, select) share one explicit height: WebKit ignores vertical
 * padding on native selects, so padding alone leaves them thinner than text inputs.
 */
export const fieldClass =
  "h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100";

export const textAreaClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100";
