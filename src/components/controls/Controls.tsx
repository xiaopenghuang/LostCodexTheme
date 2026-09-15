import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '../../app/ThemeProvider';
import styles from './Controls.module.css';

export function Group({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return <fieldset className={styles.group}><legend>{title}</legend>{hint && <p className={styles.hint}>{hint}</p>}{children}</fieldset>;
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string, group?: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const { endGroup } = useTheme();
  useEffect(() => { setText(value); setInvalid(false); }, [value]);
  function commit() {
    if (/^#[\da-fA-F]{6}$/.test(text)) { onChange(text.toLowerCase()); setInvalid(false); }
    else { setInvalid(true); }
    endGroup();
  }
  return <div className={styles.field}>
    <label htmlFor={`${id}-text`}>{label}</label>
    <div className={styles.color}>
      <input type="color" value={value} aria-label={`${label}选色器`} onChange={event => onChange(event.target.value, id)} onBlur={endGroup} />
      <input id={`${id}-text`} type="text" spellCheck={false} maxLength={7} value={text} aria-invalid={invalid}
        onChange={event => setText(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') { commit(); event.currentTarget.blur(); } }} />
    </div>
    {invalid && <small className={styles.error}>请输入六位颜色值</small>}
  </div>;
}

export function RangeField({ label, value, min = 0, max = 100, step = 1, unit = '', onChange }: {
  label: string; value: number; min?: number; max?: number; step?: number; unit?: string;
  onChange: (value: number, group: string) => void;
}) {
  const id = useId();
  const { endGroup } = useTheme();
  return <div className={styles.range}>
    <div><label htmlFor={id}>{label}</label><output htmlFor={id}>{Number(value.toFixed(2))}<span>{unit}</span></output></div>
    <input id={id} type="range" min={min} max={max} step={step} value={value}
      aria-valuetext={`${Number(value.toFixed(2))}${unit}`}
      style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      onChange={event => onChange(Number(event.target.value), id)} onPointerUp={endGroup} onPointerCancel={endGroup} onKeyUp={endGroup} onBlur={endGroup} />
  </div>;
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (value: boolean) => void; hint?: string }) {
  const id = useId();
  return <label className={styles.toggle} htmlFor={id}><span>{label}{hint && <small>{hint}</small>}</span>
    <input id={id} type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} role="switch" />
    <span className={styles.track} aria-hidden="true" />
  </label>;
}

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void;
}) {
  return <div className={styles.segmentField}><span>{label}</span><div className={styles.segment} role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" aria-pressed={option.value === value}
      onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div></div>;
}

export function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: Array<{ value: string; label: string; disabled?: boolean }>; onChange: (value: string) => void;
}) {
  const id = useId();
  return <div className={styles.selectField}><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={event => onChange(event.target.value)}>
    {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
  </select></div>;
}

export function Modal({ title, children, onClose, required = false }: { title: string; children: ReactNode; onClose: () => void; required?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className={styles.modal} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!required) onClose(); }}>
    <div className={styles.modalTitle}><h2 id={titleId}>{title}</h2>{!required && <button type="button" className="iconButton" onClick={onClose} aria-label="关闭弹窗"><X size={18} /></button>}</div>
    {children}
  </dialog>;
}
