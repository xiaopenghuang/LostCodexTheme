import type { ThemeDocument, ThemeState } from './types';

export interface EditorHistory {
  past: ThemeDocument[]; present: ThemeDocument; future: ThemeDocument[]; group: string | null;
}
export type HistoryAction =
  | { type: 'edit'; update: (document: ThemeDocument) => ThemeDocument; group?: string }
  | { type: 'replace'; document: ThemeDocument }
  | { type: 'reset'; document: ThemeDocument }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'end-group' };

export function createHistory(document: ThemeDocument): EditorHistory {
  return { past: [], present: document, future: [], group: null };
}

export function historyReducer(state: EditorHistory, action: HistoryAction): EditorHistory {
  if (action.type === 'reset') return createHistory(action.document);
  if (action.type === 'end-group') return { ...state, group: null };
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return { past: state.past.slice(0, -1), present: state.past.at(-1)!,
      future: [state.present, ...state.future].slice(0, 50), group: null };
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state;
    return { past: [...state.past, state.present].slice(-50), present: state.future[0],
      future: state.future.slice(1), group: null };
  }
  const next = action.type === 'replace' ? action.document : action.update(state.present);
  if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
  const group = action.type === 'edit' ? action.group ?? null : null;
  return { past: group !== null && group === state.group ? state.past : [...state.past, state.present].slice(-50),
    present: next, future: [], group };
}

export function patchTheme<K extends keyof ThemeState>(key: K, patch: Partial<ThemeState[K]>) {
  return (document: ThemeDocument): ThemeDocument => {
    const previous = document.theme;
    let theme = { ...previous, [key]: { ...previous[key], ...patch } };
    if (key === 'background') {
      const background = patch as Partial<ThemeState['background']>;
      if (background.image && !previous.background.image) {
        // Reveal the existing full-window wallpaper on first upload, in one undo step.
        // Replacing an image must preserve later sidebar opacity adjustments.
        theme = { ...theme, sidebar: { ...theme.sidebar, opacity: 0 } };
      }
    }
    if (key === 'global') {
      const global = patch as Partial<ThemeState['global']>;
      if (global.appearance && global.appearance !== previous.global.appearance) {
        const light = global.appearance === 'light';
        const textColor = light ? '#28352b' : '#e6e8e5';
        const borderColor = light ? '#ced4c9' : '#333735';
        theme = { ...theme,
          global: { ...theme.global, textColor, accent: light ? '#416450' : '#a8c8b4' },
          background: { ...theme.background, color: light ? '#f0f1ed' : '#1b1d1c',
            gradientStart: light ? '#e2eadc' : '#202b28', gradientEnd: light ? '#e0e7eb' : '#141c23' },
          sidebar: { ...theme.sidebar, background: light ? '#e7e9e3' : '#222522', borderColor },
          composer: { ...theme.composer, background: light ? '#fbfcf9' : '#282c29', borderColor },
          userMessage: { ...theme.userMessage, background: light ? '#dfe8dc' : '#303b34', textColor, borderColor },
          assistantMessage: { ...theme.assistantMessage, background: light ? '#f0f1ed' : '#1b1d1c', textColor, borderColor },
          codeBlock: { ...theme.codeBlock, background: light ? '#e7e9e3' : '#161917', borderColor },
          workspacePanel: { ...theme.workspacePanel, background: light ? '#e7e9e3' : '#222522', textColor, borderColor },
          summaryPanel: { ...theme.summaryPanel, background: light ? '#fbfcf9' : '#282c29', textColor, borderColor },
          toolbarButtons: { ...theme.toolbarButtons, background: light ? '#fbfcf9' : '#282c29', textColor, borderColor },
        };
      }
      if (global.radius !== undefined) {
        for (const surface of ['sidebar', 'composer', 'userMessage', 'assistantMessage', 'codeBlock'] as const) {
          theme = { ...theme, [surface]: { ...theme[surface], radius: global.radius } };
        }
      }
      if (global.textColor) {
        for (const role of ['userMessage', 'assistantMessage', 'workspacePanel', 'summaryPanel', 'toolbarButtons'] as const) {
          if (theme[role].textColor === previous.global.textColor) theme = { ...theme, [role]: { ...theme[role], textColor: global.textColor } };
        }
      }
    }
    return { ...document, theme };
  };
}
