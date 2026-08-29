import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { BranchChatError } from "./errors.mjs";
import { findCodexExecutable } from "./paths.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class AppServerClient {
  constructor({ env = process.env, requestTimeoutMs = 30_000 } = {}) {
    this.env = env;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    if (this.child) return this;
    const executable = await findCodexExecutable(this.env);
    if (!executable) {
      throw new BranchChatError("CODEX_NOT_FOUND", "Could not find the Codex executable. Set BRANCHCHAT_CODEX_PATH.");
    }
    const childEnv = { ...this.env };
    const binDirectory = path.dirname(executable);
    childEnv.PATH = `${binDirectory}${path.delimiter}${childEnv.PATH || ""}`;
    this.child = spawn(executable, ["app-server"], {
      env: childEnv, shell: false, stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", () => {});
    this.child.on("error", (error) => this.#rejectAll(error));
    this.child.on("close", (code) => this.#rejectAll(new Error(`Codex App Server exited with ${code}`)));
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.#onLine(line));
    await this.request("initialize", {
      clientInfo: { name: "branchchat", title: "BranchChat", version: "0.1.0" },
      capabilities: {},
    });
    this.notify("initialized", {});
    return this;
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

  #rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.child = null;
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async request(method, params = {}, { retries = 4 } = {}) {
    await this.connectIfNeeded(method);
    for (let attempt = 0; ; attempt += 1) {
      try { return await this.#requestOnce(method, params); }
      catch (error) {
        if (error.appServerCode !== -32001 || attempt >= retries) throw error;
        await sleep(100 * (2 ** attempt) + Math.floor(Math.random() * 100));
      }
    }
  }

  async connectIfNeeded(method) {
    if (!this.child && method !== "initialize") await this.connect();
  }

  #requestOnce(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BranchChatError("APP_SERVER_TIMEOUT", `Codex App Server timed out on ${method}.`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async threadRead(threadId) {
    const result = await this.request("thread/read", { threadId, includeTurns: false });
    return result.thread || result;
  }

  async forkThread(threadId, cwd) {
    const result = await this.request("thread/fork", {
      threadId, cwd, runtimeWorkspaceRoots: [cwd], excludeTurns: true,
    });
    return result.thread || result;
  }

  async setThreadName(threadId, name) {
    return this.request("thread/name/set", { threadId, name }, { retries: 1 });
  }

  async updateThreadMetadata(threadId, gitInfo) {
    return this.request("thread/metadata/update", { threadId, gitInfo }, { retries: 1 });
  }

  async listThreads(limit = 20) {
    return this.request("thread/list", { limit, sortKey: "updated_at" });
  }

  close() {
    this.child?.kill();
    this.child = null;
  }
}
