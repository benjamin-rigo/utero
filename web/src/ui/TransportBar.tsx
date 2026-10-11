import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { parseBpmDraft } from './bpmDraft'

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

  const nudge = (delta: number) => onBpm(Math.round((bpm + delta) * 10) / 10)

  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1.5">
      <b>utero</b>
      <Button size="sm" variant={playing ? 'default' : 'outline'} onClick={onTogglePlay} disabled={starting} aria-busy={starting} aria-label={playing ? 'Stop' : 'Play'}>
        {playing ? '■ STOP' : '▶ PLAY'}
      </Button>
      <label className="flex items-center gap-1 text-zinc-400">
        BPM
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
          className="w-16 rounded bg-zinc-900 px-1 py-0.5 text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc" />
      </label>
      {error && <span role="alert" className="text-red-400">{error}</span>}
      <span className="ml-auto text-zinc-500">⌥+klikk = sávhossz</span>
    </header>
  )
}
