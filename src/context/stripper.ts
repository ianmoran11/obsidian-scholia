export function stripForTokens(md: string): string {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, "") // leading YAML
    .replace(/!\[\[[^\]]+\]\]/g, "") // Obsidian embeds
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // images
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1") // links → text
    .replace(/\n{3,}/g, "\n\n") // collapse blank runs
    .trim();
}
