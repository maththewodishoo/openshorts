import React, { useEffect, useRef } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, Loader2, Inbox } from 'lucide-react';

export function Card({ children, className = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ icon: Icon, title, sub, action }) {
  return (
    <div className="between" style={{ marginBottom: 14 }}>
      <div>
        <div className="card-title">
          {Icon ? <Icon size={16} style={{ color: 'var(--cyan)' }} /> : null}
          {title}
        </div>
        {sub ? <div className="card-sub">{sub}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className="field">
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? <div className="hint" style={{ color: 'var(--danger)' }}>{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function ChipGroup({ options, value, onChange, multiple = false }) {
  const list = Array.isArray(value) ? value : [value];
  const isOn = (v) => (multiple ? list.includes(v) : value === v);
  const toggle = (v) => {
    if (!multiple) return onChange(v);
    return onChange(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };
  return (
    <div className="chip-group">
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const text = typeof opt === 'string' ? opt : opt.label;
        return (
          <button
            type="button"
            key={val}
            className={`chip ${isOn(val) ? 'on' : ''}`}
            onClick={() => toggle(val)}
            aria-pressed={isOn(val)}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className="switch" style={disabled ? { opacity: 0.5 } : undefined}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="switch-track" />
      {label ? <span className="switch-label">{label}</span> : null}
    </label>
  );
}

export function Badge({ tone = '', children, icon: Icon }) {
  return (
    <span className={`badge ${tone}`}>
      {Icon ? <Icon size={11} /> : null}
      {children}
    </span>
  );
}

export function Stat({ label, value, foot }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {foot ? <div className="stat-foot">{foot}</div> : null}
    </div>
  );
}

export function Empty({ icon: Icon = Inbox, title, sub, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={22} />
      </div>
      <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{title}</div>
      {sub ? <div className="small" style={{ maxWidth: 420 }}>{sub}</div> : null}
      {action}
    </div>
  );
}

export function Spinner({ size = 16 }) {
  return <Loader2 size={size} className="spin" />;
}

export function Progress({ value }) {
  const pct = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Banner({ tone = 'info', icon: Icon = Info, children }) {
  return (
    <div className={`banner ${tone}`} role="status">
      <Icon size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="between" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 17 }}>{title}</h2>
          <button type="button" className="btn icon ghost" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        {children}
        {footer ? <div style={{ marginTop: 18 }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function Toasts({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === 'ok' ? CheckCircle2 : t.kind === 'err' ? AlertTriangle : t.kind === 'warn' ? AlertTriangle : Info;
        return (
          <div key={t.id} className={`toast ${t.kind || ''}`}>
            <Icon size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />
            <div style={{ flex: 1 }}>{t.message}</div>
            <button type="button" className="btn ghost icon" style={{ width: 22, height: 22, minHeight: 22 }} onClick={() => onDismiss(t.id)} aria-label="Dismiss">
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          type="button"
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          className={`tab ${value === t.value ? 'on' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
