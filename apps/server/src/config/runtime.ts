import { env } from "./env.js";
import { settings, SettingKeys } from "../db/settings.js";

// Runtime config merges .env (for power users) with DB settings (for friend-mode).
// DB takes precedence — if you set a key in the UI, it overrides the env file.

export const runtime = {
  anthropicApiKey(): string {
    return settings.get(SettingKeys.AnthropicApiKey) ?? env.anthropicApiKey;
  },
  anthropicModel(): string {
    return settings.get(SettingKeys.AnthropicModel) ?? env.anthropicModel;
  },
  stravaClientId(): string {
    return settings.get(SettingKeys.StravaClientId) ?? env.stravaClientId;
  },
  stravaClientSecret(): string {
    return settings.get(SettingKeys.StravaClientSecret) ?? env.stravaClientSecret;
  },
  isAnthropicConfigured(): boolean {
    return this.anthropicApiKey().length > 0;
  },
  isStravaConfigured(): boolean {
    return this.stravaClientId().length > 0 && this.stravaClientSecret().length > 0;
  },
};
