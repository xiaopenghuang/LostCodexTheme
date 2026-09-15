import { useState } from 'react';
import { ImagePlus, RotateCcw, Trash2, FolderOpen, Copy, Check } from 'lucide-react';
import { ColorField, Group, RangeField, Segmented, SelectField, Toggle } from '../components/controls/Controls';
import { useTheme } from '../app/ThemeProvider';
import { useOperation } from '../app/useOperation';
import { saveImage, systemFonts } from '../platform/storage';
import { buildCss } from '../theme/css-generator';
import type { EditorSection, SurfaceKey } from '../theme/types';
import styles from './Inspector.module.css';

export const SECTIONS: Record<EditorSection, { title: string; subtitle: string }> = {
  global: { title: '整体', subtitle: '从舒服的色调开始' },
  background: { title: '背景', subtitle: '给工作空间一点氛围' },
  sidebar: { title: '侧栏', subtitle: '安放项目与最近的灵感' },
  composer: { title: '输入框', subtitle: '每一个想法，从这里开始' },
  messages: { title: '消息', subtitle: '让每次交流都清晰舒适' },
  codeBlock: { title: '代码块', subtitle: '专注代码里的每个细节' },
  panels: { title: '工作面板', subtitle: '分别调整右侧区域和顶部工具按钮' },
  font: { title: '字体', subtitle: '找到适合自己的阅读节奏' },
  themes: { title: '主题', subtitle: '一个预设，无限可能' },
  transfer: { title: '导入与导出', subtitle: '把你的风格随身带走' },
  settings: { title: '设置', subtitle: '简单的默认，进阶的自由' },
};

type Notify = (message: string, error?: boolean) => void;

function SurfaceFields({ surfaceKey }: { surfaceKey: SurfaceKey }) {
  const { document, update } = useTheme();
  const surface = document.theme[surfaceKey];
  return <>
    <Group title="表面">
      <ColorField label="背景颜色" value={surface.background} onChange={(background, group) => update(surfaceKey, { background }, group)} />
      <RangeField label="不透明度" value={surface.opacity * 100} unit="%" onChange={(value, group) => update(surfaceKey, { opacity: value / 100 }, group)} />
      <RangeField label="背景模糊" value={surface.blur} max={40} unit="px" onChange={(blur, group) => update(surfaceKey, { blur }, group)} />
    </Group>
    <Group title="形状与边缘">
      <RangeField label="圆角" value={surface.radius} max={40} unit="px" onChange={(radius, group) => update(surfaceKey, { radius }, group)} />
      <RangeField label="边框粗细" value={surface.borderWidth} max={4} step={0.5} unit="px" onChange={(borderWidth, group) => update(surfaceKey, { borderWidth }, group)} />
      <ColorField label="边框颜色" value={surface.borderColor} onChange={(borderColor, group) => update(surfaceKey, { borderColor }, group)} />
      <Toggle label="柔和阴影" value={surface.shadow} onChange={shadow => update(surfaceKey, { shadow })} />
    </Group>
  </>;
}

function GlobalPanel() {
  const { document, update } = useTheme();
  const global = document.theme.global;
  return <>
    <Group title="基础外观">
      <Segmented label="主题模式" value={global.appearance} options={[{ value: 'dark', label: '深色' }, { value: 'light', label: '浅色' }]}
        onChange={appearance => update('global', { appearance })} />
      <ColorField label="点缀颜色" value={global.accent} onChange={(accent, group) => update('global', { accent }, group)} />
      <ColorField label="文字颜色" value={global.textColor} onChange={(textColor, group) => update('global', { textColor }, group)} />
      <div className={styles.swatches} aria-label="推荐点缀颜色">{['#a8c8b4', '#d4ad86', '#88abc2', '#c5bd91', '#ca9d94', '#b8b8b8'].map(color =>
        <button type="button" key={color} aria-label={`使用 ${color}`} aria-pressed={color === global.accent} style={{ background: color }} onClick={() => update('global', { accent: color })} />)}</div>
    </Group>
    <Group title="空间与质感">
      <Segmented label="界面密度" value={global.density} options={[{ value: 'compact', label: '紧凑' }, { value: 'normal', label: '默认' }, { value: 'comfortable', label: '宽松' }]}
        onChange={density => update('global', { density })} />
      <RangeField label="整体圆角" value={global.radius} max={40} unit="px" onChange={(radius, group) => update('global', { radius }, group)} />
      <RangeField label="表面不透明度" value={global.opacity * 100} unit="%" onChange={(value, group) => update('global', { opacity: value / 100 }, group)} />
    </Group>
    <div className={styles.tip}>先选一套喜欢的预设，再慢慢调整。每一步都可以撤销。</div>
  </>;
}

