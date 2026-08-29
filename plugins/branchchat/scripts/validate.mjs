import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tools } from "../mcp/server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  ".codex-plugin/plugin.json", ".mcp.json", "skills/branchchat/SKILL.md", "mcp/server.mjs", "dist/server.mjs", "README.md",
];
await Promise.all(required.map((file) => access(path.join(root, file))));
const manifest = JSON.parse(await readFile(path.join(root, ".codex-plugin/plugin.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (manifest.name !== "branchchat" || manifest.version.split("+")[0] !== packageJson.version) {
  throw new Error("Unexpected plugin identity or version.");
}
if (new Set(tools.map((tool) => tool.name)).size !== 6 || tools.length !== 6) throw new Error("Expected six unique MCP tools.");
process.stdout.write("BranchChat structure and tool contract are valid.\n");
