import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { BranchChatError } from "./errors.mjs";
import { findCodexExecutable } from "./paths.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_STDERR_LENGTH = 4_000;

function safeStderr(value) {
  return String(value || "")
    .trim()
    .replace(/\b(sk-[A-Za-z0-9_-]{10,})\b/g, "[REDACTED]")
    .replace(/\b(authorization|api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(-MAX_STDERR_LENGTH);
}

function appServerExitError({ code, signal, executable, stderr }) {
  const diagnostic = safeStderr(stderr);
  const status = code === null || code === undefined ? "without an exit code" : `with code ${code}`;
  const signalSuffix = signal ? ` (signal ${signal})` : "";
  const diagnosticSuffix = diagnostic ? `: ${diagnostic}` : ".";
  return new BranchChatError(
    "APP_SERVER_EXITED",
    `Codex App Server exited ${status}${signalSuffix}${diagnosticSuffix}`,
    { details: { exitCode: code ?? null, signal: signal || null, executable, stderr: diagnostic || null } },
  );
}

export function appServerInitializeParams() {
  return {
    clientInfo: { name: "branchchat", title: "BranchChat", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  };
}

export class AppServerClient {
  constructor({
    env = process.env,
    requestTimeoutMs = 30_000,
    startupRetries = 2,
    spawnCommand = spawn,
    findExecutable = findCodexExecutable,
    appServerCwd = os.homedir(),
  } = {}) {
    this.env = env;
    this.requestTimeoutMs = requestTimeoutMs;
    this.startupRetries = startupRetries;
    this.spawnCommand = spawnCommand;
    this.findExecutable = findExecutable;
    this.appServerCwd = appServerCwd;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    if (this.connectPromise) return this.connectPromise;
    if (this.child) return this;
    const pendingConnect = this.#connectWithRetries();
    this.connectPromise = pendingConnect;
    try { return await pendingConnect; }
    finally {
      if (this.connectPromise === pendingConnect) this.connectPromise = null;
    }
  }

  async #connectWithRetries() {
    const executable = await this.findExecutable(this.env);
    if (!executable) {
      throw new BranchChatError("CODEX_NOT_FOUND", "Could not find the Codex executable. Set BRANCHCHAT_CODEX_PATH.");
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.#start(executable);
        return this;
      } catch (error) {
        if (!["APP_SERVER_EXITED", "APP_SERVER_IO_ERROR"].includes(error?.code) || attempt >= this.startupRetries) {
          throw error;
        }
        await sleep(100 * (2 ** attempt));
      }
    }
  }

  async #start(executable) {
    const childEnv = { ...this.env };
    const binDirectory = path.dirname(executable);
    childEnv.PATH = `${binDirectory}${path.delimiter}${childEnv.PATH || ""}`;
    const child = this.spawnCommand(executable, ["app-server"], {
      cwd: this.appServerCwd,
      env: childEnv,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_LENGTH * 2);
    });
    child.stdin.on("error", (error) => {
      this.#handleChildFailure(child, new BranchChatError(
        "APP_SERVER_IO_ERROR",
        `Could not write to Codex App Server: ${error.message}`,
        { details: { executable } },
      ));
      child.kill();
    });
    child.on("error", (error) => this.#handleChildFailure(child, new BranchChatError(
      "APP_SERVER_LAUNCH_FAILED",
      `Could not start Codex App Server: ${error.message}`,
      { details: { executable } },
    )));
    child.on("close", (code, signal) => this.#handleChildFailure(
      child,
      appServerExitError({ code, signal, executable, stderr }),
    ));
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.#onLine(line));
    try {
      await this.#requestOnce("initialize", appServerInitializeParams());
      this.notify("initialized", {});
    } catch (error) {
      if (child === this.child) {
        this.child = null;
        child.kill();
      }
      throw error;
    }
  }

  #onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      const error = new BranchChatError("APP_SERVER_ERROR", message.error.message || "Codex App Server request failed.", {
        details: { appServerCode: message.error.code, data: message.error.data },
      });
      error.appServerCode = message.error.code;
      pending.reject(error);
    } else pending.resolve(message.result);
  }

  #handleChildFailure(child, error) {
    if (child !== this.child) return;
    this.child = null;
    this.#rejectAll(error);
  }

  #rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  notify(method, params) {
    if (!this.child) {
      throw new BranchChatError("APP_SERVER_DISCONNECTED", "Codex App Server is not connected.");
    }
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async request(method, params = {}, { retries = 4, reconnectRetries = 0 } = {}) {
    for (let reconnectAttempt = 0; ; reconnectAttempt += 1) {
      await this.connectIfNeeded(method);
      try {
        for (let attempt = 0; ; attempt += 1) {
          try { return await this.#requestOnce(method, params); }
          catch (error) {
            if (error.appServerCode !== -32001 || attempt >= retries) throw error;
            await sleep(100 * (2 ** attempt) + Math.floor(Math.random() * 100));
          }
        }
      } catch (error) {
        if (error?.code !== "APP_SERVER_EXITED" || reconnectAttempt >= reconnectRetries) throw error;
      }
    }
  }

  async connectIfNeeded(method) {
    if (method !== "initialize" && (this.connectPromise || !this.child)) await this.connect();
  }

  #requestOnce(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new BranchChatError("APP_SERVER_DISCONNECTED", "Codex App Server is not connected."));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BranchChatError("APP_SERVER_TIMEOUT", `Codex App Server timed out on ${method}.`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async threadRead(threadId, { includeTurns = false } = {}) {
    const result = await this.request("thread/read", { threadId, includeTurns }, { reconnectRetries: 1 });
    return result.thread || result;
  }

  async forkThread(threadId, cwd, { beforeTurnId } = {}) {
    const params = {
      threadId,
      cwd,
      runtimeWorkspaceRoots: [cwd],
      excludeTurns: true,
      threadSource: "user",
    };
    if (beforeTurnId) params.beforeTurnId = beforeTurnId;
    const result = await this.request("thread/fork", params);
    return result.thread || result;
  }

  async setThreadName(threadId, name) {
    return this.request("thread/name/set", { threadId, name }, { retries: 1 });
  }

  async updateThreadMetadata(threadId, gitInfo, { projectId } = {}) {
    const params = { threadId, gitInfo };
    if (typeof projectId === "string" && projectId.trim()) params.projectId = projectId;
    return this.request("thread/metadata/update", params, { retries: 1 });
  }

  async listThreads(limit = 20) {
    return this.request("thread/list", { limit, sortKey: "updated_at" }, { reconnectRetries: 1 });
  }

  async waitForThreadListed(threadId, { attempts = 5, delayMs = 100 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await this.listThreads(50);
      const threads = Array.isArray(result?.data) ? result.data : Array.isArray(result?.threads) ? result.threads : [];
      if (threads.some((thread) => (thread?.id || thread?.threadId) === threadId)) return true;
      if (attempt + 1 < attempts && delayMs > 0) await sleep(delayMs * (2 ** attempt));
    }
    return false;
  }

  close() {
    const child = this.child;
    this.child = null;
    this.#rejectAll(new BranchChatError("APP_SERVER_CLOSED", "Codex App Server connection was closed."));
    child?.kill();
  }
}