function BackgroundPanel({ imageUrl, notify }: { imageUrl?: string; notify: Notify }) {
  const { document, update } = useTheme();
  const b = document.theme.background;
  const { busy, begin, finish } = useOperation(JSON.stringify([document.theme.meta.id, b.type, b.image]));
  async function selectImage(file?: File) {
    if (!file) return;
    const signal = begin();
    try {
      const image = await saveImage(file, signal);
      if (signal.aborted) return;
      update('background', { type: 'image', image }); notify('背景图片已加入主题');
    }
    catch (error) { if (!signal.aborted) notify(String(error), true); }
    finally { finish(signal); }
  }
  return <>
    <Group title="背景来源">
      <Segmented label="背景类型" value={b.type} options={[{ value: 'color', label: '纯色' }, { value: 'gradient', label: '渐变' }, { value: 'image', label: '图片' }]}
        onChange={type => update('background', { type })} />
      <ColorField label={b.type === 'image' ? '衬底颜色' : '背景颜色'} value={b.color} onChange={(color, group) => update('background', { color }, group)} />
      {b.type === 'gradient' && <>
        <ColorField label="起始颜色" value={b.gradientStart} onChange={(gradientStart, group) => update('background', { gradientStart }, group)} />
        <ColorField label="结束颜色" value={b.gradientEnd} onChange={(gradientEnd, group) => update('background', { gradientEnd }, group)} />
        <RangeField label="渐变方向" value={b.gradientAngle} max={360} unit="°" onChange={(gradientAngle, group) => update('background', { gradientAngle }, group)} />
      </>}
      {b.type === 'image' && <>
        <label className={styles.imagePicker}>{imageUrl ? <img src={imageUrl} alt="当前背景" /> : <ImagePlus size={24} />}
          <span>{busy ? '正在读取图片' : b.image ? '更换背景图片' : '选择一张喜欢的图片'}</span><small>PNG / JPEG / WebP · 最大 10 MB</small>
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { void selectImage(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        {b.image && <button className="textButton" onClick={() => update('background', { image: undefined, type: 'color' })}><Trash2 size={13} />移除图片</button>}
      </>}
    </Group>
    {b.type === 'image' && b.image && <Group title="侧栏背景">
      <button className="secondaryButton fullWidth" disabled={document.theme.sidebar.opacity === 0}
        onClick={() => update('sidebar', { opacity: 0 })}>
        {document.theme.sidebar.opacity === 0 ? '图片已覆盖侧栏' : '让图片覆盖侧栏'}
      </button>
      <div className={styles.tip}>侧栏和主区域共用一张背景图。需要半透明底色时，可到侧栏调整不透明度。</div>
    </Group>}
    <Group title="氛围">
      <RangeField label="背景不透明度" value={b.opacity * 100} unit="%" onChange={(value, group) => update('background', { opacity: value / 100 }, group)} />
      <RangeField label="遮罩强度" value={b.overlay * 100} unit="%" onChange={(value, group) => update('background', { overlay: value / 100 }, group)} />
      <RangeField label="模糊" value={b.blur} max={40} unit="px" onChange={(blur, group) => update('background', { blur }, group)} />
    </Group>
    {b.type === 'image' && <Group title="构图">
      <Segmented label="缩放方式" value={b.size} options={[{ value: 'cover', label: '填满' }, { value: 'contain', label: '完整显示' }]} onChange={size => update('background', { size })} />
      <RangeField label="水平位置" value={b.positionX} unit="%" onChange={(positionX, group) => update('background', { positionX }, group)} />
      <RangeField label="垂直位置" value={b.positionY} unit="%" onChange={(positionY, group) => update('background', { positionY }, group)} />
      <button className="textButton" onClick={() => update('background', { positionX: 50, positionY: 50 })}><RotateCcw size={13} />恢复居中</button>
    </Group>}
  </>;
}

function MessagePanel() {
  const [role, setRole] = useState<'userMessage' | 'assistantMessage'>('userMessage');
  const { document, update } = useTheme();
  const message = document.theme[role];
  return <>
    <Segmented label="正在调整" value={role} options={[{ value: 'userMessage', label: '我的消息' }, { value: 'assistantMessage', label: 'Codex 回复' }]} onChange={setRole} />
    <SurfaceFields surfaceKey={role} />
    <Group title="阅读与布局">
      <ColorField label="文字颜色" value={message.textColor} onChange={(textColor, group) => update(role, { textColor }, group)} />
      <RangeField label="消息间距" value={message.spacing} max={48} unit="px" onChange={(spacing, group) => update(role, { spacing }, group)} />
      <RangeField label="最大宽度" value={message.maxWidth} min={40} unit="%" onChange={(maxWidth, group) => update(role, { maxWidth }, group)} />
    </Group>
  </>;
}

function FontPanel({ notify, codeOnly = false }: { notify: Notify; codeOnly?: boolean }) {
  const { document, update } = useTheme();
  const font = document.theme.font;
  const [fonts, setFonts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const options = (current: string) => fonts.includes(current) ? fonts.map(value => ({ value, label: value }))
    : [{ value: current, label: `${current}（主题指定，待读取）`, disabled: true }, ...fonts.map(value => ({ value, label: value }))];
  async function scan() {
    setBusy(true);
    try { const families = await systemFonts(); setFonts(families); notify(`已读取 ${families.length} 种系统字体`); }
    catch (error) { notify(String(error), true); }
    finally { setBusy(false); }
  }
  return <Group title={codeOnly ? '代码文字' : '文字设置'}>
    <button className="secondaryButton fullWidth" disabled={busy} onClick={() => void scan()}><FolderOpen size={14} />{busy ? '正在读取' : '读取系统字体'}</button>
    {!codeOnly && <>
      <SelectField label="界面字体" value={font.uiFamily} options={options(font.uiFamily)} onChange={uiFamily => update('font', { uiFamily })} />
      <RangeField label="界面字号" value={font.uiSize} min={11} max={24} unit="px" onChange={(uiSize, group) => update('font', { uiSize }, group)} />
      <RangeField label="文字粗细" value={font.weight} min={300} max={700} step={100} onChange={(weight, group) => update('font', { weight }, group)} />
    </>}
    <SelectField label="代码字体" value={font.codeFamily} options={options(font.codeFamily)} onChange={codeFamily => update('font', { codeFamily })} />
    <RangeField label="代码字号" value={font.codeSize} min={10} max={24} unit="px" onChange={(codeSize, group) => update('font', { codeSize }, group)} />
    <RangeField label="行高" value={font.lineHeight} min={1.2} max={2.2} step={0.05} onChange={(lineHeight, group) => update('font', { lineHeight }, group)} />
  </Group>;
}

function WorkPanels() {
  const [part, setPart] = useState<'workspacePanel' | 'summaryPanel' | 'toolbarButtons'>('workspacePanel');
  const { document, update } = useTheme();
  return <>
    <SelectField label="正在调整" value={part} options={[
      { value: 'workspacePanel', label: '右侧面板' },
      { value: 'summaryPanel', label: '输出与来源' },
      { value: 'toolbarButtons', label: '顶部工具按钮' },
    ]} onChange={value => setPart(value as typeof part)} />
    <SurfaceFields surfaceKey={part} />
    <Group title="文字"><ColorField label="文字颜色" value={document.theme[part].textColor} onChange={(textColor, group) => update(part, { textColor }, group)} /></Group>
    <div className={styles.tip}>{part === 'workspacePanel' ? '控制右侧文件预览与目录面板。不透明度为 0 时透出背景图。宽度仍由 Codex 原生分隔线控制，代码高亮、终端及网页内容保持原样。' : part === 'summaryPanel' ? '控制输出与来源卡片的底色，不改变卡片的显示或收起方式。' : '控制对话顶部的工具按钮，不包括最小化、最大化和关闭按钮。透明底色仍保留悬停、选中和键盘焦点反馈。'}</div>
  </>;
}

export function Inspector({ section, imageUrl, notify, advanced, onAdvancedChange }: {
  section: EditorSection; imageUrl?: string; notify: Notify; advanced: boolean; onAdvancedChange: (value: boolean) => void;
}) {
  const { document, update, setCustomCss, endGroup } = useTheme();
  const [copied, setCopied] = useState(false);
  const t = document.theme;
  async function copyCss() {
    try { await navigator.clipboard.writeText(buildCss(t, imageUrl)); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { notify('复制失败，请检查剪贴板权限', true); }
  }
  return <aside className={styles.inspector} aria-label="主题属性">
    <header><div><span className={styles.overline}>自定义你的空间</span><h2>{SECTIONS[section].title}</h2><p>{SECTIONS[section].subtitle}</p></div>
      <span className={styles.panelMark}>{section === 'global' ? '01' : section === 'background' ? '02' : 'EDIT'}</span></header>
    <div className={styles.body}>
      {section === 'global' && <GlobalPanel />}
      {section === 'background' && <BackgroundPanel imageUrl={imageUrl} notify={notify} />}
      {section === 'sidebar' && <><SurfaceFields surfaceKey="sidebar" /><Group title="布局" hint="实际 Codex 的宽度请拖动原生侧栏分隔线调整。这里仅改变预览，避免挤压原生按钮。"><RangeField label="预览侧栏宽度" value={t.sidebar.width} min={180} max={360} unit="px" onChange={(width, group) => update('sidebar', { width }, group)} /></Group></>}
      {section === 'composer' && <><SurfaceFields surfaceKey="composer" /><Group title="布局" hint="输入框外围的原生渐变遮罩会自动移除。这里的背景颜色与不透明度只控制输入框本身。"><RangeField label="内部留白" value={t.composer.padding} min={8} max={32} unit="px" onChange={(padding, group) => update('composer', { padding }, group)} /></Group></>}
      {section === 'messages' && <MessagePanel />}
      {section === 'codeBlock' && <><SurfaceFields surfaceKey="codeBlock" /><FontPanel codeOnly notify={notify} /></>}
      {section === 'panels' && <WorkPanels />}
      {section === 'font' && <FontPanel notify={notify} />}
      {(section === 'themes' || section === 'transfer') && <>
        <Group title="当前主题"><div className={styles.themeSummary}><span style={{ background: t.global.accent }} /><strong>{t.meta.name}</strong><small>{t.global.appearance === 'dark' ? '深色主题' : '浅色主题'}</small></div></Group>
        <div className={styles.tip}>预设只是起点。切换到左侧的任一区域，就能继续微调你的主题。</div>
      </>}
      {section === 'settings' && <><Group title="编辑偏好"><Toggle label="高级主题编辑" hint="为熟悉样式的用户显示额外工具" value={advanced} onChange={onAdvancedChange} /></Group>
        <div className={styles.tip}>主题编辑和保存不需要联网。预览不会读取你的 Codex 对话内容。</div></>}
      {advanced && <Group title="高级样式" hint="自定义样式单独保存。仅使用你信任的内容。">
        <label className={styles.codeLabel} htmlFor="custom-css">自定义 CSS</label>
        <textarea id="custom-css" className={styles.codeEditor} spellCheck={false} value={document.customCss} maxLength={262144} onChange={event => setCustomCss(event.target.value)} onBlur={endGroup}
          placeholder={'[data-lct-part="composer"] {\n  /* your style */\n}'} />
        <button className="textButton" onClick={() => void copyCss()}>{copied ? <Check size={13} /> : <Copy size={13} />}复制生成的 CSS</button>
        <details className={styles.output}><summary>查看生成的样式</summary><small>图片数据已在查看器中省略，复制时会保留完整内容。</small>
          <pre>{buildCss(t, imageUrl).replace(/data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+/g, '[image data omitted]')}</pre></details>
        <details className={styles.output}><summary>查看主题配置</summary><pre>{JSON.stringify(t, null, 2)}</pre></details>
      </Group>}
    </div>
    <footer><span className={styles.footerDot} />所有调整均可撤销</footer>
  </aside>;
}
