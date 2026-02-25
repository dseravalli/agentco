import { execa } from "execa";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const WORKTREE_ROOT = path.join(os.homedir(), ".agentco", "worktrees");

async function git(args: string[], cwd: string) {
  const result = await execa("git", args, { cwd, reject: false });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

export async function fetchOrigin(projectRoot: string): Promise<void> {
  await git(["fetch", "origin"], projectRoot);
}

export async function pullMain(projectRoot: string): Promise<void> {
  await git(["pull", "origin", "main"], projectRoot);
}

export async function createWorktree(
  projectRoot: string,
  worktreePath: string,
  branchName: string,
): Promise<void> {
  await git(["worktree", "add", worktreePath, "-b", branchName], projectRoot);
}

export async function removeWorktree(projectRoot: string, worktreePath: string): Promise<void> {
  await git(["worktree", "remove", worktreePath, "--force"], projectRoot);
}

export async function deleteBranch(projectRoot: string, branchName: string): Promise<void> {
  await git(["branch", "-d", branchName], projectRoot).catch(() => {
    return git(["branch", "-D", branchName], projectRoot);
  });
}

export async function addAll(cwd: string): Promise<void> {
  await git(["add", "-A"], cwd);
}

export async function commit(cwd: string, message: string): Promise<void> {
  await git(["commit", "-m", message], cwd);
}

export async function push(cwd: string, branchName: string): Promise<void> {
  await git(["push", "origin", branchName], cwd);
}

export async function resolveWorktreePath(projectSlug: string, taskSlug: string): Promise<string> {
  await fs.mkdir(WORKTREE_ROOT, { recursive: true });
  return path.join(WORKTREE_ROOT, `${projectSlug}-${taskSlug}`);
}

export function resolveBranchName(taskSlug: string): string {
  return `agent/${taskSlug}`;
}
