import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Modal } from "./ui/modal";
import { TonePreview } from "./TonePreview";
import { useToneForgeStore } from "../stores/toneforge";
import { buildTonePreviewRows } from "../lib/tonePreview";
import { channelLabel } from "../lib/channels";
import {
  deleteLibraryTone,
  getLibraryTone,
  importLibraryToneFromAmp,
  importLibraryToneFromDialog,
  listLibraryTones,
  loadLibraryTone,
  saveLibraryTone,
} from "../lib/tauri-api";
import type { ToneRecord, ToneSummary } from "../types/library";

type DetailTab = "overview" | "notes";
type LibraryModal = "save" | "import" | null;

export function ToneLibraryPanel() {
  const patch = useToneForgeStore((s) => s.patch);
  const params = useToneForgeStore((s) => s.params);
  const connection = useToneForgeStore((s) => s.connection);
  const channels = useToneForgeStore((s) => s.channels);
  const busy = useToneForgeStore((s) => s.busy);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setBusy = useToneForgeStore((s) => s.setBusy);
  const setError = useToneForgeStore((s) => s.setError);

  const [tones, setTones] = useState<ToneSummary[]>([]);
  const [query, setQuery] = useState("");

  const [saveName, setSaveName] = useState("");
  const [saveNotes, setSaveNotes] = useState("");

  const [importName, setImportName] = useState("");
  const [importNotes, setImportNotes] = useState("");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [previewTone, setPreviewTone] = useState<ToneRecord | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [activeModal, setActiveModal] = useState<LibraryModal>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listLibraryTones(query.trim() || undefined);
      setTones(list);
      if (selectedId !== null && !list.some((tone) => tone.id === selectedId)) {
        setSelectedId(null);
        setPreviewTone(null);
      }
    } catch (err) {
      setError(String(err));
    }
  }, [query, selectedId, setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setDetailTab("overview");
  }, [selectedId]);

  useEffect(() => {
    if (selectedId === null) {
      setPreviewTone(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    void getLibraryTone(selectedId)
      .then((tone) => {
        if (!cancelled) setPreviewTone(tone);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, setError]);

  const previewRows = useMemo(() => {
    if (!previewTone) return [];
    return buildTonePreviewRows(previewTone.patch, params);
  }, [previewTone, params]);

  async function handleSave() {
    if (!saveName.trim() || !patch) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveLibraryTone({
        name: saveName.trim(),
        notes: saveNotes.trim(),
        tags: [],
      });
      setSaveName("");
      setSaveNotes("");
      await refresh();
      setSelectedId(saved.id);
      setActiveModal(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFromAmp() {
    setBusy(true);
    setError(null);
    try {
      const saved = await importLibraryToneFromAmp({
        name: importName.trim() || "Amp import",
        notes: importNotes.trim(),
        tags: [],
      });
      setImportName("");
      setImportNotes("");
      await refresh();
      setSelectedId(saved.id);
      setActiveModal(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFromFile() {
    setBusy(true);
    setError(null);
    try {
      const saved = await importLibraryToneFromDialog({
        name: importName.trim(),
        notes: importNotes.trim(),
        tags: [],
      });
      if (!saved) return;
      setImportName("");
      setImportNotes("");
      await refresh();
      setSelectedId(saved.id);
      setActiveModal(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(writeToDevice: boolean) {
    if (selectedId === null) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadLibraryTone(selectedId, writeToDevice);
      setPatch(loaded);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (selectedId === null) return;
    setBusy(true);
    setError(null);
    try {
      await deleteLibraryTone(selectedId);
      setSelectedId(null);
      setPreviewTone(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Tone Library</CardTitle>
        <Badge tone="neutral">{tones.length}</Badge>
      </CardHeader>

      <CardContent className="h-full">
        <Modal
          open={activeModal === "save"}
          title="Save tone"
          description="Save the currently loaded patch into your library."
          onClose={() => setActiveModal(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setActiveModal(null)} disabled={busy}>
                Cancel
              </Button>
              <Button disabled={busy || !patch || !saveName.trim()} onClick={() => void handleSave()}>
                Save
              </Button>
            </div>
          }
        >
          <div className="space-y-2">
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              placeholder="Tone name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              disabled={busy || !patch}
            />
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              placeholder="Notes (optional)"
              value={saveNotes}
              onChange={(e) => setSaveNotes(e.target.value)}
              disabled={busy || !patch}
            />
            {!patch && (
              <p className="text-xs text-zinc-500">Read a patch from the amp before saving.</p>
            )}
          </div>
        </Modal>

        <Modal
          open={activeModal === "import"}
          title="Import tone"
          description="Import from the amp (current channel) or from a ToneForge JSON preset."
          onClose={() => setActiveModal(null)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setActiveModal(null)} disabled={busy}>
                Close
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !connection.connected}
                onClick={() => void handleImportFromAmp()}
              >
                Import from amp
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void handleImportFromFile()}>
                Import from file
              </Button>
            </div>
          }
        >
          <div className="space-y-2">
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              placeholder="Name (optional)"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              disabled={busy}
            />
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
              placeholder="Notes (optional)"
              value={importNotes}
              onChange={(e) => setImportNotes(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-zinc-500">
              Import from amp reads the current channel. Import from file opens a JSON preset.
            </p>
          </div>
        </Modal>

        <div
          className="grid h-full gap-3"
          style={{ gridTemplateColumns: "1fr 1.25fr" }}
        >
          {/* Left: save/import + list */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={busy || !patch}
                onClick={() => setActiveModal("save")}
              >
                Save…
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setActiveModal("import")}
              >
                Import…
              </Button>
            </div>

            <div className="space-y-2">
              <input
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                placeholder="Search tones…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={busy}
              />
              <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>
                Refresh
              </Button>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto">
              {tones.length === 0 ? (
                <p className="text-sm text-zinc-500">No saved tones yet.</p>
              ) : (
                tones.map((tone) => (
                  <button
                    key={tone.id}
                    type="button"
                    onClick={() => setSelectedId(tone.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      selectedId === tone.id
                        ? "border-orange-500/60 bg-orange-500/10"
                        : "border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-100 truncate">{tone.name}</span>
                      {tone.channel !== undefined && tone.channel !== null && (
                        <span className="text-[10px] text-zinc-500 shrink-0">
                          {channelLabel(tone.channel, channels)}
                        </span>
                      )}
                    </div>
                    {tone.notes && (
                      <p className="mt-1 truncate text-xs text-zinc-500">{tone.notes}</p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: preview/details */}
          <div className="space-y-3">
            {!previewTone ? (
              <div className="rounded-lg border border-zinc-800 p-3">
                <p className="text-sm text-zinc-300">Select a tone to preview</p>
                <p className="text-xs text-zinc-500 mt-2">
                  Load it into the editor or send to the amp.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-zinc-800 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-100 truncate">
                        {previewTone.name}
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">
                        {previewTone.device_model}
                        {previewTone.channel !== undefined &&
                        previewTone.channel !== null
                          ? ` · ${channelLabel(previewTone.channel, channels)}`
                          : ""}
                      </p>
                      {previewTone.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {previewTone.tags.slice(0, 5).map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      variant={detailTab === "overview" ? "secondary" : "ghost"}
                      disabled={previewLoading}
                      onClick={() => setDetailTab("overview")}
                    >
                      Overview
                    </Button>
                    <Button
                      variant={detailTab === "notes" ? "secondary" : "ghost"}
                      disabled={previewLoading}
                      onClick={() => setDetailTab("notes")}
                    >
                      Notes
                    </Button>
                  </div>

                  <div className="mt-3">
                    {previewLoading ? (
                      <p className="text-xs text-zinc-500">Loading preview…</p>
                    ) : detailTab === "overview" ? (
                      <TonePreview
                        tone={previewTone}
                        rows={previewRows}
                        channels={channels}
                        showHeader={false}
                      />
                    ) : (
                      <div>
                        <p className="text-xs uppercase tracking-wide text-zinc-500">
                          Tone notes
                        </p>
                        <textarea
                          className="mt-2 w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                          readOnly
                          value={previewTone.notes ?? ""}
                          rows={8}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy || !previewTone}
                    onClick={() => void handleLoad(false)}
                  >
                    Load in editor
                  </Button>
                  <Button
                    disabled={busy || !connection.connected || !previewTone}
                    onClick={() => void handleLoad(true)}
                  >
                    Send to amp
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void handleDelete()}
                  >
                    Delete
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
