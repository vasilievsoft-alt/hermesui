import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

interface Props {
  filename: string;
  value: string;
  editable: boolean;
  onChange?: (v: string) => void;
  onSave?: () => void;
}

export default function CodeEditor({
  filename,
  value,
  editable,
  onChange,
  onSave,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Latest callbacks without recreating the editor.
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const langComp = new Compartment();
    let view: EditorView | null = null;

    const exts: any[] = [
      basicSetup,
      EditorView.editable.of(editable),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { overflow: 'auto' },
      }),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            cb.current.onSave?.();
            return true;
          },
        },
      ]),
      langComp.of([]),
    ];

    if (editable && onChange) {
      exts.push(
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
        })
      );
    }

    view = new EditorView({
      state: EditorState.create({ doc: value, extensions: exts }),
      parent: el,
    });
    viewRef.current = view;

    // Lazy-load syntax highlighting for this file's extension.
    const langDesc = LanguageDescription.matchFilename(languages, filename);
    if (langDesc) {
      void langDesc.load().then((support) => {
        if (!view || !support) return;
        view.dispatch({ effects: langComp.reconfigure(support) });
      });
    }

    return () => {
      view?.destroy();
      if (viewRef.current === view) viewRef.current = null;
      view = null;
    };
    // Recreate only when file identity or mode changes; doc updates flow
    // through props below without resetting cursor/scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename, editable]);

  // External doc replacement (opened another file / reverted edits).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <div ref={host} className="h-full overflow-hidden text-sm" />;
}
