import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, IconButton } from "./icons";
import { cn } from "../../lib/utils";

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  maxWidthClassName = "max-w-lg",
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  maxWidthClassName?: string;
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className={cn(
          "relative w-full rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-xl",
          maxWidthClassName,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">{title}</p>
            {description && <p className="mt-1 text-xs text-zinc-500">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1 shrink-0">
            <CloseIcon className="h-5 w-5" />
          </IconButton>
        </div>

        <div className="px-4 py-4">{children}</div>

        {footer && (
          <div className="border-t border-zinc-800 px-4 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

