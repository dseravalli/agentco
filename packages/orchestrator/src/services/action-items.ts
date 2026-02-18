import Anthropic from "@anthropic-ai/sdk";
import type { FileDiff } from "./opencode.js";
import * as logger from "../lib/log.js";

export interface ActionItem {
  category: "migration" | "env_var" | "schema_change" | "config_change";
  summary: string;
  files: string[];
}

const CATEGORY_LABELS: Record<ActionItem["category"], string> = {
  migration: "New migration",
  env_var: "Environment variable change",
  schema_change: "Schema change",
  config_change: "Config/infra change",
};

// -- Heuristic patterns --

const MIGRATION_PATTERNS = [
  /\bmigrations?\//i,
  /\bmigrate\//i,
  /\/drizzle\/\d+/,
  /\/prisma\/migrations\//,
  /\/alembic\/versions\//,
  /\/db\/migrate\//,
  /\/flyway\//i,
  /\.sql$/,
];

const ENV_FILE_PATTERNS = [
  /^\.env$/,
  /^\.env\./,
  /\.env\.example$/,
  /\.env\.local$/,
  /\.env\.sample$/,
];

const ENV_REF_PATTERNS = [
  /process\.env\.\w+/,
  /Bun\.env\.\w+/,
  /import\.meta\.env\.\w+/,
];

const SCHEMA_PATTERNS = [
  /\/schema\.\w+$/,
  /\/schema\/.*\.\w+$/,
  /prisma\/schema\.prisma$/,
  /\/models?\.\w+$/,
  /\/models\//,
  /drizzle\/.*schema/i,
];

const CONFIG_PATTERNS = [
  /^Dockerfile/i,
  /^docker-compose/i,
  /\.github\/workflows\//,
  /\.gitlab-ci/,
  /nginx/i,
  /^Procfile$/,
  /^fly\.toml$/,
  /^vercel\.json$/,
  /^netlify\.toml$/,
  /^render\.yaml$/,
  /^railway\.json$/,
  /^heroku\.yml$/,
  /^\.dockerignore$/,
  /^Caddyfile$/,
  /^k8s\//,
  /^kubernetes\//,
  /^terraform\//,
  /^pulumi\//,
];

function isNewFile(diff: FileDiff): boolean {
  return diff.before === "" && diff.after !== "";
}

function matchesAny(file: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(file));
}

function extractAddedEnvVars(diff: FileDiff): string[] {
  const vars = new Set<string>();
  const lines = diff.after.split("\n");
  const beforeLines = new Set(diff.before.split("\n"));

  for (const line of lines) {
    if (beforeLines.has(line)) continue;
    for (const pattern of ENV_REF_PATTERNS) {
      const matches = line.matchAll(new RegExp(pattern, "g"));
      for (const m of matches) {
        vars.add(m[0]);
      }
    }
  }
  return [...vars];
}

function extractAddedEnvKeys(diff: FileDiff): string[] {
  const keys: string[] = [];
  const lines = diff.after.split("\n");
  const beforeKeys = new Set(
    diff.before
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => l.split("=")[0].trim())
  );

  for (const line of lines) {
    if (!line.includes("=")) continue;
    const key = line.split("=")[0].trim();
    if (key && !key.startsWith("#") && !beforeKeys.has(key)) {
      keys.push(key);
    }
  }
  return keys;
}

