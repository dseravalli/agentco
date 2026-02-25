import { execa } from "execa";
import * as git from "./git.js";
import * as logger from "../lib/log.js";

export async function createPullRequest(
  worktreePath: string,
  branchName: string,
  title: string,
  body: string,
): Promise<string> {
  await git.addAll(worktreePath);

  try {
    await git.commit(worktreePath, title);
  } catch {
    logger.warn("[pr]", "Nothing to commit, continuing with PR creation");
  }

  await git.push(worktreePath, branchName);

  const result = await execa(
    "gh",
    ["pr", "create", "--title", title, "--body", body, "--head", branchName],
    { cwd: worktreePath, reject: false },
  );

  if (result.exitCode !== 0) {
    throw new Error(`PR creation failed: ${result.stderr}`);
  }

  return result.stdout.trim();
}
