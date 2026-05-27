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
}

export interface ToneRecord extends ToneSummary {
  device_family: string;
  patch: Patch;
}

export interface SaveToneRequest {
  name: string;
  notes?: string;
  tags?: string[];
}
