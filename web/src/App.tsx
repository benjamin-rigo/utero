import { useRef, useState, useSyncExternalStore } from 'react'
import { startEngine, type EngineHost } from '@/audio/host'
import { playheadOf, SNAP_TRACKS } from '@/audio/snapshot'
import { createStore } from '@/state/store'
import { MachinePanel } from '@/ui/MachinePanel'
import { Mixer } from '@/ui/Mixer'
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

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr_200px] bg-background font-mono text-xs text-foreground">
      <TransportBar bpm={state.bpm} playing={state.playing} starting={starting} error={error} onTogglePlay={togglePlay} onBpm={store.setBpm} />
      <main className="grid min-h-0 grid-cols-[1fr_440px]">
        <div className="flex min-h-0 flex-col">
          <SequencerMatrix state={state} playheads={playheads} onToggle={store.toggleStep} onSetLength={store.setLength}
            onSetSpeed={store.setSpeed} onSelect={store.select} onSetNote={store.setStepNote} />
          <div className="h-[190px] shrink-0">
            <ModStrip state={state} frame={frame} store={store} />
          </div>
        </div>
        <MachinePanel state={state} frame={frame} store={store} />
      </main>
      <Mixer state={state} frame={frame} store={store} />
    </div>
  )
}
