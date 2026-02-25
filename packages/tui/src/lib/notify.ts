import fs from "node:fs";

let ttyFd: number | null = null;
const isTmux = !!process.env.TMUX;

function getTtyFd(): number | null {
  if (ttyFd !== null) return ttyFd;
  try {
    ttyFd = fs.openSync("/dev/tty", "w");
    return ttyFd;
  } catch {
    return null;
  }
}

function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1f;\\]/g, " ").trim();
}

function wrapForTmux(sequence: string): string {
  return `\x1bPtmux;\x1b${sequence}\x1b\\`;
}

export function sendNotification(title: string, body: string): void {
  const fd = getTtyFd();
  if (fd === null) return;

  const safeTitle = sanitize(title);
  const safeBody = sanitize(body);
  let sequence = `\x1b]777;notify;${safeTitle};${safeBody}\x07`;

  if (isTmux) {
    sequence = wrapForTmux(sequence);
  }

  try {
    fs.writeSync(fd, sequence);
  } catch {
    // tty may have been closed, reset so next call retries
    ttyFd = null;
  }
}
