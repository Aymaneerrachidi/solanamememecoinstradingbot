type Level = "info" | "warn" | "error";

function log(level: Level, msg: string, extra?: unknown) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level.toUpperCase()} ${msg}`;
  if (extra !== undefined) console[level === "error" ? "error" : "log"](line, extra);
  else console[level === "error" ? "error" : "log"](line);
}

export const logger = {
  info: (m: string, e?: unknown) => log("info", m, e),
  warn: (m: string, e?: unknown) => log("warn", m, e),
  error: (m: string, e?: unknown) => log("error", m, e),
};
