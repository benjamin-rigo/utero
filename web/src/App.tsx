import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { startEngine, type EngineHost } from '@/audio/host'
import { kickPitchOf, playheadOf, SNAP_KICK_TRACKS, SNAP_TRACKS } from '@/audio/snapshot'
import { hzToNote } from '@/state/machines'
import { createStore } from '@/state/store'
import { MachinePanel } from '@/ui/MachinePanel'
import { MacroFaders } from '@/ui/MacroFaders'
import { Master, Mixer } from '@/ui/Mixer'
import { ModStrip } from '@/ui/ModStrip'
import { SequencerMatrix } from '@/ui/SequencerMatrix'
import { TransportBar } from '@/ui/TransportBar'
import { useEngineFrame } from '@/ui/useEngineFrame'

const store = createStore()
const IDLE = Array<number>(SNAP_TRACKS).fill(-1)

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [host, setHost] = useState<EngineHost | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)
  const frame = useEngineFrame(host?.snapshot ?? null)
  const playheads = state.playing && frame ? Array.from({ length: SNAP_TRACKS }, (_, t) => playheadOf(frame, t)) : IDLE

  // Space is always start/stop (except while typing): captured before buttons and steps can use it
  const toggleRef = useRef<() => void>(() => {})
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) toggleRef.current()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target)) e.preventDefault()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  }, [])

  const togglePlay = async () => {
    if (state.playing) {
      store.stop()
      return
    }
    if (startingRef.current) return
    setError(null)
    try {
      if (!host) {
        startingRef.current = true
        setStarting(true)
        const h = await startEngine(setError)
        store.connect(h.send)
        setHost(h)
      }
      store.play()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }

  useEffect(() => { toggleRef.current = () => { void togglePlay() } })

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-background font-mono text-label text-ink-soft lowercase">
      <TransportBar bpm={state.bpm} playing={state.playing} starting={starting} error={error} onTogglePlay={togglePlay} onBpm={store.setBpm} />
      {/* two units on shared rows: left = sequencer / modulators / mixer on one column grid, right = machine / macros / master */}
      <main className="grid min-h-0 grid-cols-[minmax(0,1fr)_var(--spacing-side)] grid-rows-[minmax(0,1fr)_var(--spacing-strip)_var(--spacing-mixer)]">
        <div className="left-grid row-span-3 grid-rows-subgrid min-h-0">
          <SequencerMatrix state={state} playheads={playheads} onToggle={store.toggleStep} onSetLength={store.setLength}
            onSetSpeed={store.setSpeed} onSelect={store.select} onSetNote={store.setStepNote}
            tuner={frame ? Array.from({ length: SNAP_KICK_TRACKS }, (_, k) => (kickPitchOf(frame, k) > 0 ? hzToNote(kickPitchOf(frame, k)) : null)) : []} />
          <ModStrip state={state} frame={frame} store={store} />
          <Mixer state={state} frame={frame} store={store} />
        </div>
        <div className="row-span-3 grid min-h-0 grid-rows-subgrid border-l border-line">
          <MachinePanel state={state} frame={frame} store={store} />
          <MacroFaders state={state} store={store} />
          <Master state={state} frame={frame} store={store} />
        </div>
      </main>
    </div>
  )
}
