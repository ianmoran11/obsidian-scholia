export type Scope = "selection" | "heading" | "full-note";

export interface CaptureRow {
  id: string;
  ts: string;
  sourcePath: string;
  template: string;
  content: string;
  scope: Scope;
  model: string;
}

export interface CaptureFilter {
  since?: string;
  template?: string;
  sourcePath?: string;
}

export interface SqliteStore {
  init(): Promise<void>;
  insertCapture(row: CaptureRow): Promise<void>;
  queryCaptures(filter: CaptureFilter): Promise<CaptureRow[]>;
  close(): Promise<void>;
}

export class NoopSqliteStore implements SqliteStore {
  async init(): Promise<void> {}
  async insertCapture(_row: CaptureRow): Promise<void> {}
  async queryCaptures(_filter: CaptureFilter): Promise<CaptureRow[]> {
    return [];
  }
  async close(): Promise<void> {}
}
