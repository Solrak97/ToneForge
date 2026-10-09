export type AgentMode = "cursor" | "auto" | "local" | "cloud";

export interface UserPreferences {
  preferred_volume_min: number;
  preferred_volume_max: number;
  avoid_wobble_fx: boolean;
  notes: string;
}

export interface AgentSettings {
  mode: AgentMode;
  cursor_api_key: string;
  cursor_model: string;
  local_base_url: string;
  local_model: string;
  cloud_base_url: string;
  cloud_api_key: string;
  cloud_model: string;
  preferences: UserPreferences;
}

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  toolOk?: boolean;
}

export interface AgentToolEvent {
  run_id: string;
  name: string;
  arguments: unknown;
  result_summary: string;
  ok: boolean;
}
