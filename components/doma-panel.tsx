'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawingDomaDimension, DrawingDomaRun } from '@/lib/types/database'
import { DOMA_DIRECTION_COLORS } from '@/lib/doma-paint'
import {
  aggregateSchedule,
  countBars,
  DOMA_BAR_DIAMETERS,
  DOMA_BENDS_OPTIONS,
  domaDiameterOptionLabel,
  domaSettingsWithDiameter,
  layoutDomaRun,
  type DomaBarSettings,
  type DomaBends,
  type DomaRunLayout,
  type DomaRunWarning,
  type SlabBarDirection,
} from '@/lib/slab-rebar'

export type DomaTool = 'select' | 'dimension' | 'bar'

export type DomaSelection = { type: 'dimension' | 'bar'; id: string } | null

const DIRECTION_LABEL: Record<SlabBarDirection, string> = { tate: 'タテ', yoko: 'ヨコ' }

function parseMm(v: string): number {
  return Math.round(Number(v.replace(/,/g, '')))
}

function NumField({
  label,
  value,
  onChange,
  inputRef,
  onEnter,
  onBlur,
  hint,
}: {
  label: string
  /** 欄の下に出す短い説明 */
  hint?: string
  value: string
  onChange: (v: string) => void
  inputRef?: React.Ref<HTMLInputElement>
  onEnter?: () => void
  onBlur?: () => void
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-muted">
      {label}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
        className="w-full rounded border border-border px-2 py-1 text-xs text-foreground"
      />
      {hint ? <span className="text-[10px] leading-snug text-muted">{hint}</span> : null}
    </label>
  )
}

