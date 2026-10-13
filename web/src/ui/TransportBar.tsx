import { useEffect, useRef, useState } from 'react'
import { parseBpmDraft } from './bpmDraft'
import { Logo } from './Logo'

interface Props {
  bpm: number
  playing: boolean
  starting: boolean
  error: string | null
  onTogglePlay(): void
  onBpm(bpm: number): void
}

/** The BPM field commits on Enter/blur only, so a half-typed value never reaches the live tempo. */
export function TransportBar({ bpm, playing, starting, error, onTogglePlay, onBpm }: Props) {
  const [draft, setDraft] = useState(String(bpm))
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false)
  useEffect(() => {
    if (!editing) setDraft(String(bpm))
  }, [bpm, editing])

  const commit = () => {
    setEditing(false)
    const value = parseBpmDraft(draft)
    if (cancelled.current || value === null) {
      cancelled.current = false
      setDraft(String(bpm))
      return
    }
    onBpm(value)
  }

  const nudge = (delta: number) => {
    const next = Math.round(((parseBpmDraft(draft) ?? bpm) + delta) * 10) / 10
    setDraft(String(next))
    onBpm(next)
  }

  return (
    <header className="flex items-center gap-group border-b border-line p-inset">
      <Logo className="size-control shrink-0 text-ink" />
      <button type="button" className={`h-control w-knob focus-ring disabled:opacity-50 ${playing ? 'bg-ink text-on-ink' : 'bg-well text-ink-soft hover:text-ink'}`} onClick={onTogglePlay} disabled={starting} aria-busy={starting} aria-label={playing ? 'Stop' : 'Play'}>
        {playing ? '■ STOP' : '▶ PLAY'}
      </button>
      <label className="flex items-center gap-tight text-ink-mute">
        <span className="w-dial">BPM</span>
        <input type="text" inputMode="decimal" value={draft}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              cancelled.current = true
              e.currentTarget.blur()
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const step = e.shiftKey ? 1 : 0.1
              nudge(e.key === 'ArrowUp' ? step : -step)
            }
          }}
          className="h-control w-knob bg-well px-tight text-ink focus-ring" />
      </label>
      {error && <span role="alert" className="text-alert">{error}</span>}
    </header>
  )
}
