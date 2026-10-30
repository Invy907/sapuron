'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawingDomaDimension, DrawingDomaRun } from '@/lib/types/database'
import { DOMA_DIRECTION_COLORS } from '@/lib/doma-paint'
import {
  DEFAULT_DOMA_ZONE_WALLS,
  DOMA_ZONE_COLOR,
  DOMA_ZONE_SIDE_LABEL,
  domaZoneEdgeAtScreenSide,
  domaZoneExtendMm,
  domaZoneHasDirection,
  domaZoneRunValues,
  domaRunZoneCuts,
  domaZoneRuns,
  domaZoneSpecOf,
  expandDomaRuns,
  splitDomaRunByZones,
  type DomaZoneEdge,
  type DomaZoneSpec,
} from '@/lib/doma-zone'
import {
  aggregateSchedule,
  countBars,
  DOMA_BAR_DIAMETERS,
  DOMA_STOCK_CANDIDATES_MM,
  DOMA_BENDS_OPTIONS,
  domaDiameterOptionLabel,
  domaSettingsWithDiameter,
  layoutDomaRun,
  rebalanceDomaPieces,
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
  // 日本語入力がオンだと「４０００」「４，０００」のように全角で入るので、半角に直してから読む
  const halfWidth = v.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  return Math.round(Number(halfWidth.replace(/[,，、\s]/g, '')))
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
  type Key = 'pitchMm' | 'bendMm'
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
    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
      <label className="col-span-2 flex flex-col gap-1 text-[11px] text-muted">
        鉄筋種類（重ね mm）
        <select
          value={settings.diameter}
          onChange={(e) => onChange(domaSettingsWithDiameter(e.target.value, settings))}
          className="h-8 w-full rounded border border-border bg-white px-2 text-xs text-foreground"
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

    </div>
  )
}

function layoutOf(run: DrawingDomaRun): DomaRunLayout {
  return layoutDomaRun(run.length_mm, run.span_mm, run.bends, run.settings, run.pieces_override)
}

/**
 * 集計の数値。方向ごとの加工本数と、径・形・長さごとの行（別の土間筋から同じ長さが出たら 1 行に合算）。
 * 特殊の範囲はタテ・ヨコに展開して数える。右パネルの集計と図面の印刷で同じ数値を使う
 */
export function domaSummaryOf(bars: DrawingDomaRun[], dims: DrawingDomaDimension[] = []) {
  const layouts = expandDomaRuns(bars, dims).map((b) => ({ bar: b, layout: layoutOf(b) }))
  const schedule = aggregateSchedule(
    layouts.map(({ bar, layout }) => ({ diameter: bar.settings.diameter, runs: [layout] })),
  )
  const piecesByDirection = (direction: SlabBarDirection) =>
    layouts
      .filter(({ bar }) => bar.direction === direction)
      .reduce((sum, { layout }) => sum + layout.pieces.length * layout.count, 0)
  return {
    counts: { tate: piecesByDirection('tate'), yoko: piecesByDirection('yoko') },
    schedule,
  }
}

export const DOMA_DIRECTION_LABEL = DIRECTION_LABEL

/**
 * 集計。付加筋タブの要約と同じ形（方向ごとの本数の札 + 径・形・長さごとの行）。
 */