function SettingsFields({
  settings,
  onChange,
}: {
  settings: DomaBarSettings
  onChange: (next: DomaBarSettings) => void
}) {
  type Key = 'pitchMm' | 'bendMm' | 'stockMm' | 'lapMm'
  // 入力中の文字列だけを持つ。入力していない欄は常に保存済みの値を出すので、
  // 径を変えて重ねが変わったときなども欄に反映される
  const [draft, setDraft] = useState<Partial<Record<Key, string>>>({})
  const text = (key: Key) => draft[key] ?? String(settings[key])

  const commit = (key: Key, raw: string) => {
    setDraft((prev) => ({ ...prev, [key]: raw }))
    const n = parseMm(raw)
    if (!Number.isFinite(n) || n < 0) return
    if (key === 'pitchMm' && n <= 0) return
    onChange({ ...settings, [key]: n })
  }
  const endEdit = (key: Key) =>
    setDraft((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-0.5 text-[11px] text-muted">
        径
        <select
          value={settings.diameter}
          onChange={(e) => onChange(domaSettingsWithDiameter(e.target.value, settings))}
          className="rounded border border-border px-2 py-1 text-xs text-foreground"
        >
          {DOMA_BAR_DIAMETERS.map((d) => (
            <option key={d} value={d}>
              {domaDiameterOptionLabel(d)}
            </option>
          ))}
        </select>
      </label>
      <NumField
        label="ピッチ (mm)"
        value={text('pitchMm')}
        onChange={(v) => commit('pitchMm', v)}
        onBlur={() => endEdit('pitchMm')}
      />
      <NumField
        label="端部曲げ (mm)"
        value={text('bendMm')}
        onChange={(v) => commit('bendMm', v)}
        onBlur={() => endEdit('bendMm')}
      />
      <NumField
        label="重ね (mm)"
        value={text('lapMm')}
        onChange={(v) => commit('lapMm', v)}
        onBlur={() => endEdit('lapMm')}
      />
      <NumField
        label="定尺 (mm)"
        value={text('stockMm')}
        onChange={(v) => commit('stockMm', v)}
        onBlur={() => endEdit('stockMm')}
      />
    </div>
  )
}

function layoutOf(run: DrawingDomaRun): DomaRunLayout {
  return layoutDomaRun(run.length_mm, run.span_mm, run.bends, run.settings, run.pieces_override)
}

/**
 * 集計。付加筋タブの要約と同じ形（方向ごとの本数の札 + 径・形・長さごとの行）。
 * 別の土間筋から同じ長さが出たら 1 行に合算する。
 */
function DomaSummary({ bars }: { bars: DrawingDomaRun[] }) {
  const layouts = useMemo(() => bars.map((b) => ({ bar: b, layout: layoutOf(b) })), [bars])
  const schedule = useMemo(
    () => aggregateSchedule(layouts.map(({ bar, layout }) => ({ diameter: bar.settings.diameter, runs: [layout] }))),
    [layouts],
  )
  const piecesByDirection = (direction: SlabBarDirection) =>
    layouts
      .filter(({ bar }) => bar.direction === direction)
      .reduce((sum, { layout }) => sum + layout.pieces.length * layout.count, 0)

  return (
    <div className="space-y-2 border-t border-border px-4 py-3">
      <div className="flex flex-wrap gap-1">
        {(['tate', 'yoko'] as const).map((d) => {
          const count = piecesByDirection(d)
          return (
            <span
              key={d}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                count > 0 ? 'bg-primary/10 text-foreground' : 'bg-gray-100 text-muted'
              }`}
            >
              {DIRECTION_LABEL[d]}筋 <span className="font-semibold">{count}</span>
            </span>
          )
        })}
      </div>
      <div className="space-y-0.5 border-t border-border pt-1.5">
        {schedule.map((row) => (
          <div
            key={`${row.diameter}-${row.kind}-${row.lengthMm}`}
            className="flex items-center justify-between gap-2 text-[10px] text-muted"
          >
            <span className="tabular-nums">
              {row.diameter} {row.kind === 'BENT' ? '曲' : '直'} {row.lengthMm.toLocaleString()}
            </span>
            <span className="shrink-0 tabular-nums text-foreground">{row.quantity} 本</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const WARNING_LABEL: Record<DomaRunWarning, string> = {
  LAP_TOO_SHORT: '直線部が重ねより短い加工本があり、継手の重ねが取れません',
  MANUAL_SUM_MISMATCH: '手入力の合計が L＋端部曲げ＋重ね と合いません',
  VALUE_TOO_LARGE: '設置長さ・配筋範囲が 50,000 を超えています。入力を確認してください',
}

function Warnings({ warnings }: { warnings: DomaRunWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <ul className="space-y-0.5 text-[11px] text-amber-800">
      {warnings.map((w) => (
        <li key={w}>⚠ {WARNING_LABEL[w]}</li>
      ))}
    </ul>
  )
}

/** 「6000 + 1270（重ね 600）」 */
function piecesSummary(layout: DomaRunLayout): string {
  const pieces = layout.pieces.map((p) => p.lengthMm).join(' + ')
  const laps = layout.laps.length > 0 ? `（重ね ${Math.round(layout.laps[0]!.mm)}${layout.laps.length > 1 ? ` × ${layout.laps.length}` : ''}）` : ''
  return `${pieces}${laps}`
}

/**
 * 選択中の寸法線。入力した値はそのまま保存する（0 以下・空欄は保存しない）。
 * 入力中の文字列はフォーカスを外すまで持ち、外したら保存済みの値の表示に戻す。
 */
function DimensionEditor({
  dim,
  onUpdate,
}: {
  dim: DrawingDomaDimension
  onUpdate: (mm: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <NumField
      label="寸法 (mm)"
      value={draft ?? String(dim.length_mm)}
      onChange={(v) => {
        setDraft(v)
        const mm = parseMm(v)
        if (mm > 0 && mm !== dim.length_mm) onUpdate(mm)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

/** 寸法線 1 本（値だけでなく、どの寸法線かも覚える） */
export type DomaDimensionChoice = { id: string; mm: number }

/** 寸法線の値ボタン。図面上の候補（描いた線に合う寸法線）は先頭に強調して出す */
function DimensionChips({
  choices,
  candidates = [],
  source,
  onPick,
}: {
  choices: DomaDimensionChoice[]
  candidates?: DomaDimensionChoice[]
  /** 今の値が寸法線から来たものか手入力か（選択中の編集だけ） */
  source?: 'dimension' | 'manual'
  onPick: (choice: DomaDimensionChoice) => void
}) {
  const candidateMm = new Set(candidates.map((c) => c.mm))
  const others = choices.filter((c) => !candidateMm.has(c.mm))
  if (candidates.length === 0 && others.length === 0 && !source) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {source ? (
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            source === 'dimension' ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-800'
          }`}
          title={source === 'dimension' ? '寸法線の値を使っています（図面で強調）' : '寸法線と結びついていない値です'}
        >
          {source === 'dimension' ? '寸法線' : '手入力'}
        </span>
      ) : null}
      {candidates.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c)}
          aria-label={`${c.mm}（描いた線に合う寸法線）`}
          title="描いた線に合う寸法線（図面で強調）"
          className="rounded border border-primary/50 bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary hover:bg-primary/20"
        >
          {c.mm}
        </button>
      ))}
      {others.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c)}
          className="rounded border border-border bg-gray-50 px-1.5 py-0.5 text-[11px] tabular-nums hover:bg-gray-100"
        >
          {c.mm}
        </button>
      ))}
    </div>
  )
}

