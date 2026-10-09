import type { ChannelInfo } from "../types/device";

export function channelLabel(index: number, channels?: ChannelInfo[]): string {
  const match = channels?.find((channel) => channel.index === index);
  if (match) return match.label;
  if (index === 0) return "PANEL";
  if (index >= 1 && index <= 4) return `A: CH${index}`;
  if (index >= 5 && index <= 8) return `B: CH${index - 4}`;
  return `CH ${index + 1}`;
}

/** Fallback before connect / identity detection — Katana-50 style layout. */
export const DEFAULT_CHANNELS: ChannelInfo[] = [
  { index: 0, label: "PANEL" },
  { index: 1, label: "CH1" },
  { index: 2, label: "CH2" },
];
