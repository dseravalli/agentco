import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_PATH = path.join(os.homedir(), ".agentco", "config.json");

const DEFAULT_MODELS = [
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "openai/gpt-5.3-codex",
];

interface GlobalConfig {
  models: string[];
}

export function getGlobalConfig(): GlobalConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.models) && parsed.models.length > 0) {
      return { models: parsed.models };
    }
  } catch {
    // File doesn't exist or is invalid — create with defaults
    try {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ models: DEFAULT_MODELS }, null, 2) + "\n");
    } catch {
      // Can't write — just use defaults
    }
  }
  return { models: DEFAULT_MODELS };
}
