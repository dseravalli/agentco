type LogLevel = "debug" | "info" | "error"

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, error: 2 }

const current: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) in LEVELS
    ? (process.env.LOG_LEVEL as LogLevel)
    : "info"

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[current]
}

export function debug(prefix: string, msg: string): void {
  if (shouldLog("debug")) console.log(`${prefix} ${msg}`)
}

export function info(prefix: string, msg: string): void {
  if (shouldLog("info")) console.log(`${prefix} ${msg}`)
}

export function warn(prefix: string, msg: string): void {
  if (shouldLog("info")) console.warn(`${prefix} ${msg}`)
}

export function error(prefix: string, msg: string): void {
  console.error(`${prefix} ${msg}`)
}

export function isDebug(): boolean {
  return current === "debug"
}
