import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker&inline';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker&inline';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker&inline';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker&inline';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker&inline';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import './widgets.css';
import { bindMonacoCommands, createPrimaryShortcutHandler, type MonacoShortcutActions } from './shortcuts';

declare global {
  interface Window {
    zyncEditor?: {
      onMessage: (callback: (message: unknown) => void) => () => void;
      emitReady: (payload?: unknown) => void;
      emitChange: (payload?: unknown) => void;
      emitDirtyChange: (dirty: boolean) => void;
      requestSave: (content: string) => void;
      requestClose: () => void;
      reportError: (code: string, message: string, fatal?: boolean) => void;
    };
  }
}

type HostMessage =
  | { type: 'zync:editor:init'; payload?: { pluginId?: string } }
  | { type: 'zync:editor:open-document'; payload?: { docId?: string; language?: string; content?: string; readOnly?: boolean } }
  | { type: 'zync:editor:update-document'; payload?: { docId?: string; content?: string } }
  | { type: 'zync:editor:set-readonly'; payload?: { readOnly?: boolean } }
  | { type: 'zync:editor:set-theme'; payload?: { mode?: 'light' | 'dark'; colors?: Record<string, string> } }
  | { type: 'zync:editor:focus' }
  | { type: 'zync:editor:dispose' };

const SUPPORTED_LANGUAGES = new Set([
  'javascript',
  'typescript',
  'json',
  'html',
  'css',
  'markdown',
  'python',
  'rust',
  'xml',
  'yaml',
  'sql',
  'plaintext',
]);

const container = document.getElementById('editor-root');
if (!container) {
  throw new Error('Missing #editor-root container');
}
const bootLoading = document.getElementById('boot-loading');
const setBootState = (busy: boolean, message?: string) => {
  if (!bootLoading) return;
  bootLoading.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (message) bootLoading.textContent = message;
  if (!busy) bootLoading.style.display = 'none';
};

(window as Window & { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

const editor = monaco.editor.create(container, {
  value: '',
  language: 'plaintext',
  automaticLayout: true,
  minimap: { enabled: true },
  fontSize: 13,
  lineNumbersMinChars: 3,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'off',
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection',
  quickSuggestions: true,
  contextmenu: true,
  folding: true,
  glyphMargin: false,
  find: {
    addExtraSpaceOnTop: false,
  },
});
if (bootLoading) {
  setBootState(false);
}

let currentDocId: string | undefined;
let savedContent = '';

const emitChange = () => {
  const content = editor.getValue();
  window.zyncEditor?.emitChange({ docId: currentDocId, content });
  window.zyncEditor?.emitDirtyChange(content !== savedContent);
};

editor.onDidChangeModelContent(emitChange);

const runEditorAction = (actionId: string): boolean => {
  const action = editor.getAction(actionId);
  if (action) {
    void action.run();
    return true;
  }
  return false;
};

const resolveLanguage = (language?: string) => {
  const lang = (language ?? '').toLowerCase();
  return SUPPORTED_LANGUAGES.has(lang) ? lang : 'plaintext';
};


const gotoWidget = document.createElement('div');
gotoWidget.id = 'zync-goto-widget';
gotoWidget.setAttribute('role', 'group');
gotoWidget.hidden = true;

const gotoLabel = document.createElement('span');
gotoLabel.id = 'zync-goto-label';
gotoLabel.className = 'zync-visually-hidden';
gotoLabel.textContent = 'Go to line and column';

const gotoHint = document.createElement('span');
gotoHint.id = 'zync-goto-hint';
gotoHint.className = 'zync-visually-hidden';
gotoHint.textContent = 'Format: line:column';

const gotoInput = document.createElement('input');
gotoInput.id = 'zync-goto-input';
gotoInput.type = 'text';
gotoInput.placeholder = 'line:column';
gotoInput.setAttribute('aria-labelledby', 'zync-goto-label');
gotoInput.setAttribute('aria-describedby', 'zync-goto-hint');

const gotoGo = document.createElement('button');
gotoGo.id = 'zync-goto-go';
gotoGo.type = 'button';
gotoGo.textContent = 'Go';
gotoGo.setAttribute('aria-label', 'Apply go to line');

gotoWidget.appendChild(gotoLabel);
gotoWidget.appendChild(gotoHint);
gotoWidget.appendChild(gotoInput);
gotoWidget.appendChild(gotoGo);
container.appendChild(gotoWidget);

const submitGoto = () => {
  const raw = gotoInput.value.trim();
  const [lineRaw, colRaw] = raw.split(':');
  const lineNumber = Number.parseInt(lineRaw, 10);
  const column = colRaw ? Number.parseInt(colRaw, 10) : 1;
  if (!Number.isFinite(lineNumber) || lineNumber < 1) return;
  const target = {
    lineNumber,
    column: Number.isFinite(column) && column > 0 ? column : 1,
  };
  editor.revealPositionInCenter(target);
  editor.setPosition(target);
  gotoWidget.hidden = true;
  editor.focus();
};

gotoGo.addEventListener('click', submitGoto);
gotoInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitGoto();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    gotoWidget.hidden = true;
    editor.focus();
  }
});

