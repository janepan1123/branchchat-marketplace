import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { AppServerClient, appServerInitializeParams } from "../mcp/lib/app-server-client.mjs";

class RecordingAppServerClient extends AppServerClient {
  async request(method, params) {
    this.recorded = { method, params };
    return { thread: { id: "child", cwd: params.cwd } };
  }
}

test("BranchChat opts into the experimental App Server API", () => {
  assert.deepEqual(appServerInitializeParams(), {
    clientInfo: { name: "branchchat", title: "BranchChat", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
});

test("forkThread excludes the active turn and replaces the runtime workspace", async () => {
  const client = new RecordingAppServerClient();
  const result = await client.forkThread("source", "/projects/repo-worktrees/task", {
    beforeTurnId: "turn-active",
  });
  assert.equal(result.id, "child");
  assert.deepEqual(client.recorded, {
    method: "thread/fork",
    params: {
      threadId: "source",
      cwd: "/projects/repo-worktrees/task",
      runtimeWorkspaceRoots: ["/projects/repo-worktrees/task"],
      excludeTurns: true,
      threadSource: "user",
      beforeTurnId: "turn-active",
    },
  });
});

test("thread metadata update assigns the inherited Codex project", async () => {
  const client = new RecordingAppServerClient();
  await client.updateThreadMetadata(
    "child",
    { branch: "branchchat/ux", sha: "abc123" },
    { projectId: "project-sproutstudio" },
  );
  assert.deepEqual(client.recorded, {
    method: "thread/metadata/update",
    params: {
      threadId: "child",
      gitInfo: { branch: "branchchat/ux", sha: "abc123" },
      projectId: "project-sproutstudio",
    },
  });
});

test("waits until the user-owned fork appears in the Codex task list", async () => {
  const client = new AppServerClient();
  let calls = 0;
  client.listThreads = async () => {
    calls += 1;
    return { data: calls === 1 ? [] : [{ id: "child" }] };
  };
  assert.equal(await client.waitForThreadListed("child", { attempts: 2, delayMs: 0 }), true);
  assert.equal(calls, 2);
});

test("reports when a fork never appears in the Codex task list", async () => {
  const client = new AppServerClient();
  client.listThreads = async () => ({ data: [] });
  assert.equal(await client.waitForThreadListed("missing", { attempts: 2, delayMs: 0 }), false);
});

function fakeAppServer(onMessage) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).trim().split("\n").filter(Boolean)) {
        onMessage(JSON.parse(line), child);
      }
      callback();
    },
  });
  child.kill = () => {
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", null, "SIGTERM");
    });
    return true;
  };
  return child;
}

test("retries a transient App Server startup exit", async () => {
  let spawnCount = 0;
  const client = new AppServerClient({
    startupRetries: 1,
    findExecutable: async () => "/test/codex",
    spawnCommand: () => {
      spawnCount += 1;
      return fakeAppServer((message, child) => {
        if (message.method !== "initialize") return;
        if (spawnCount === 1) {
          child.stderr.write("temporary startup failure\n");
          queueMicrotask(() => {
            child.stdout.end();
            child.stderr.end();
            child.emit("close", 1, null);
          });
          return;
        }
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })}\n`);
      });
    },
  });

  await client.connect();
  assert.equal(spawnCount, 2);
  client.close();
});

test("serializes concurrent App Server initialization", async () => {
  let spawnCount = 0;
  const client = new AppServerClient({
    findExecutable: async () => "/test/codex",
    spawnCommand: () => {
      spawnCount += 1;
      return fakeAppServer((message, child) => {
        if (message.method !== "initialize") return;
        setImmediate(() => {
          child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })}\n`);
        });
      });
    },
  });

  await Promise.all([client.connect(), client.connect(), client.connect()]);
  assert.equal(spawnCount, 1);
  client.close();
});

test("starts App Server from a stable directory instead of the plugin cache cwd", async () => {
  let spawnOptions;
  const client = new AppServerClient({
    appServerCwd: "/stable/home",
    findExecutable: async () => "/test/codex",
    spawnCommand: (_executable, _args, options) => {
      spawnOptions = options;
      return fakeAppServer((message, child) => {
        if (message.method !== "initialize") return;
        child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })}\n`);
      });
    },
  });

  await client.connect();
  assert.equal(spawnOptions.cwd, "/stable/home");
  client.close();
});

test("reports App Server exit details instead of a generic internal error", async () => {
  const client = new AppServerClient({
    startupRetries: 0,
    findExecutable: async () => "/test/codex",
    spawnCommand: () => fakeAppServer((message, child) => {
      if (message.method !== "initialize") return;
      child.stderr.write("configuration rejected\n");
      queueMicrotask(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 1, null);
      });
    }),
  });

  await assert.rejects(client.connect(), (error) => {
    assert.equal(error.code, "APP_SERVER_EXITED");
    assert.equal(error.details.exitCode, 1);
    assert.match(error.details.stderr, /configuration rejected/);
    return true;
  });
});
