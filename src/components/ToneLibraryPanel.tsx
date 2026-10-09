import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "./ui/button";
import { CardContent, CardHeader, CardTitle, PageCard } from "./ui/card";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import { Pane, ResizeHandle, useCollapsiblePane, usePaneGroup } from "./ui/panes";
import { Segmented } from "./ui/segmented";
import { fieldClass } from "./ui/field";
import { Modal } from "./ui/modal";
import {
  ChevronDownIcon,
  CloseIcon,
  ExportIcon,
  GridIcon,
  GripIcon,
  IconButton,
  ImportIcon,
  ListIcon,
  MoreIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "./ui/icons";
import { QuickEditor } from "./QuickEditor";
import { ToneChain } from "./ToneChain";
import { ToneCompare } from "./ToneCompare";
import { ToneOverview } from "./ToneOverview";
import { useToneForgeStore } from "../stores/toneforge";
import { channelLabel, DEFAULT_CHANNELS } from "../lib/channels";
import { withParamValue } from "../lib/quickParams";
import { ampTypeLabel, patchReader, summaryReader, toneChain, type ChainBlock } from "../lib/toneChain";
import { cn } from "../lib/utils";
import {
  addToneToLiveset,
  createLiveset,
  deleteLibraryTone,
  deleteLiveset,
  exportLibraryToneToDialog,
  exportLivesetToDialog,
  getLibraryTone,
  getLiveset,
  importLibraryFileFromDialog,
  importLibraryToneFromAmp,
  listLibraryTones,
  listLivesets,
  loadLibraryTone,
  removeToneFromLiveset,
  renameLiveset,
  reorderLiveset,
  seedLibraryDemoTones,
  saveLibraryTone,
  updateLibraryTonePatch,
} from "../lib/tauri-api";
import type { Patch } from "../types/device";
import type { LiveSetRecord, LiveSetSummary, ToneRecord, ToneSummary } from "../types/library";

type DetailTab = "overview" | "edit" | "compare";
type ToneView = "list" | "grid";
type LibraryModal = "save" | "amp" | "new-liveset" | "rename-liveset" | "delete-liveset" | null;
type SaveState = "idle" | "saving" | "saved";

const TONE_DRAG_TYPE = "application/x-toneforge-tone";

interface ToneDrag {
  tone: ToneSummary;
  index: number;
  /** Liveset the tone was dragged out of; `null` for All tones. */
  fromLivesetId: number | null;
}

interface RowDropTarget {
  index: number;
  position: "before" | "after";
}

type DropHandlers = {
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
};

/** dragleave also fires when moving onto a child; only treat leaving the element itself as a leave. */
function leftElement(e: DragEvent<HTMLElement>) {
  const next = e.relatedTarget;
  return !(next instanceof Node && e.currentTarget.contains(next));
}

const VIEW_STORAGE_KEY = "toneforge.library.view";

function storedView(): ToneView {
  return localStorage.getItem(VIEW_STORAGE_KEY) === "grid" ? "grid" : "list";
}

/** `onOpenEditor` switches to the Editor page after "Load in editor". */
export function ToneLibraryPanel({ onOpenEditor }: { onOpenEditor: () => void }) {
  const patch = useToneForgeStore((s) => s.patch);
  const params = useToneForgeStore((s) => s.params);
  const connection = useToneForgeStore((s) => s.connection);
  const channels = useToneForgeStore((s) => s.channels);
  const busy = useToneForgeStore((s) => s.busy);
  const setPatch = useToneForgeStore((s) => s.setPatch);
  const setBusy = useToneForgeStore((s) => s.setBusy);
  const setError = useToneForgeStore((s) => s.setError);

  const [tones, setTones] = useState<ToneSummary[]>([]);
  const [livesets, setLivesets] = useState<LiveSetSummary[]>([]);
  const [activeLiveset, setActiveLiveset] = useState<LiveSetRecord | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ToneView>(storedView);
  const searchRef = useRef<HTMLInputElement>(null);
  const toneListRef = useRef<HTMLDivElement>(null);

  const [toneName, setToneName] = useState("");
  const [toneNotes, setToneNotes] = useState("");
  const [livesetName, setLivesetName] = useState("");
  const [modalLiveset, setModalLiveset] = useState<LiveSetSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [previewTone, setPreviewTone] = useState<ToneRecord | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [activeModal, setActiveModal] = useState<LibraryModal>(null);

  const [draft, setDraft] = useState<Patch | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const draftRef = useRef<Patch | null>(null);
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());

  const [drag, setDrag] = useState<ToneDrag | null>(null);
  const [rowDrop, setRowDrop] = useState<RowDropTarget | null>(null);
  const [livesetDropId, setLivesetDropId] = useState<number | null>(null);

  // Each view keeps its own pane widths: tiles want a wide tones pane, the list a narrow one.
  const paneLayout = useDefaultLayout({ id: `library-panes-${view}`, storage: localStorage });
  const paneGroup = usePaneGroup("editor");
  const livesetPane = useCollapsiblePane(paneGroup, "livesets", 180);
  const tonePane = useCollapsiblePane(paneGroup, "tones", view === "grid" ? 480 : 260);
  const toggleLivesetPane = livesetPane.toggle;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        toggleLivesetPane();
      } else if (key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleLivesetPane]);

  const activeLivesetId = activeLiveset?.id ?? null;

  /** Refetches tones, livesets and the shown liveset (`null` shows all tones). */
  const reload = useCallback(
    async (livesetId: number | null) => {
      const [list, sets, liveset] = await Promise.all([
        listLibraryTones(query.trim() || undefined),
        listLivesets(),
        livesetId === null ? Promise.resolve(null) : getLiveset(livesetId).catch(() => null),
      ]);
      setTones(list);
      setLivesets(sets);
      setActiveLiveset(liveset);
    },
    [query],
  );

  const run = useCallback(
    async (task: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await task();
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [setBusy, setError],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listLibraryTones(query.trim() || undefined), listLivesets()])
      .then(([list, sets]) => {
        if (cancelled) return;
        setTones(list);
        setLivesets(sets);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [query, setError]);

  useEffect(() => {
    setNotice(null);
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

  useEffect(() => {
    draftRef.current = previewTone?.patch ?? null;
    setDraft(draftRef.current);
    setSaveState("idle");
  }, [previewTone]);

  const visibleTones = useMemo(() => {
    if (!activeLiveset) return tones;
    const q = query.trim().toLowerCase();
    if (!q) return activeLiveset.tones;
    return activeLiveset.tones.filter(
      (tone) => tone.name.toLowerCase().includes(q) || tone.notes.toLowerCase().includes(q),
    );
  }, [activeLiveset, tones, query]);

  const canReorder = activeLiveset !== null && !query.trim() && view === "list";

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  useEffect(() => {
    const list = toneListRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-tone-id="${selectedId}"]`);
    if (!list || !item) return;
    item.scrollIntoView({ block: "nearest" });
    if (list.contains(document.activeElement)) {
      (item.matches("[role=button]") ? item : item.querySelector<HTMLElement>("[role=button]"))?.focus();
    }
  }, [selectedId, view]);

  /** Arrow keys move the selection; in the grid, up and down jump a row of tiles. */
  function handleToneKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (visibleTones.length === 0) return;
    let step = 0;
    if (view === "grid") {
      const columns = toneListRef.current
        ? getComputedStyle(toneListRef.current).gridTemplateColumns.split(" ").length
        : 1;
      step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[e.key] ?? 0;
    } else {
      step = { ArrowUp: -1, ArrowDown: 1 }[e.key] ?? 0;
    }
    if (step === 0) return;
    e.preventDefault();
    const current = visibleTones.findIndex((tone) => tone.id === selectedId);
    const next = current === -1 ? 0 : Math.max(0, Math.min(visibleTones.length - 1, current + step));
    setSelectedId(visibleTones[next].id);
  }

  function previewParam(paramId: string, value: number) {
    if (!draftRef.current) return;
    draftRef.current = withParamValue(draftRef.current, params, paramId, value);
    setDraft(draftRef.current);
  }

  /** Library edits save on release, like the main editor commits to the amp. */
  function commitParam(paramId: string, value: number) {
    previewParam(paramId, value);
    const tone = previewTone;
    const next = draftRef.current;
    if (!tone || !next) return;
    setSaveState("saving");
    pendingSave.current = pendingSave.current
      .then(() => updateLibraryTonePatch(tone.id, next))
      .then(() => setSaveState("saved"))
      .catch((err) => {
        setSaveState("idle");
        setError(String(err));
      });
  }

  function openToneModal(modal: "save" | "amp") {
    setToneName("");
    setToneNotes("");
    setActiveModal(modal);
  }

  function openLivesetModal(modal: "new-liveset" | "rename-liveset" | "delete-liveset", set?: LiveSetSummary) {
    setModalLiveset(set ?? null);
    setLivesetName(modal === "rename-liveset" ? (set?.name ?? "") : "");
    setActiveModal(modal);
  }

  /** New tones land in the liveset being viewed, if any. */
  async function addToActiveLiveset(toneIds: number[]) {
    if (activeLivesetId === null) return;
    for (const id of toneIds) {
      await addToneToLiveset(activeLivesetId, id);
    }
  }

  const handleSave = () =>
    run(async () => {
      const saved = await saveLibraryTone({ name: toneName.trim(), notes: toneNotes.trim(), tags: [] });
      await addToActiveLiveset([saved.id]);
      await reload(activeLivesetId);
      setSelectedId(saved.id);
      setActiveModal(null);
    });

  const handleImportFromAmp = () =>
    run(async () => {
      const saved = await importLibraryToneFromAmp({
        name: toneName.trim() || "Amp import",
        notes: toneNotes.trim(),
        tags: [],
      });
      await addToActiveLiveset([saved.id]);
      await reload(activeLivesetId);
      setSelectedId(saved.id);
      setActiveModal(null);
    });

  const handleImportFile = () =>
    run(async () => {
      const result = await importLibraryFileFromDialog();
      if (!result) return;
      if (result.liveset) {
        await reload(result.liveset.id);
        setNotice(`Imported liveset “${result.liveset.name}” with ${result.tone_ids.length} tones.`);
      } else {
        await addToActiveLiveset(result.tone_ids);
        await reload(activeLivesetId);
      }
      setSelectedId(result.tone_ids[0] ?? null);
    });

  const handleLoad = (writeToDevice: boolean, channel?: number) =>
    run(async () => {
      if (selectedId === null) return;
      await pendingSave.current;
      setPatch(await loadLibraryTone(selectedId, writeToDevice, channel));
      if (!writeToDevice) onOpenEditor();
    });

  const handleDeleteTone = () =>
    run(async () => {
      if (selectedId === null) return;
      await deleteLibraryTone(selectedId);
      setSelectedId(null);
      await reload(activeLivesetId);
    });

  const handleExportTone = () =>
    run(async () => {
      if (!previewTone) return;
      await pendingSave.current;
      if (await exportLibraryToneToDialog(previewTone.id, previewTone.name)) {
        setNotice(`Exported “${previewTone.name}”.`);
      }
    });

  const handleExportLiveset = () =>
    run(async () => {
      if (!activeLiveset) return;
      await pendingSave.current;
      if (await exportLivesetToDialog(activeLiveset.id, activeLiveset.name)) {
        setNotice(`Exported “${activeLiveset.name}”.`);
      }
    });

  const handleSaveLiveset = () =>
    run(async () => {
      const name = livesetName.trim();
      const saved =
        activeModal === "rename-liveset" && modalLiveset
          ? await renameLiveset(modalLiveset.id, name)
          : await createLiveset(name);
      await reload(activeModal === "rename-liveset" ? activeLivesetId : saved.id);
      setActiveModal(null);
    });

  const handleDeleteLiveset = () =>
    run(async () => {
      if (!modalLiveset) return;
      await deleteLiveset(modalLiveset.id);
      await reload(modalLiveset.id === activeLivesetId ? null : activeLivesetId);
      setActiveModal(null);
    });

  /** Moves the tone at `from` to `to` (an index in the list after removal), showing it right away. */
  const handleReorder = (from: number, to: number) =>
    run(async () => {
      if (!activeLiveset) return;
      const previous = activeLiveset;
      const ordered = [...previous.tones];
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      setActiveLiveset({ ...previous, tones: ordered });
      try {
        setActiveLiveset(await reorderLiveset(previous.id, ordered.map((tone) => tone.id)));
      } catch (err) {
        setActiveLiveset(previous);
        throw err;
      }
    });

  const handleAddToLiveset = (tone: ToneSummary, set: LiveSetSummary) =>
    run(async () => {
      const updated = await addToneToLiveset(set.id, tone.id);
      await reload(activeLivesetId);
      setNotice(
        updated.tones.length > set.tone_count
          ? `Added “${tone.name}” to “${set.name}”.`
          : `“${tone.name}” is already in “${set.name}”.`,
      );
    });

  function endDrag() {
    setDrag(null);
    setRowDrop(null);
    setLivesetDropId(null);
  }

  function handleToneDragStart(e: DragEvent<HTMLDivElement>, tone: ToneSummary, index: number) {
    e.dataTransfer.setData(TONE_DRAG_TYPE, String(tone.id));
    e.dataTransfer.effectAllowed = canReorder ? "copyMove" : "copy";
    setDrag({ tone, index, fromLivesetId: activeLivesetId });
  }

  /** Final index for dropping the dragged row next to `target`, or `null` when it wouldn't move. */
  function reorderIndex(target: RowDropTarget) {
    if (!drag) return null;
    let to = target.position === "after" ? target.index + 1 : target.index;
    if (drag.index < to) to -= 1;
    return to === drag.index ? null : to;
  }

  function rowDropHandlers(index: number): DropHandlers {
    const accepts = () => canReorder && drag !== null && drag.fromLivesetId === activeLivesetId;
    const targetAt = (e: DragEvent<HTMLDivElement>): RowDropTarget => {
      const rect = e.currentTarget.getBoundingClientRect();
      return { index, position: e.clientY < rect.top + rect.height / 2 ? "before" : "after" };
    };
    return {
      onDragOver: (e) => {
        if (!accepts()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const target = targetAt(e);
        const next = reorderIndex(target) === null ? null : target;
        if (next?.index !== rowDrop?.index || next?.position !== rowDrop?.position) setRowDrop(next);
      },
      onDragLeave: (e) => {
        if (leftElement(e)) setRowDrop((current) => (current?.index === index ? null : current));
      },
      onDrop: (e) => {
        if (!accepts()) return;
        e.preventDefault();
        const from = drag?.index;
        const to = reorderIndex(targetAt(e));
        endDrag();
        if (from !== undefined && to !== null) void handleReorder(from, to);
      },
    };
  }

  function livesetDropHandlers(set: LiveSetSummary): DropHandlers {
    const accepts = () => drag !== null && drag.fromLivesetId !== set.id;
    return {
      onDragOver: (e) => {
        if (!accepts()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (livesetDropId !== set.id) setLivesetDropId(set.id);
      },
      onDragLeave: (e) => {
        if (leftElement(e)) setLivesetDropId((current) => (current === set.id ? null : current));
      },
      onDrop: (e) => {
        if (!accepts() || !drag) return;
        e.preventDefault();
        const tone = drag.tone;
        endDrag();
        void handleAddToLiveset(tone, set);
      },
    };
  }

  const handleRemoveFromLiveset = (toneId: number) =>
    run(async () => {
      if (!activeLiveset) return;
      await removeToneFromLiveset(activeLiveset.id, toneId);
      await reload(activeLiveset.id);
    });

  const handleSeedDemo = () =>
    run(async () => {
      if ((await seedLibraryDemoTones()) > 0) await reload(activeLivesetId);
    });

  const newItems: MenuItem[] = [
    { label: "New liveset", onSelect: () => openLivesetModal("new-liveset") },
    { label: "Tone from current patch", onSelect: () => openToneModal("save"), disabled: !patch },
    { label: "Tone from amp", onSelect: () => openToneModal("amp"), disabled: !connection.connected },
  ];
  const toneItems: MenuItem[] = previewTone
    ? [
        ...livesets
          .filter((set) => set.id !== activeLivesetId)
          .map((set) => ({
            label: set.name,
            section: "Add to liveset",
            onSelect: () => void handleAddToLiveset(previewTone, set),
          })),
        ...(activeLiveset
          ? [
              {
                label: `Remove from “${activeLiveset.name}”`,
                section: "",
                onSelect: () => void handleRemoveFromLiveset(previewTone.id),
              },
            ]
          : []),
        { label: "Export .tsl", section: "", onSelect: () => void handleExportTone() },
        { label: "Delete from library", section: "", danger: true, onSelect: () => void handleDeleteTone() },
      ]
    : [];
  const exportItems: MenuItem[] = [
    ...(activeLiveset
      ? [{ label: `Liveset “${activeLiveset.name}”`, onSelect: () => void handleExportLiveset() }]
      : []),
    ...(previewTone
      ? [{ label: `Tone “${previewTone.name}”`, onSelect: () => void handleExportTone() }]
      : []),
  ];

  return (
    <PageCard>
      <CardHeader className="flex flex-row flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <CardTitle className="truncate">{activeLiveset?.name ?? "All tones"}</CardTitle>
          <p className="text-xs text-zinc-500">
            {visibleTones.length === 1 ? "1 tone" : `${visibleTones.length} tones`}
            {query.trim() ? ` matching “${query.trim()}”` : ""}
          </p>
        </div>
        <Segmented
          label="Tone view"
          options={[
            { value: "list", label: "List", icon: <ListIcon className="h-4 w-4" /> },
            { value: "grid", label: "Tiles", icon: <GridIcon className="h-4 w-4" /> },
          ]}
          value={view}
          onChange={setView}
        />
        <div className="flex items-center">
          <MenuButton label="New" icon={<PlusIcon className="h-5 w-5" />} items={newItems} disabled={busy} />
          <IconButton
            label="Import .tsl (or a ToneForge JSON preset)"
            disabled={busy}
            onClick={() => void handleImportFile()}
          >
            <ImportIcon className="h-5 w-5" />
          </IconButton>
          <MenuButton
            label="Export .tsl"
            icon={<ExportIcon className="h-5 w-5" />}
            items={exportItems}
            disabled={busy || exportItems.length === 0}
          />
        </div>
        <div className="relative w-56">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            ref={searchRef}
            type="search"
            className={cn(fieldClass, "pl-8")}
            placeholder={activeLiveset ? `Search ${activeLiveset.name}` : "Search all tones"}
            aria-label="Search tones"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col">
        <Modal
          open={activeModal === "save" || activeModal === "amp"}
          title={activeModal === "amp" ? "New tone from amp" : "New tone from current patch"}
          description={
            activeModal === "amp"
              ? "Read the amp's current channel into your library."
              : "Save the patch in the editor into your library."
          }
          onClose={() => setActiveModal(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setActiveModal(null)} disabled={busy}>
                Cancel
              </Button>
              {activeModal === "amp" ? (
                <Button disabled={busy || !connection.connected} onClick={() => void handleImportFromAmp()}>
                  Import
                </Button>
              ) : (
                <Button disabled={busy || !patch || !toneName.trim()} onClick={() => void handleSave()}>
                  Save
                </Button>
              )}
            </div>
          }
        >
          <div className="space-y-2">
            <input
              className={fieldClass}
              placeholder={activeModal === "amp" ? "Name (optional)" : "Tone name"}
              value={toneName}
              onChange={(e) => setToneName(e.target.value)}
              disabled={busy}
              autoFocus
            />
            <input
              className={fieldClass}
              placeholder="Notes (optional)"
              value={toneNotes}
              onChange={(e) => setToneNotes(e.target.value)}
              disabled={busy}
            />
            {activeLiveset && (
              <p className="text-xs text-zinc-500">The tone is also added to “{activeLiveset.name}”.</p>
            )}
          </div>
        </Modal>

        <Modal
          open={activeModal === "new-liveset" || activeModal === "rename-liveset"}
          title={activeModal === "rename-liveset" ? "Rename liveset" : "New liveset"}
          description="A liveset is a bank of tones you can share as a BOSS TONE STUDIO .tsl file."
          onClose={() => setActiveModal(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setActiveModal(null)} disabled={busy}>
                Cancel
              </Button>
              <Button disabled={busy || !livesetName.trim()} onClick={() => void handleSaveLiveset()}>
                {activeModal === "rename-liveset" ? "Rename" : "Create"}
              </Button>
            </div>
          }
        >
          <input
            className={fieldClass}
            placeholder="Liveset name"
            value={livesetName}
            onChange={(e) => setLivesetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && livesetName.trim()) void handleSaveLiveset();
            }}
            disabled={busy}
            autoFocus
          />
        </Modal>

        <Modal
          open={activeModal === "delete-liveset"}
          title={`Delete “${modalLiveset?.name ?? ""}”?`}
          description="The liveset is removed; its tones stay in your library."
          onClose={() => setActiveModal(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setActiveModal(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void handleDeleteLiveset()}>
                Delete liveset
              </Button>
            </div>
          }
        >
          <p className="text-sm text-zinc-400">
            Export it as a .tsl first if you want to keep a copy of the bank.
          </p>
        </Modal>

        {notice && <p className="mb-3 shrink-0 text-xs text-emerald-400">{notice}</p>}

        <Group
          key={view}
          id={`library-panes-${view}`}
          orientation="horizontal"
          className="min-h-0 flex-1"
          groupRef={paneGroup.groupRef}
          defaultLayout={paneLayout.defaultLayout}
          onLayoutChanged={paneLayout.onLayoutChanged}
        >
          <Panel {...livesetPane.panelProps} minSize={140} maxSize={320}>
            <Pane title="Livesets" collapsed={livesetPane.collapsed} onToggle={livesetPane.toggle}>
              <nav className="space-y-1">
                <SidebarItem
                  label="All tones"
                  active={activeLiveset === null}
                  onClick={() => void run(() => reload(null))}
                />
                <div className="mx-2 my-2 border-t border-zinc-800" />
                {livesets.map((set) => (
                  <SidebarItem
                    key={set.id}
                    label={set.name}
                    count={set.tone_count}
                    active={set.id === activeLivesetId}
                    dropActive={livesetDropId === set.id}
                    dropHandlers={livesetDropHandlers(set)}
                    onClick={() => void run(() => reload(set.id))}
                    onRename={() => openLivesetModal("rename-liveset", set)}
                    onDelete={() => openLivesetModal("delete-liveset", set)}
                  />
                ))}
                {livesets.length === 0 && (
                  <p className="px-2 text-xs text-zinc-500">
                    Use + or import a .tsl to start a bank of tones you can share.
                  </p>
                )}
              </nav>
            </Pane>
          </Panel>

          <ResizeHandle />

          <Panel {...tonePane.panelProps} minSize={180} maxSize={view === "grid" ? undefined : 480}>
            <Pane title="Tones" collapsed={tonePane.collapsed} onToggle={tonePane.toggle}>
              {visibleTones.length === 0 ? (
                <div className="space-y-2 px-1 text-sm text-zinc-500">
                  {query.trim() ? (
                    <p>No tones match “{query.trim()}”.</p>
                  ) : activeLiveset ? (
                    <p>This liveset is empty. Drag tones from All tones onto it in the sidebar.</p>
                  ) : (
                    <>
                      <p>No saved tones yet.</p>
                      <Button variant="secondary" disabled={busy} onClick={() => void handleSeedDemo()}>
                        Add demo tones
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <div
                  ref={toneListRef}
                  tabIndex={-1}
                  onKeyDown={handleToneKeyDown}
                  className={cn(
                    "outline-none",
                    view === "grid"
                      ? "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]"
                      : "space-y-0.5",
                  )}
                >
                  {visibleTones.map((tone, index) => {
                    const read = summaryReader(tone);
                    const props = {
                      tone,
                      number: activeLiveset
                        ? activeLiveset.tones.findIndex((t) => t.id === tone.id) + 1
                        : undefined,
                      amp: ampTypeLabel(read, params),
                      chain: toneChain(read),
                      selected: selectedId === tone.id,
                      dragging: drag?.tone.id === tone.id,
                      draggable: !busy,
                      onSelect: () => setSelectedId(tone.id),
                      onDragStart: (e: DragEvent<HTMLDivElement>) => handleToneDragStart(e, tone, index),
                      onDragEnd: endDrag,
                    };
                    return view === "grid" ? (
                      <ToneTile key={tone.id} {...props} />
                    ) : (
                      <ToneRow
                        key={tone.id}
                        {...props}
                        dropHandlers={rowDropHandlers(index)}
                        dropLine={rowDrop?.index === index ? rowDrop.position : null}
                        reorderable={canReorder}
                        onRemove={
                          activeLiveset ? () => void handleRemoveFromLiveset(tone.id) : undefined
                        }
                        busy={busy}
                      />
                    );
                  })}
                </div>
              )}
            </Pane>
          </Panel>

          <ResizeHandle />

          <Panel id="editor" minSize={320}>
            {!previewTone || !draft ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                <p className="text-sm text-zinc-300">
                  {previewLoading ? "Loading tone…" : "Select a tone"}
                </p>
                <p className="text-xs text-zinc-500">
                  See its chain and amp settings, tweak it, or send it to the amp.
                </p>
              </div>
            ) : (
              <div className="flex h-full min-w-0 flex-col gap-4 pl-1">
                <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-medium text-zinc-100">{previewTone.name}</p>
                    <p className="text-xs text-zinc-500">
                      {[
                        ampTypeLabel(patchReader(draft), params),
                        previewTone.channel !== undefined && previewTone.channel !== null
                          ? `saved from ${channelLabel(previewTone.channel, channels)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      {saveState === "saving" && <span className="text-orange-400"> · saving…</span>}
                      {saveState === "saved" && <span className="text-emerald-400"> · saved</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="secondary"
                      className="h-9 py-0"
                      disabled={busy}
                      onClick={() => void handleLoad(false)}
                    >
                      Load in editor
                    </Button>
                    <SendToAmpButton
                      disabled={busy || !connection.connected}
                      onSend={(channel) => void handleLoad(true, channel)}
                    />
                    <MenuButton
                      label="More actions"
                      icon={<MoreIcon className="h-5 w-5" />}
                      items={toneItems}
                      disabled={busy}
                      menuOnly
                    />
                  </div>
                </div>

                <Segmented
                  label="Tone details"
                  className="self-start"
                  options={[
                    { value: "overview", label: "Overview" },
                    { value: "edit", label: "Edit" },
                    { value: "compare", label: "Compare" },
                  ]}
                  value={detailTab}
                  onChange={setDetailTab}
                />

                <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                  {detailTab === "overview" ? (
                    <ToneOverview patch={draft} params={params} notes={previewTone.notes} />
                  ) : detailTab === "edit" ? (
                    <QuickEditor
                      key={previewTone.id}
                      patch={draft}
                      params={params}
                      disabled={busy}
                      pendingParam={null}
                      onPreview={previewParam}
                      onCommit={commitParam}
                    />
                  ) : (
                    <ToneCompare
                      key={previewTone.id}
                      tone={{ ...previewTone, patch: draft }}
                      tones={tones}
                      currentPatch={patch}
                      params={params}
                    />
                  )}
                </div>
              </div>
            )}
          </Panel>
        </Group>
      </CardContent>
    </PageCard>
  );
}

interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Items are grouped by section; a divider (and the name, if any) starts each new one. */
  section?: string;
}

/** Open/close state for a dropdown that closes on outside clicks; put `ref` on its wrapper. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return { open, setOpen, ref };
}

function DropdownMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div className="absolute right-0 top-full z-30 mt-1 max-h-80 min-w-56 max-w-72 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
      {items.map((item, index) => {
        const newSection = index > 0 && item.section !== items[index - 1].section;
        const heading = item.section && (index === 0 || newSection);
        return (
          <div key={`${item.section ?? ""}:${item.label}`}>
            {newSection && <div className="mx-2 my-1 border-t border-zinc-800" />}
            {heading && <p className="px-3 pb-1 pt-1.5 text-[11px] uppercase tracking-wide text-zinc-500">{item.section}</p>}
            <button
              type="button"
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className={cn(
                "block w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40",
                item.danger ? "text-red-400" : "text-zinc-200",
              )}
            >
              {item.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Icon button that opens a menu, or runs the action directly when there's only one (unless `menuOnly`). */
function MenuButton({
  label,
  icon,
  items,
  disabled,
  menuOnly,
}: {
  label: string;
  icon: ReactNode;
  items: MenuItem[];
  disabled?: boolean;
  menuOnly?: boolean;
}) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div ref={ref} className="relative">
      <IconButton
        label={label}
        active={open}
        disabled={disabled}
        onClick={() => (items.length === 1 && !menuOnly ? items[0].onSelect() : setOpen(!open))}
      >
        {icon}
      </IconButton>
      {open && <DropdownMenu items={items} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Sends to the amp's current channel; the arrow picks another channel (the amp switches to it). */
function SendToAmpButton({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (channel?: number) => void;
}) {
  const patch = useToneForgeStore((s) => s.patch);
  const channels = useToneForgeStore((s) => s.channels);
  const { open, setOpen, ref } = useDropdown();
  const current = patch?.meta.channel ?? null;

  return (
    <div ref={ref} className="relative inline-flex">
      <Button
        className="h-9 rounded-r-none py-0"
        disabled={disabled}
        onClick={() => onSend(current ?? undefined)}
      >
        {current === null ? "Send to amp" : `Send to ${channelLabel(current, channels)}`}
      </Button>
      <Button
        className="h-9 w-8 rounded-l-none border-l border-black/25 px-0 py-0"
        disabled={disabled}
        aria-label="Send to another channel"
        title="Send to another channel"
        onClick={() => setOpen(!open)}
      >
        <ChevronDownIcon className="h-4 w-4" />
      </Button>
      {open && (
        <DropdownMenu
          items={(channels.length > 0 ? channels : DEFAULT_CHANNELS).map((channel) => ({
            label: channel.index === current ? `${channel.label} (current)` : channel.label,
            onSelect: () => onSend(channel.index),
          }))}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SidebarItem({
  label,
  count,
  active,
  dropActive,
  dropHandlers,
  onClick,
  onRename,
  onDelete,
}: {
  label: string;
  count?: number;
  active: boolean;
  /** A dragged tone is hovering and can be dropped here. */
  dropActive?: boolean;
  dropHandlers?: DropHandlers;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      {...dropHandlers}
      className={cn(
        "group flex items-center rounded-md transition-colors",
        dropActive
          ? "bg-orange-500/20 text-orange-200 ring-1 ring-orange-500"
          : active
            ? "bg-orange-500/10 text-orange-300"
            : "text-zinc-300 hover:bg-zinc-800",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left text-sm"
      >
        <span className="truncate">{label}</span>
        {count !== undefined && (
          <span className="shrink-0 text-xs text-zinc-500 group-hover:hidden">{count}</span>
        )}
      </button>
      {(onRename || onDelete) && (
        <div className="hidden shrink-0 items-center pr-1 group-hover:flex">
          {onRename && (
            <RowAction label={`Rename ${label}`} disabled={false} onClick={onRename}>
              <PencilIcon className="h-3.5 w-3.5" />
            </RowAction>
          )}
          {onDelete && (
            <RowAction label={`Delete ${label}`} disabled={false} onClick={onDelete}>
              <TrashIcon className="h-3.5 w-3.5" />
            </RowAction>
          )}
        </div>
      )}
    </div>
  );
}

interface ToneItemProps {
  tone: ToneSummary;
  /** Position in the liveset being viewed. */
  number?: number;
  amp?: string;
  chain: ChainBlock[];
  selected: boolean;
  dragging: boolean;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

/** Click or Enter/Space selects. Not a <button>: WebKit won't start a drag on a parent of a button. */
function selectProps(onSelect: () => void) {
  return {
    role: "button",
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
  } as const;
}

function ToneRow({
  tone,
  number,
  amp,
  chain,
  selected,
  dragging,
  draggable,
  onSelect,
  onDragStart,
  onDragEnd,
  dropHandlers,
  dropLine,
  reorderable,
  onRemove,
  busy,
}: ToneItemProps & {
  dropHandlers: DropHandlers;
  dropLine: RowDropTarget["position"] | null;
  reorderable: boolean;
  onRemove?: () => void;
  busy: boolean;
}) {
  const detail = [amp, tone.notes].filter(Boolean).join(" · ");
  return (
    <div
      data-tone-id={tone.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      {...dropHandlers}
      className={cn(
        "group relative flex select-none items-center rounded-md transition-colors",
        selected ? "bg-orange-500/10" : "hover:bg-zinc-900",
        dragging && "opacity-40",
      )}
    >
      {dropLine && <DropLine position={dropLine} />}
      <div
        {...selectProps(onSelect)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2 py-1.5 text-left focus:outline-none"
      >
        {number !== undefined && (
          <span className="w-4 shrink-0 text-right text-xs tabular-nums text-zinc-500">{number}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm", selected ? "text-orange-200" : "text-zinc-100")}>{tone.name}</p>
          {detail && <p className="truncate text-xs text-zinc-500">{detail}</p>}
        </div>
        <ToneChain chain={chain} className={cn(onRemove && "group-hover:hidden group-focus-within:hidden")} />
      </div>
      {onRemove && (
        <div className="hidden shrink-0 items-center pr-1 group-hover:flex group-focus-within:flex">
          {reorderable && (
            <span
              title="Drag to reorder"
              className="flex h-7 w-6 cursor-grab items-center justify-center text-zinc-500 active:cursor-grabbing"
            >
              <GripIcon className="h-3.5 w-3.5" />
            </span>
          )}
          <RowAction label="Remove from liveset" disabled={busy} onClick={onRemove}>
            <CloseIcon className="h-3.5 w-3.5" />
          </RowAction>
        </div>
      )}
    </div>
  );
}

function ToneTile({
  tone,
  number,
  amp,
  chain,
  selected,
  dragging,
  draggable,
  onSelect,
  onDragStart,
  onDragEnd,
}: ToneItemProps) {
  return (
    <div
      data-tone-id={tone.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      {...selectProps(onSelect)}
      title={tone.notes || tone.name}
      className={cn(
        "flex cursor-pointer select-none flex-col gap-3 rounded-lg border p-3 transition-colors focus:outline-none",
        selected
          ? "border-orange-500/60 bg-orange-500/10"
          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 focus-visible:border-zinc-600",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("truncate text-sm", selected ? "text-orange-200" : "text-zinc-100")}>{tone.name}</p>
          <p className="truncate text-xs text-zinc-500">{amp ?? "\u00a0"}</p>
        </div>
        {number !== undefined && <span className="shrink-0 text-xs tabular-nums text-zinc-500">{number}</span>}
      </div>
      <ToneChain chain={chain} size="md" />
    </div>
  );
}

/** Insertion marker drawn in the gap above or below a tone row. */
function DropLine({ position }: { position: RowDropTarget["position"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-orange-500",
        position === "before" ? "-top-1" : "-bottom-1",
      )}
    />
  );
}

function RowAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
