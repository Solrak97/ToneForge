export type ParamKind = "u8" | "i8" | "u16" | "enum" | "text";

export interface ParamDef {
  id: string;
  label: string;
  address: number[];
  kind: ParamKind;
  min?: number;
  max?: number;
  default?: number;
  group?: string;
  options?: string[];
  wired?: boolean;
  bts_name?: string;
  address_space?: string;
}

export interface ParamValue {
  type: "u8" | "i8" | "u16" | "text";
  value: number | string;
}

export interface PatchMeta {
  device_family: string;
  device_model: string;
  channel?: number;
  patch_slot?: number;
  name?: string;
}

export interface ChannelInfo {
  index: number;
  label: string;
}

export interface Patch {
  meta: PatchMeta;
  params: Record<string, ParamValue>;
}

export interface ConnectionStatus {
  connected: boolean;
  port_name?: string;
  device_model?: string;
  editor_mode: boolean;
}

export interface DeviceInfo {
  id: string;
  name: string;
  manufacturer_hint?: string;
  model_hint?: string;
}
