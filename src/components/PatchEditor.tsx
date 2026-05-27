import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { useToneForgeStore } from "../stores/toneforge";
import { channelLabel } from "../lib/channels";
import { loadPresetFromDialog, savePresetToDialog, setParam } from "../lib/tauri-api";
import type { ParamDef, ParamValue } from "../types/device";

const GROUP_LABELS: Record<string, string> = {
  amp: "Amp",
  patch: "Patch",
  color: "Effect Colors",
  fx_switch: "Effect Switches",
  booster: "Booster",
  mod_fx: "Mod / FX",
  mod_fx_detail: "Mod / FX Detail",
  delay: "Delay",
  reverb: "Reverb",
  noise_suppressor: "Noise Suppressor",
  solo: "Solo",
  eq: "EQ",
  contour: "Contour",
  pedal_fx: "Pedal FX",
  send_return: "Send / Return",
  assign: "Assignments",
  other: "Other",
};

function paramValueToNumber(value?: ParamValue): number {
  if (!value) return 0;
  if (typeof value.value === "number") return value.value;
  return 0;
}

function ParamControl({
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

export function PatchEditor() {
  const patch = useToneForgeStore((s) => s.patch);
  const params = useToneForgeStore((s) => s.params);
  const connection = useToneForgeStore((s) => s.connection);
  const channels = useToneForgeStore((s) => s.channels);
  const busy = useToneForgeStore((s) => s.busy);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setBusy = useToneForgeStore((s) => s.setBusy);
  const setError = useToneForgeStore((s) => s.setError);
  const [pendingParam, setPendingParam] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const stats = useMemo(() => {
    const wired = params.filter((p) => p.wired !== false).length;
    return { total: params.length, wired };
  }, [params]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ParamDef[]>();
    for (const param of params) {
      if (!showCatalog && param.wired === false) continue;
      const group = param.group ?? "other";
      const list = groups.get(group) ?? [];
      list.push(param);
      groups.set(group, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [params, showCatalog]);

  async function handleParamCommit(paramId: string, value: number) {
    if (!connection.connected) return;
    setPendingParam(paramId);
    setBusy(true);
    setError(null);
    try {
      const updated = await setParam(paramId, value);
      setPatch(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setPendingParam(null);
      setBusy(false);
    }
  }

  function handleParamPreview(paramId: string, value: number) {
    if (!patch) return;
    setPatch({
      ...patch,
      params: {
        ...patch.params,
        [paramId]: { type: "u8", value },
      },
    });
  }

  async function handleSavePreset() {
    setBusy(true);
    setError(null);
    try {
      await savePresetToDialog();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadPreset() {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadPresetFromDialog();
      setPatch(loaded);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Patch Editor</CardTitle>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!patch || busy} onClick={() => void handleSavePreset()}>
            Save JSON
          </Button>
          <Button variant="secondary" disabled={!connection.connected || busy} onClick={() => void handleLoadPreset()}>
            Load JSON
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!patch ? (
          <p className="text-sm text-zinc-400">Connect to your Katana and read a patch to begin editing.</p>
        ) : (
          <div className="space-y-5">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
              <p className="text-zinc-300">
                {patch.meta.device_model} ·{" "}
                {patch.meta.channel !== undefined && patch.meta.channel !== null
                  ? channelLabel(patch.meta.channel, channels)
                  : "Unknown channel"}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {Object.keys(patch.params).length} values loaded · {stats.wired} wired / {stats.total} catalogued
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={showCatalog}
                  onChange={(e) => setShowCatalog(e.target.checked)}
                />
                Show full parameter catalog (includes placeholders)
              </label>
            </div>

            {grouped.map(([group, groupParams]) => (
              <section key={group} className="space-y-3">
                <h3 className="text-xs uppercase tracking-wide text-zinc-500">
                  {GROUP_LABELS[group] ?? group}
                  <span className="ml-2 normal-case text-zinc-600">({groupParams.length})</span>
                </h3>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {groupParams.map((param) => {
                    const current = paramValueToNumber(patch.params[param.id]);
                    const isWired = param.wired !== false;
                    const controlDisabled = !connection.connected || busy || !isWired;
                    return (
                      <div
                        key={param.id}
                        className={`rounded-lg border p-3 ${isWired ? "border-zinc-800" : "border-zinc-800/60 opacity-70"}`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <label className="text-sm text-zinc-200">{param.label}</label>
                          <div className="flex items-center gap-1">
                            {!isWired && (
                              <Badge tone="neutral">Soon</Badge>
                            )}
                            {pendingParam === param.id && (
                              <span className="text-xs text-orange-400">syncing…</span>
                            )}
                          </div>
                        </div>
                        <ParamControl
                          param={param}
                          value={current}
                          disabled={controlDisabled}
                          onChange={(value) => handleParamPreview(param.id, value)}
                          onCommit={(value) => void handleParamCommit(param.id, value)}
                        />
                        {param.bts_name && (
                          <p className="mt-2 truncate text-[10px] text-zinc-600" title={param.bts_name}>
                            {param.bts_name} · {param.address.map((b) => b.toString(16).padStart(2, "0")).join(" ")}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
