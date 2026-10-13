import type { KeyboardEvent } from 'react'

interface Props {
  /** Accessible group name, e.g. 'SUB OCT', 'Rate mode'. */
  label: string
  /** Visible caption in front of the options; omitted when the options speak for themselves. */
  caption?: string
  options: string[]
  index: number
  onIndex(i: number): void
  className?: string
}

/**
 * Every option visible, the active one filled white (a radiogroup): click, or ←→ / Home / End with
 * focus following the choice. Used for every either/or setting so the current state is never a guess.
 */
export function Segmented({ label, caption, options, index, onIndex, className = '' }: Props) {
  const last = options.length - 1
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    e.preventDefault()
    const n = Math.min(last, Math.max(0, i))
    if (n !== index) onIndex(n)
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[n]?.focus()
  }
  return (
    // one outlined group, options split by hairlines, the active one filled
    <div role="radiogroup" aria-label={label} className={`flex h-control w-fit items-stretch border border-strong text-label ${className}`}>
      {caption && <span className="mr-tight self-center text-ink-mute">{caption}</span>}
      {options.map((o, i) => (
        <button key={o} type="button" role="radio" aria-checked={i === index} tabIndex={i === index ? 0 : -1}
          onClick={() => { if (i !== index) onIndex(i) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, index + 1)
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, index - 1)
            else if (e.key === 'Home') move(e, 0)
            else if (e.key === 'End') move(e, last)
          }}
          className={`min-w-option px-tight focus-ring ${i > 0 ? 'border-l border-strong' : ''} ${i === index ? 'bg-ink text-on-ink' : 'text-ink-mute hover:text-ink-soft'}`}>
          {o}
        </button>
      ))}
    </div>
  )
}
