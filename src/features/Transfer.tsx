import { useState } from 'react';
import { Download, Upload, FileArchive, ShieldCheck, ArrowDown } from 'lucide-react';
import { useTheme } from '../app/ThemeProvider';
import { useOperation } from '../app/useOperation';
import { commitImport, exportTheme, importTheme, type ThemeImport } from '../theme/packages';
import { exportDreamSkin } from '../adapters/dreamskin/export';
import { saveExport } from '../platform/storage';
import { Modal, Segmented } from '../components/controls/Controls';
import styles from './Transfer.module.css';

export function Transfer({ notify, openEditor }: { notify: (message: string, error?: boolean) => void; openEditor: () => void }) {
  const { document, replace } = useTheme();
  const { busy, begin, finish } = useOperation(document.theme.meta.id);
  const [pending, setPending] = useState<ThemeImport | null>(null);
  const [format, setFormat] = useState<'native' | 'dreamskin'>('native');
  async function read(file?: File) {
    if (!file) return;
    const signal = begin();
    try {
      const imported = await importTheme(file, document.theme.global.appearance);
      if (!signal.aborted) setPending(imported);
    }
    catch (error) { if (!signal.aborted) notify(String(error), true); }
    finally { finish(signal); }
  }
  async function write() {
    const signal = begin();
    try {
      const blob = format === 'dreamskin' ? await exportDreamSkin(document) : await exportTheme(document);
      if (signal.aborted) return;
      const saved = await saveExport(blob, `${document.theme.meta.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.zip`);
      if (saved && !signal.aborted) notify('主题包已导出');
    }
    catch (error) { if (!signal.aborted) notify(String(error), true); }
    finally { finish(signal); }
  }
  async function accept(includeStyles: boolean) {
    if (!pending) return;
    const signal = begin();
    try {
      const document = await commitImport(pending, signal);
      if (signal.aborted) return;
      replace({ ...document, customCss: includeStyles ? document.customCss : '' }); setPending(null); openEditor(); notify('主题已导入，可以继续调整');
    } catch (error) { if (!signal.aborted) notify(String(error), true); }
    finally { finish(signal); }
  }
  return <section className={styles.transfer}>
    <span className="eyebrow">TAKE YOUR STYLE WITH YOU</span><h1>让喜欢的风格，跟着你。</h1><p className={styles.intro}>本地保存，自由分享。不需要账号，也不需要联网。</p>
    <div className={styles.cards}>
      <article><span className={styles.cardIcon}><Upload size={22} /></span><h2>带进一个新主题</h2><p>导入 LostCodexTheme 或 Dream Skin 主题包。颜色和背景图片，一起带进来。</p>
        <label className={styles.drop} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void read(event.dataTransfer.files[0]); }}>
          <FileArchive size={29} /><strong>{busy ? '正在处理主题文件' : '点击选择，或拖入文件'}</strong><small>.zip 主题包 / .json 配置 · 最大 32 MB</small>
          <input type="file" accept=".zip,.json" disabled={busy} onChange={event => { void read(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
      </article>
      <article><span className={styles.cardIcon}><Download size={22} /></span><h2>把这一刻的风格带走</h2><p>将当前主题打包成一个文件，留作备份，或分享给另一个工作空间。</p>
        <Segmented label="导出格式" value={format} options={[{ value: 'native', label: '原生主题包' }, { value: 'dreamskin', label: 'Dream Skin' }]} onChange={setFormat} />
        {format === 'dreamskin' && <p className={styles.compatibility}>Dream Skin 会使用兼容外观。独立消息、代码样式和自定义字体仍保存在包内，导回本编辑器可完整恢复。</p>}
        <div className={styles.exportPreview}><FileArchive size={30} /><strong>{document.theme.meta.name}</strong><span>包含配置{document.theme.background.image ? '、背景图片' : ''}{document.customCss.trim() ? '、自定义样式' : ''}</span><ArrowDown size={16} /></div>
        <button className="primaryButton fullWidth" disabled={busy} onClick={() => void write()}><Download size={15} />导出主题包</button>
      </article>
    </div>
    <div className={styles.safety}><ShieldCheck size={19} /><span>主题文件只包含外观设置，不包含账号、对话和模型配置。</span></div>
    {pending && <Modal title="导入这个主题？" onClose={() => { if (!busy) setPending(null); }}><p>{pending.document.theme.meta.name} 会替换当前编辑内容。你仍然可以通过撤销回到现在的主题。</p>
      {pending.notes.length > 0 && <p>{pending.notes.join('。')}。</p>}
      {pending.document.customCss.trim() && <p>主题包含额外样式。只在信任来源时保留，或仅导入可视化设置。</p>}
      <div className="modalActions"><button className="secondaryButton" disabled={busy} onClick={() => setPending(null)}>取消</button>
        {pending.document.customCss.trim() && <button className="secondaryButton" disabled={busy} onClick={() => void accept(false)}>只导入设置</button>}
        <button className="primaryButton" disabled={busy} onClick={() => void accept(true)}>{busy ? '正在导入' : pending.document.customCss.trim() ? '信任并导入' : '导入主题'}</button></div>
    </Modal>}
  </section>;
}
