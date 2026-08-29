import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { BranchChatError } from "./errors.mjs";

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function staleLock(lockPath, staleAfterMs) {
  try {
    const record = JSON.parse(await readFile(lockPath, "utf8"));
    const age = Date.now() - Date.parse(record.createdAt);
    if (!Number.isFinite(age) || age < 0) return true;
    if (processExists(record.pid)) return false;
    return age > Math.min(staleAfterMs, 1_000);
  } catch {
    return true;
  }
}

export async function withFileLock(
  locksRoot,
  name,
  operation,
  { staleAfterMs = 10 * 60 * 1000 } = {},
) {
  await mkdir(locksRoot, { recursive: true, mode: 0o700 });
  const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, "-");
  const lockPath = path.join(locksRoot, `${safeName}.lock`);
  let handle;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      await handle.sync();
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (attempt === 0 && await staleLock(lockPath, staleAfterMs)) {
        await unlink(lockPath).catch(() => {});
        continue;
      }
      throw new BranchChatError("REPO_LOCKED", "Another BranchChat operation is already running for this repository.", {
        details: { lockPath },
      });
    }
  }

  try {
    return await operation();
  } finally {
    await handle?.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}
