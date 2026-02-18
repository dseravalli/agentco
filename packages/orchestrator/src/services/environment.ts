import fs from "node:fs/promises";
import path from "node:path";
import type { AgentCoConfig } from "../types.js";
import * as logger from "../lib/log.js";

export async function copyWorktreeFiles(
  projectRoot: string,
  worktreePath: string,
  filesToCopy: string[]
): Promise<void> {
  for (const file of filesToCopy) {
    const src = path.join(projectRoot, file);
    const dest = path.join(worktreePath, file);

    try {
      await fs.access(src);
    } catch {
      logger.warn("[env]", `File not found, skipping copy: ${src}`);
      continue;
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.cp(src, dest, { recursive: true });
  }
}

export async function writeEnvFile(
  worktreePath: string,
  projectRoot: string,
  envOverrides: Record<string, string>,
  resolvedValues: Record<string, string>
): Promise<void> {
  const envPath = path.join(worktreePath, ".env");
  let existingEnv: Record<string, string> = {};

  // Read existing .env from worktree (may have been copied)
  try {
    const content = await fs.readFile(envPath, "utf-8");
    existingEnv = parseEnv(content);
  } catch {
    // No existing .env
  }

  // Read parent .env for "inherit" values
  let parentEnv: Record<string, string> = {};
  try {
    const parentContent = await fs.readFile(
      path.join(projectRoot, ".env"),
      "utf-8"
    );
    parentEnv = parseEnv(parentContent);
  } catch {
    // No parent .env
  }

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === "auto") {
      if (resolvedValues[key] !== undefined) {
        existingEnv[key] = resolvedValues[key];
      }
    } else if (value === "inherit") {
      if (parentEnv[key] !== undefined) {
        existingEnv[key] = parentEnv[key];
      }
    } else {
      existingEnv[key] = value;
    }
  }

  const envContent = Object.entries(existingEnv)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  await fs.writeFile(envPath, envContent + "\n");
}

function parseEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}
