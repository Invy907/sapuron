'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 時刻の代わりに選べる「午前中」。値は "YYYY-MM-DDT午前中" */
export const MORNING_LABEL = '午前中'

type ParsedDateTime = {
  date: { y: number; m: number; d: number } | null
  hh: number
  mm: number
  morning: boolean
}

/** datetime-local 互換の "YYYY-MM-DDTHH:mm"（時刻省略も許容）。時刻の代わりに "T午前中" も受け付ける */
function parseValue(value: string): ParsedDateTime {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value)
  if (!m) return { date: null, hh: 0, mm: 0, morning: false }
  const y = Number.parseInt(m[1]!, 10)
  const mo = Number.parseInt(m[2]!, 10)
  const d = Number.parseInt(m[3]!, 10)
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { date: null, hh: 0, mm: 0, morning: false }
  return {
    date: { y, m: mo, d },
    hh: m[4] != null ? Number.parseInt(m[4], 10) : 0,
    mm: m[5] != null ? Number.parseInt(m[5], 10) : 0,
    morning: value.endsWith(`T${MORNING_LABEL}`),
  }
}

function toValue(y: number, m: number, d: number, hh: number, mm: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}`
}

function toMorningValue(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}T${MORNING_LABEL}`
}

function toIsoDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

function formatJa(value: string): string {
  const p = parseValue(value)
  if (!p.date) return ''
  const time = p.morning ? MORNING_LABEL : `${pad2(p.hh)}:${pad2(p.mm)}`
  return `${p.date.y}年${p.date.m}月${p.date.d}日 ${time}`
}

function formatPlainDateTime(value: string): string {
  const p = parseValue(value)
  if (p.date && p.morning) {
    return `${p.date.y}/${pad2(p.date.m)}/${pad2(p.date.d)} ${MORNING_LABEL}`
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return value
  return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}`
}

function monthLabelJa(year: number, month: number): string {
  return `${year}年${month}月`
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

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
}: {
  value: string
  onChange: (value: string) => void
  plain?: boolean
  labelPrefix?: string
}) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const today = useMemo(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }
  }, [])

  const parsed = parseValue(value)
  const initialView = parsed.date ?? today
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(initialView.y)
  const [viewMonth, setViewMonth] = useState(initialView.m)

  useEffect(() => {
    if (!open) return
    const p = parseValue(value)
    if (p.date) {
      setViewYear(p.date.y)
      setViewMonth(p.date.m)
    }
  }, [open, value])

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

  /** 日付セル選択: 既存の時刻（午前中を含む）を維持して確定 */
  function pickDate(iso: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    if (!m) return
    const y = Number.parseInt(m[1]!, 10)
    const mo = Number.parseInt(m[2]!, 10)
    const d = Number.parseInt(m[3]!, 10)
    const cur = parseValue(value)
    onChange(cur.morning ? toMorningValue(y, mo, d) : toValue(y, mo, d, cur.hh, cur.mm))
  }

  /** 午前中の切り替え。外すと時・分の選択に戻る。日付未選択なら今日を採用 */
  function toggleMorning() {
    const cur = parseValue(value)
    const base = cur.date ?? today
    onChange(
      cur.morning
        ? toValue(base.y, base.m, base.d, cur.hh, cur.mm)
        : toMorningValue(base.y, base.m, base.d),
    )
  }

  /** 時・分の変更: 午前中は外れる。日付未選択なら今日を採用 */
  function setTime(part: 'hh' | 'mm', n: number) {
    const cur = parseValue(value)
    const base = cur.date ?? today
    const hh = part === 'hh' ? n : cur.hh
    const mm = part === 'mm' ? n : cur.mm
    onChange(toValue(base.y, base.m, base.d, hh, mm))
  }

  const selectedIso = parsed.date
    ? toIsoDate(parsed.date.y, parsed.date.m, parsed.date.d)
    : ''
  const dateTimeValueText = value
    ? plain
      ? formatPlainDateTime(value)
      : formatJa(value)
    : plain
      ? '—'
      : '日時を選択'

  const ariaLabel = labelPrefix
    ? `${labelPrefix}${dateTimeValueText}`
    : dateTimeValueText

  return (
    <div ref={rootRef} className={plain ? 'relative' : 'relative mt-1'}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={plain && labelPrefix ? ariaLabel : undefined}
        onClick={() => setOpen((v) => !v)}
        className={
          plain
            ? PLAIN_TRIGGER_CLASS
            : 'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2 text-left text-sm font-medium text-foreground outline-none hover:border-primary/40 focus:border-primary print:border-transparent print:bg-transparent print:px-0'
        }
      >
        {plain && labelPrefix ? (
          <>
            <span>{labelPrefix}</span>
            <span
              className={
                value ? 'font-medium tabular-nums text-foreground' : 'text-muted/70'
              }
            >
              {dateTimeValueText}
            </span>
            <PlainCalendarIcon />
          </>
        ) : (
          <>
            <span className={value || plain ? 'text-inherit' : 'text-muted/70'}>
              {dateTimeValueText}
            </span>
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
            <span className="text-sm font-semibold text-foreground">
              {monthLabelJa(viewYear, viewMonth)}
            </span>
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
                  onClick={() => pickDate(cell.iso)}
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

          {/* 時刻選択 */}
          <div className="mt-3 flex items-center justify-center gap-2 border-t border-border pt-3">
            <span className="text-xs text-muted">時刻</span>
            <select
              aria-label="時"
              value={parsed.hh}
              onChange={(e) => setTime('hh', Number.parseInt(e.target.value, 10))}
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
              value={parsed.mm}
              onChange={(e) => setTime('mm', Number.parseInt(e.target.value, 10))}
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
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              aria-pressed={parsed.morning}
              onClick={toggleMorning}
              className={`rounded-md border px-3 py-1 text-xs font-medium ${
                parsed.morning
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-white text-foreground hover:bg-muted/40'
              }`}
            >
              {MORNING_LABEL}
            </button>
          </div>

          <div className="mt-2 flex justify-between gap-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => {
                const now = new Date()
                onChange(
                  toValue(
                    now.getFullYear(),
                    now.getMonth() + 1,
                    now.getDate(),
                    now.getHours(),
                    now.getMinutes(),
                  ),
                )
                setViewYear(now.getFullYear())
                setViewMonth(now.getMonth() + 1)
              }}
              className="rounded-md px-2 py-1 text-xs text-muted hover:bg-muted/40"
            >
              現在
            </button>
            <div className="flex gap-2">
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
        </div>
      )}
    </div>
  )
}
