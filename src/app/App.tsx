import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowUpRight, Check, ChevronRight, Code2, Image, LayoutGrid, Leaf, LoaderCircle,
  MessageSquare, PanelLeft, Redo2, RotateCcw, Save, Settings2, SlidersHorizontal, SwatchBook, Type, Undo2, X, PlugZap, Copy, FolderOpen } from 'lucide-react';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { Inspector, SECTIONS } from '../features/Inspector';
import { Preview } from '../components/preview/Preview';
import { Modal, Toggle } from '../components/controls/Controls';
import { ThemeShelf, ThemeLibrary } from '../features/ThemeLibrary';
import { desktop, deleteTheme, imageDataUrl, listThemes, loadPreferences, savePreferences } from '../platform/storage';
import { applyTheme, closeEditor, diagnostics, getCodexStatus, observeClose, observeStatus, openLogsDirectory, requestEditorExit,
  reconnectCodex, restoreDefault, setEditorDirty, startThemingSession, type CodexStatus } from '../platform/codex';
import type { EditorSection, SavedTheme, ThemeDocument } from '../theme/types';
import styles from './App.module.css';
import { version } from '../../package.json';

const Transfer = lazy(() => import('../features/Transfer').then(module => ({ default: module.Transfer })));

const primaryNav = [
  ['global', SlidersHorizontal], ['background', Image], ['sidebar', PanelLeft], ['composer', LayoutGrid],
  ['messages', MessageSquare], ['codeBlock', Code2], ['panels', LayoutGrid], ['font', Type],
] as const;
const secondaryNav = [['themes', SwatchBook], ['transfer', ArrowLeftRight]] as const;

