import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Bell, Check } from 'lucide-react'
import { useI18n } from '../i18n'

export interface ToastInput { kind?: 'info' | 'ok' | 'error'; title?: string; text: string; action?: { label: string; run(): void } }
interface Toast extends ToastInput { id: number }
const Ctx = createContext<{ push(t: ToastInput): void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setItems(list => list.filter(x => x.id !== id)), [])
  const push = useCallback((input: ToastInput) => {
    const id = ++seq.current
    setItems(list => [...list.slice(-3), { ...input, id }])
    setTimeout(() => dismiss(id), input.kind === 'error' ? 7000 : 5000)
  }, [dismiss])
  const value = useMemo(() => ({ push }), [push])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label={t('toast.region')} aria-live="polite">
        {items.map(x => (
          <div key={x.id} className={`toast ${x.kind ?? 'info'}`} role={x.kind === 'error' ? 'alert' : 'status'}>
            {x.kind === 'error' ? <AlertCircle aria-hidden /> : x.kind === 'ok' ? <Check aria-hidden /> : <Bell aria-hidden />}
            <div className="t-body">
              {x.title && <div className="t-title">{x.title}</div>}
              <div className="t-text">{x.text}</div>
              {x.action && <button className="link" onClick={() => { x.action!.run(); dismiss(x.id) }}>{x.action.label}</button>}
            </div>
            <button className="icon-btn plain sm" aria-label={t('common.close')} onClick={() => dismiss(x.id)}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast hors ToastProvider')
  return c
}
