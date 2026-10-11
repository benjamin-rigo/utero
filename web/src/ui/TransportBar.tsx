import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  bpm: number
  playing: boolean
  starting: boolean
  error: string | null
  onTogglePlay(): void
  onBpm(bpm: number): void
}

export function TransportBar({ bpm, playing, starting, error, onTogglePlay, onBpm }: Props) {
  const [draft, setDraft] = useState(String(bpm))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(String(bpm))
  }, [bpm, editing])

  const commit = () => {
    setEditing(false)
    onBpm(Number(draft))
  }

  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1.5">
      <b>utero</b>
      <Button size="sm" variant={playing ? 'default' : 'outline'} onClick={onTogglePlay} disabled={starting} aria-busy={starting} aria-label={playing ? 'Stop' : 'Play'}>
        {playing ? '■ STOP' : '▶ PLAY'}
      </Button>
      <label className="flex items-center gap-1 text-zinc-400">
        BPM
        <input type="number" min={20} max={300} step={0.1} value={draft}
          onFocus={() => setEditing(true)}
          onChange={(e) => {
            setDraft(e.target.value)
            if (!(e.nativeEvent instanceof InputEvent)) onBpm(e.target.valueAsNumber)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setDraft(String(bpm))
              e.currentTarget.blur()
            }
          }}
          className="w-16 rounded bg-zinc-900 px-1 py-0.5 text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc" />
      </label>
      {error && <span role="alert" className="text-red-400">{error}</span>}
      <span className="ml-auto text-zinc-500">⌥+klikk = sávhossz</span>
    </header>
  )
}
