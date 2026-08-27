export interface ApiStatus {
  app: string;
  version: string;
}

export interface AgentDescriptor {
  id: 'claude' | 'opencode' | 'openclaw' | 'hermes';
  name: string;
  acpCommand: string[];
}

export interface FileEntry {
  name: string;
  type: 'dir' | 'file';
  size: number;
  mtimeMs: number;
}

export interface FileReadResult {
  content: string;
  truncated: boolean;
  binary: boolean;
  size: number;
  mtimeMs: number;
}