function BendsToggle({ value, onChange }: { value: DomaBends; onChange: (next: DomaBends) => void }) {
  return (
    <div className="flex flex-col gap-0.5 text-[11px] text-muted">
      端部曲げ
      <div className="inline-flex rounded-md border border-border bg-white p-0.5 text-xs">
        {DOMA_BENDS_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={value === opt.id}
            className={`flex-1 rounded px-2 py-0.5 font-medium ${
              value === opt.id ? 'bg-slate-700 text-white' : 'text-muted hover:bg-gray-100'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 設置長さ L・配筋範囲・端部曲げ。入力窓と選択中の編集で共通 */
function RunFields({
  length,
  span,
  bends,
  pitchMm,
  dimensionChoices,
  lengthCandidates,
  spanCandidates,
  lengthSource,
  spanSource,
  onLength,
  onSpan,
  onBends,
  onLengthBlur,
  onSpanBlur,
  lengthInputRef,
  onEnter,
  showHints = false,
}: {
  /** 入力窓だけで、欄の下に L と配筋範囲の違いを短く出す */
  showHints?: boolean
  length: string
  span: string
  bends: DomaBends
  pitchMm: number
  dimensionChoices: DomaDimensionChoice[]
  lengthCandidates?: DomaDimensionChoice[]
  spanCandidates?: DomaDimensionChoice[]
  lengthSource?: 'dimension' | 'manual'
  spanSource?: 'dimension' | 'manual'
  /** 寸法線のボタンから選んだときは dimId も渡す（手で打ったときは undefined） */
  onLength: (v: string, dimId?: string) => void
  onSpan: (v: string, dimId?: string) => void
  onBends: (next: DomaBends) => void
  onLengthBlur?: () => void
  onSpanBlur?: () => void
  lengthInputRef?: React.Ref<HTMLInputElement>
  onEnter?: () => void
}) {
  const spanMm = parseMm(span)
  const count = spanMm > 0 && pitchMm > 0 ? countBars(spanMm, pitchMm) : null
  return (
    <>
      <NumField
        label="設置長さ L（鉄筋方向の長さ, mm）"
        hint={showHints ? '鉄筋が伸びる向きの長さ。加工本の分け方が決まります' : undefined}
        value={length}
        onChange={(v) => onLength(v)}
        inputRef={lengthInputRef}
        onEnter={onEnter}
        onBlur={onLengthBlur}
      />
      <DimensionChips
        choices={dimensionChoices}
        candidates={lengthCandidates}
        source={lengthSource}
        onPick={(c) => onLength(String(c.mm), c.id)}
      />
      <NumField
        label="配筋範囲（鉄筋と直角の幅, mm）"
        hint={showHints ? 'この鉄筋を何本並べるかを決める幅' : undefined}
        value={span}
        onChange={(v) => onSpan(v)}
        onEnter={onEnter}
        onBlur={onSpanBlur}
      />
      <DimensionChips
        choices={dimensionChoices}
        candidates={spanCandidates}
        source={spanSource}
        onPick={(c) => onSpan(String(c.mm), c.id)}
      />
      {count != null ? (
        <p className="text-[11px] tabular-nums text-muted">
          本数 {count}本（{spanMm.toLocaleString()} ÷ {pitchMm} = {(spanMm / pitchMm).toFixed(2)} → 切り上げ）
        </p>
      ) : null}
      <BendsToggle value={bends} onChange={onBends} />
    </>
  )
}

/**
 * 加工本の長さ。自動の結果を出し、書き換えると手入力（pieces_override）になる。
 * 合計の検算を下に出し、合わなければ警告（自動では直さない）。
 */
function PiecesEditor({
  run,
  layout,
  onOverride,
}: {
  run: DrawingDomaRun
  layout: DomaRunLayout
  onOverride: (lengths: number[] | null) => void
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const lengths = layout.pieces.map((p) => p.lengthMm)
  const sum = lengths.reduce((a, b) => a + b, 0)
  const bendCount = run.bends === 'both' ? 2 : run.bends === 'none' ? 0 : 1

  const change = (index: number, raw: string) => {
    setDrafts((prev) => ({ ...prev, [index]: raw }))
    const mm = parseMm(raw)
    if (!(mm > 0)) return
    onOverride(lengths.map((v, i) => (i === index ? mm : v)))
  }
  const endEdit = (index: number) =>
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[index]
      return next
    })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground">加工本</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            layout.source === 'manual' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-muted'
          }`}
        >
          {layout.source === 'manual' ? '手入力' : '自動'}
        </span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {layout.pieces.map((p) => (
            <tr
              key={p.index}
              className={`border-t border-border first:border-t-0 ${p.lapShort ? 'bg-amber-50' : ''}`}
              title={p.lapShort ? '直線部が重ねより短く、継手の重ねが取れません' : undefined}
            >
              <td className="w-6 py-0.5 text-muted">{p.index + 1}</td>
              <td className="w-6 py-0.5">
                {p.kind === 'BENT' ? '曲' : '直'}
                {p.lapShort ? <span className="ml-0.5 text-amber-700">⚠</span> : null}
              </td>
              <td className="py-0.5">
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`${p.index + 1} 本目の長さ`}
                  value={drafts[p.index] ?? String(p.lengthMm)}
                  onChange={(e) => change(p.index, e.target.value)}
                  onBlur={() => endEdit(p.index)}
                  className="w-full rounded border border-border px-2 py-0.5 text-right text-xs tabular-nums"
                />
              </td>
              <td className="w-6 py-0.5 text-right">
                {layout.pieces.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => onOverride(lengths.filter((_, i) => i !== p.index))}
                    className="text-[11px] text-muted hover:text-danger"
                    aria-label={`${p.index + 1} 本目を削除`}
                  >
                    ×
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between text-[11px]">
        <button
          type="button"
          onClick={() => onOverride([...lengths, run.settings.stockMm])}
          className="text-primary hover:underline"
        >
          ＋ 本を追加
        </button>
        {layout.source === 'manual' ? (
          <button type="button" onClick={() => onOverride(null)} className="text-primary hover:underline">
            自動に戻す
          </button>
        ) : null}
      </div>
      <p className="text-[11px] tabular-nums text-muted">
        検算 {lengths.join(' + ')} = {sum.toLocaleString()}
        {' / '}L {run.length_mm.toLocaleString()} + 曲げ {run.settings.bendMm}×{bendCount} + 重ね{' '}
        {run.settings.lapMm}×{Math.max(lengths.length - 1, 0)} = {layout.requiredTotalMm.toLocaleString()}{' '}
        {sum === layout.requiredTotalMm ? '✓' : '⚠'}
      </p>
    </div>
  )
}

/**
 * 選択中の土間筋（設置区間 1 セット）。どの欄も入力したらそのまま保存する。
 * 保存は常に今の値に差分を重ねた全体を渡す。
 */
function RunEditor({
  run,
  dimensions,
  onUpdate,
}: {
  run: DrawingDomaRun
  dimensions: DrawingDomaDimension[]
  onUpdate: (patch: RunPatch) => void
}) {
  // 寸法線と結びついていて値も同じなら「寸法線」、それ以外は「手入力」
  const sourceOf = (dimId: string | null, mm: number): 'dimension' | 'manual' =>
    dimId != null && dimensions.find((d) => d.id === dimId)?.length_mm === mm ? 'dimension' : 'manual'
  const [lengthDraft, setLengthDraft] = useState<string | null>(null)
  const [spanDraft, setSpanDraft] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const layout = layoutOf(run)

  const commit = (patch: Partial<RunPatch>) =>
    onUpdate({
      length_mm: run.length_mm,
      span_mm: run.span_mm,
      bends: run.bends,
      settings: run.settings,
      pieces_override: run.pieces_override,
      length_dim_id: run.length_dim_id,
      span_dim_id: run.span_dim_id,
      ...patch,
    })

  return (
    <div className="flex flex-col gap-2">
      <RunFields
        length={lengthDraft ?? String(run.length_mm)}
        span={spanDraft ?? String(run.span_mm)}
        bends={run.bends}
        pitchMm={run.settings.pitchMm}
        dimensionChoices={domaDimensionChoices(dimensions)}
        lengthSource={sourceOf(run.length_dim_id, run.length_mm)}
        spanSource={sourceOf(run.span_dim_id, run.span_mm)}
        onLength={(v, dimId) => {
          setLengthDraft(dimId ? null : v)
          const mm = parseMm(v)
          if (mm > 0) commit({ length_mm: mm, ...(dimId ? { length_dim_id: dimId } : {}) })
        }}
        onSpan={(v, dimId) => {
          setSpanDraft(dimId ? null : v)
          const mm = parseMm(v)
          if (mm > 0) commit({ span_mm: mm, ...(dimId ? { span_dim_id: dimId } : {}) })
        }}
        onBends={(bends) => commit({ bends })}
        onLengthBlur={() => setLengthDraft(null)}
        onSpanBlur={() => setSpanDraft(null)}
      />
      <div className="rounded-md border border-border bg-white p-2">
        <PiecesEditor run={run} layout={layout} onOverride={(lengths) => commit({ pieces_override: lengths })} />
      </div>
      <p className="text-[11px] tabular-nums text-foreground">
        製作数量{' '}
        {layout.pieces
          .map((p) => `${p.lengthMm.toLocaleString()} × ${layout.count}本`)
          .join(' ＋ ')}
      </p>
      <Warnings warnings={layout.warnings} />
      <div>
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="text-[11px] text-muted hover:text-foreground"
          aria-expanded={settingsOpen}
        >
          {settingsOpen ? '▾' : '▸'} 条件（{run.settings.diameter} / ピッチ {run.settings.pitchMm} / 曲げ{' '}
          {run.settings.bendMm} / 重ね {run.settings.lapMm} / 定尺 {run.settings.stockMm}）
        </button>
        {settingsOpen ? (
          <div className="mt-2">
            <SettingsFields settings={run.settings} onChange={(settings) => commit({ settings })} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

type RunPatch = Pick<
  DrawingDomaRun,
  'length_mm' | 'span_mm' | 'bends' | 'settings' | 'pieces_override' | 'length_dim_id' | 'span_dim_id'
>

export type DomaInputModalState =
  | { type: 'dimension'; line: { x1: number; y1: number; x2: number; y2: number }; estimateMm: number | null }
  | {
      type: 'bar'
      direction: SlabBarDirection
      line: { x1: number; y1: number; x2: number; y2: number }
      /** 描いた線に合う寸法線（L: 同じ向きで両端がそろう／配筋範囲: 直交して位置を含む、全体寸法は除く） */
      lengthCandidates: DomaDimensionChoice[]
      spanCandidates: DomaDimensionChoice[]
      /** 候補が 1 つの値に決まったときだけ入れておく */
      defaultLength: DomaDimensionChoice | null
      defaultSpan: DomaDimensionChoice | null
    }

/** 入力窓で確定した値。寸法線のボタンで選び、その値のままなら dimId が入る */
export type DomaRunInput = {
  lengthMm: number
  lengthDimId: string | null
  bends: DomaBends
  spanMm: number
  spanDimId: string | null
}

export function DomaInputModal({
  state,
  settings,
  defaultBends,
  dimensionChoices,
  onCancel,
  onConfirmDimension,
  onConfirmBar,
}: {
  state: DomaInputModalState
  settings: DomaBarSettings
  /** 右パネルの条件で選んでいる端部曲げ */
  defaultBends: DomaBends
  dimensionChoices: DomaDimensionChoice[]
  onCancel: () => void
  onConfirmDimension: (mm: number) => void
  onConfirmBar: (values: DomaRunInput) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [bends, setBends] = useState<DomaBends>(defaultBends)
  const [value, setValue] = useState(() => {
    if (state.type === 'dimension') return state.estimateMm != null ? String(state.estimateMm) : ''
    return state.defaultLength ? String(state.defaultLength.mm) : ''
  })
  const [span, setSpan] = useState(state.type === 'bar' && state.defaultSpan ? String(state.defaultSpan.mm) : '')
  /** 寸法線のボタンで選んだもの。値を打ち替えたら結びつきは確定時に外す */
  const [lengthChoice, setLengthChoice] = useState<DomaDimensionChoice | null>(
    state.type === 'bar' ? state.defaultLength : null,
  )
  const [spanChoice, setSpanChoice] = useState<DomaDimensionChoice | null>(
    state.type === 'bar' ? state.defaultSpan : null,
  )
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const valueMm = parseMm(value)
  const spanMm = parseMm(span)

  const confirm = () => {
    if (state.type === 'dimension') {
      if (valueMm > 0) onConfirmDimension(valueMm)
      return
    }
    if (valueMm > 0 && spanMm > 0) {
      onConfirmBar({
        lengthMm: valueMm,
        lengthDimId: lengthChoice?.mm === valueMm ? lengthChoice.id : null,
        bends,
        spanMm,
        spanDimId: spanChoice?.mm === spanMm ? spanChoice.id : null,
      })
    }
  }

  const preview =
    state.type === 'bar' && valueMm > 0 && spanMm > 0
      ? layoutDomaRun(valueMm, spanMm, bends, settings)
      : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onCancel}>
      <div
        className="w-80 rounded-lg bg-white p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      >
        <h3 className="mb-3 text-sm font-semibold">
          {state.type === 'dimension'
            ? '寸法を入力'
            : `土間筋（${DIRECTION_LABEL[state.direction]}）を入力`}
        </h3>
        <div className="flex flex-col gap-2">
          {state.type === 'dimension' ? (
            <NumField label="寸法 (mm)" value={value} onChange={setValue} inputRef={inputRef} onEnter={confirm} />
          ) : (
            <>
              <RunFields
                length={value}
                span={span}
                bends={bends}
                pitchMm={settings.pitchMm}
                dimensionChoices={dimensionChoices}
                lengthCandidates={state.lengthCandidates}
                spanCandidates={state.spanCandidates}
                onLength={(v, dimId) => {
                  setValue(v)
                  if (dimId) setLengthChoice({ id: dimId, mm: parseMm(v) })
                }}
                onSpan={(v, dimId) => {
                  setSpan(v)
                  if (dimId) setSpanChoice({ id: dimId, mm: parseMm(v) })
                }}
                onBends={setBends}
                lengthInputRef={inputRef}
                onEnter={confirm}
                showHints
              />
              {/* 径・ピッチなどは右パネルの「条件」で決める。ここでは何で計算するかだけ見せる */}
              <p className="text-[11px] tabular-nums text-muted">
                条件 {settings.diameter} / ピッチ {settings.pitchMm} / 曲げ {settings.bendMm} / 重ね{' '}
                {settings.lapMm} / 定尺 {settings.stockMm}（右パネルの「条件」で変更）
              </p>
              {preview ? (
                <div className="rounded-md bg-gray-50 px-2 py-1.5 text-[11px]">
                  <div className="font-semibold tabular-nums">加工本 {piecesSummary(preview)}</div>
                  <div className="tabular-nums">
                    {settings.diameter} @{settings.pitchMm} × {preview.count}本
                  </div>
                  <div className="mt-1">
                    <Warnings warnings={preview.warnings} />
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={state.type === 'dimension' ? !(valueMm > 0) : !preview}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

export function DomaPanel({
  kind,
  direction,
  tool,
  settings,
  dimensions,
  bars,
  selection,
  onSettingsChange,
  onSelect,
  onUpdateDimension,
  onUpdateBar,
  onDeleteDimension,
  onDeleteBar,
  viewRotationSteps = 0,
  bends,
  onBendsChange,
  canUndo,
  onUndo,
}: {
  /** これから描く土間筋の端部曲げ（条件の一部） */
  bends: DomaBends
  onBendsChange: (next: DomaBends) => void
  /** 直前に作った土間筋を取り消せるとき true */
  canUndo?: boolean
  onUndo?: () => void
  /** 図面の表示回転。寸法線の「横／縦」を画面で見た向きで出すため */
  viewRotationSteps?: number
  kind: 'standard' | 'special'
  direction: SlabBarDirection
  tool: DomaTool
  settings: DomaBarSettings
  dimensions: DrawingDomaDimension[]
  /** 描いた土間筋（設置区間 1 つ = 1 セット） */
  bars: DrawingDomaRun[]
  selection: DomaSelection
  onSettingsChange: (next: DomaBarSettings) => void
  onSelect: (sel: DomaSelection) => void
  onUpdateDimension: (id: string, mm: number) => void
  onUpdateBar: (id: string, patch: RunPatch) => void
  onDeleteDimension: (id: string) => void
  onDeleteBar: (id: string) => void
}) {
  const directionBars = bars.filter((b) => b.direction === direction)
  const selectedDim =
    selection?.type === 'dimension' ? dimensions.find((d) => d.id === selection.id) ?? null : null
  const selectedBar = selection?.type === 'bar' ? bars.find((b) => b.id === selection.id) ?? null : null
  const dirLabel = DIRECTION_LABEL[direction]
  /** 一覧と同じ「タテ1」「タテ2」…の番号 */
  const selectedBarTitle = selectedBar
    ? `${DIRECTION_LABEL[selectedBar.direction]}筋 ${
        bars.filter((b) => b.direction === selectedBar.direction).indexOf(selectedBar) + 1
      }`
    : ''

  return (
    <div className="w-72 shrink-0 flex flex-col rounded-lg border border-border bg-white overflow-hidden">
      {/* 見出しは付加筋一覧と同じ形 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">
            {tool === 'dimension' ? `寸法線一覧 (${dimensions.length})` : `土間筋一覧 (${bars.length})`}
          </h3>
          {onUndo ? (
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="text-[11px] text-muted hover:text-foreground disabled:opacity-40"
            >
              元に戻す
            </button>
          ) : null}
        </div>
        <span className="text-[11px] text-muted">{kind === 'standard' ? `標準・${dirLabel}` : '特殊'}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {kind === 'special' ? (
          <p className="px-4 py-6 text-center text-xs text-muted">特殊は準備中です。</p>
        ) : selectedDim || selectedBar ? (
          // 選択中は、その寸法線・土間筋の値だけを出す。閉じる・削除の位置はユニット／付加筋と揃える
          <section className="space-y-3 border-b border-border bg-blue-50/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-primary">
                {selectedDim ? '寸法線' : selectedBarTitle}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className="text-[11px] text-muted transition-colors hover:text-foreground"
                >
                  閉じる
                </button>
                <button
                  type="button"
                  onClick={() =>
                    selectedDim ? onDeleteDimension(selectedDim.id) : selectedBar && onDeleteBar(selectedBar.id)
                  }
                  className="text-xs text-danger hover:underline"
                >
                  削除
                </button>
              </div>
            </div>
            {/* key は id だけ。値で key を変えると入力のたびに欄が作り直されてフォーカスが外れる */}
            {selectedDim ? (
              <DimensionEditor
                key={selectedDim.id}
                dim={selectedDim}
                onUpdate={(mm) => onUpdateDimension(selectedDim.id, mm)}
              />
            ) : selectedBar ? (
              <RunEditor
                key={selectedBar.id}
                run={selectedBar}
                dimensions={dimensions}
                onUpdate={(patch) => onUpdateBar(selectedBar.id, patch)}
              />
            ) : null}
          </section>
        ) : (
          <>
            {/* 描く条件は、付加筋の配置設定と同じく描くツールを選んでいるときだけ出す */}
            {tool === 'bar' ? (
              <section className="space-y-2 border-b border-border p-3">
                <span className="text-[10px] font-medium text-foreground">{dirLabel}筋の条件</span>
                <SettingsFields key={direction} settings={settings} onChange={onSettingsChange} />
                <BendsToggle value={bends} onChange={onBendsChange} />
              </section>
            ) : null}

            {tool === 'dimension' ? (
              // 寸法線を引いている間は、どの寸法がもう入っているかを見せる
              dimensions.length === 0 ? (
                <p className="px-4 py-3 text-[11px] leading-relaxed text-muted">まだ寸法線がありません。</p>
              ) : (
                <ul className="space-y-0.5 px-4 py-3">
                  {dimensions.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => onSelect({ type: 'dimension', id: d.id })}
                        className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left hover:bg-gray-50"
                      >
                        <span className="text-[11px] text-muted">
                          {(Math.abs(d.x2 - d.x1) >= Math.abs(d.y2 - d.y1)) === (viewRotationSteps % 2 === 0)
                            ? '横'
                            : '縦'}
                        </span>
                        <span className="font-mono text-[13px] font-semibold text-foreground">
                          {d.length_mm.toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : directionBars.length === 0 ? (
              <p className="px-4 py-3 text-[11px] leading-relaxed text-muted">まだ配置されていません。</p>
            ) : (
              <ul className="space-y-1 px-4 py-3">
                {directionBars.map((b, i) => {
                  const layout = layoutOf(b)
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => onSelect({ type: 'bar', id: b.id })}
                        className="w-full rounded px-1 py-0.5 text-left hover:bg-gray-50"
                      >
                        <span className="flex items-center justify-between text-[11px] font-semibold text-muted">
                          <span>
                            {dirLabel}
                            {i + 1}
                            <span className="ml-1.5 font-normal tabular-nums">L {b.length_mm.toLocaleString()}</span>
                          </span>
                          {layout.warnings.length > 0 ? <span className="text-amber-700">⚠</span> : null}
                        </span>
                        {/* 加工本ごとに 1 行。下の集計と同じく曲／直を前に付ける */}
                        {layout.pieces.map((p) => (
                          <span
                            key={p.index}
                            className="block font-mono text-[13px] font-semibold"
                            style={{ color: DOMA_DIRECTION_COLORS[b.direction] }}
                          >
                            <span className="mr-1.5 font-sans text-[11px] font-medium">
                              {p.kind === 'BENT' ? '曲' : '直'}
                            </span>
                            {p.lengthMm.toLocaleString()} × {layout.count}
                          </span>
                        ))}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {tool !== 'dimension' && bars.length > 0 ? <DomaSummary bars={bars} /> : null}
          </>
        )}
      </div>
    </div>
  )
}

/** 値ボタン用の寸法線（同じ値は 1 つにまとめ、大きい順） */
export function domaDimensionChoices(dimensions: DrawingDomaDimension[]): DomaDimensionChoice[] {
  const byMm = new Map<number, DomaDimensionChoice>()
  for (const d of dimensions) if (!byMm.has(d.length_mm)) byMm.set(d.length_mm, { id: d.id, mm: d.length_mm })
  return [...byMm.values()].sort((a, b) => b.mm - a.mm)
}
