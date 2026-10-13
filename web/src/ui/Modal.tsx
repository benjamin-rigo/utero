import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  title: string
  onClose(): void
  children: ReactNode
}

/** A centred dialog over a dimmed page: × / Esc / backdrop close it; focus moves in and returns on close. */
export function Modal({ title, onClose, children }: Props) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('[tabindex="0"], button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      back?.focus()
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-on-ink/70" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className="flex flex-col border border-strong bg-background">
        <div className="flex h-control items-center justify-between border-b border-line pl-inset text-label">
          <span className="text-ink">{title}</span>
          <button type="button" aria-label={`Close ${title}`} onClick={onClose}
            className="h-full px-inset text-ink-mute hover:text-ink focus-ring">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