export function detectActionItems(diffs: FileDiff[]): ActionItem[] {
  const items: ActionItem[] = [];
  const seen = new Set<string>();

  function addItem(item: ActionItem) {
    const key = `${item.category}:${item.files.sort().join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  }

  for (const diff of diffs) {
    const file = diff.file;

    // Migrations: only flag new migration files
    if (isNewFile(diff) && matchesAny(file, MIGRATION_PATTERNS)) {
      addItem({
        category: "migration",
        summary: `New migration file: ${file}`,
        files: [file],
      });
    }

    // Env files: detect new keys
    if (matchesAny(file, ENV_FILE_PATTERNS)) {
      const newKeys = extractAddedEnvKeys(diff);
      if (newKeys.length > 0) {
        addItem({
          category: "env_var",
          summary: `New env vars in ${file}: ${newKeys.join(", ")}`,
          files: [file],
        });
      }
    }

    // Env var references in source code (new references only)
    if (!matchesAny(file, ENV_FILE_PATTERNS) && diff.additions > 0) {
      const newVars = extractAddedEnvVars(diff);
      if (newVars.length > 0) {
        addItem({
          category: "env_var",
          summary: `New env var references in ${file}: ${newVars.join(", ")}`,
          files: [file],
        });
      }
    }

    // Schema changes
    if (matchesAny(file, SCHEMA_PATTERNS) && (diff.additions > 0 || diff.deletions > 0)) {
      addItem({
        category: "schema_change",
        summary: `Schema changed: ${file} (+${diff.additions}/-${diff.deletions})`,
        files: [file],
      });
    }

    // Config/infra changes
    if (matchesAny(file, CONFIG_PATTERNS) && (diff.additions > 0 || diff.deletions > 0)) {
      addItem({
        category: "config_change",
        summary: `Config changed: ${file} (+${diff.additions}/-${diff.deletions})`,
        files: [file],
      });
    }
  }

  return items;
}

// -- LLM fallback --

const LLM_TIMEOUT_MS = 15_000;

function buildDiffSummary(diffs: FileDiff[]): string {
  return diffs
    .map((d) => {
      const status = isNewFile(d) ? "(new)" : `(+${d.additions}/-${d.deletions})`;
      return `${d.file} ${status}`;
    })
    .join("\n");
}

const SYSTEM_PROMPT = `You analyze code diffs to identify changes that require manual action from a developer.

Look for:
- Database migrations that need to be run
- New environment variables that need to be set
- Database schema changes (new tables, columns, indexes)
- Infrastructure/config changes (Docker, CI/CD, deployment configs)

Respond ONLY with a JSON array of objects, each with:
- "category": one of "migration", "env_var", "schema_change", "config_change"
- "summary": a brief human-readable description of what action is needed
- "files": array of affected file paths

If there are no action items, respond with an empty array: []

Be conservative — only flag things that genuinely require manual attention.`;

export async function detectActionItemsWithLLM(diffs: FileDiff[]): Promise<ActionItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn("[action-items]", "ANTHROPIC_API_KEY not set, skipping LLM analysis");
    return [];
  }

  const diffSummary = buildDiffSummary(diffs);
  if (!diffSummary.trim()) return [];

  try {
    const client = new Anthropic({ apiKey });

    const response = await Promise.race([
      client.messages.create({
        model: "claude-haiku-4-20250414",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Here are the files changed in this session:\n\n${diffSummary}\n\nWhat manual actions are needed?`,
          },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM timeout")), LLM_TIMEOUT_MS)
      ),
    ]);

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item: unknown): item is ActionItem =>
        typeof item === "object" &&
        item !== null &&
        "category" in item &&
        "summary" in item &&
        "files" in item &&
        typeof (item as ActionItem).category === "string" &&
        typeof (item as ActionItem).summary === "string" &&
        Array.isArray((item as ActionItem).files)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[action-items]", `LLM analysis failed: ${msg}`);
    return [];
  }
}

// -- Main entry point --

export async function analyzeCompletion(diffs: FileDiff[]): Promise<ActionItem[]> {
  if (diffs.length === 0) return [];

  const heuristicItems = detectActionItems(diffs);

  if (heuristicItems.length > 0) {
    logger.debug("[action-items]", `heuristics found ${heuristicItems.length} item(s), skipping LLM`);
    return heuristicItems;
  }

  logger.debug("[action-items]", "heuristics found nothing, running LLM analysis");
  const llmItems = await detectActionItemsWithLLM(diffs);
  logger.debug("[action-items]", `LLM found ${llmItems.length} item(s)`);
  return llmItems;
}

export { CATEGORY_LABELS };
