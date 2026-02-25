import pg from "pg";
import { execaCommand } from "execa";

const { Client } = pg;

function buildDbName(projectSlug: string, taskSlug: string): string {
  return `${projectSlug}_${taskSlug}`.replace(/-/g, "_");
}

function buildConnectionUrl(baseConnectionString: string, dbName: string): string {
  const url = new URL(baseConnectionString);
  url.pathname = `/${dbName}`;
  return url.toString();
}

export async function createDatabase(
  connectionString: string,
  projectSlug: string,
  taskSlug: string,
): Promise<{ databaseName: string; databaseUrl: string }> {
  const dbName = buildDbName(projectSlug, taskSlug);
  const client = new Client({ connectionString });

  try {
    await client.connect();
    // Check if database already exists
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (result.rows.length === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }

  const databaseUrl = buildConnectionUrl(connectionString, dbName);
  return { databaseName: dbName, databaseUrl };
}

export async function dropDatabase(connectionString: string, databaseName: string): Promise<void> {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    // Terminate existing connections
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await client.end();
  }
}

export async function runMigrations(worktreePath: string, migrateCommand: string): Promise<void> {
  const result = await execaCommand(migrateCommand, {
    cwd: worktreePath,
    reject: false,
    env: { ...process.env },
  });
  if (result.exitCode !== 0) {
    throw new Error(`Migration failed: ${result.stderr}`);
  }
}

export async function runSeed(worktreePath: string, seedCommand: string): Promise<void> {
  const result = await execaCommand(seedCommand, {
    cwd: worktreePath,
    reject: false,
    env: { ...process.env },
  });
  if (result.exitCode !== 0) {
    throw new Error(`Seed failed: ${result.stderr}`);
  }
}
