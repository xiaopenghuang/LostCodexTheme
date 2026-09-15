import { createContext, useContext, useEffect, useEffectEvent, useReducer, useState, type ReactNode } from 'react';
import { createHistory, historyReducer, patchTheme } from '../theme/history';
import { newDocument } from '../theme/defaults';
import type { ThemeDocument, ThemeState } from '../theme/types';
import { clearDraft, loadDraft, saveDraft, saveTheme } from '../platform/storage';

type DraftStatus = 'loading' | 'saved' | 'saving' | 'error';
interface ThemeContextValue {
  document: ThemeDocument;
  canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void;
  update: <K extends keyof ThemeState>(section: K, value: Partial<ThemeState[K]>, group?: string) => void;
  setCustomCss: (css: string) => void;
  endGroup: () => void;
  replace: (document: ThemeDocument, saved?: boolean) => void;
  save: () => Promise<void>;
  unsaved: boolean; saving: boolean; draftStatus: DraftStatus; draftError: string;
  draftLoadFailed: boolean;
  recovery: ThemeDocument | null; recover: () => void; discardRecovery: () => Promise<void>;
}
const Context = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => createHistory(newDocument('我的第一个主题')));
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [saving, setSaving] = useState(false);
  const [recovery, setRecovery] = useState<ThemeDocument | null>(null);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>('loading');
  const [draftError, setDraftError] = useState('');
  const [ready, setReady] = useState(false);
  const [draftLoadFailed, setDraftLoadFailed] = useState(false);
  const document = history.present;
  const snapshot = JSON.stringify(document);

  useEffect(() => {
    let active = true;
    loadDraft().then(draft => {
      if (!active) return;
      setRecovery(draft); setReady(true); setDraftStatus('saved');
    }).catch(error => { if (active) { setDraftError(String(error)); setDraftStatus('error'); setDraftLoadFailed(true); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready || recovery) return;
    let active = true;
    setDraftStatus('saving');
    const timer = window.setTimeout(() => {
      saveDraft(document).then(() => { if (active) { setDraftStatus('saved'); setDraftError(''); } })
        .catch(error => { if (active) { setDraftStatus('error'); setDraftError(String(error)); } });
    }, 1000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [document, ready, recovery]);

  useEffect(() => {
    if ((draftStatus !== 'saving' && draftStatus !== 'error') || snapshot === savedSnapshot) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draftStatus, snapshot, savedSnapshot]);

  const keydown = useEffectEvent((event: KeyboardEvent) => {
    const element = event.target as HTMLElement;
    if (element.matches('input, textarea, [contenteditable="true"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault(); dispatch({ type: 'redo' });
    }
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => keydown(event);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  async function save() {
    setSaving(true);
    try { await saveTheme(document); setSavedSnapshot(snapshot); }
    finally { setSaving(false); }
  }

  return <Context value={{ document, canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
    update: (section, value, group) => dispatch({ type: 'edit', update: patchTheme(section, value), group }),
    setCustomCss: css => dispatch({ type: 'edit', update: doc => ({ ...doc, customCss: css }), group: 'custom-css' }),
    endGroup: () => dispatch({ type: 'end-group' }),
    replace: (doc, saved) => { dispatch({ type: 'replace', document: doc }); if (saved) setSavedSnapshot(JSON.stringify(doc)); }, save,
    unsaved: snapshot !== savedSnapshot, saving, draftStatus, draftError, draftLoadFailed, recovery,
    recover: () => { if (recovery) dispatch({ type: 'reset', document: recovery }); setRecovery(null); },
    discardRecovery: async () => { await clearDraft(); setRecovery(null); setDraftLoadFailed(false); setDraftError(''); setReady(true); },
  }}>{children}</Context>;
}

export function useTheme() {
  const value = useContext(Context);
  if (!value) throw new Error('ThemeProvider is required');
  return value;
}
