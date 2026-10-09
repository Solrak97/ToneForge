import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

function Icon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-4 w-4", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export const PlusIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

/** Arrow into a tray: bring a file in. */
export const ImportIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  </Icon>
);

/** Arrow out of a tray: write a file out. */
export const ExportIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M5 21h14" />
  </Icon>
);

export const SearchIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const PencilIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
  </Icon>
);

export const TrashIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);

export const CloseIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

/** Six dots: a drag handle. */
export const GripIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth={3} />
  </Icon>
);

export const SettingsIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const ChevronDownIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const ChevronsLeftIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
  </Icon>
);

export const ChevronsRightIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m13 17 5-5-5-5M6 17l5-5-5-5" />
  </Icon>
);

export const ListIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Icon>
);

export const GridIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
  </Icon>
);

export const MoreIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />
  </Icon>
);

/** Shared look for square, borderless icon buttons. `sm` fits compact headers. */
export function IconButton({
  label,
  onClick,
  disabled,
  active,
  size = "md",
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg transition disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-7 w-7 rounded-md" : "h-9 w-9",
        active ? "bg-zinc-800 text-orange-400" : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100",
        className,
      )}
    >
      {children}
    </button>
  );
}
