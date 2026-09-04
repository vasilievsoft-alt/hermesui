import { useEffect, useRef, useState } from 'react';
import CodeEditor from '../components/files/CodeEditor';
import { filesApi } from '../files-api';
import { useIsMobile } from '../hooks/useMediaQuery';
import type { FileEntry } from '../../../shared/types';

interface TNode {
  id: string; // workspace-relative path
  name: string;
  type: 'dir' | 'file';
  children?: TNode[];
}

const ROOT: TNode = { id: '', name: 'workspace', type: 'dir', children: [] };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;

function parentOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

async function fetchChildren(dir: string): Promise<TNode[]> {
  const entries: FileEntry[] = await filesApi.tree(dir);
  return entries.map((e) => ({
    id: dir ? `${dir}/${e.name}` : e.name,
    name: e.name,
    type: e.type,
    ...(e.type === 'dir' ? { children: [] as TNode[] } : {}),
  }));
}

export default function FilesPage() {
  const [root, setRoot] = useState<TNode>(ROOT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [read, setRead] = useState<Awaited<ReturnType<typeof filesApi.read>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  async function loadDir(dir: string): Promise<void> {
    const kids = await fetchChildren(dir);
    setRoot((prev) => {
      const clone = structuredClone(prev);
      const target = dir ? find(clone, dir) : clone;
      if (target) target.children = kids;
      return clone;
    });
  }

  useEffect(() => {
    void loadDir('').catch((e) => setError(String(e)));
  }, []);

  async function toggleDir(node: TNode): Promise<void> {
    const isOpen = expanded.has(node.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
    if (!isOpen) {
      // (re)load children on every expand to reflect agent-side changes
      const kids = await fetchChildren(node.id);
      setRoot((prev) => {
        const clone = structuredClone(prev);
        const target = find(clone, node.id);
        if (target) target.children = kids;
        return clone;
      });
    }
  }

  async function refreshDir(dir: string): Promise<void> {
    await loadDir(dir);
    setFlash('done');
    setTimeout(() => setFlash(null), 1200);
  }

  async function openFile(path: string): Promise<void> {
    setSelected(path);
    setError(null);
    try {
      const r = await filesApi.read(path);
      setRead(r);
      setDraft(r.content);
      setEditing(false);
    } catch (e) {
      setRead(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save(): Promise<void> {
    if (!selected) return;
    await filesApi.write(selected, draft);
    setFlash('saved');
    setTimeout(() => setFlash(null), 1500);
    setEditing(false);
    void loadDir(parentOf(selected));
  }

  async function op(fn: () => Promise<unknown>, afterDir: string, msg?: string): Promise<void> {
    try {
      await fn();
      await loadDir(afterDir);
      setFlash(msg ?? 'done');
      setTimeout(() => setFlash(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function promptName(title: string, def = ''): string | null {
    const v = window.prompt(title, def);
    return v && v.trim() ? v.trim() : null;
  }

  const isImage = selected ? IMAGE_EXT.test(selected) : false;
  const canEdit = selected != null && read != null && !read.binary && !read.truncated;

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
        {isMobile && selected && (
          <ToolbarBtn
            onClick={() => {
              setSelected(null);
              setRead(null);
            }}
          >
            ← back
          </ToolbarBtn>
        )}
        <ToolbarBtn onClick={() => void loadDir('')}>↻</ToolbarBtn>
        <ToolbarBtn
          onClick={() => {
            const name = promptName('New file path (e.g. src/app.ts)');
            if (name)
              void op(() => filesApi.write(name, ''), parentOf(name), `created ${name}`).then(
                () => openFile(name)
              );
          }}
        >
          + File
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => {
            const name = promptName('New folder path');
            if (name) void op(() => filesApi.mkdir(name), parentOf(name));
          }}
        >
          + Folder
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => fileInput.current?.click()}
          title={`Upload to ${uploadDirFor(selected) || 'root'}`}
        >
          ⬆<span className="hidden sm:inline"> Upload → {uploadDirFor(selected) || 'root'}</span>
        </ToolbarBtn>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            const dir = uploadDirFor(selected);
            Promise.all(list.map((f) => filesApi.upload(dir, f)))
              .then(() => loadDir(dir))
              .catch((err) => setError(String(err)));
          }}
        />
        <div className="flex-1" />
        {selected && read && (
          <>
            {editing && (
              <>
                <button
                  onClick={() => void save()}
                  className="rounded-md bg-emerald-700 px-3 py-1 hover:bg-emerald-600"
                >
                  Save
                </button>
                <ToolbarBtn
                  onClick={() => {
                    setDraft(read.content);
                    setEditing(false);
                  }}
                >
                  Cancel
                </ToolbarBtn>
              </>
            )}
            {!editing && canEdit && <ToolbarBtn onClick={() => setEditing(true)}>✎ Edit</ToolbarBtn>}
            <a
              href={filesApi.downloadUrl(selected)}
              className="rounded-md border border-neutral-700 px-2.5 py-1.5 hover:bg-neutral-800 md:py-1"
              title="Download"
            >
              ⬇<span className="hidden sm:inline"> Download</span>
            </a>
            <ToolbarBtn
              onClick={() => {
                if (window.confirm(`Delete ${selected}?`)) {
                  const dir = parentOf(selected);
                  void op(() => filesApi.remove(selected), dir).then(() => {
                    setSelected(null);
                    setRead(null);
                  });
                }
              }}
              title="Delete"
            >
              🗑<span className="hidden sm:inline"> Delete</span>
            </ToolbarBtn>
          </>
        )}
        {flash && <span className="text-emerald-400">{flash}</span>}
        {error && <span className="text-red-400">{error}</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* tree — full width on mobile until a file is opened */}
        {(!isMobile || !selected) && (
          <div
            className={`${
              isMobile ? 'w-full' : 'w-72'
            } shrink-0 overflow-auto overscroll-contain border-r border-neutral-800 py-1`}
          >
            <TreeBranch
              node={root}
              depth={0}
              expanded={expanded}
              selected={selected}
              onToggle={(n) => void toggleDir(n)}
              onSelect={(n) =>
                n.type === 'file' ? void openFile(n.id) : void toggleDir(n)
              }
            />
          </div>
        )}

        {/* viewer */}
        {(!isMobile || selected) && (
          <div className="min-w-0 flex-1 bg-neutral-950">
          {!selected && (
            <div className="grid h-full place-items-center text-sm text-neutral-600">
              select a file to preview
            </div>
          )}
          {selected && isImage && (
            <div className="grid h-full place-items-center overflow-auto p-4">
              <img
                src={filesApi.rawUrl(selected)}
                alt={selected}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}
          {selected && !isImage && read && read.binary && (
            <div className="grid h-full place-items-center text-sm text-neutral-500">
              binary file ({formatSize(read.size)}) — download only
            </div>
          )}
          {selected && !isImage && read && !read.binary && read.truncated && (
            <div className="grid h-full place-items-center gap-2 p-4 text-center text-sm text-neutral-500">
              too large for preview ({formatSize(read.size)})
              <a href={filesApi.downloadUrl(selected)} className="underline">
                download
              </a>
            </div>
          )}
          {selected && !isImage && read && !read.binary && !read.truncated && (
            <CodeEditor
              filename={selected}
              value={draft}
              editable={editing}
              onChange={setDraft}
              onSave={() => void save()}
            />
          )}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeBranch({
  node,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  node: TNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (n: TNode) => void;
  onSelect: (n: TNode) => void;
}) {
  const isOpen = expanded.has(node.id);
  return (
    <div>
      <div
        onClick={() => onSelect(node)}
        style={{ paddingLeft: depth * 14 + 8 }}
        className={`flex cursor-pointer items-center gap-1.5 py-[3px] pr-2 text-sm hover:bg-neutral-800/60 ${
          selected === node.id ? 'bg-neutral-800 text-white' : 'text-neutral-300'
        }`}
        title={node.id}
      >
        {node.type === 'dir' ? (
          <span className="w-3 select-none text-neutral-500">{isOpen ? '▾' : '▸'}</span>
        ) : (
          <span className="w-3" />
        )}
        <span>{node.type === 'dir' ? (isOpen ? '📂' : '📁') : '📄'}</span>
        <span className="truncate">{node.name}</span>
      </div>
      {node.type === 'dir' &&
        isOpen &&
        (node.children ?? []).map((c) => (
          <TreeBranch
            key={c.id}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            selected={selected}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

function ToolbarBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-md border border-neutral-700 px-2.5 py-1.5 hover:bg-neutral-800 md:py-1"
    >
      {children}
    </button>
  );
}

function find(node: TNode, id: string): TNode | null {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return null;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Uploads land next to the current selection, or in the workspace root.
function uploadDirFor(selected: string | null): string {
  if (!selected) return '';
  return parentOf(selected);
}
