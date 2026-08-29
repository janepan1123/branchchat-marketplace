import { AppServerClient } from "../mcp/lib/app-server-client.mjs";

const client = new AppServerClient({ requestTimeoutMs: 15_000 });
try {
  const result = await client.listThreads(1);
  if (!result) throw new Error("Codex App Server returned no result.");
  const thread = (result.data || result.threads || [])[0];
  if (thread?.id) await client.threadRead(thread.id);
  process.stdout.write("Codex App Server initialize + read-only thread/list and thread/read succeeded.\n");
} finally { client.close(); }