const shortcutActions: MonacoShortcutActions = {
  save: () => window.zyncEditor?.requestSave(editor.getValue()),
  close: () => window.zyncEditor?.requestClose(),
  find: () => {
    runEditorAction('actions.find');
  },
  replace: () => {
    runEditorAction('editor.action.startFindReplaceAction');
  },
  gotoLine: () => {
    runGotoLinePrompt();
  },
  toggleComment: () => {
    runEditorAction('editor.action.commentLine');
  },
};

bindMonacoCommands(editor, shortcutActions);
window.addEventListener('keydown', createPrimaryShortcutHandler(shortcutActions), true);

const defineTheme = (mode: 'light' | 'dark', colors: Record<string, string>) => {
  const themeName = `zync-monaco-${mode}`;
  monaco.editor.defineTheme(themeName, {
    base: mode === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': colors.background ?? (mode === 'light' ? '#ffffff' : '#0f111a'),
      'editor.foreground': colors.text ?? (mode === 'light' ? '#111827' : '#e5e7eb'),
      'editorLineNumber.foreground': colors.muted ?? (mode === 'light' ? '#6b7280' : '#94a3b8'),
      'editorLineNumber.activeForeground': colors.text ?? (mode === 'light' ? '#111827' : '#e5e7eb'),
      'editorCursor.foreground': colors.primary ?? '#3b82f6',
      'editor.selectionBackground': `${(colors.primary ?? '#3b82f6')}44`,
      'editor.findMatchBackground': `${(colors.primary ?? '#3b82f6')}66`,
      'editor.findMatchHighlightBackground': `${(colors.primary ?? '#3b82f6')}33`,
      'editorWidget.background': colors.surface ?? (mode === 'light' ? '#f8fafc' : '#1f2937'),
      'editorWidget.border': colors.border ?? (mode === 'light' ? '#d1d5db' : '#374151'),
      'input.background': colors.background ?? (mode === 'light' ? '#ffffff' : '#111827'),
      'input.foreground': colors.text ?? (mode === 'light' ? '#111827' : '#e5e7eb'),
      'input.border': colors.border ?? (mode === 'light' ? '#d1d5db' : '#374151'),
      'button.background': colors.primary ?? '#3b82f6',
      'button.foreground': mode === 'light' ? '#ffffff' : '#f8fafc',
    },
  });
  monaco.editor.setTheme(themeName);
};

const onMessage = (raw: unknown) => {
  const message = raw as HostMessage;
  try {
    switch (message.type) {
      case 'zync:editor:init':
        // Host init is currently metadata-only for Monaco; no-op keeps intent explicit.
        break;
      case 'zync:editor:open-document': {
        const content = message.payload?.content ?? '';
        const model = editor.getModel();
        if (!model) break;
        model.setValue(content);
        monaco.editor.setModelLanguage(model, resolveLanguage(message.payload?.language));
        editor.updateOptions({ readOnly: Boolean(message.payload?.readOnly) });
        currentDocId = message.payload?.docId;
        savedContent = content;
        window.zyncEditor?.emitDirtyChange(false);
        editor.focus();
        break;
      }
      case 'zync:editor:update-document': {
        const content = message.payload?.content ?? '';
        const model = editor.getModel();
        if (!model) break;
        model.setValue(content);
        savedContent = content;
        window.zyncEditor?.emitDirtyChange(false);
        break;
      }
      case 'zync:editor:set-readonly':
        editor.updateOptions({ readOnly: Boolean(message.payload?.readOnly) });
        break;
      case 'zync:editor:set-theme':
        defineTheme(message.payload?.mode ?? 'dark', message.payload?.colors ?? {});
        break;
      case 'zync:editor:focus':
        editor.focus();
        break;
      case 'zync:editor:dispose':
        editor.dispose();
        break;
      default:
        break;
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    window.zyncEditor?.reportError('MONACO_RUNTIME_ERROR', messageText, false);
  }
};

window.zyncEditor?.onMessage(onMessage);
window.zyncEditor?.emitReady({
  supports: [
    'search',
    'replace',
    'goto-line',
    'syntax-highlight',
    'folding',
    'multi-selection',
    'completion',
    'hover',
    'definition',
    'minimap',
  ],
});
const runGotoLinePrompt = () => {
  const current = editor.getPosition();
  gotoInput.value = current ? `${current.lineNumber}:${current.column}` : '1:1';
  gotoWidget.hidden = false;
  gotoInput.focus();
  gotoInput.select();
};

window.addEventListener('error', () => {
  if (bootLoading?.getAttribute('aria-busy') === 'true') {
    setBootState(
      false,
      'Failed to initialize Monaco editor. Please reopen this file or reinstall the plugin.'
    );
  }
});
