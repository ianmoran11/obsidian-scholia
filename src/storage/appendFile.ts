import type { Vault, TFile } from "obsidian";
import type { LlmRunMetadata } from "../llm/metadata";
import { formatRunMetadataLine } from "../llm/metadata";

export type AppendFormat = "markdown" | "json-line";

export interface AppendOptions {
  relativePath: string;
  content: string;
  format: AppendFormat;
  sourcePath?: string;
  templateName?: string;
  metadata?: LlmRunMetadata;
}

async function ensureFolderExists(
  vault: Vault,
  folderPath: string,
): Promise<void> {
  const existing = vault.getFolderByPath(folderPath);
  if (existing) return;

  const parts = folderPath.split("/");
  let currentPath = "";

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const folder = vault.getFolderByPath(currentPath);
    if (!folder) {
      await vault.createFolder(currentPath);
    }
  }
}

function buildMarkdownEntry(
  content: string,
  sourcePath?: string,
  templateName?: string,
  metadata?: LlmRunMetadata,
): string {
  const ts = new Date().toISOString();
  const basename = sourcePath
    ? (sourcePath.split("/").pop()?.replace(/\.md$/, "") ?? "")
    : "";
  const comment = `<!-- scholia:captured:${ts}:${basename} -->`;
  const metadataLine = metadata
    ? `\n\n**Metadata:** ${formatRunMetadataLine(metadata)}`
    : "";
  return `---\n${comment}\n${content}${metadataLine}`;
}

function buildJsonLineEntry(
  content: string,
  sourcePath?: string,
  templateName?: string,
  metadata?: LlmRunMetadata,
): string {
  const ts = new Date().toISOString();
  const entry = {
    ts,
    source: sourcePath ?? "",
    template: templateName ?? "",
    content,
    metadata,
  };
  return JSON.stringify(entry);
}

export async function appendToVault(
  vault: Vault,
  options: AppendOptions,
): Promise<void> {
  const { relativePath, content, format, sourcePath, templateName, metadata } = options;

  const parts = relativePath.split("/");
  if (parts.length > 1) {
    const folderParts = parts.slice(0, -1);
    await ensureFolderExists(vault, folderParts.join("/"));
  }

  const file = vault.getFileByPath(relativePath);

  if (format === "markdown") {
    const entry = buildMarkdownEntry(content, sourcePath, templateName, metadata);
    if (file) {
      const existing = await vault.read(file);
      await vault.modify(file, existing + "\n\n" + entry);
    } else {
      const header = "# Captures\n\n";
      await vault.create(relativePath, header + entry);
    }
  } else {
    const entry = buildJsonLineEntry(content, sourcePath, templateName, metadata);
    if (file) {
      const existing = await vault.read(file);
      await vault.modify(file, existing + "\n" + entry);
    } else {
      await vault.create(relativePath, entry + "\n");
    }
  }
}
