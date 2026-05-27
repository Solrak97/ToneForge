import { useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { useToneForgeStore } from "../stores/toneforge";
import { loadPresetFromDialog, savePresetToDialog, setParam } from "../lib/tauri-api";
import type { ParamDef, ParamValue } from "../types/device";

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
}: {
  param: ParamDef;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const min = param.min ?? 0;
  const max = param.max ?? 100;

  if (param.kind === "enum" && param.options?.length) {
    return (
      <select
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
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
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{min}</span>
        <span className="text-zinc-300">{value}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

export function PatchEditor() {
  const patch = useToneForgeStore((s) => s.patch);
  const params = useToneForgeStore((s) => s.params);
  const connection = useToneForgeStore((s) => s.connection);
  const busy = useToneForgeStore((s) => s.busy);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setBusy = useToneForgeStore((s) => s.setBusy);
  const setError = useToneForgeStore((s) => s.setError);
  const [pendingParam, setPendingParam] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const groups = new Map<string, ParamDef[]>();
    for (const param of params) {
      const group = param.group ?? "other";
      const list = groups.get(group) ?? [];
      list.push(param);
      groups.set(group, list);
    }
    return Array.from(groups.entries());
  }, [params]);

  async function handleParamChange(paramId: string, value: number) {
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
                {patch.meta.device_model} · Channel {patch.meta.channel ?? "?"}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {Object.keys(patch.params).length} parameters loaded
              </p>
            </div>

            {grouped.map(([group, groupParams]) => (
              <section key={group} className="space-y-3">
                <h3 className="text-xs uppercase tracking-wide text-zinc-500">{group}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {groupParams.map((param) => {
                    const current = paramValueToNumber(patch.params[param.id]);
                    return (
                      <div key={param.id} className="rounded-lg border border-zinc-800 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <label className="text-sm text-zinc-200">{param.label}</label>
                          {pendingParam === param.id && (
                            <span className="text-xs text-orange-400">syncing…</span>
                          )}
                        </div>
                        <ParamControl
                          param={param}
                          value={current}
                          disabled={!connection.connected || busy}
                          onChange={(value) => void handleParamChange(param.id, value)}
                        />
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