function DomaSummary({
  bars,
  dimensions,
  onGoToSummary,
}: {
  bars: DrawingDomaRun[]
  dimensions: DrawingDomaDimension[]
  /** 結果ページへ（付加筋の「結果ページを見る」と同じ） */
  onGoToSummary?: () => void
}) {
  const { counts, schedule } = useMemo(() => domaSummaryOf(bars, dimensions), [bars, dimensions])

  return (
    <div className="space-y-2 border-t border-border px-4 py-3">
      {onGoToSummary ? (
        <button
          type="button"
          onClick={onGoToSummary}
          className="block w-full rounded-md bg-primary px-2 py-1.5 text-center text-[11px] font-medium text-white hover:bg-primary-hover"
        >
          結果ページを見る
        </button>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {(['tate', 'yoko'] as const).map((d) => {
          const count = counts[d]
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
  showDimensionChoices = true,
}: {
  /** 入力窓だけで、欄の下に L と配筋範囲の違いを短く出す */
  showHints?: boolean
  showDimensionChoices?: boolean
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
      {showDimensionChoices ? <DimensionChips
        choices={dimensionChoices}
        candidates={lengthCandidates}
        source={lengthSource}
        onPick={(c) => onLength(String(c.mm), c.id)}
      /> : null}
      <NumField
        label="配筋範囲（鉄筋と直角の幅, mm）"
        hint={showHints ? 'この鉄筋を何本並べるかを決める幅' : undefined}
        value={span}
        onChange={(v) => onSpan(v)}
        onEnter={onEnter}
        onBlur={onSpanBlur}
      />
      {showDimensionChoices ? <DimensionChips
        choices={dimensionChoices}
        candidates={spanCandidates}
        source={spanSource}
        onPick={(c) => onSpan(String(c.mm), c.id)}
      /> : null}
      {count != null ? (
        <p className="text-[11px] tabular-nums text-muted">
          本数 {count}本（{spanMm.toLocaleString()} ÷ {pitchMm} = {(spanMm / pitchMm).toFixed(2)} → 切り上げ）
        </p>
      ) : null}
      <details className="text-[11px] text-muted">
        <summary className="cursor-pointer">端部曲げの変更（{DOMA_BENDS_OPTIONS.find((o) => o.id === bends)?.label}）</summary>
        <div className="mt-2"><BendsToggle value={bends} onChange={onBends} /></div>
      </details>
    </>
  )
}

/**
 * 加工本の長さ。1本を確定すると残りを調整し、総加工長を維持する。
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
  const [editError, setEditError] = useState<string | null>(null)
  const apply = (index: number, raw: string) => {
    const mm = parseMm(raw)
    if (!Number.isFinite(mm)) {
      setEditError('長さは数字で入力してください。')
      return
    }
    const next = rebalanceDomaPieces(layout, index, mm, run.settings.bendMm, run.settings.lapMm)
    if (next) {
      setEditError(null)
      onOverride(next)
    } else {
      setEditError('重ね・定尺6,000mm・2本の長さの差1,000mm以上を満たす長さを選んでください。')
    }
  }
  const endEdit = (index: number) => {
    if (drafts[index] != null) apply(index, drafts[index])
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground">加工長さ (mm)</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            layout.source === 'manual' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-muted'
          }`}
        >
          {layout.source === 'manual' ? '調整済み' : '自動選択'}
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
              <td className="py-1.5">
                <select
                  aria-label={`${p.index + 1} 本目の定尺候補`}
                  value=""
                  onChange={(e) => apply(p.index, e.target.value)}
                  className="mb-1 w-full rounded border border-border bg-white px-2 py-1 text-xs"
                >
                  <option value="">定尺を選択</option>
                  {DOMA_STOCK_CANDIDATES_MM.map((mm) => <option key={mm} value={mm}>{mm.toLocaleString()} mm</option>)}
                </select>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`${p.index + 1} 本目の長さ`}
                  value={drafts[p.index] ?? String(p.lengthMm)}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [p.index]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
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
          onClick={() => onOverride([...lengths, DOMA_STOCK_CANDIDATES_MM[0]])}
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
      <p className="text-[11px] text-muted">長さを変更すると、他の本の長さを自動調整します。</p>
      {editError ? <p role="alert" className="text-[11px] text-amber-700">{editError}</p> : null}
      <details className="text-[11px] tabular-nums text-muted">
        <summary className="cursor-pointer">加工合計 {sum.toLocaleString()} mm {sum === layout.requiredTotalMm ? '✓' : '⚠'}</summary>
        <p className="mt-1">{lengths.join(' + ')} / 必要長さ {layout.requiredTotalMm.toLocaleString()} mm</p>
      </details>
    </div>
  )
}

/**
 * 選択中の土間筋（設置区間 1 セット）。どの欄も入力したらそのまま保存する。
 * 保存は常に今の値に差分を重ねた全体を渡す。
 */
function RunEditor({
  run,
  runs,
  dimensions,
  onUpdate,
}: {
  run: DrawingDomaRun
  /** 図面の土間筋すべて（区域で切る本を出すため） */
  runs: DrawingDomaRun[]
  dimensions: DrawingDomaDimension[]
  onUpdate: (patch: RunPatch) => void
}) {
  // 寸法線と結びついていて値も同じなら「寸法線」、それ以外は「手入力」
  const sourceOf = (dimId: string | null, mm: number): 'dimension' | 'manual' =>
    dimId != null && dimensions.find((d) => d.id === dimId)?.length_mm === mm ? 'dimension' : 'manual'
  const [lengthDraft, setLengthDraft] = useState<string | null>(null)
  const [spanDraft, setSpanDraft] = useState<string | null>(null)
  const layout = layoutOf(run)
  const cuts = domaRunZoneCuts(run, runs, dimensions)
  const rows = splitDomaRunByZones(run, runs, dimensions)
  const zones = runs.filter((r) => r.kind === 'special')

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
      <section className="rounded-md border border-border bg-white p-3">
        <p className="mb-2 text-xs font-medium text-foreground">配筋条件</p>
        <SettingsFields
          settings={run.settings}
          onChange={(settings) => {
            const geometryChanged = settings.bendMm !== run.settings.bendMm || settings.lapMm !== run.settings.lapMm
            let pieces = run.pieces_override
            if (geometryChanged && pieces?.length) {
              const nextLayout = layoutDomaRun(run.length_mm, run.span_mm, run.bends, settings, pieces)
              pieces = rebalanceDomaPieces(nextLayout, 0, pieces[0], settings.bendMm, settings.lapMm)
            }
            commit({ settings, pieces_override: pieces })
          }}
        />
      </section>
      <RunFields
        showDimensionChoices={false}
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
      {cuts.length > 0 ? (
        <section className="space-y-1 rounded-md border border-green-200 bg-green-50/60 p-2 text-[11px]">
          <p className="font-medium" style={{ color: DOMA_ZONE_COLOR }}>
            区域で切る本（区域の中へはみ出しの分だけ入る）
          </p>
          {cuts.map((cut) => (
            <div key={cut.zoneId} className="tabular-nums text-foreground">
              <p>
                特殊{zones.findIndex((z) => z.id === cut.zoneId) + 1} にかかる {cut.count}本（区域{' '}
                {cut.fromMm.toLocaleString()}〜{cut.toMm.toLocaleString()}）
              </p>
              {(
                [
                  ['手前', cut.before],
                  ['先', cut.after],
                ] as const
              ).map(([label, part]) =>
                part ? (
                  <p key={label} className="pl-2">
                    {label}{' '}
                    {piecesSummary(
                      layoutDomaRun(part.lengthMm, cut.count * run.settings.pitchMm, part.bends, run.settings),
                    )}
                  </p>
                ) : null,
              )}
            </div>
          ))}
        </section>
      ) : null}
      <p className="text-[11px] tabular-nums text-foreground">
        製作数量{' '}
        {rows
          .flatMap((row) => {
            const rowLayout = layoutOf(row)
            return rowLayout.pieces.map((p) => `${p.lengthMm.toLocaleString()} × ${rowLayout.count}本`)
          })
          .join(' ＋ ')}
      </p>
      <Warnings warnings={layout.warnings} />

    </div>
  )
}

/** 壁の辺の切り替え。画面で見た上下左右で出し、図面座標の辺に直して返す */
function WallToggles({
  walls,
  viewRotationSteps,
  onChange,
  hint,
}: {
  walls: Record<DomaZoneEdge, boolean>
  viewRotationSteps: number
  onChange: (next: Record<DomaZoneEdge, boolean>) => void
  hint?: string
}) {
  const button = (side: DomaZoneEdge) => {
    const edge = domaZoneEdgeAtScreenSide(side, viewRotationSteps)
    const on = walls[edge]
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange({ ...walls, [edge]: !on })}
        title={on ? '壁: 端部曲げで止める' : '壁でない: 区域の外へはみ出す'}
        className={`min-w-[3.25rem] rounded px-1.5 py-0.5 text-[10px] font-medium ${
          on ? 'bg-slate-700 text-white' : 'border border-border bg-white text-muted hover:bg-gray-50'
        }`}
      >
        {DOMA_ZONE_SIDE_LABEL[side]}
        {on ? ' 壁' : ''}
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-1 text-[11px] text-muted">
      壁の辺
      <div className="grid grid-cols-[auto_1fr_auto] grid-rows-[auto_2.25rem_auto] items-center justify-items-center gap-1">
        <span />
        {button('top')}
        <span />
        {button('left')}
        <div className="h-full w-full rounded border-2 border-dashed" style={{ borderColor: DOMA_ZONE_COLOR }} />
        {button('right')}
        <span />
        {button('bottom')}
        <span />
      </div>
      {hint ? <span className="text-[10px] leading-snug">{hint}</span> : null}
    </div>
  )
}

/** 入力窓のプレビュー用に、保存前の範囲を行の形にする */
function draftZone(
  tateMm: number,
  yokoMm: number,
  settings: DomaBarSettings,
  spec: DomaZoneSpec,
): DrawingDomaRun {
  return {
    id: 'draft',
    drawing_id: '',
    page_no: 1,
    kind: 'special',
    direction: 'tate',
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    length_mm: tateMm,
    span_mm: yokoMm,
    bends: 'none',
    settings: { ...settings, zone: spec },
    pieces_override: null,
    length_dim_id: null,
    span_dim_id: null,
    created_at: '',
  }
}

/** 「L 2,550（範囲 1,950 + はみ出し 600）」 */
function zoneLengthText(zone: DrawingDomaRun, direction: SlabBarDirection): string {
  const v = domaZoneRunValues(zone, direction)
  const extends_ = [v.startExtendMm, v.endExtendMm].filter((mm) => mm > 0)
  return `L ${v.lengthMm.toLocaleString()}（区域 ${v.sizeMm.toLocaleString()}${extends_
    .map((mm) => ` + はみ出し ${mm.toLocaleString()}`)
    .join('')}）`
}

/**
 * 選択中の特殊範囲。範囲の大きさ・壁・はみ出しを変えたら、手入力した加工本は自動に戻す
 * （L が変わると手入力の合計が合わなくなるため）
 */
function ZoneEditor({
  zone,
  viewRotationSteps,
  onUpdate,
}: {
  zone: DrawingDomaRun
  viewRotationSteps: number
  onUpdate: (patch: RunPatch) => void
}) {
  const spec = domaZoneSpecOf(zone)
  const [tateDraft, setTateDraft] = useState<string | null>(null)
  const [yokoDraft, setYokoDraft] = useState<string | null>(null)
  const [extendDraft, setExtendDraft] = useState<string | null>(null)

  const commit = (patch: Partial<RunPatch>) =>
    onUpdate({
      length_mm: zone.length_mm,
      span_mm: zone.span_mm,
      bends: zone.bends,
      settings: zone.settings,
      pieces_override: zone.pieces_override,
      length_dim_id: zone.length_dim_id,
      span_dim_id: zone.span_dim_id,
      ...patch,
    })
  const specWith = (next: Partial<DomaZoneSpec>, keepOverrides = false): DomaZoneSpec => {
    const merged = { ...spec, ...next }
    if (!keepOverrides) delete merged.overrides
    return merged
  }
  const commitSpec = (next: Partial<DomaZoneSpec>, keepOverrides = false) =>
    commit({ settings: { ...zone.settings, zone: specWith(next, keepOverrides) } })

  const runs = domaZoneRuns(zone)
  const toggleDirection = (direction: SlabBarDirection) => {
    const next = { tate: domaZoneHasDirection(zone, 'tate'), yoko: domaZoneHasDirection(zone, 'yoko') }
    next[direction] = !next[direction]
    if (!next.tate && !next.yoko) return
    commitSpec({ directions: next }, true)
  }

  return (
    <div className="flex flex-col gap-2">
      <section className="rounded-md border border-border bg-white p-3">
        <p className="mb-2 text-xs font-medium text-foreground">配筋条件</p>
        <SettingsFields
          settings={zone.settings}
          onChange={(settings) => {
            const geometryChanged =
              settings.bendMm !== zone.settings.bendMm || settings.lapMm !== zone.settings.lapMm
            commit({ settings: { ...settings, zone: specWith({}, !geometryChanged) } })
          }}
        />
      </section>
      <div className="grid grid-cols-2 gap-x-3">
        <NumField
          label="タテ方向の区域 (mm)"
          value={tateDraft ?? String(zone.length_mm)}
          onChange={(v) => {
            setTateDraft(v)
            const mm = parseMm(v)
            if (mm > 0) commit({ length_mm: mm, settings: { ...zone.settings, zone: specWith({}) } })
          }}
          onBlur={() => setTateDraft(null)}
        />
        <NumField
          label="ヨコ方向の区域 (mm)"
          value={yokoDraft ?? String(zone.span_mm)}
          onChange={(v) => {
            setYokoDraft(v)
            const mm = parseMm(v)
            if (mm > 0) commit({ span_mm: mm, settings: { ...zone.settings, zone: specWith({}) } })
          }}
          onBlur={() => setYokoDraft(null)}
        />
      </div>
      <WallToggles
        walls={spec.walls}
        viewRotationSteps={viewRotationSteps}
        onChange={(walls) => commitSpec({ walls })}
        hint="図面で区域の辺をクリックしても切り替わります。壁の辺は端部曲げで止め、壁でない辺は外へはみ出します。"
      />
      <NumField
        label="はみ出し (mm)"
        hint={`壁でない辺から区域の外へ伸ばす長さ。標準は重ね（${zone.settings.lapMm}）`}
        value={extendDraft ?? String(domaZoneExtendMm(zone))}
        onChange={(v) => {
          setExtendDraft(v)
          const mm = parseMm(v)
          if (Number.isFinite(mm) && mm >= 0) commitSpec({ extendMm: mm })
        }}
        onBlur={() => setExtendDraft(null)}
      />
      {spec.extendMm != null && spec.extendMm !== zone.settings.lapMm ? (
        <button
          type="button"
          onClick={() => commitSpec({ extendMm: undefined })}
          className="self-start text-[11px] text-primary hover:underline"
        >
          重ねと同じにする
        </button>
      ) : null}
      <details className="text-[11px] text-muted">
        <summary className="cursor-pointer">入れる向き（タテ・ヨコ）</summary>
        <div className="mt-2 flex gap-3">
          {(['tate', 'yoko'] as const).map((d) => (
            <label key={d} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={domaZoneHasDirection(zone, d)}
                onChange={() => toggleDirection(d)}
              />
              {DIRECTION_LABEL[d]}
            </label>
          ))}
        </div>
      </details>
      {runs.map((run) => {
        const layout = layoutOf(run)
        return (
          <section key={run.id} className="space-y-1.5 rounded-md border border-border bg-white p-2">
            <p className="text-[11px] font-semibold" style={{ color: DOMA_DIRECTION_COLORS[run.direction] }}>
              {DIRECTION_LABEL[run.direction]}
              <span className="ml-1.5 font-normal tabular-nums text-muted">{zoneLengthText(zone, run.direction)}</span>
            </p>
            <PiecesEditor
              run={run}
              layout={layout}
              onOverride={(lengths) =>
                commitSpec({ overrides: { ...spec.overrides, [run.direction]: lengths } }, true)
              }
            />
            <p className="text-[11px] tabular-nums text-foreground">
              製作数量{' '}
              {layout.pieces.map((p) => `${p.lengthMm.toLocaleString()} × ${layout.count}本`).join(' ＋ ')}
            </p>
            <Warnings warnings={layout.warnings} />
          </section>
        )
      })}
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
      type: 'zone'
      /** 範囲の対角（図面座標） */
      line: { x1: number; y1: number; x2: number; y2: number }
      /** タテ筋が図面座標の y の向きか（描いたときの表示回転） */
      tateAlongY: boolean
      /** 範囲の辺に両端がそろう寸法線（タテ方向・ヨコ方向） */
      tateCandidates: DomaDimensionChoice[]
      yokoCandidates: DomaDimensionChoice[]
      defaultTate: DomaDimensionChoice | null
      defaultYoko: DomaDimensionChoice | null
    }
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

/** 特殊範囲の入力窓で確定した値 */
export type DomaZoneInput = {
  tateMm: number
  tateDimId: string | null
  yokoMm: number
  yokoDimId: string | null
  walls: Record<DomaZoneEdge, boolean>
}

/** 特殊範囲を囲んだあとの入力窓。範囲の大きさ（寸法線から選べる）と壁の辺を決める */
export function DomaZoneInputModal({
  state,
  settings,
  dimensionChoices,
  viewRotationSteps,
  onCancel,
  onConfirm,
}: {
  state: Extract<DomaInputModalState, { type: 'zone' }>
  settings: DomaBarSettings
  dimensionChoices: DomaDimensionChoice[]
  viewRotationSteps: number
  onCancel: () => void
  onConfirm: (values: DomaZoneInput) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [tate, setTate] = useState(state.defaultTate ? String(state.defaultTate.mm) : '')
  const [yoko, setYoko] = useState(state.defaultYoko ? String(state.defaultYoko.mm) : '')
  const [tateChoice, setTateChoice] = useState<DomaDimensionChoice | null>(state.defaultTate)
  const [yokoChoice, setYokoChoice] = useState<DomaDimensionChoice | null>(state.defaultYoko)
  const [walls, setWalls] = useState<Record<DomaZoneEdge, boolean>>(DEFAULT_DOMA_ZONE_WALLS)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const tateMm = parseMm(tate)
  const yokoMm = parseMm(yoko)
  const valid = tateMm > 0 && yokoMm > 0
  const preview = valid ? draftZone(tateMm, yokoMm, settings, { tateAlongY: state.tateAlongY, walls }) : null
  const confirm = () => {
    if (!valid) return
    onConfirm({
      tateMm,
      tateDimId: tateChoice?.mm === tateMm ? tateChoice.id : null,
      yokoMm,
      yokoDimId: yokoChoice?.mm === yokoMm ? yokoChoice.id : null,
      walls,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onCancel}>
      <div
        className="w-80 rounded-lg bg-white p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      >
        <h3 className="mb-3 text-sm font-semibold">区域を入力</h3>
        <div className="flex flex-col gap-2">
          <NumField
            label="タテ方向の区域 (mm)"
            value={tate}
            onChange={setTate}
            inputRef={inputRef}
            onEnter={confirm}
          />
          <DimensionChips
            choices={dimensionChoices}
            candidates={state.tateCandidates}
            onPick={(c) => {
              setTate(String(c.mm))
              setTateChoice(c)
            }}
          />
          <NumField label="ヨコ方向の区域 (mm)" value={yoko} onChange={setYoko} onEnter={confirm} />
          <DimensionChips
            choices={dimensionChoices}
            candidates={state.yokoCandidates}
            onPick={(c) => {
              setYoko(String(c.mm))
              setYokoChoice(c)
            }}
          />
          <WallToggles
            walls={walls}
            viewRotationSteps={viewRotationSteps}
            onChange={setWalls}
            hint="壁の辺は端部曲げで止め、壁でない辺は重ねの分だけ外へはみ出します。"
          />
          <p className="text-[11px] tabular-nums text-muted">
            条件 {settings.diameter} / ピッチ {settings.pitchMm} / 曲げ {settings.bendMm} / 重ね {settings.lapMm}
            （右パネルの「条件」で変更）
          </p>
          {preview ? (
            <div className="space-y-1 rounded-md bg-gray-50 px-2 py-1.5 text-[11px]">
              {domaZoneRuns(preview).map((run) => {
                const layout = layoutOf(run)
                return (
                  <div key={run.direction}>
                    <div className="font-semibold" style={{ color: DOMA_DIRECTION_COLORS[run.direction] }}>
                      {DIRECTION_LABEL[run.direction]}{' '}
                      <span className="font-normal tabular-nums text-muted">
                        {zoneLengthText(preview, run.direction)}
                      </span>
                    </div>
                    <div className="tabular-nums">
                      加工本 {piecesSummary(layout)} × {layout.count}本
                    </div>
                    <Warnings warnings={layout.warnings} />
                  </div>
                )
              })}
            </div>
          ) : null}
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
            disabled={!valid}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
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
  state: Exclude<DomaInputModalState, { type: 'zone' }>
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
                {settings.lapMm} / 定尺 自動（右パネルの「条件」で変更）
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
  onGoToSummary,
}: {
  onGoToSummary?: () => void
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
  const standardBars = bars.filter((b) => b.kind !== 'special')
  const zones = bars.filter((b) => b.kind === 'special')
  const directionBars = standardBars.filter((b) => b.direction === direction)
  const selectedDim =
    selection?.type === 'dimension' ? dimensions.find((d) => d.id === selection.id) ?? null : null
  const selectedBar = selection?.type === 'bar' ? bars.find((b) => b.id === selection.id) ?? null : null
  const dirLabel = DIRECTION_LABEL[direction]
  /** 一覧と同じ「タテ1」「タテ2」「特殊1」…の番号 */
  const selectedBarTitle = !selectedBar
    ? ''
    : selectedBar.kind === 'special'
      ? `特殊 ${zones.indexOf(selectedBar) + 1}`
      : `${DIRECTION_LABEL[selectedBar.direction]}筋 ${
          standardBars.filter((b) => b.direction === selectedBar.direction).indexOf(selectedBar) + 1
        }`

  return (
    <div className="w-72 shrink-0 flex flex-col rounded-lg border border-border bg-white overflow-hidden">
      {/* 見出しは付加筋一覧と同じ形 */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">
            {tool === 'dimension'
              ? `寸法線一覧 (${dimensions.length})`
              : kind === 'special'
                ? `区域一覧 (${zones.length})`
                : `土間筋一覧 (${standardBars.length})`}
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
        {selectedDim || selectedBar ? (
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
            ) : selectedBar?.kind === 'special' ? (
              <ZoneEditor
                key={selectedBar.id}
                zone={selectedBar}
                viewRotationSteps={viewRotationSteps}
                onUpdate={(patch) => onUpdateBar(selectedBar.id, patch)}
              />
            ) : selectedBar ? (
              <RunEditor
                key={selectedBar.id}
                run={selectedBar}
                runs={bars}
                dimensions={dimensions}
                onUpdate={(patch) => onUpdateBar(selectedBar.id, patch)}
              />
            ) : null}
          </section>
        ) : (
          <>
            {/* 土間筋を描くときだけ、新規作成用の条件を表示する。 */}
            {tool === 'bar' && kind === 'special' ? (
              <section className="space-y-2 border-b border-border p-3">
                <span className="text-[10px] font-medium text-foreground">これから描く区域の条件</span>
                <SettingsFields key="special" settings={settings} onChange={onSettingsChange} />
                <p className="text-[10px] leading-snug text-muted">
                  図面をドラッグして区域を囲みます。区域の中はタテ・ヨコの両方が入り、壁でない辺は重ねの分だけ外へはみ出します。
                </p>
              </section>
            ) : tool === 'bar' ? (
              <section className="space-y-2 border-b border-border p-3">
                <span className="text-[10px] font-medium text-foreground">これから描く{dirLabel}筋の条件</span>
                <SettingsFields key={direction} settings={settings} onChange={onSettingsChange} />
                <details className="text-[11px] text-muted">
                  <summary className="cursor-pointer">端部曲げの変更</summary>
                  <div className="mt-2"><BendsToggle value={bends} onChange={onBendsChange} /></div>
                </details>
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
            ) : kind === 'special' ? (
              zones.length === 0 ? (
                <p className="px-4 py-3 text-[11px] leading-relaxed text-muted">まだ区域がありません。</p>
              ) : (
                <ul className="space-y-1 px-4 py-3">
                  {zones.map((z, i) => (
                    <li key={z.id}>
                      <button
                        type="button"
                        onClick={() => onSelect({ type: 'bar', id: z.id })}
                        className="w-full rounded px-1 py-0.5 text-left hover:bg-gray-50"
                      >
                        <span className="flex items-center justify-between text-[11px] font-semibold text-muted">
                          <span>
                            <span style={{ color: DOMA_ZONE_COLOR }}>特殊{i + 1}</span>
                            <span className="ml-1.5 font-normal tabular-nums">
                              タテ {z.length_mm.toLocaleString()} × ヨコ {z.span_mm.toLocaleString()}
                            </span>
                          </span>
                          {domaZoneRuns(z).some((r) => layoutOf(r).warnings.length > 0) ? (
                            <span className="text-amber-700">⚠</span>
                          ) : null}
                        </span>
                        {domaZoneRuns(z).map((r) => {
                          const layout = layoutOf(r)
                          return layout.pieces.map((p) => (
                            <span
                              key={`${r.direction}-${p.index}`}
                              className="block font-mono text-[13px] font-semibold"
                              style={{ color: DOMA_DIRECTION_COLORS[r.direction] }}
                            >
                              <span className="mr-1.5 font-sans text-[11px] font-medium">
                                {DIRECTION_LABEL[r.direction]} {p.kind === 'BENT' ? '曲' : '直'}
                              </span>
                              {p.lengthMm.toLocaleString()} × {layout.count}
                            </span>
                          ))
                        })}
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
                  // 区域で切った本は、区域にかからない本と分けて出す
                  const rows = splitDomaRunByZones(b, bars, dimensions)
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
                        {rows.map((row) => {
                          const rowLayout = layoutOf(row)
                          const cut = row.id !== b.id
                          return rowLayout.pieces.map((p) => (
                            <span
                              key={`${row.id}-${p.index}`}
                              className="block font-mono text-[13px] font-semibold"
                              style={{ color: DOMA_DIRECTION_COLORS[b.direction] }}
                            >
                              <span className="mr-1.5 font-sans text-[11px] font-medium">
                                {cut ? <span style={{ color: DOMA_ZONE_COLOR }}>区域 </span> : null}
                                {p.kind === 'BENT' ? '曲' : '直'}
                              </span>
                              {p.lengthMm.toLocaleString()} × {rowLayout.count}
                            </span>
                          ))
                        })}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

          </>
        )}

        {/* 要約と「結果ページを見る」は、付加筋・ユニットと同じく選択中や寸法線を描いているときも出す */}
        {bars.length > 0 ? (
          <DomaSummary bars={bars} dimensions={dimensions} onGoToSummary={onGoToSummary} />
        ) : null}
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
