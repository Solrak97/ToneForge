import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { getAgentSettings, setAgentSettings } from "../lib/tauri-api";
import { useAgentStore } from "../stores/agent";
import { cn } from "../lib/utils";
import { fieldClass, textAreaClass } from "./ui/field";
import type { AgentMode, AgentSettings, UserPreferences } from "../types/agent";

/** LLM provider and tone preferences for the Agent chat. */
export function AgentSettingsSection() {
  const settings = useAgentStore((s) => s.settings);
  const setSettings = useAgentStore((s) => s.setSettings);
  const [draft, setDraft] = useState<AgentSettings | null>(settings);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getAgentSettings()
      .then((loaded) => {
        setSettings(loaded);
        setDraft(loaded);
      })
      .catch((err) => setError(String(err)));
  }, [setSettings]);

  if (!draft) {
    return <p className="text-xs text-zinc-500">{error ?? "Loading agent settings…"}</p>;
  }

  const update = (patch: Partial<AgentSettings>) => {
    setDraft({ ...draft, ...patch });
    setStatus("idle");
  };
  const updatePrefs = (patch: Partial<UserPreferences>) =>
    update({ preferences: { ...draft.preferences, ...patch } });

  async function handleSave() {
    if (!draft) return;
    setStatus("saving");
    setError(null);
    try {
      const saved = await setAgentSettings(draft);
      setSettings(saved);
      setDraft(saved);
      setStatus("saved");
    } catch (err) {
      setError(String(err));
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Mode">
          <select
            className={fieldClass}
            value={draft.mode}
            onChange={(e) => update({ mode: e.target.value as AgentMode })}
          >
            <option value="cursor">Cursor agent</option>
            <option value="auto">Auto (local then cloud)</option>
            <option value="local">Local only</option>
            <option value="cloud">Cloud only</option>
          </select>
        </Field>
        {draft.mode === "cursor" ? (
          <>
            <Field label="Cursor model">
              <input
                className={fieldClass}
                value={draft.cursor_model}
                onChange={(e) => update({ cursor_model: e.target.value })}
              />
            </Field>
            <Field label="Cursor API key" wide>
              <input
                type="password"
                className={fieldClass}
                value={draft.cursor_api_key}
                onChange={(e) => update({ cursor_api_key: e.target.value })}
                placeholder="Leave empty to use CURSOR_API_KEY"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Local model">
              <input
                className={fieldClass}
                value={draft.local_model}
                onChange={(e) => update({ local_model: e.target.value })}
              />
            </Field>
            <Field label="Local base URL" wide>
              <input
                className={fieldClass}
                value={draft.local_base_url}
                onChange={(e) => update({ local_base_url: e.target.value })}
              />
            </Field>
            <Field label="Cloud model">
              <input
                className={fieldClass}
                value={draft.cloud_model}
                onChange={(e) => update({ cloud_model: e.target.value })}
              />
            </Field>
            <Field label="Cloud API key">
              <input
                type="password"
                className={fieldClass}
                value={draft.cloud_api_key}
                onChange={(e) => update({ cloud_api_key: e.target.value })}
                placeholder="sk-…"
              />
            </Field>
            <Field label="Cloud base URL" wide>
              <input
                className={fieldClass}
                value={draft.cloud_base_url}
                onChange={(e) => update({ cloud_base_url: e.target.value })}
              />
            </Field>
          </>
        )}
      </div>

      <div className="space-y-2 border-t border-zinc-800 pt-3">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Tone preferences</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Volume min">
            <input
              type="number"
              min={0}
              max={100}
              className={fieldClass}
              value={draft.preferences.preferred_volume_min}
              onChange={(e) => updatePrefs({ preferred_volume_min: Number(e.target.value) })}
            />
          </Field>
          <Field label="Volume max">
            <input
              type="number"
              min={0}
              max={100}
              className={fieldClass}
              value={draft.preferences.preferred_volume_max}
              onChange={(e) => updatePrefs({ preferred_volume_max: Number(e.target.value) })}
            />
          </Field>
          <label className="flex items-end gap-2 pb-1.5">
            <input
              type="checkbox"
              checked={draft.preferences.avoid_wobble_fx}
              onChange={(e) => updatePrefs({ avoid_wobble_fx: e.target.checked })}
            />
            <span className="text-xs text-zinc-300">Avoid wobble FX</span>
          </label>
        </div>
        <Field label="Notes (pickups, guitar, room…)">
          <textarea
            className={cn(textAreaClass, "min-h-[60px]")}
            value={draft.preferences.notes}
            onChange={(e) => updatePrefs({ notes: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-3">
        {error && <p className="mr-auto break-words text-xs text-red-400">{error}</p>}
        {status === "saved" && <span className="text-xs text-emerald-400">Saved</span>}
        <Button
          variant="secondary"
          disabled={status === "saving" || !settings}
          onClick={() => {
            setDraft(settings);
            setStatus("idle");
          }}
        >
          Reset
        </Button>
        <Button disabled={status === "saving"} onClick={() => void handleSave()}>
          Save agent settings
        </Button>
      </div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={cn("block space-y-1", wide && "md:col-span-2")}>
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
