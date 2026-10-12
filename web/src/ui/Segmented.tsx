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
    <div role="radiogroup" aria-label={label} className={`flex w-fit items-center gap-px text-[10px] ${className}`}>
      {caption && <span className="mr-1.5 lowercase text-zinc-400">{caption}</span>}
      {options.map((o, i) => (
        <button key={o} type="button" role="radio" aria-checked={i === index} tabIndex={i === index ? 0 : -1}
          onClick={() => { if (i !== index) onIndex(i) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, index + 1)
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, index - 1)
            else if (e.key === 'Home') move(e, 0)
            else if (e.key === 'End') move(e, last)
          }}
          className={`min-w-7 px-1.5 py-0.5 lowercase outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-100 ${i === index ? 'bg-zinc-100 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>
          {o}
        </button>
      ))}
    </div>
  )
}