function Editor() {
  const theme = useTheme();
  const [section, setSection] = useState<EditorSection>('global');
  const [advanced, setAdvanced] = useState(false);
  const [live, setLive] = useState(true);
  const [status, setStatus] = useState<CodexStatus>({ state: 'disconnected', message: desktop ? 'Codex 未连接' : '离线编辑模式', verified: false });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedTheme[]>([]);
  const [imageUrl, setImageUrl] = useState<string>();
  const [imageError, setImageError] = useState('');
  const [notice, setNotice] = useState<{ message: string; error: boolean; id: number } | null>(null);
  const [confirm, setConfirm] = useState<'connect' | 'restore' | 'close' | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [diagnosticText, setDiagnosticText] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(theme.document.theme.meta.name);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sequence = useRef(0);
  const lastApplied = useRef('');
  const preferenceTouched = useRef(false);
  const connected = status.state === 'connected' || status.state === 'applied';
  const activeSession = connected || status.sessionActive === true;
  const snapshot = JSON.stringify(theme.document);
  const image = theme.document.theme.background.image;
  const saveShortcut = useEffectEvent((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => saveShortcut(event);
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);

  function notify(message: string, error = false) { setNotice({ message: message.replace(/^Error:\s*/, ''), error, id: Date.now() }); }
  useEffect(() => {
    let active = true;
    listThemes().then(items => { if (active) setSaved(items); }).catch(error => { if (active) notify(String(error), true); });
    getCodexStatus().then(next => { if (active && sequence.current === 0) setStatus(next); }).catch(() => { if (active && sequence.current === 0) setStatus({ state: 'error', message: '暂时无法读取 Codex 状态', verified: false }); });
    loadPreferences().then(preferences => {
      if (active && !preferenceTouched.current) { setAdvanced(preferences.advanced); setLive(preferences.liveApply); }
    }).catch(error => { if (active) notify(String(error), true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const stops: Array<() => void> = [];
    async function observe() {
      const statusStop = await observeStatus(next => {
        if (active) { setStatus(next); if (!next.sessionActive) lastApplied.current = ''; }
      });
      if (!active) { statusStop(); return; } stops.push(statusStop);
      const closeStop = await observeClose(() => { if (active) setConfirm('close'); });
      if (!active) { closeStop(); return; } stops.push(closeStop);
    }
    void observe().catch(error => { if (active) notify(String(error), true); });
    return () => { active = false; stops.forEach(stop => stop()); };
  }, []);
  useEffect(() => {
    void setEditorDirty(theme.unsaved && (theme.draftStatus === 'saving' || theme.draftStatus === 'error'))
      .catch(error => notify(String(error), true));
  }, [theme.draftStatus, theme.unsaved]);
  useEffect(() => {
    setName(theme.document.theme.meta.name);
  }, [theme.document.theme.meta.name]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 10000 : 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    let active = true;
    setImageUrl(undefined); setImageError('');
    if (image) imageDataUrl(image).then(url => { if (active) setImageUrl(url); })
      .catch(error => { if (active) setImageError(String(error).replace(/^Error:\s*/, '')); });
    return () => { active = false; };
  }, [image]);

  async function apply(document: ThemeDocument, background: string | undefined, announce: boolean) {
    if (document.theme.background.type === 'image' && document.theme.background.image && !background) {
      if (announce) notify('请等背景图片加载完成后再应用', true);
      return;
    }
    const stamp = JSON.stringify(document) + (background ?? '');
    const ticket = ++sequence.current;
    setBusy(true);
    const task = queue.current.then(async () => {
      if (ticket !== sequence.current) return;
      if (lastApplied.current === stamp) { if (announce) notify('当前主题已经应用'); return; }
      try {
        const next = await applyTheme(document, background);
        // Even a superseded request changes Codex. The next queued edit must compare
        // against that completed result, not the last snapshot shown in the editor.
        lastApplied.current = stamp;
        if (ticket === sequence.current) { setStatus(next); if (announce) notify('主题已应用到 Codex'); }
      } catch (error) {
        lastApplied.current = '';
        throw error;
      }
    });
    queue.current = task.catch(() => undefined);
    try { await task; }
    catch (error) {
      if (ticket === sequence.current) {
        const message = String(error).replace(/^Error:\s*/, '');
        notify(message, true); setLive(false);
        setStatus(previous => ({ ...previous, state: 'error', message, sessionActive: true }));
      }
    } finally { if (ticket === sequence.current) setBusy(false); }
  }
  const automaticApply = useEffectEvent(() => { void apply(theme.document, imageUrl, false); });
  useEffect(() => {
    if (!live || !connected) return;
    const timer = setTimeout(() => automaticApply(), 300);
    return () => clearTimeout(timer);
  }, [snapshot, imageUrl, live, connected]);

  async function connect() {
    setConfirm(null); ++sequence.current; setBusy(true);
    try { setStatus(await startThemingSession()); lastApplied.current = ''; notify('Codex 已连接，可以应用主题'); }
    catch (error) { notify(String(error), true); await refreshStatus(); }
    finally { setBusy(false); }
  }
  async function restore() {
    setConfirm(null); setLive(false); ++sequence.current; setBusy(true);
    try { await queue.current; setStatus(await restoreDefault()); lastApplied.current = ''; notify('Codex 已恢复默认'); }
    catch (error) { notify(String(error), true); await refreshStatus(); }
    finally { setBusy(false); }
  }
  async function refreshStatus() {
    try { setStatus(await getCodexStatus()); }
    catch { setStatus(previous => ({ ...previous, state: 'error', message: '无法确认连接状态，请重试' })); }
  }
  async function reconnect() {
    ++sequence.current; setBusy(true);
    try { await queue.current; setStatus(await reconnectCodex()); lastApplied.current = ''; notify('Codex 窗口已重新连接'); }
    catch (error) { notify(String(error), true); await refreshStatus(); }
    finally { setBusy(false); }
  }
  function changeAdvanced(value: boolean) {
    preferenceTouched.current = true; setAdvanced(value);
    void savePreferences({ advanced: value, liveApply: live }).catch(error => notify(String(error), true));
  }
  function changeLive(value: boolean) {
    preferenceTouched.current = true; setLive(value);
    void savePreferences({ advanced, liveApply: value }).catch(error => notify(String(error), true));
  }
  async function closeApplication(saveFirst: boolean) {
    setConfirm(null); setLive(false); ++sequence.current; setBusy(true);
    try {
      if (saveFirst) await theme.save();
      await queue.current;
      const current = await getCodexStatus();
      if (current.manualExitRequired) throw new Error('请先完全退出新打开的 Codex，再退出主题编辑器');
      if (current.sessionActive) setStatus(await restoreDefault());
      await closeEditor();
    } catch (error) { notify(String(error), true); await refreshStatus(); }
    finally { setBusy(false); }
  }
  async function save() {
    try { await theme.save(); notify('主题已保存到我的主题'); }
    catch (error) { notify(String(error), true); return; }
    try { setSaved(await listThemes()); } catch (error) { notify(String(error), true); }
  }
  async function remove() {
    if (!deleteId) return;
    try { await deleteTheme(deleteId); setSaved(items => items.filter(item => item.document.theme.meta.id !== deleteId)); setDeleteId(null); notify('主题已从收藏中移除'); }
    catch (error) { notify(String(error), true); }
  }
  function rename() {
    const value = name.trim();
    if (value) theme.update('meta', { name: value }); else setName(theme.document.theme.meta.name);
    setEditingName(false);
  }
  async function showDiagnostics() {
    try { setDiagnosticText(await diagnostics()); } catch (error) { notify(String(error), true); }
  }

  return <div className={styles.app}>
    <header className={styles.header}>
      <button className={styles.wordmark} onClick={() => setSection('global')} aria-label="返回主题编辑"><img className={styles.logo} src="/icon.png" alt="" width="36" height="36" /><span>Lost<span className={styles.wordmarkThin}>CodexTheme</span><small>让工作空间更像你</small></span></button>
      <div className={styles.documentName}><span className={styles.documentDivider} /><SwatchBook size={14} />
        {editingName ? <input autoFocus aria-label="主题名称" maxLength={80} value={name} onChange={event => setName(event.target.value)} onBlur={rename} onKeyDown={event => { if (event.key === 'Enter') rename(); if (event.key === 'Escape') { setName(theme.document.theme.meta.name); setEditingName(false); } }} /> :
          <button onClick={() => setEditingName(true)} title="点击重命名主题">{theme.document.theme.meta.name}</button>}
        <span className={styles.draftLabel} title={theme.draftError}>{theme.draftStatus === 'saving' ? '保存草稿中' : theme.draftStatus === 'error' ? '草稿未保存' : theme.unsaved ? '草稿' : '已保存'}</span>
      </div>
      <div className={styles.headerActions}>
        <div className={styles.history}><button className="iconButton" title="撤销 Ctrl+Z" aria-label="撤销" disabled={!theme.canUndo} onClick={theme.undo}><Undo2 size={16} /></button><button className="iconButton" title="重做 Ctrl+Shift+Z" aria-label="重做" disabled={!theme.canRedo} onClick={theme.redo}><Redo2 size={16} /></button></div>
        <button className="secondaryButton" aria-label="保存主题" disabled={theme.saving} onClick={() => void save()}>{theme.saving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}<span>保存主题</span></button>
        <button className="primaryButton" aria-label={connected ? '应用到 Codex' : activeSession ? '重新连接 Codex' : '连接 Codex'} disabled={busy || !desktop} title={!desktop ? '连接 Codex 需要桌面版，浏览器中可离线编辑' : ''}
          onClick={() => connected ? void apply(theme.document, imageUrl, true) : activeSession ? void reconnect() : setConfirm('connect')}>{busy ? <LoaderCircle className="spin" size={14} /> : <ArrowUpRight size={15} />}<span>{connected ? '应用到 Codex' : activeSession ? '重新连接' : '连接 Codex'}</span></button>
      </div>
    </header>
    <nav className={styles.navigation} aria-label="编辑区域"><div className={styles.navLabel}>你的主题工作台</div>
      <div className={styles.navGroup}>{primaryNav.map(([key, Icon]) => <button key={key} aria-label={SECTIONS[key].title} title={SECTIONS[key].title} aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)}><Icon size={17} strokeWidth={1.7} /><span>{SECTIONS[key].title}</span>{section === key && <ChevronRight size={13} />}</button>)}</div>
      <div className={styles.navDivider} />
      <div className={styles.navGroup}>{secondaryNav.map(([key, Icon]) => <button key={key} aria-label={SECTIONS[key].title} title={SECTIONS[key].title} aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)}><Icon size={17} strokeWidth={1.7} /><span>{SECTIONS[key].title}</span></button>)}</div>
      <div className={styles.navBottom}><div className={styles.localCard}><div><span className={styles.smallLogo}><Leaf size={14} /></span><span>Made to feel like you.</span></div><p>不止是换个颜色。<br />是给每天的工作，一点自己的风格。</p><span className={styles.localBadge}>本地优先 · 无需账号</span></div>
        <button className={styles.settingsLink} aria-current={section === 'settings' ? 'page' : undefined} onClick={() => setSection('settings')}><Settings2 size={16} />设置<span>v{version}</span></button>
      </div>
    </nav>
    <main className={styles.workspace}>
      {section === 'themes' ? <ThemeLibrary themes={saved} remove={setDeleteId} openEditor={() => setSection('global')} notify={notify} />
        : section === 'transfer' ? <Suspense fallback={<p role="status">正在准备主题文件工具</p>}><Transfer notify={notify} openEditor={() => setSection('global')} /></Suspense>
          : section === 'settings' ? <section className={styles.settingsPage}><span className="eyebrow">KEEP IT SIMPLE</span><h1>按照自己的习惯工作。</h1><p>主题保存在本机。所有 Codex 操作都需要你主动发起。</p>
            <article><span className={styles.settingsIcon}><PlugZap size={22} /></span><div><h2>Codex 连接</h2><p>{status.message}{status.version ? ` · ${status.version}` : ''}</p>{!status.verified && <small>当前版本的实机兼容性仍待验证</small>}</div>
              <button className="secondaryButton" disabled={busy || !desktop} onClick={() => activeSession ? void reconnect() : setConfirm('connect')}>{activeSession ? '重新连接' : '连接 Codex'}</button></article>
            <article><span className={styles.settingsIcon}><SwatchBook size={22} /></span><div><h2>保持简单，也能深入</h2><p>普通模式只保留直观的颜色和滑块。高级模式可以编辑独立样式。</p></div></article>
            {desktop && <article><span className={styles.settingsIcon}><Leaf size={22} /></span><div><h2>关闭窗口后继续运行</h2><p>点右上角关闭会隐藏到右下角系统托盘，不会退出或关闭 Codex。点击托盘图标可重新打开。</p></div>
              <button className="secondaryButton" disabled={busy} onClick={() => void requestEditorExit().catch(error => notify(String(error), true))}>退出换肤软件</button></article>}
            {desktop && <article><span className={styles.settingsIcon}><SwatchBook size={22} /></span><div><h2>原生窗口按钮自动配色</h2><p>应用主题时，会将 Codex 的原生外观同步为{theme.document.theme.global.appearance === 'dark' ? '深色' : '浅色'}，让窗口按钮与主题匹配，不再遮盖背景。这项原生设置由 Codex 保存，恢复默认或退出后仍会保留。</p></div></article>}
            {advanced && <div className={styles.diagnosticActions}><button className="secondaryButton" onClick={() => void showDiagnostics()}><Code2 size={15} />查看诊断信息</button>
              {desktop && <button className="secondaryButton" onClick={() => void openLogsDirectory().catch(error => notify(String(error), true))}><FolderOpen size={15} />打开日志文件夹</button>}</div>}
          </section> : <><div className={styles.previewArea}><Preview document={theme.document} imageUrl={imageUrl} selected={section} imageError={imageError} /></div><ThemeShelf openLibrary={() => setSection('themes')} /></>}
    </main>
    <Inspector section={section} imageUrl={imageUrl} notify={notify} advanced={advanced} onAdvancedChange={changeAdvanced} />
    <footer className={styles.statusbar}><span className={`${styles.connection} ${connected ? styles.connected : ''}`}><i />{busy ? '正在处理' : status.message}</span>
      <span className={styles.autosave}>{theme.draftStatus === 'saved' ? <><Check size={12} />草稿已保存</> : theme.draftStatus === 'error' ? '草稿保存遇到问题，请手动保存主题' : '正在保存草稿'}</span>
      <div className={styles.footerActions}><button className="textButton" disabled={!activeSession || busy} onClick={() => setConfirm('restore')}><RotateCcw size={13} />恢复默认</button>
        <span className={styles.footerDivider} /><Toggle label="实时应用" value={live} onChange={changeLive} /></div>
    </footer>
    {notice && <div className={`${styles.toast} ${notice.error ? styles.toastError : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.error ? '!' : <Check size={15} />}</span><p>{notice.message}</p><button className="iconButton" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={14} /></button></div>}
    {theme.recovery && <Modal title="继续上一次的灵感？" required onClose={() => undefined}><p>发现上次的草稿 {theme.recovery.theme.meta.name}。可以继续编辑，或从新主题开始。</p><div className="modalActions"><button className="secondaryButton" onClick={() => void theme.discardRecovery().catch(error => notify(String(error), true))}>从新主题开始</button><button className="primaryButton" onClick={theme.recover}>恢复草稿</button></div></Modal>}
    {theme.draftLoadFailed && <Modal title="上次的草稿暂时无法读取" required onClose={() => undefined}><p>旧草稿不会被自动覆盖。可以先备份旧记录，再继续使用新的草稿。</p><p>{theme.draftError.replace(/^Error:\s*/, '')}</p>
      <div className="modalActions"><button className="primaryButton" onClick={() => void theme.discardRecovery().catch(error => notify(String(error), true))}>备份旧记录并继续</button></div></Modal>}
    {confirm === 'connect' && <Modal title="准备连接 Codex" onClose={() => setConfirm(null)}><p>请先保存工作，并完全退出 Codex。连接会使用独立的主题工作目录重新打开它，不会修改安装文件。</p><p>程序不会替你关闭正在使用的 Codex。当前版本仍需完成实机兼容性验证。</p><div className="modalActions"><button className="secondaryButton" onClick={() => setConfirm(null)}>暂不连接</button><button className="primaryButton" onClick={() => void connect()}>已退出，开始连接</button></div></Modal>}
    {confirm === 'restore' && <Modal title="恢复 Codex 默认状态？" onClose={() => setConfirm(null)}><p>请先保存 Codex 中的工作。程序会关闭自己启动的主题实例，结束主题连接，再按官方方式重新打开 Codex。编辑器里的主题会保留。</p><div className="modalActions"><button className="secondaryButton" onClick={() => setConfirm(null)}>取消</button><button className="primaryButton" onClick={() => void restore()}>恢复默认</button></div></Modal>}
    {confirm === 'close' && <Modal title="退出主题编辑器？" onClose={() => setConfirm(null)}>
      <p>只是暂时不用窗口，可以取消后点右上角关闭，程序会在托盘继续运行。</p>
      {status.manualExitRequired && <p>上次启动尚未完成身份检查。请先手动完全退出 Codex，以结束可能存在的主题连接。</p>}
      {activeSession && <p>请先保存 Codex 中的工作。退出时会结束本程序启动的主题实例，再恢复官方启动。</p>}
      {theme.unsaved && theme.draftStatus !== 'saved' && <p>还有修改尚未保存。直接退出可能丢失最近的调整。</p>}
      <div className="modalActions"><button className="secondaryButton" onClick={() => setConfirm(null)}>继续编辑</button>
        <button className="secondaryButton" disabled={busy} onClick={() => void closeApplication(false)}>{activeSession ? '恢复并退出' : '直接退出'}</button>
        <button className="primaryButton" disabled={busy || theme.saving} onClick={() => void closeApplication(true)}>保存主题并退出</button></div>
    </Modal>}
    {deleteId && <Modal title="从我的主题中移除？" onClose={() => setDeleteId(null)}><p>这会删除已保存的主题。当前正在编辑的内容和背景图片不会被删除。</p><div className="modalActions"><button className="secondaryButton" onClick={() => setDeleteId(null)}>保留</button><button className="dangerButton" onClick={() => void remove()}>移除主题</button></div></Modal>}
    {diagnosticText !== null && <Modal title="诊断信息" onClose={() => setDiagnosticText(null)}><pre className={styles.diagnostic}>{diagnosticText}</pre><div className="modalActions"><button className="secondaryButton" onClick={() => void navigator.clipboard.writeText(diagnosticText).then(() => notify('诊断信息已复制')).catch(() => notify('无法访问剪贴板', true))}><Copy size={14} />复制</button><button className="primaryButton" onClick={() => setDiagnosticText(null)}>关闭</button></div></Modal>}
  </div>;
}

export default function App() { return <ThemeProvider><Editor /></ThemeProvider>; }
