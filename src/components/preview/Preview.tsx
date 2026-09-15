import { useEffect, useRef, useState } from 'react';
import { Monitor, Smartphone, Eye, ImageOff } from 'lucide-react';
import { buildCss } from '../../theme/css-generator';
import type { EditorSection, ThemeDocument } from '../../theme/types';
import { PREVIEW_HTML } from './template';
import styles from './Preview.module.css';

export function Preview({ document, imageUrl, selected, imageError }: {
  document: ThemeDocument; imageUrl?: string; selected: EditorSection; imageError?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(0);
  const [compact, setCompact] = useState(false);
  const [highlight, setHighlight] = useState(false);
  useEffect(() => {
    const target = ref.current?.contentDocument;
    if (!target) return;
    const generated = target.getElementById('lct-generated');
    const custom = target.getElementById('lct-custom');
    const selection = target.getElementById('lct-selection');
    if (generated) generated.textContent = buildCss(document.theme, imageUrl);
    if (custom) custom.textContent = document.customCss;
    const part = { global: 'root', background: 'background', sidebar: 'sidebar', composer: 'composer',
      messages: 'user-message', codeBlock: 'code-block', panels: 'workspace-panel', font: 'main', themes: 'root', transfer: 'root', settings: 'root' }[selected];
    target.documentElement.dataset.workPanels = String(selected === 'panels');
    const selectors = selected === 'panels' ? '[data-lct-part="workspace-panel"], [data-lct-part="summary-panel"], [data-lct-part="toolbar-button"]' : `[data-lct-part="${part}"]`;
    if (selection) selection.textContent = highlight ? `${selectors} { outline: 2px dashed #b8d6a6 !important; outline-offset: -3px !important; }` : '';
  }, [document, imageUrl, selected, highlight, loaded]);

  return <section className={styles.preview} aria-label="Codex 模拟预览">
    <div className={styles.toolbar}><span><i />实时预览 <small>你的工作空间，由你定义</small></span>
      <div className={styles.tools}><button className="iconButton" aria-label="桌面尺寸" aria-pressed={!compact} onClick={() => setCompact(false)}><Monitor size={16} /></button>
        <button className="iconButton" aria-label="窄屏尺寸" aria-pressed={compact} onClick={() => setCompact(true)}><Smartphone size={16} /></button>
        <span className={styles.separator} /><button className="iconButton" aria-label="标出正在编辑的区域" aria-pressed={highlight} onClick={() => setHighlight(!highlight)}><Eye size={16} /></button></div>
    </div>
    <div className={`${styles.stage} ${compact ? styles.compact : ''}`}>
      <div className={styles.window}><div className={styles.windowBar}><span className={styles.windowMark}>C</span><span>Codex</span><span className={styles.simulated}>模拟窗口</span><div className={styles.windowControls}><span /> <span /> <span /></div></div>
        <iframe ref={ref} srcDoc={PREVIEW_HTML} title="Codex 外观模拟窗口" sandbox="allow-same-origin" onLoad={() => setLoaded(value => value + 1)} />
      </div>
    </div>
    <div className={styles.note}>{imageError ? <><ImageOff size={13} />{imageError}</> : <><span className={styles.noteDot} />只改变外观，不打扰你的工作流</>}</div>
  </section>;
}
