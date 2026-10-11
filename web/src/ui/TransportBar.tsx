import { Button } from '@/components/ui/button'

interface Props {
  bpm: number
  playing: boolean
  error: string | null
  onTogglePlay(): void
  onBpm(bpm: number): void
}

export function TransportBar({ bpm, playing, error, onTogglePlay, onBpm }: Props) {
  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1.5">
      <b>utero</b>
      <Button size="sm" variant={playing ? 'default' : 'outline'} onClick={onTogglePlay} aria-label={playing ? 'Stop' : 'Play'}>
        {playing ? '■ STOP' : '▶ PLAY'}
      </Button>
      <label className="flex items-center gap-1 text-zinc-400">
        BPM
        <input type="number" min={20} max={300} step={0.1} value={bpm}
          onChange={(e) => onBpm(e.target.valueAsNumber)}
          className="w-16 rounded bg-zinc-900 px-1 py-0.5 text-zinc-100 focus-visible:ring-2 focus-visible:ring-acc" />
      </label>
      {error && <span role="alert" className="text-red-400">{error}</span>}
      <span className="ml-auto text-zinc-500">⌥+klikk = sávhossz</span>
    </header>
  )
}
