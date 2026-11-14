import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CheckCircle2, Circle, Copy, Minus, XCircle } from 'lucide-react'

export function Badge({ value, compact = false }: { value: boolean | null; compact?: boolean }) {
  const Icon = value === true ? CheckCircle2 : value === false ? XCircle : Minus
  return <span className={`badge ${value === true ? 'pass' : value === false ? 'fail' : 'neutral'}`}><Icon size={compact ? 12 : 13} />{value === true ? 'PASS' : value === false ? 'FAIL' : 'CHƯA CHẤM'}</span>
}
export function JsonView({ value }: { value: unknown }) {
  const text = value === undefined ? '— không có —' : JSON.stringify(value, null, 2) ?? 'null'
  const tokens = text.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|\b-?\d+(?:\.\d+)?\b)/g)
  return <pre className="json-view"><code>{tokens.map((part, i) => <span key={i} className={part.endsWith(':') ? 'json-key' : part.startsWith('"') ? 'json-string' : /^(true|false|null|\d)/.test(part) ? 'json-number' : ''}>{part}</span>)}</code></pre>
}
export function CopyButton({ value, label = 'Sao chép JSON' }: { value: unknown; label?: string }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState(false)
  useEffect(() => { if (!copied && !error) return; const t = setTimeout(() => { setCopied(false); setError(false) }, 2000); return () => clearTimeout(t) }, [copied, error])
  return <button className="icon-button" aria-label={label} title={error ? 'Không truy cập được clipboard' : copied ? 'Đã sao chép' : label} onClick={async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(value, null, 2)); setCopied(true) } catch { setError(true) }
  }}>{copied ? <Check size={15} /> : error ? <XCircle size={15} /> : <Copy size={15} />}</button>
}
export function Dialog({ children, onClose, labelId, className = '' }: { children: ReactNode; onClose: () => void; labelId: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current() }
      if (e.key === 'Tab') {
        const els = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, audio[controls], a[href], [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length)
        if (!els.length) { e.preventDefault(); return }
        if (e.shiftKey && (document.activeElement === els[0] || document.activeElement === ref.current)) { e.preventDefault(); els.at(-1)?.focus() }
        else if (!e.shiftKey && (document.activeElement === els.at(-1) || document.activeElement === ref.current)) { e.preventDefault(); els[0].focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [])
  return <div className="dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelId} className={`dialog ${className}`}>{children}</div></div>
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><Circle size={26} /><h3>{title}</h3>{children && <p>{children}</p>}</div>
}
