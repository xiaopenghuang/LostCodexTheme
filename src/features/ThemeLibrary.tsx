import { useState, type CSSProperties } from 'react';
import { ArrowUpRight, Plus, Search, Trash2, Copy } from 'lucide-react';
import { PRESETS, fromPreset, type Preset } from '../theme/presets';
import { newDocument } from '../theme/defaults';
import type { SavedTheme, ThemeDocument, ThemeState } from '../theme/types';
import { useTheme } from '../app/ThemeProvider';
import styles from './ThemeLibrary.module.css';

function Miniature({ theme }: { theme: ThemeState }) {
  return <div className={styles.miniature} style={{ '--mini-bg': theme.background.type === 'gradient'
    ? `linear-gradient(${theme.background.gradientAngle}deg, ${theme.background.gradientStart}, ${theme.background.gradientEnd})` : theme.background.color,
    '--mini-side': theme.sidebar.background, '--mini-input': theme.composer.background, '--mini-accent': theme.global.accent,
    '--mini-text': theme.global.textColor } as CSSProperties}>
    <div className={styles.miniSide}><i /><i /><i /><i /></div><div className={styles.miniContent}><span /><span /><div className={styles.miniCode}><i /><i /><i /></div><div className={styles.miniInput}><i /></div></div>
  </div>;
}

function PresetCard({ preset, onSelect }: { preset: Preset; onSelect: () => void }) {
  return <button className={styles.presetCard} onClick={onSelect} title={preset.description}><Miniature theme={preset.theme} /><span>{preset.name}<i style={{ background: preset.theme.global.accent }} /></span></button>;
}

export function ThemeShelf({ openLibrary }: { openLibrary: () => void }) {
  const { replace } = useTheme();
  return <section className={styles.shelf} aria-label="内置主题预设"><header><div><h2>从喜欢的风格开始</h2><span>一键切换，随心微调</span></div>
    <button className="textButton" onClick={openLibrary}>全部主题<ArrowUpRight size={13} /></button></header>
    <div className={styles.shelfCards}>{PRESETS.slice(0, 4).map(preset => <PresetCard key={preset.id} preset={preset} onSelect={() => replace(fromPreset(preset))} />)}</div>
  </section>;
}

export function ThemeLibrary({ themes, remove, openEditor, notify }: {
  themes: SavedTheme[]; remove: (id: string) => void; openEditor: () => void; notify: (message: string) => void;
}) {
  const { replace } = useTheme();
  const [search, setSearch] = useState('');
  function choose(document: ThemeDocument, saved = false) { replace(structuredClone(document), saved); openEditor(); }
  const filtered = themes.filter(theme => theme.document.theme.meta.name.toLowerCase().includes(search.toLowerCase()));
  return <section className={styles.library}>
    <div className={styles.heading}><div><span className="eyebrow">YOUR PERSONAL COLLECTION</span><h1>把灵感，留在工作空间里。</h1><p>选一个新的起点，或继续打磨你自己的主题。</p></div>
      <button className="primaryButton" onClick={() => choose(newDocument())}><Plus size={15} />新建主题</button></div>
    <h2 className={styles.sectionTitle}>内置预设 <small>{PRESETS.length} 种风格</small></h2>
    <div className={styles.grid}>{PRESETS.map(preset => <PresetCard key={preset.id} preset={preset} onSelect={() => choose(fromPreset(preset))} />)}</div>
    <div className={styles.savedHeading}><h2 className={styles.sectionTitle}>我的主题 <small>{themes.length} 个主题</small></h2><label className={styles.search}><Search size={14} /><input aria-label="搜索已保存的主题" placeholder="搜索主题" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    {filtered.length === 0 ? <div className={styles.empty}>{themes.length ? '没有找到匹配的主题' : '你的主题会保存在这里'}<small>{themes.length ? '换个名字试试' : '编辑完成后，点击右上角的保存主题'}</small></div> :
      <div className={styles.grid}>{filtered.map(({ document, savedAt }) => <article className={styles.savedCard} key={document.theme.meta.id}>
        <button className={styles.savedSelect} onClick={() => choose(document, true)}><Miniature theme={document.theme} /><strong>{document.theme.meta.name}</strong><small>{new Date(savedAt).toLocaleDateString('zh-CN')} 保存</small></button>
        <div className={styles.savedActions}><button className="iconButton" aria-label={`复制 ${document.theme.meta.name}`} onClick={() => {
          const copy = structuredClone(document); copy.theme.meta.id = crypto.randomUUID(); copy.theme.meta.name = `${copy.theme.meta.name.slice(0, 74)} 副本`; choose(copy); notify('已创建副本，保存后会出现在我的主题中');
        }}><Copy size={13} /></button><button className="iconButton" aria-label={`删除 ${document.theme.meta.name}`} onClick={() => remove(document.theme.meta.id)}><Trash2 size={13} /></button></div>
      </article>)}</div>}
  </section>;
}
