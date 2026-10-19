'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawingDomaBar, DrawingDomaDimension } from '@/lib/types/database'
import {
  aggregateSchedule,
  computeDomaBar,
  type DomaBarSettings,
  type SlabBarDirection,
} from '@/lib/slab-rebar'

export type DomaTool = 'select' | 'dimension' | 'bar'

export type DomaSelection = { type: 'dimension' | 'bar'; id: string } | null

const DIAMETERS = ['D10', 'D13', 'D16', 'D19', 'D22']

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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  inputRef?: React.Ref<HTMLInputElement>
  onEnter?: () => void
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
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
        className="w-full rounded border border-border px-2 py-1 text-xs text-foreground"
      />
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
  const [draft, setDraft] = useState(() => ({
    pitchMm: String(settings.pitchMm),
    bendMm: String(settings.bendMm),
    stockMm: String(settings.stockMm),
    lapMm: String(settings.lapMm),
  }))

  const commit = (key: keyof typeof draft, raw: string) => {
    setDraft((prev) => ({ ...prev, [key]: raw }))
    const n = parseMm(raw)
    if (!Number.isFinite(n) || n < 0) return
    if (key === 'pitchMm' && n <= 0) return
    onChange({ ...settings, [key]: n })
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-0.5 text-[11px] text-muted">
        径
        <select
          value={settings.diameter}
          onChange={(e) => onChange({ ...settings, diameter: e.target.value })}
          className="rounded border border-border px-2 py-1 text-xs text-foreground"
        >
          {DIAMETERS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <NumField label="ピッチ (mm)" value={draft.pitchMm} onChange={(v) => commit('pitchMm', v)} />
      <NumField label="曲げ長さ (mm)" value={draft.bendMm} onChange={(v) => commit('bendMm', v)} />
      <NumField label="重ね (mm)" value={draft.lapMm} onChange={(v) => commit('lapMm', v)} />
      <NumField label="定尺 (mm)" value={draft.stockMm} onChange={(v) => commit('stockMm', v)} />
    </div>
  )
}

