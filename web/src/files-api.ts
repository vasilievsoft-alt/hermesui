import { api } from './api';
import type { FileEntry, FileReadResult } from '../../shared/types';

export const filesApi = {
  tree: (dir = '') => api.get<FileEntry[]>(`/api/files/tree?path=${encodeURIComponent(dir)}`),
  read: (path: string) =>
    api.get<FileReadResult>(`/api/files/read?path=${encodeURIComponent(path)}`),
  write: (path: string, content: string) =>
    api.put<{ ok: boolean }>('/api/files/write', { path, content }),
  mkdir: (path: string) => api.post<{ ok: boolean }>('/api/files/mkdir', { path }),
  rename: (from: string, to: string) =>
    api.post<{ ok: boolean }>('/api/files/rename', { from, to }),
  remove: (path: string) => api.post<{ ok: boolean }>('/api/files/delete', { path }),
  rawUrl: (path: string) => `/api/files/raw?path=${encodeURIComponent(path)}`,
  downloadUrl: (path: string) =>
    `/api/files/download?path=${encodeURIComponent(path)}`,

  upload(dir: string, file: globalThis.File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    form.append('dir', dir);
    return fetch('/api/files/upload', { method: 'POST', body: form }).then((r) => {
      if (!r.ok) throw new Error(`upload failed: ${r.status}`);
    });
  },
};
