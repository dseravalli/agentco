import fs from "node:fs"

let ttyFd: number | null = null
const isTmux = !!process.env.TMUX

function getTtyFd(): number | null {
  if (ttyFd !== null) return ttyFd
  try {
    ttyFd = fs.openSync("/dev/tty", "w")
    return ttyFd
  } catch {
    return null
  }
}

export function copyToClipboard(text: string): void {
  const fd = getTtyFd()
  if (fd === null) return

  const encoded = Buffer.from(text).toString("base64")
  let sequence = `\x1b]52;c;${encoded}\x07`

  if (isTmux) {
    sequence = `\x1bPtmux;\x1b${sequence}\x1b\\`
  }

  try {
    fs.writeSync(fd, sequence)
  } catch {
    ttyFd = null
  }
}