function ScheduleTable({
  bars,
  title,
}: {
  bars: DrawingDomaBar[]
  title: string
}) {
  const schedule = useMemo(
    () =>
      aggregateSchedule(
        bars.map((b) => ({
          diameter: b.settings.diameter,
          runs: [computeDomaBar(b.run_length_mm, b.span_mm, b.settings)],
        })),
      ),
    [bars],
  )
  const total = schedule.reduce((sum, r) => sum + r.quantity, 0)
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold">{title}</h4>
      {schedule.length === 0 ? (
        <p className="py-1 text-center text-xs text-muted">—</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[11px] text-muted">
              <th className="py-0.5 text-left font-normal">径</th>
              <th className="py-0.5 text-left font-normal">形</th>
              <th className="py-0.5 text-right font-normal">長さ</th>
              <th className="py-0.5 text-right font-normal">本数</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((row) => (
              <tr key={`${row.diameter}-${row.kind}-${row.lengthMm}`} className="border-t border-border">
                <td className="py-0.5">{row.diameter}</td>
                <td className="py-0.5">{row.kind === 'BENT' ? '曲' : '直'}</td>
                <td className="py-0.5 text-right tabular-nums">{row.lengthMm.toLocaleString()}</td>
                <td className="py-0.5 text-right tabular-nums">{row.quantity}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold">
              <td className="py-0.5" colSpan={3}>
                合計
              </td>
              <td className="py-0.5 text-right tabular-nums">{total}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

function DimensionEditor({
  dim,
  onUpdate,
  onDelete,
}: {
  dim: DrawingDomaDimension
  onUpdate: (mm: number) => void
  onDelete: () => void
}) {
  const [value, setValue] = useState(String(dim.length_mm))
  const save = () => {
    const mm = parseMm(value)
    if (mm > 0) onUpdate(mm)
  }
  return (
    <div className="flex flex-col gap-2">
      <NumField label="寸法 (mm)" value={value} onChange={setValue} onEnter={save} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          className="flex-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover"
        >
          更新
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
        >
          削除
        </button>
      </div>
    </div>
  )
}

function BarEditor({
  bar,
  dimensionValues,
  onUpdate,
  onDelete,
}: {
  bar: DrawingDomaBar
  dimensionValues: number[]
  onUpdate: (patch: Pick<DrawingDomaBar, 'run_length_mm' | 'span_mm' | 'settings'>) => void
  onDelete: () => void
}) {
  const [run, setRun] = useState(String(bar.run_length_mm))
  const [span, setSpan] = useState(String(bar.span_mm))
  const [settings, setSettings] = useState(bar.settings)

  const runMm = parseMm(run)
  const spanMm = parseMm(span)
  const preview = runMm > 0 && spanMm > 0 ? computeDomaBar(runMm, spanMm, settings) : null

  return (
    <div className="flex flex-col gap-2">
      <LengthAndSpanFields
        run={run}
        span={span}
        onRun={setRun}
        onSpan={setSpan}
        dimensionValues={dimensionValues}
      />
      <SettingsFields settings={settings} onChange={setSettings} />
      {preview ? <PreviewLine settings={settings} {...preview} /> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!preview}
          onClick={() => onUpdate({ run_length_mm: runMm, span_mm: spanMm, settings })}
          className="flex-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          更新
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
        >
          削除
        </button>
      </div>
    </div>
  )
}

function DimensionChips({ values, onPick }: { values: number[]; onPick: (mm: number) => void }) {
  if (values.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((mm) => (
        <button
          key={mm}
          type="button"
          onClick={() => onPick(mm)}
          className="rounded border border-border bg-gray-50 px-1.5 py-0.5 text-[11px] tabular-nums hover:bg-gray-100"
        >
          {mm}
        </button>
      ))}
    </div>
  )
}

function LengthAndSpanFields({
  run,
  span,
  onRun,
  onSpan,
  dimensionValues,
  runInputRef,
  onEnter,
}: {
  run: string
  span: string
  onRun: (v: string) => void
  onSpan: (v: string) => void
  dimensionValues: number[]
  runInputRef?: React.Ref<HTMLInputElement>
  onEnter?: () => void
}) {
  return (
    <>
      <NumField label="鉄筋の長さ (mm)" value={run} onChange={onRun} inputRef={runInputRef} onEnter={onEnter} />
      <DimensionChips values={dimensionValues} onPick={(mm) => onRun(String(mm))} />
      <NumField label="配筋する幅 (mm)" value={span} onChange={onSpan} onEnter={onEnter} />
      <DimensionChips values={dimensionValues} onPick={(mm) => onSpan(String(mm))} />
    </>
  )
}

function PreviewLine({
  settings,
  count,
  pieces,
  warnings,
}: {
  settings: DomaBarSettings
} & ReturnType<typeof computeDomaBar>) {
  return (
    <div className="rounded-md bg-gray-50 px-2 py-1.5 text-[11px]">
      <div className="font-semibold">
        {settings.diameter} @{settings.pitchMm} × {count}本
      </div>
      <div className="tabular-nums">{pieces.map((p) => p.lengthMm).join(' + ') || '—'}</div>
      {warnings.includes('LAST_PIECE_SHORTER_THAN_LAP') ? (
        <div className="mt-0.5 text-amber-800">最後の本の直線部が重ね長さより短いです。</div>
      ) : null}
      {warnings.includes('SHORT_RUN_SPLIT_EVENLY') ? (
        <div className="mt-0.5 text-amber-800">短いため 2 本に等分しています（仕様未確定）。</div>
      ) : null}
    </div>
  )
}

export type DomaInputModalState =
  | { type: 'dimension'; line: { x1: number; y1: number; x2: number; y2: number }; estimateMm: number | null }
  | {
      type: 'bar'
      direction: SlabBarDirection
      line: { x1: number; y1: number; x2: number; y2: number }
      estimateMm: number | null
    }

export function DomaInputModal({
  state,
  settings,
  dimensionValues,
  onCancel,
  onConfirmDimension,
  onConfirmBar,
}: {
  state: DomaInputModalState
  settings: DomaBarSettings
  dimensionValues: number[]
  onCancel: () => void
  onConfirmDimension: (mm: number) => void
  onConfirmBar: (runMm: number, spanMm: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [run, setRun] = useState(state.estimateMm != null ? String(state.estimateMm) : '')
  const [span, setSpan] = useState('')
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const runMm = parseMm(run)
  const spanMm = parseMm(span)

  const confirm = () => {
    if (state.type === 'dimension') {
      if (runMm > 0) onConfirmDimension(runMm)
      return
    }
    if (runMm > 0 && spanMm > 0) onConfirmBar(runMm, spanMm)
  }

  const preview =
    state.type === 'bar' && runMm > 0 && spanMm > 0 ? computeDomaBar(runMm, spanMm, settings) : null

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
            <NumField label="寸法 (mm)" value={run} onChange={setRun} inputRef={inputRef} onEnter={confirm} />
          ) : (
            <>
              <LengthAndSpanFields
                run={run}
                span={span}
                onRun={setRun}
                onSpan={setSpan}
                dimensionValues={dimensionValues}
                runInputRef={inputRef}
                onEnter={confirm}
              />
              {preview ? <PreviewLine settings={settings} {...preview} /> : null}
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
            disabled={state.type === 'dimension' ? !(runMm > 0) : !preview}
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
  onToolChange,
  onSettingsChange,
  onSelect,
  onUpdateDimension,
  onUpdateBar,
  onDeleteDimension,
  onDeleteBar,
}: {
  kind: 'standard' | 'special'
  direction: SlabBarDirection
  tool: DomaTool
  settings: DomaBarSettings
  dimensions: DrawingDomaDimension[]
  bars: DrawingDomaBar[]
  selection: DomaSelection
  onToolChange: (tool: DomaTool) => void
  onSettingsChange: (next: DomaBarSettings) => void
  onSelect: (sel: DomaSelection) => void
  onUpdateDimension: (id: string, mm: number) => void
  onUpdateBar: (id: string, patch: Pick<DrawingDomaBar, 'run_length_mm' | 'span_mm' | 'settings'>) => void
  onDeleteDimension: (id: string) => void
  onDeleteBar: (id: string) => void
}) {
  const directionBars = bars.filter((b) => b.direction === direction)
  const dimensionValues = useMemo(() => domaDimensionValues(dimensions), [dimensions])
  const selectedDim =
    selection?.type === 'dimension' ? dimensions.find((d) => d.id === selection.id) ?? null : null
  const selectedBar = selection?.type === 'bar' ? bars.find((b) => b.id === selection.id) ?? null : null
  const dirLabel = DIRECTION_LABEL[direction]

  return (
    <div className="w-72 shrink-0 flex flex-col rounded-lg border border-border bg-white overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">土間筋</h3>
        <p className="mt-0.5 text-xs text-muted">{kind === 'standard' ? `標準・${dirLabel}` : '特殊'}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {kind === 'special' ? (
          <p className="px-4 py-6 text-center text-xs text-muted">特殊は準備中です。</p>
        ) : (
          <>
            <section className="border-b border-border px-4 py-3">
              <h4 className="mb-1 text-xs font-semibold">1. 各辺の寸法を描く</h4>
              <p className="mb-2 text-[11px] leading-snug text-muted">
                図面上でドラッグして寸法線を引き、寸法(mm)を入力します。
              </p>
              <button
                type="button"
                onClick={() => onToolChange(tool === 'dimension' ? 'select' : 'dimension')}
                className={`w-full rounded-md px-3 py-1.5 text-xs font-medium ${
                  tool === 'dimension'
                    ? 'bg-slate-700 text-white'
                    : 'border border-border hover:bg-gray-50'
                }`}
              >
                {tool === 'dimension' ? '寸法線を描画中（クリックで終了）' : '寸法線を描く (M)'}
              </button>
              <p className="mt-1.5 text-[11px] text-muted">寸法線 {dimensions.length} 本</p>
            </section>

            <section className="border-b border-border px-4 py-3">
              <h4 className="mb-2 text-xs font-semibold">2. {dirLabel}筋の設定</h4>
              <SettingsFields key={direction} settings={settings} onChange={onSettingsChange} />
            </section>

            <section className="border-b border-border px-4 py-3">
              <h4 className="mb-1 text-xs font-semibold">3. {dirLabel}筋を描く</h4>
              <p className="mb-2 text-[11px] leading-snug text-muted">
                鉄筋 1 本分を{direction === 'tate' ? '縦' : '横'}にドラッグし、長さと配筋する幅を入力します。
              </p>
              <button
                type="button"
                onClick={() => onToolChange(tool === 'bar' ? 'select' : 'bar')}
                className={`w-full rounded-md px-3 py-1.5 text-xs font-medium ${
                  tool === 'bar'
                    ? 'bg-slate-700 text-white'
                    : 'border border-border hover:bg-gray-50'
                }`}
              >
                {tool === 'bar' ? `${dirLabel}筋を描画中（クリックで終了）` : `${dirLabel}筋を描く (D)`}
              </button>
              {directionBars.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {directionBars.map((b, i) => {
                    const { count, pieces } = computeDomaBar(b.run_length_mm, b.span_mm, b.settings)
                    const active = selection?.type === 'bar' && selection.id === b.id
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(active ? null : { type: 'bar', id: b.id })}
                          className={`w-full rounded-md border px-2 py-1 text-left text-[11px] ${
                            active ? 'border-amber-400 bg-amber-50' : 'border-border hover:bg-gray-50'
                          }`}
                        >
                          <span className="font-medium">
                            {dirLabel}
                            {i + 1}
                          </span>
                          <span className="ml-1.5 text-muted">
                            L={b.run_length_mm} 幅={b.span_mm} → {count}本
                          </span>
                          <span className="block tabular-nums text-muted">
                            {pieces.map((p) => p.lengthMm).join(' + ')}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </section>

            {selectedDim || selectedBar ? (
              <section className="border-b border-border bg-amber-50/40 px-4 py-3">
                <h4 className="mb-2 text-xs font-semibold">選択中の{selectedDim ? '寸法線' : '土間筋'}</h4>
                {selectedDim ? (
                  <DimensionEditor
                    key={`${selectedDim.id}-${selectedDim.length_mm}`}
                    dim={selectedDim}
                    onUpdate={(mm) => onUpdateDimension(selectedDim.id, mm)}
                    onDelete={() => onDeleteDimension(selectedDim.id)}
                  />
                ) : selectedBar ? (
                  <BarEditor
                    key={`${selectedBar.id}-${selectedBar.run_length_mm}-${selectedBar.span_mm}-${JSON.stringify(selectedBar.settings)}`}
                    bar={selectedBar}
                    dimensionValues={dimensionValues}
                    onUpdate={(patch) => onUpdateBar(selectedBar.id, patch)}
                    onDelete={() => onDeleteBar(selectedBar.id)}
                  />
                ) : null}
              </section>
            ) : null}

            <section className="flex flex-col gap-3 px-4 py-3">
              <ScheduleTable bars={directionBars} title={`${dirLabel}筋の集計`} />
              <ScheduleTable bars={bars} title="全体の集計（タテ＋ヨコ）" />
            </section>
          </>
        )}
      </div>
    </div>
  )
}

export function domaDimensionValues(dimensions: DrawingDomaDimension[]): number[] {
  return Array.from(new Set(dimensions.map((d) => d.length_mm))).sort((a, b) => b - a)
}
