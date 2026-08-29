import test from "node:test";
import assert from "node:assert/strict";
import { shortBranch, threadTitle } from "../mcp/lib/title.mjs";

test("shortBranch removes common prefixes and limits length", () => {
  assert.equal(shortBranch("feature/backend-api"), "backend-api");
  assert.ok(Array.from(shortBranch(`branchchat/${"x".repeat(80)}`)).length <= 28);
});

test("threadTitle is readable and bounded", () => {
  const title = threadTitle("feature/backend", "Backend API");
  assert.equal(title, "⎇ backend · Backend API");
  assert.ok(Array.from(threadTitle("feature/long", "x".repeat(200))).length <= 80);
});
