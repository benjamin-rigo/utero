import { useRef, useState, useSyncExternalStore } from 'react'
import { startEngine, type EngineHost } from '@/audio/host'
import { createStore } from '@/state/store'
import { MachinePanel } from '@/ui/MachinePanel'
import { SequencerMatrix } from '@/ui/SequencerMatrix'
import { TransportBar } from '@/ui/TransportBar'
import { usePlayheads } from '@/ui/usePlayheads'

const store = createStore()

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [host, setHost] = useState<EngineHost | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)
  const playheads = usePlayheads(host?.snapshot ?? null, state.playing)

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
    <div className="grid h-dvh grid-rows-[auto_1fr] bg-background font-mono text-xs text-foreground">
      <TransportBar bpm={state.bpm} playing={state.playing} starting={starting} error={error} onTogglePlay={togglePlay} onBpm={store.setBpm} />
      <main className="grid min-h-0 grid-cols-[1fr_440px]">
        <SequencerMatrix state={state} playheads={playheads} onToggle={store.toggleStep} onSetLength={store.setLength}
          onSetSpeed={store.setSpeed} onSelect={store.select} />
        <MachinePanel state={state} onParam={store.setParam} />
      </main>
    </div>
  )
}
