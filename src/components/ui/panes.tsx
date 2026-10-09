import { useCallback, useRef, useState, type ReactNode } from "react";
import { Separator, useGroupRef, usePanelRef, type PanelSize } from "react-resizable-panels";
import { cn } from "../../lib/utils";
import { ChevronsLeftIcon, ChevronsRightIcon, IconButton } from "./icons";

/** Width of a collapsed pane's rail, in pixels. */
export const PANE_RAIL_SIZE = 36;

/**
 * Shared state for a `Group` of panes. Collapsing or expanding a pane gives or takes the space
 * from `fillPanelId` (the main area), like an IDE sidebar, instead of the pane next to it.
 */
export function usePaneGroup(fillPanelId: string) {
  const groupRef = useGroupRef();
  /** Pixel width each pane had before it was collapsed. */
  const restoreWidths = useRef(new Map<string, number>());
  return { groupRef, fillPanelId, restoreWidths };
}

type PaneGroup = ReturnType<typeof usePaneGroup>;

/** Collapse state and toggle for one collapsible `Panel`; spread `panelProps` onto it. */
export function useCollapsiblePane(group: PaneGroup, id: string, defaultWidth: number) {
  const panelRef = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const onResize = useCallback(
    (size: PanelSize) => setCollapsed(size.inPixels <= PANE_RAIL_SIZE + 1),
    [],
  );

  const { groupRef, fillPanelId, restoreWidths } = group;
  const toggle = useCallback(() => {
    const groupApi = groupRef.current;
    const panel = panelRef.current;
    if (!groupApi || !panel) return;
    const { asPercentage, inPixels } = panel.getSize();
    if (inPixels <= 0) return;
    const percentPerPixel = asPercentage / inPixels;

    const isCollapsed = panel.isCollapsed();
    if (!isCollapsed) restoreWidths.current.set(id, inPixels);
    const targetPixels = isCollapsed ? (restoreWidths.current.get(id) ?? defaultWidth) : PANE_RAIL_SIZE;
    const target = targetPixels * percentPerPixel;

    const layout = { ...groupApi.getLayout() };
    layout[fillPanelId] += layout[id] - target;
    layout[id] = target;
    groupApi.setLayout(layout);
  }, [groupRef, panelRef, fillPanelId, restoreWidths, id, defaultWidth]);

  return {
    collapsed,
    toggle,
    panelProps: {
      id,
      panelRef,
      onResize,
      collapsible: true,
      collapsedSize: PANE_RAIL_SIZE,
      defaultSize: defaultWidth,
      groupResizeBehavior: "preserve-pixel-size" as const,
    },
  };
}

/**
 * Titled column inside a resizable layout. Collapsed, it becomes a slim rail that expands on click
 * or when something is dragged over it. `actions` sit next to the title.
 */
export function Pane({
  title,
  collapsed = false,
  onToggle,
  actions,
  className,
  children,
}: {
  title: string;
  collapsed?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        onDragEnter={onToggle}
        title={`Show ${title}`}
        aria-label={`Show ${title}`}
        className="flex h-full w-full flex-col items-center gap-3 rounded-lg py-1.5 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
      >
        <ChevronsRightIcon className="h-4 w-4 shrink-0" />
        <span className="truncate text-[10px] uppercase tracking-wide [writing-mode:vertical-rl]">
          {title}
        </span>
      </button>
    );
  }

  return (
    <div className={cn("flex h-full min-w-0 flex-col gap-2", className)}>
      <div className="flex h-7 shrink-0 items-center gap-1 pl-1">
        <p className="min-w-0 flex-1 truncate text-xs uppercase tracking-wide text-zinc-500">{title}</p>
        {actions}
        {onToggle && (
          <IconButton size="sm" label={`Hide ${title}`} onClick={onToggle}>
            <ChevronsLeftIcon className="h-4 w-4" />
          </IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/** Drag to resize the panes on either side; double-click resets them. */
export function ResizeHandle() {
  return (
    <Separator className="group relative flex w-3 shrink-0 justify-center outline-none">
      <div className="h-full w-px bg-zinc-800 transition-colors group-data-[separator=hover]:bg-orange-500/60 group-data-[separator=focus]:bg-orange-500/60 group-data-[separator=active]:bg-orange-500" />
    </Separator>
  );
}
