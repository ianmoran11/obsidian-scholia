import type { TFile, Vault } from "obsidian";

export interface AudioStorageResult {
  path: string;
  basename: string;
}

function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Untitled";
}

function timestampForPath(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "-" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!vault.getFolderByPath(current)) {
      await (vault as Vault & { createFolder: (path: string) => Promise<unknown> })
        .createFolder(current);
    }
  }
}

export async function saveAudioToVault(
  vault: Vault,
  opts: {
    audioOutputFolder: string;
    sourceFile?: TFile | null;
    calloutId?: string;
    audio: ArrayBuffer;
    extension?: string;
    now?: Date;
  },
): Promise<AudioStorageResult> {
  const folder = opts.audioOutputFolder || "_System/Scholia Audio";
  const noteName = sanitizePathSegment(
    opts.sourceFile?.path.split("/").pop()?.replace(/\.md$/i, "") ?? "Untitled",
  );
  const noteFolder = `${folder}/${noteName}`;
  await ensureFolder(vault, noteFolder);

  const idPart = sanitizePathSegment(opts.calloutId ?? "scholia");
  const basename = `${idPart}-${timestampForPath(opts.now)}.${opts.extension ?? "mp3"}`;
  const path = `${noteFolder}/${basename}`;
  const binaryVault = vault as Vault & {
    createBinary: (path: string, data: ArrayBuffer) => Promise<void>;
    modifyBinary: (file: TFile, data: ArrayBuffer) => Promise<void>;
    getFileByPath: (path: string) => TFile | null;
  };
  const existing = binaryVault.getFileByPath(path);
  if (existing) {
    await binaryVault.modifyBinary(existing, opts.audio);
  } else {
    await binaryVault.createBinary(path, opts.audio);
  }

  return { path, basename };
}
