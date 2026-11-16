'use client'

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 時刻の部分。値の "T" より後ろに入る。
 * - none: 日付だけ（"YYYY-MM-DD"）
 * - clock: 時・分（"YYYY-MM-DDTHH:mm"）
 * - preset: 「午前中」など、時刻の代わりの言葉（"YYYY-MM-DDT午前中"）
 */
type TimePart = { kind: 'none' } | { kind: 'clock'; hh: number; mm: number } | { kind: 'preset'; label: string }

type ParsedDateTime = {
  date: { y: number; m: number; d: number } | null
  time: TimePart
}

function parseValue(value: string, presets: readonly string[]): ParsedDateTime {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(.+))?$/.exec(value)
  if (!m) return { date: null, time: { kind: 'none' } }
  const y = Number.parseInt(m[1]!, 10)
  const mo = Number.parseInt(m[2]!, 10)
  const d = Number.parseInt(m[3]!, 10)
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { date: null, time: { kind: 'none' } }
  const rest = m[4] ?? ''
  const clock = /^(\d{2}):(\d{2})/.exec(rest)
  const time: TimePart = clock
    ? { kind: 'clock', hh: Number.parseInt(clock[1]!, 10), mm: Number.parseInt(clock[2]!, 10) }
    : presets.includes(rest)
      ? { kind: 'preset', label: rest }
      : { kind: 'none' }
  return { date: { y, m: mo, d }, time }
}

function toIsoDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

function toValue(date: { y: number; m: number; d: number }, time: TimePart): string {
  const iso = toIsoDate(date.y, date.m, date.d)
  if (time.kind === 'clock') return `${iso}T${pad2(time.hh)}:${pad2(time.mm)}`
  if (time.kind === 'preset') return `${iso}T${time.label}`
  return iso
}

function timeText(time: TimePart): string {
  if (time.kind === 'clock') return `${pad2(time.hh)}:${pad2(time.mm)}`
  if (time.kind === 'preset') return time.label
  return ''
}

function formatJa(p: ParsedDateTime): string {
  if (!p.date) return ''
  return `${p.date.y}年${p.date.m}月${p.date.d}日 ${timeText(p.time)}`.trim()
}

function formatPlainDateTime(p: ParsedDateTime): string {
  if (!p.date) return ''
  return `${p.date.y}/${pad2(p.date.m)}/${pad2(p.date.d)} ${timeText(p.time)}`.trim()
}

function monthLabelJa(year: number, month: number): string {
  return `${year}年${month}月`
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
/** 時刻指定に切り替えたときの最初の時刻 */
const DEFAULT_CLOCK = { hh: 8, mm: 0 }

const PLAIN_TRIGGER_CLASS =
  'group inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-slate-300 bg-slate-50/80 px-2 py-1 text-sm text-muted shadow-sm outline-none transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 print:border-transparent print:bg-transparent print:px-0 print:shadow-none'

function PlainCalendarIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 text-muted/70 transition-colors group-hover:text-primary print:hidden"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <rect x="3" y="4" width="14" height="13" rx="1.5" />
      <path d="M3 8h14M7 2v3M13 2v3" strokeLinecap="round" />
    </svg>
  )
}

