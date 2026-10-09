import { useEffect, useMemo, useState } from "react";
import { getLibraryTone } from "../lib/tauri-api";
import { compareTones } from "../lib/toneCompare";
import type { ParamDef, Patch } from "../types/device";
import type { ToneRecord, ToneSummary } from "../types/library";

const CURRENT = "current";

export function ToneCompare({
  tone,
  tones,
  currentPatch,
  params,
}: {
  tone: ToneRecord;
  tones: ToneSummary[];
  currentPatch: Patch | null;
  params: ParamDef[];
}) {
  const others = tones.filter((t) => t.id !== tone.id);
  const [target, setTarget] = useState<string>(
    currentPatch ? CURRENT : others[0] ? String(others[0].id) : "",
  );
  const [targetTone, setTargetTone] = useState<ToneRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTargetTone(null);
    setError(null);
    if (!target || target === CURRENT) return;
    let cancelled = false;
    void getLibraryTone(Number(target))
      .then((t) => !cancelled && setTargetTone(t))
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [target]);

  const otherPatch = target === CURRENT ? currentPatch : targetTone?.patch ?? null;
  const otherName = target === CURRENT ? "Current" : targetTone?.name ?? "…";

  const diff = useMemo(
    () => (otherPatch ? compareTones(tone.patch, otherPatch, params) : null),
    [tone.patch, otherPatch, params],
  );

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        Compare with
        <select
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {currentPatch && <option value={CURRENT}>Current patch (editor / amp)</option>}
          {others.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {!target && <p className="text-xs text-zinc-500">Nothing to compare with yet.</p>}
      {target && !diff && !error && <p className="text-xs text-zinc-500">Loading…</p>}

      {diff && (
        <>
          {diff.sections.length === 0 ? (
            <p className="text-sm text-zinc-300">These sound the same: no audible settings differ.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-md border border-zinc-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-normal">Setting</th>
                    <th className="px-2 py-1.5 text-right font-normal truncate max-w-[8rem]">{tone.name}</th>
                    <th className="px-2 py-1.5 text-right font-normal truncate max-w-[8rem]">{otherName}</th>
                  </tr>
                </thead>
                {diff.sections.map((section) => (
                  <tbody key={section.title}>
                    <tr>
                      <td colSpan={3} className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-zinc-600">
                        {section.title}
                      </td>
                    </tr>
                    {section.rows.map((row) => (
                      <tr key={row.id} className="border-t border-zinc-800/60">
                        <td className="px-2 py-1 text-zinc-400">{row.label}</td>
                        <td className="px-2 py-1 text-right text-zinc-100">{row.a}</td>
                        <td className="px-2 py-1 text-right text-orange-300">{row.b}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          <p className="text-[11px] text-zinc-600">
            {diff.rawDifferences} stored values differ in total, including inactive colors and effect types.
          </p>
        </>
      )}
    </div>
  );
}
