export function buildCommandId(templatePath: string): string {
  const normalized = templatePath
    .replace(/[<>:"/\\|?*\s]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `scholia.template.${normalized}`;
}
