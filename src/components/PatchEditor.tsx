import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/button";
import { CardHeader, CardTitle, PageCard, PageCardContent } from "./ui/card";
import { useToneForgeStore } from "../stores/toneforge";
import { ColorMemoryBar } from "./ColorMemoryBar";
import { formatParamLabelShort } from "../lib/paramLabels";
import {
  colorBlocksForEffectsTab,
  isActiveColorParam,
  paramMatchesColorMemory,
  readActiveColorIndex,
  type ColorPresetIndex,
} from "../lib/colorPresets";
import { saveLibraryTone, setParam } from "../lib/tauri-api";
import { Modal } from "./ui/modal";
import { Segmented } from "./ui/segmented";
import { fieldClass } from "./ui/field";
import type { ParamDef } from "../types/device";
import { ParamControl } from "./ParamControl";
import { paramValueToNumber, withParamValue } from "../lib/quickParams";
import { QuickEditor } from "./QuickEditor";

const GROUP_LABELS: Record<string, string> = {
  amp: "Amp",
  patch: "Patch",
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

type PatchEditorTab = "amp" | "effects" | "dynamics" | "eq" | "routing" | "all";
type EffectsSubTab = "all" | "booster" | "mod_fx" | "delay" | "reverb" | "fx_switch";
type ModFxSection = "mod" | "fx";
type DelaySection = "delay1" | "delay2";

type EditorView = "quick" | "advanced";
const EDITOR_VIEW_KEY = "toneforge.editorView";

export function PatchEditor() {
  const patch = useToneForgeStore((s) => s.patch);
  const params = useToneForgeStore((s) => s.params);
  const connection = useToneForgeStore((s) => s.connection);
  const busy = useToneForgeStore((s) => s.busy);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setBusy = useToneForgeStore((s) => s.setBusy);
  const setError = useToneForgeStore((s) => s.setError);
  const [pendingParam, setPendingParam] = useState<string | null>(null);
  const [view, setView] = useState<EditorView>(() =>
    localStorage.getItem(EDITOR_VIEW_KEY) === "advanced" ? "advanced" : "quick",
  );
  const [tab, setTab] = useState<PatchEditorTab>("amp");
  const [effectsTab, setEffectsTab] = useState<EffectsSubTab>("all");
  const [effectColor, setEffectColor] = useState<ColorPresetIndex>(0);
  const [modFxSection, setModFxSection] = useState<ModFxSection>("mod");
  const [delaySection, setDelaySection] = useState<DelaySection>("delay1");
  const lastColorBlockId = useRef<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveNotes, setSaveNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const colorBlock = useMemo(() => {
    if (tab !== "effects") return null;
    if (effectsTab === "all" || effectsTab === "fx_switch") return null;
    return colorBlocksForEffectsTab(effectsTab, modFxSection, delaySection);
  }, [tab, effectsTab, modFxSection, delaySection]);

  useEffect(() => {
    if (!colorBlock || !patch) return;
    if (lastColorBlockId.current === colorBlock.id) return;
    lastColorBlockId.current = colorBlock.id;
    setEffectColor(readActiveColorIndex(patch, colorBlock));
  }, [colorBlock, patch]);

  const allowedGroups = useMemo(() => {
    if (tab === "all") return null;
    if (tab === "amp") return new Set(["amp", "patch", "other"]);
    if (tab === "eq") return new Set(["eq", "contour"]);
    if (tab === "dynamics") return new Set(["noise_suppressor", "solo"]);
    if (tab === "routing") return new Set(["pedal_fx", "send_return", "assign", "other"]);
    // effects
    if (effectsTab === "all")
      return new Set(["booster", "mod_fx", "mod_fx_detail", "delay", "reverb", "fx_switch"]);
    if (effectsTab === "mod_fx") return new Set(["mod_fx", "mod_fx_detail"]);
    if (effectsTab === "delay") return new Set(["delay"]);
    return new Set([effectsTab]);
  }, [tab, effectsTab]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ParamDef[]>();
    for (const param of params) {
      if (param.wired === false) continue;
      if (isActiveColorParam(param.id)) continue;
      const group = param.group ?? "other";
      if (allowedGroups && !allowedGroups.has(group)) continue;
      if (colorBlock && !paramMatchesColorMemory(param, colorBlock, effectColor)) continue;
      const list = groups.get(group) ?? [];
      list.push(param);
      groups.set(group, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [params, allowedGroups, colorBlock, effectColor]);

  async function handleSetLiveColor(color: ColorPresetIndex) {
    if (!colorBlock || !patch || !connection.connected) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await setParam(colorBlock.activeColorParamId, color);
      setPatch(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

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
    setPatch(withParamValue(patch, params, paramId, value));
  }

  function openSaveModal() {
    setSaveName(patch?.meta.name?.trim() ?? "");
    setSaveNotes("");
    setSaveOpen(true);
  }

  async function handleSaveToLibrary() {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      await saveLibraryTone({ name, notes: saveNotes.trim(), tags: [] });
      setSaveOpen(false);
      setSavedNotice(`Saved “${name}”`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!savedNotice) return;
    const timer = setTimeout(() => setSavedNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [savedNotice]);

  function changeView(next: EditorView) {
    setView(next);
    localStorage.setItem(EDITOR_VIEW_KEY, next);
  }

  return (
    <PageCard>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Patch Editor</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {savedNotice && <span className="text-xs text-emerald-400">{savedNotice}</span>}
          <Button
            variant="secondary"
            className="h-9 py-0"
            disabled={!patch || busy}
            onClick={openSaveModal}
            title="Save this tone to your library"
          >
            Save to library
          </Button>
          <Segmented
            label="Editor view"
            options={[
              { value: "quick", label: "Quick" },
              { value: "advanced", label: "Advanced" },
            ]}
            value={view}
            onChange={changeView}
          />
        </div>
      </CardHeader>

      <Modal
        open={saveOpen}
        title="Save to library"
        onClose={() => setSaveOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSaveOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button disabled={saving || !saveName.trim()} onClick={() => void handleSaveToLibrary()}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <input
            className={fieldClass}
            placeholder="Tone name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && saveName.trim()) void handleSaveToLibrary();
            }}
            disabled={saving}
            autoFocus
          />
          <input
            className={fieldClass}
            placeholder="Notes (optional)"
            value={saveNotes}
            onChange={(e) => setSaveNotes(e.target.value)}
            disabled={saving}
          />
        </div>
      </Modal>

      <PageCardContent>
        {!patch ? (
          <p className="text-sm text-zinc-400">Connect to your Katana and read a patch to begin editing.</p>
        ) : view === "quick" ? (
          <QuickEditor
            patch={patch}
            params={params}
            disabled={!connection.connected || busy}
            pendingParam={pendingParam}
            onPreview={handleParamPreview}
            onCommit={(paramId, value) => void handleParamCommit(paramId, value)}
          />
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button variant={tab === "amp" ? "secondary" : "ghost"} disabled={busy} onClick={() => setTab("amp")}>
                  Amp
                </Button>
                <Button variant={tab === "effects" ? "secondary" : "ghost"} disabled={busy} onClick={() => setTab("effects")}>
                  Effects
                </Button>
                <Button variant={tab === "dynamics" ? "secondary" : "ghost"} disabled={busy} onClick={() => setTab("dynamics")}>
                  Dynamics
                </Button>
                <Button variant={tab === "eq" ? "secondary" : "ghost"} disabled={busy} onClick={() => setTab("eq")}>
                  EQ
                </Button>
                <Button variant={tab === "routing" ? "secondary" : "ghost"} disabled={busy} onClick={() => setTab("routing")}>
                  Routing
                </Button>
                <Button variant={tab === "all" ? "secondary" : "ghost"} disabled={busy} onClick={() => setTab("all")}>
                  All
                </Button>
              </div>

              {tab === "effects" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={effectsTab === "all" ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => setEffectsTab("all")}
                  >
                    All effects
                  </Button>
                  <Button
                    variant={effectsTab === "booster" ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => setEffectsTab("booster")}
                  >
                    Booster
                  </Button>
                  <Button
                    variant={effectsTab === "mod_fx" ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => setEffectsTab("mod_fx")}
                  >
                    Mod/FX
                  </Button>
                  <Button
                    variant={effectsTab === "delay" ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => setEffectsTab("delay")}
                  >
                    Delay
                  </Button>
                  <Button
                    variant={effectsTab === "reverb" ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => setEffectsTab("reverb")}
                  >
                    Reverb
                  </Button>
                  <Button
                    variant={effectsTab === "fx_switch" ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => setEffectsTab("fx_switch")}
                  >
                    Switches
                  </Button>
                </div>
              )}

              {tab === "effects" && effectsTab === "mod_fx" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={modFxSection === "mod" ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => setModFxSection("mod")}
                  >
                    Mod
                  </Button>
                  <Button
                    variant={modFxSection === "fx" ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => setModFxSection("fx")}
                  >
                    FX
                  </Button>
                </div>
              )}

              {tab === "effects" && effectsTab === "delay" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={delaySection === "delay1" ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => setDelaySection("delay1")}
                  >
                    Delay
                  </Button>
                  <Button
                    variant={delaySection === "delay2" ? "secondary" : "ghost"}
                    disabled={busy}
                    onClick={() => setDelaySection("delay2")}
                  >
                    Delay 2
                  </Button>
                </div>
              )}

              {colorBlock && patch && (
                <ColorMemoryBar
                  block={colorBlock}
                  patch={patch}
                  editingColor={effectColor}
                  disabled={busy}
                  onEditingColorChange={setEffectColor}
                  onLiveColorChange={(color) => void handleSetLiveColor(color)}
                />
              )}
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
                    const controlDisabled = !connection.connected || busy;
                    return (
                      <div key={param.id} className="rounded-lg border border-zinc-800 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <label className="text-sm text-zinc-200">
                            {formatParamLabelShort(param, { hideColorSlot: !!colorBlock })}
                          </label>
                          {pendingParam === param.id && (
                            <span className="text-xs text-orange-400">syncing…</span>
                          )}
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
      </PageCardContent>
    </PageCard>
  );
}
