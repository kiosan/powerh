import Anthropic from "@anthropic-ai/sdk";
import { runtime } from "../config/runtime.js";

let _client: Anthropic | null = null;
let _lastKey = "";

export function getAnthropic(): Anthropic {
  const key = runtime.anthropicApiKey();
  if (!key) {
    throw new Error("Anthropic API key is not configured. Set it in Settings.");
  }
  if (!_client || key !== _lastKey) {
    _client = new Anthropic({ apiKey: key });
    _lastKey = key;
  }
  return _client;
}
