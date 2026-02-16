import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { WebhookConfig, OpenClawConfig } from "../types.js";

const CONFIG_PATH = path.join(os.homedir(), ".agentco", "config.json");

const DEFAULT_MODELS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4",
  "google/gemini-2.5-pro",
  "openai/o3",
  "openai/gpt-4.1",
];

export interface GlobalConfig {
  models: string[];
  webhooks: WebhookConfig[];
  openclaw?: OpenClawConfig;
}

export function getGlobalConfig(): GlobalConfig {
  const defaults: GlobalConfig = { models: DEFAULT_MODELS, webhooks: [] };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      models: Array.isArray(parsed.models) && parsed.models.length > 0
        ? parsed.models
        : DEFAULT_MODELS,
      webhooks: Array.isArray(parsed.webhooks) ? parsed.webhooks : [],
      openclaw: parsed.openclaw ?? undefined,
    };
  } catch {
    // File doesn't exist or is invalid — create with defaults
    try {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(
        CONFIG_PATH,
        JSON.stringify(defaults, null, 2) + "\n",
      );
    } catch {
      // Can't write — just use defaults
    }
  }
  return defaults;
}

export function saveGlobalConfig(config: GlobalConfig): void {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(config, null, 2) + "\n",
    );
  } catch (err) {
    console.error("Failed to save global config:", err);
    throw new Error("Failed to save config");
  }
}
