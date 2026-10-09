import type { Patch } from "./device";

export interface ToneSummary {
  id: number;
  name: string;
  device_model: string;
  channel?: number;
  tags: string[];
  notes: string;
  created_at: string;
  updated_at: string;
  /** A few params (amp type, effect switches and live colors) for drawing the signal chain in lists. */
  preview?: Record<string, number>;
}

export interface ToneRecord extends ToneSummary {
  device_family: string;
  patch: Patch;
}

/** A bank of tones, shared as a BOSS TONE STUDIO `.tsl` file. */
export interface LiveSetSummary {
  id: number;
  name: string;
  notes: string;
  tone_count: number;
  created_at: string;
  updated_at: string;
}

export interface LiveSetRecord {
  id: number;
  name: string;
  notes: string;
  /** In bank order. */
  tones: ToneSummary[];
  created_at: string;
  updated_at: string;
}

export interface LibraryImport {
  /** Set when the file held more than one patch. */
  liveset: LiveSetRecord | null;
  tone_ids: number[];
}

export interface SaveToneRequest {
  name: string;
  notes?: string;
  tags?: string[];
}
