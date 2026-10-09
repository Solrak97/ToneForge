import { useState } from "react";
import { CardHeader, CardTitle, PageCard, PageCardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { AgentSettingsSection } from "./AgentSettingsSection";
import { useDebugLogStore } from "../stores/debugLog";
import { useDevModeStore } from "../stores/devMode";
import { useToneForgeStore } from "../stores/toneforge";
import { cn } from "../lib/utils";

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50",
        checked ? "bg-orange-500" : "bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

const DEV_MODE_UNLOCKS = [
  "The debug log panel with raw MIDI and app activity",
  "The Katana emulator, a fake amp for testing without hardware",
  "Unfinished sections: the Agent chat, MIDI / Assign and Devices",
];

export function SettingsPanel() {
  const devMode = useDevModeStore((s) => s.enabled);
  const setDevMode = useDevModeStore((s) => s.setEnabled);
  const debugLogVisible = useDebugLogStore((s) => s.visible);
  const setDebugLogVisible = useDebugLogStore((s) => s.setVisible);
  const setError = useToneForgeStore((s) => s.setError);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function applyDevMode(enabled: boolean) {
    setSaving(true);
    try {
      await setDevMode(enabled);
      setConfirmOpen(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageCard>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <PageCardContent className="space-y-4">
        <Modal
          open={confirmOpen}
          title="Enable experimental mode?"
          description="Experimental mode is meant for building and testing ToneForge."
          onClose={() => setConfirmOpen(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={saving} onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-amber-500 text-black hover:bg-amber-400"
                disabled={saving}
                onClick={() => void applyDevMode(true)}
              >
                I understand, enable it
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <WarningIcon />
              <p className="text-sm text-amber-100">
                You're entering experimental mode. Features here are unfinished or for testing, can
                behave unexpectedly, and may change or disappear without notice.
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">This unlocks</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
                {DEV_MODE_UNLOCKS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-zinc-500">You can turn it off again here at any time.</p>
          </div>
        </Modal>

        <div
          className={cn(
            "space-y-3 rounded-lg border p-3",
            devMode ? "border-amber-500/40 bg-amber-500/5" : "border-zinc-800",
          )}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm text-zinc-200">Experimental mode</p>
                {devMode && <Badge tone="warning">On</Badge>}
              </div>
              <p className="text-xs text-zinc-500">
                Debug log, the amp emulator and features still under construction.
              </p>
            </div>
            <Toggle
              checked={devMode}
              disabled={saving}
              onChange={(next) => (next ? setConfirmOpen(true) : void applyDevMode(false))}
              label="Experimental mode"
            />
          </div>

          {devMode && (
            <div className="flex items-center justify-between gap-4 border-t border-zinc-800 pt-3">
              <div>
                <p className="text-sm text-zinc-200">Debug log</p>
                <p className="text-xs text-zinc-500">
                  Show the device and app log panel at the bottom of the window. Logging to file
                  continues either way.
                </p>
              </div>
              <Toggle checked={debugLogVisible} onChange={setDebugLogVisible} label="Show debug log" />
            </div>
          )}
        </div>

        {devMode && (
          <section className="space-y-3 rounded-lg border border-zinc-800 p-3">
            <div>
              <p className="text-sm text-zinc-200">Agent</p>
              <p className="text-xs text-zinc-500">
                Which model the Agent chat uses, and the tone preferences it follows.
              </p>
            </div>
            <AgentSettingsSection />
          </section>
        )}
      </PageCardContent>
    </PageCard>
  );
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0 text-amber-400"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
