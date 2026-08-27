import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Tree, type NodeApi } from 'react-arborist';
import CodeEditor from '../components/files/CodeEditor';
import { filesApi } from '../files-api';

interface TNode {
  id: string; // path relative to workspace root
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
  const entries = await filesApi.tree(dir);
  return entries.map((e) => ({
    id: dir ? `${dir}/${e.name}` : e.name,
    name: e.name,
    type: e.type,
    ...(e.type === 'dir' ? { children: [] as TNode[] } : {}),
  }));
}

export default function FilesPage() {
  const [rootData, setRootData] = useState<TNode>(ROOT);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [read, setRead] = useState<Awaited<ReturnType<typeof filesApi.read>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const treeWrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 260, h: 600 });

  useEffect(() => {
    // reload whole tree
    (async () => {
      try {
        setRootData({ ...ROOT, children: await fetchChildren('') });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  useEffect(() => {
    const el = treeWrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight })
    );
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [rootData]);

  async function ensureLoaded(node: TNode): Promise<TNode[]> {
    if (node.type !== 'dir') return [];
    if (node.children && node.children.length) return node.children;
    return await fetchChildren(node.id);
  }

  // loads dir children into the tree state (immutable update)
  async function loadInto(dirNode: TNode): Promise<void> {
    const kids = dirNode.children?.length
      ? dirNode.children
      : await fetchChildren(dirNode.id);
    setRootData((prev) => {
      const clone = structuredClone(prev);
      const target = findByPath(clone, dirNode.id);
      if (target) target.children = kids;
      return clone;
    });
  }

  async function refreshDir(dir: string): Promise<void> {
    const kids = await fetchChildren(dir);
    setRootData((prev) => {
      const clone = structuredClone(prev);
      if (!dir) {
        clone.children = kids;
      } else {
        const target = findByPath(clone, dir);
        if (target) target.children = kids;
      }
      return clone;
    });
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
    void refreshDir(parentOf(selected));
  }

  async function op(
    fn: () => Promise<unknown>,
    afterDir: string,
    msg?: string
  ): Promise<void> {
    try {
      await fn();
      await refreshDir(afterDir);
      setFlash(msg ?? 'done');
      setTimeout(() => setFlash(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function activate(node: NodeApi<TNode>): Promise<void> {
    const d = node.data;
    if (d.type === 'file') void openFile(d.id);
    else void loadInto(d);
  }

  function promptName(title: string, def = ''): string | null {
    const v = window.prompt(title, def);
    return v && v.trim() ? v.trim() : null;
  }

  const isImage = selected ? IMAGE_EXT.test(selected) : false;
  const canEdit =
    selected != null && read != null && !read.binary && !read.truncated;

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
        <ToolbarBtn onClick={() => void refreshDir('').then(() => null)}>↻</ToolbarBtn>
        <ToolbarBtn
          onClick={() => {
            const name = promptName('New file path (e.g. src/app.ts)');
            if (name)
              void op(
                () => filesApi.write(name, ''),
                parentOf(name),
                `created ${name}`
              ).then(() => openFile(name).catch(() => {}));
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
        <ToolbarBtn onClick={() => fileInput.current?.click()}>⬆ Upload</ToolbarBtn>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            for (const f of list) void filesApi.upload(uploadDirFor(selected), f).then(() => refreshDir(uploadDirFor(selected)));
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
            {!editing && canEdit && (
              <ToolbarBtn onClick={() => setEditing(true)}>✎ Edit</ToolbarBtn>
            )}
            <a
              href={filesApi.downloadUrl(selected)}
              className="rounded-md border border-neutral-700 px-2 py-1 hover:bg-neutral-800"
            >
              ⬇ Download
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
            >
              🗑 Delete
            </ToolbarBtn>
          </>
        )}
        {flash && <span className="text-emerald-400">{flash}</span>}
        {error && <span className="text-red-400">{error}</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* tree */}
        <div ref={treeWrap} className="w-72 shrink-0 overflow-hidden border-r border-neutral-800">
          <Tree
            data={[rootData]}
            width={size.w}
            height={size.h}
            rowHeight={28}
            indent={14}
            openByDefault={false}
            disableDrag
            disableDrop
            onToggle={(id) => void toggleLoad(id)}
            onActivate={activate}
          >
            {(props) => <Row {...props} />}
          </Tree>
        </div>

        {/* viewer */}
        <div className="min-w-0 flex-1 bg-neutral-950">          {!selected && (
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
      </div>
    </div>
  );

  async function toggleLoad(id: string): Promise<void> {
    const node = findByPath(rootData, id);
    if (node && node.type === 'dir') await loadInto(node);
  }
}

function Row({
  node,
  style,
}: {
  node: NodeApi<TNode>;
  style: CSSProperties;
}) {
  const icon = node.isInternal ? (node.isOpen ? '📂' : '📁') : '📄';
  return (
    <span
      style={{ ...style, paddingLeft: node.level * 12 + 8 }}
      className="cursor-pointer truncate pr-2 text-sm leading-[28px] text-neutral-300"
      title={node.data.id}
    >
      {icon} {node.data.name}
    </span>
  );
}

function ToolbarBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-neutral-700 px-2 py-1 hover:bg-neutral-800"
    >
      {children}
    </button>
  );
}

function findByPath(node: TNode, id: string): TNode | null {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = findByPath(c, id);
    if (hit) return hit;
  }
  return null;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Uploads go into the directory containing the current selection,
// or workspace root when nothing is selected.
function uploadDirFor(selected: string | null): string {
  if (!selected) return '';
  const i = selected.lastIndexOf('/');
  return i === -1 ? '' : selected.slice(0, i);
}
