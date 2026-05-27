import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { useToneForgeStore } from "../stores/toneforge";
import { channelLabel } from "../lib/channels";
import {
  deleteLibraryTone,
  listLibraryTones,
  loadLibraryTone,
  saveLibraryTone,
} from "../lib/tauri-api";
import type { ToneSummary } from "../types/library";

function formatTimestamp(raw: string): string {
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs <= 0) return raw;
  return new Date(secs * 1000).toLocaleString();
}

export function ToneLibraryPanel() {
  const patch = useToneForgeStore((s) => s.patch);
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
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listLibraryTones(query.trim() || undefined);
      setTones(list);
    } catch (err) {
      setError(String(err));
    }
  }, [query, setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSave() {
    if (!saveName.trim() || !patch) return;
    setBusy(true);
    setError(null);
    try {
      await saveLibraryTone({
        name: saveName.trim(),
        notes: saveNotes.trim(),
        tags: [],
      });
      setSaveName("");
      setSaveNotes("");
      await refresh();
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
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const selected = tones.find((tone) => tone.id === selectedId) ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Tone Library</CardTitle>
        <Badge tone="neutral">{tones.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Save current patch</p>
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
          <Button
            className="w-full"
            disabled={busy || !patch || !saveName.trim()}
            onClick={() => void handleSave()}
          >
            Save to library
          </Button>
          {!patch && (
            <p className="text-xs text-zinc-500">Read a patch from the amp before saving.</p>
          )}
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
                  <span className="text-sm text-zinc-100">{tone.name}</span>
                  {tone.channel !== undefined && tone.channel !== null && (
                    <span className="text-[10px] text-zinc-500">
                      {channelLabel(tone.channel, channels)}
                    </span>
                  )}
                </div>
                {tone.notes && (
                  <p className="mt-1 truncate text-xs text-zinc-500">{tone.notes}</p>
                )}
                <p className="mt-1 text-[10px] text-zinc-600">
                  Updated {formatTimestamp(tone.updated_at)}
                </p>
              </button>
            ))
          )}
        </div>

        {selected && (
          <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
            <p className="text-sm text-zinc-200">{selected.name}</p>
            <p className="text-xs text-zinc-500">
              {selected.device_model}
              {selected.channel !== undefined && selected.channel !== null
                ? ` · ${channelLabel(selected.channel, channels)}`
                : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void handleLoad(false)}
              >
                Load in editor
              </Button>
              <Button disabled={busy || !connection.connected} onClick={() => void handleLoad(true)}>
                Send to amp
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void handleDelete()}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
