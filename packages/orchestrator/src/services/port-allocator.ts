import { db, schema } from "../db/index.js";
import { PORT_RANGES } from "../types.js";
import { eq, isNotNull } from "drizzle-orm";
import net from "node:net";

type PortType = "opencode" | "devPreview";

function getRange(type: PortType) {
  return PORT_RANGES[type];
}

function getPortColumn(type: PortType) {
  return type === "opencode" ? "opencodePort" : "devPreviewPort";
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function allocatePort(type: PortType): Promise<number> {
  const range = getRange(type);
  const col = getPortColumn(type);

  const taskPorts = db
    .select({ port: schema.tasks[col] })
    .from(schema.tasks)
    .where(isNotNull(schema.tasks[col]))
    .all()
    .map((r) => r.port)
    .filter((p): p is number => p !== null);

  const usedSet = new Set(taskPorts);

  // Team member agents also hold opencode ports
  if (type === "opencode") {
    const memberPorts = db
      .select({ port: schema.teamMembers.opencodePort })
      .from(schema.teamMembers)
      .where(isNotNull(schema.teamMembers.opencodePort))
      .all()
      .map((r) => r.port)
      .filter((p): p is number => p !== null);

    for (const p of memberPorts) {
      usedSet.add(p);
    }
  }

  for (let port = range.min; port <= range.max; port++) {
    if (usedSet.has(port)) continue;
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available ports in range ${range.min}-${range.max} for ${type}`);
}

export async function releasePort(taskId: string, type: PortType): Promise<void> {
  const col = getPortColumn(type);
  db.update(schema.tasks)
    .set({ [col]: null })
    .where(eq(schema.tasks.id, taskId))
    .run();
}

export async function releaseTeamMemberPort(memberId: string): Promise<void> {
  db.update(schema.teamMembers)
    .set({ opencodePort: null })
    .where(eq(schema.teamMembers.id, memberId))
    .run();
}
