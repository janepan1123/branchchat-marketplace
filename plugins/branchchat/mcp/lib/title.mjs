const COMMON_PREFIXES = ["feature/", "fix/", "chore/", "refactor/", "branchchat/"];

function truncate(value, limit) {
  const characters = Array.from(String(value).trim());
  if (characters.length <= limit) return characters.join("");
  return `${characters.slice(0, Math.max(1, limit - 1)).join("")}…`;
}

export function shortBranch(branch) {
  const value = String(branch);
  const prefix = COMMON_PREFIXES.find((candidate) => value.startsWith(candidate));
  return truncate(prefix ? value.slice(prefix.length) : value, 28);
}

export function threadTitle(branch, taskTitle) {
  const title = `⎇ ${shortBranch(branch)} · ${truncate(taskTitle, 48)}`;
  return truncate(title, 80);
}
