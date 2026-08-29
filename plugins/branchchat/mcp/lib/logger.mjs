import { appendFile, chmod, mkdir } from "node:fs/promises";

function safeThreadId(value) {
  return typeof value === "string" ? value.slice(0, 10) : undefined;
}

export class Logger {
  constructor(paths) {
    this.paths = paths;
  }

  async write(event) {
    const entry = {
      timestamp: new Date().toISOString(),
      ...event,
      threadId: safeThreadId(event.threadId),
      sourceThreadId: safeThreadId(event.sourceThreadId),
    };
    try {
      await mkdir(this.paths.logsRoot, { recursive: true, mode: 0o700 });
      await appendFile(this.paths.logFile, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
      await chmod(this.paths.logFile, 0o600);
    } catch (error) {
      process.stderr.write(`BranchChat log warning: ${error.message}\n`);
    }
  }

  info(message, fields = {}) {
    return this.write({ level: "info", message, ...fields });
  }

  error(message, fields = {}) {
    return this.write({ level: "error", message, ...fields });
  }
}