export function CustomerDateTimePicker({
  value,
  onChange,
  plain = false,
  labelPrefix,
  timePresets = [],
  children,
}: {
  /** "YYYY-MM-DD" / "YYYY-MM-DDTHH:mm" / "YYYY-MM-DDT{timePresets のどれか}" */
  value: string
  onChange: (value: string) => void
  plain?: boolean
  labelPrefix?: string
  /** 時刻の代わりに選べる言葉（「午前中」など） */
  timePresets?: readonly string[]
  /** 時刻選択の下に追加で置くもの */
  children?: ReactNode
}) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const today = useMemo(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }
  }, [])

  const parsed = parseValue(value, timePresets)
  const initialView = parsed.date ?? today
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(initialView.y)
  const [viewMonth, setViewMonth] = useState(initialView.m)

  function toggleOpen() {
    if (!open && parsed.date) {
      setViewYear(parsed.date.y)
      setViewMonth(parsed.date.m)
    }
    setOpen(!open)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const cells = useMemo(() => {
    const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay()
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate()
    const grid: ({ day: number; iso: string } | null)[] = []
    for (let i = 0; i < firstWeekday; i++) grid.push(null)
    for (let day = 1; day <= daysInMonth; day++) {
      grid.push({ day, iso: toIsoDate(viewYear, viewMonth, day) })
    }
    return grid
  }, [viewMonth, viewYear])

  function shiftMonth(delta: number) {
    let y = viewYear
    let m = viewMonth + delta
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    setViewYear(y)
    setViewMonth(m)
  }

  /** 日付セル選択: 選んである時刻はそのまま */
  function pickDate(day: number) {
    onChange(toValue({ y: viewYear, m: viewMonth, d: day }, parsed.time))
  }

  /** 時刻の選択。日付が未選択なら今日にする */
  function setTime(time: TimePart) {
    onChange(toValue(parsed.date ?? today, time))
  }

  const clock = parsed.time.kind === 'clock' ? parsed.time : null
  const selectedIso = parsed.date ? toIsoDate(parsed.date.y, parsed.date.m, parsed.date.d) : ''
  const dateTimeValueText = value
    ? plain
      ? formatPlainDateTime(parsed)
      : formatJa(parsed)
    : plain
      ? '—'
      : '日時を選択'

  const ariaLabel = labelPrefix ? `${labelPrefix}${dateTimeValueText}` : dateTimeValueText

  const choiceClass = (active: boolean) =>
    `rounded-md border px-2 py-1 text-xs font-medium ${
      active ? 'border-primary bg-primary text-white' : 'border-border bg-white text-foreground hover:bg-muted/40'
    }`

  return (
    <div ref={rootRef} className={plain ? 'relative' : 'relative mt-1'}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={plain && labelPrefix ? ariaLabel : undefined}
        onClick={toggleOpen}
        className={
          plain
            ? PLAIN_TRIGGER_CLASS
            : 'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2 text-left text-sm font-medium text-foreground outline-none hover:border-primary/40 focus:border-primary print:border-transparent print:bg-transparent print:px-0'
        }
      >
        {plain && labelPrefix ? (
          <>
            <span>{labelPrefix}</span>
            <span className={value ? 'font-medium tabular-nums text-foreground' : 'text-muted/70'}>
              {dateTimeValueText}
            </span>
            <PlainCalendarIcon />
          </>
        ) : (
          <>
            <span className={value || plain ? 'text-inherit' : 'text-muted/70'}>{dateTimeValueText}</span>
            {!plain && (
              <svg
                className="h-4 w-4 shrink-0 text-muted/80 print:hidden"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden
              >
                <rect x="3" y="4" width="14" height="13" rx="1.5" />
                <path d="M3 8h14M7 2v3M13 2v3" strokeLinecap="round" />
              </svg>
            )}
          </>
        )}
      </button>

      {open && (
        <div
          id={listboxId}
          role="dialog"
          aria-label="日時を選択"
          className={`absolute top-[calc(100%+6px)] z-50 rounded-lg border border-border bg-white p-3 shadow-lg shadow-slate-900/10 print:hidden ${plain ? 'right-0 w-[320px]' : 'left-0 w-[min(100vw-2rem,320px)]'}`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="前の月"
              onClick={() => shiftMonth(-1)}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-muted/40"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-foreground">{monthLabelJa(viewYear, viewMonth)}</span>
            <button
              type="button"
              aria-label="次の月"
              onClick={() => shiftMonth(1)}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-muted/40"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted">
            {WEEKDAYS_JA.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, idx) =>
              cell ? (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => pickDate(cell.day)}
                  className={[
                    'rounded-md py-1.5 text-xs font-medium tabular-nums transition-colors',
                    selectedIso === cell.iso
                      ? 'bg-primary text-white'
                      : cell.iso === toIsoDate(today.y, today.m, today.d)
                        ? 'border border-primary/30 text-primary hover:bg-primary/10'
                        : 'text-foreground hover:bg-muted/50',
                  ].join(' ')}
                >
                  {cell.day}
                </button>
              ) : (
                <span key={`empty-${idx}`} />
              ),
            )}
          </div>

          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-center gap-1" role="group" aria-label="時刻の指定">
              <button
                type="button"
                aria-pressed={clock != null}
                onClick={() => setTime({ kind: 'clock', ...(clock ?? DEFAULT_CLOCK) })}
                className={choiceClass(clock != null)}
              >
                時刻指定
              </button>
              {timePresets.map((label) => {
                const active = parsed.time.kind === 'preset' && parsed.time.label === label
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTime({ kind: 'preset', label })}
                    className={choiceClass(active)}
                  >
                    {label}
                  </button>
                )
              })}
              <button
                type="button"
                aria-pressed={parsed.time.kind === 'none'}
                onClick={() => setTime({ kind: 'none' })}
                className={choiceClass(parsed.time.kind === 'none')}
              >
                時間指定なし
              </button>
            </div>
            {clock ? (
              <div className="flex items-center justify-center gap-2">
                <select
                  aria-label="時"
                  value={clock.hh}
                  onChange={(e) => setTime({ kind: 'clock', hh: Number.parseInt(e.target.value, 10), mm: clock.mm })}
                  className="rounded-md border border-border bg-white px-2 py-1 text-sm tabular-nums outline-none focus:border-primary"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {pad2(h)}
                    </option>
                  ))}
                </select>
                <span className="text-sm font-semibold text-muted">時</span>
                <select
                  aria-label="分"
                  value={clock.mm}
                  onChange={(e) => setTime({ kind: 'clock', hh: clock.hh, mm: Number.parseInt(e.target.value, 10) })}
                  className="rounded-md border border-border bg-white px-2 py-1 text-sm tabular-nums outline-none focus:border-primary"
                >
                  {MINUTES.map((mi) => (
                    <option key={mi} value={mi}>
                      {pad2(mi)}
                    </option>
                  ))}
                </select>
                <span className="text-sm font-semibold text-muted">分</span>
              </div>
            ) : null}
            {children}
          </div>

          <div className="mt-2 flex justify-end gap-2 border-t border-border pt-2">
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="rounded-md px-2 py-1 text-xs text-muted hover:bg-muted/40"
              >
                クリア
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover"
            >
              決定
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
