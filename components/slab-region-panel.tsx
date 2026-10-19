'use client'

import { useMemo, useState } from 'react'
import type { DrawingSlabRegion } from '@/lib/types/database'
import {
  aggregateSchedule,
  buildRuns,
  DEFAULT_SLAB_REBAR_SETTINGS,
  isValidShape,
  shapeOutline,
  type SlabBarDirection,
  type SlabCutCorner,
  type SlabRebarSettings,
  type SlabShape,
} from '@/lib/slab-rebar'

const DIAMETERS = ['D10', 'D13', 'D16', 'D19', 'D22']

const CUT_CORNER_OPTIONS: Array<{ id: SlabCutCorner; label: string }> = [
  { id: 'tl', label: '左上' },
  { id: 'tr', label: '右上' },
  { id: 'bl', label: '左下' },
  { id: 'br', label: '右下' },
]

export type SlabRegionDraft = { shape: SlabShape; settings: SlabRebarSettings }

export const DEFAULT_SLAB_REGION_DRAFT: SlabRegionDraft = {
  shape: { type: 'rect', widthMm: 6370, heightMm: 5460 },
  settings: DEFAULT_SLAB_REBAR_SETTINGS,
}

type FormState = {
  type: 'rect' | 'l'
  widthMm: string
  heightMm: string
  cutCorner: SlabCutCorner
  cutWidthMm: string
  cutHeightMm: string
  diameter: string
  pitchTateMm: string
  pitchYokoMm: string
  bendMm: string
  stockMm: string
  lapMm: string
}

function toForm(d: SlabRegionDraft): FormState {
  const l = d.shape.type === 'l' ? d.shape : null
  return {
    type: d.shape.type,
    widthMm: String(d.shape.widthMm),
    heightMm: String(d.shape.heightMm),
    cutCorner: l?.cutCorner ?? 'tl',
    cutWidthMm: l ? String(l.cutWidthMm) : String(Math.round(d.shape.widthMm / 2)),
    cutHeightMm: l ? String(l.cutHeightMm) : String(Math.round(d.shape.heightMm / 2)),
    diameter: d.settings.diameter,
    pitchTateMm: String(d.settings.pitchTateMm),
    pitchYokoMm: String(d.settings.pitchYokoMm),
    bendMm: String(d.settings.bendMm),
    stockMm: String(d.settings.stockMm),
    lapMm: String(d.settings.lapMm),
  }
}

function fromForm(f: FormState): { draft: SlabRegionDraft | null; error: string | null } {
  const num = (v: string) => Number(v.replace(/,/g, ''))
  const widthMm = num(f.widthMm)
  const heightMm = num(f.heightMm)
  const shape: SlabShape =
    f.type === 'rect'
      ? { type: 'rect', widthMm, heightMm }
      : {
          type: 'l',
          widthMm,
          heightMm,
          cutCorner: f.cutCorner,
          cutWidthMm: num(f.cutWidthMm),
          cutHeightMm: num(f.cutHeightMm),
        }
  if (!isValidShape(shape)) {
    return {
      draft: null,
      error:
        f.type === 'l'
          ? '寸法を確認してください（切り欠きは全体より小さく）。'
          : '幅・奥行きを入力してください。',
    }
  }
  const settings: SlabRebarSettings = {
    diameter: f.diameter,
    pitchTateMm: num(f.pitchTateMm),
    pitchYokoMm: num(f.pitchYokoMm),
    bendMm: num(f.bendMm),
    stockMm: num(f.stockMm),
    lapMm: num(f.lapMm),
  }
  if (!(settings.pitchTateMm > 0 && settings.pitchYokoMm > 0)) {
    return { draft: null, error: 'ピッチを入力してください。' }
  }
  if (!(settings.bendMm >= 0) || !(settings.lapMm >= 0)) {
    return { draft: null, error: '曲げ・重ねの長さを確認してください。' }
  }
  if (!(settings.stockMm > settings.lapMm + 2 * settings.bendMm)) {
    return { draft: null, error: '定尺は 重ね＋曲げ×2 より長くしてください。' }
  }
  return { draft: { shape, settings }, error: null }
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-muted">
      {label}
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-border px-2 py-1 text-xs text-foreground"
      />
    </label>
  )
}

function SlabRegionForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: SlabRegionDraft
  submitLabel: string
  onSubmit: (draft: SlabRegionDraft) => void
}) {
  const [form, setForm] = useState<FormState>(() => toForm(initial))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex rounded-md border border-border bg-white p-0.5 text-xs">
        {(
          [
            { id: 'rect', label: '長方形' },
            { id: 'l', label: 'L字' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => set('type', opt.id)}
            aria-pressed={form.type === opt.id}
            className={`flex-1 rounded px-2 py-0.5 font-medium ${
              form.type === opt.id ? 'bg-slate-700 text-white' : 'text-muted hover:bg-gray-100'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="全体の幅 (mm)" value={form.widthMm} onChange={(v) => set('widthMm', v)} />
        <NumField label="全体の奥行き (mm)" value={form.heightMm} onChange={(v) => set('heightMm', v)} />
      </div>
      {form.type === 'l' ? (
        <>
          <label className="flex flex-col gap-0.5 text-[11px] text-muted">
            切り欠く角
            <select
              value={form.cutCorner}
              onChange={(e) => set('cutCorner', e.target.value as SlabCutCorner)}
              className="rounded border border-border px-2 py-1 text-xs text-foreground"
            >
              {CUT_CORNER_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="切り欠き幅 (mm)" value={form.cutWidthMm} onChange={(v) => set('cutWidthMm', v)} />
            <NumField label="切り欠き奥行き (mm)" value={form.cutHeightMm} onChange={(v) => set('cutHeightMm', v)} />
          </div>
        </>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5 text-[11px] text-muted">
          径
          <select
            value={form.diameter}
            onChange={(e) => set('diameter', e.target.value)}
            className="rounded border border-border px-2 py-1 text-xs text-foreground"
          >
            {DIAMETERS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <NumField label="曲げ長さ (mm)" value={form.bendMm} onChange={(v) => set('bendMm', v)} />
        <NumField label="ピッチ タテ (mm)" value={form.pitchTateMm} onChange={(v) => set('pitchTateMm', v)} />
        <NumField label="ピッチ ヨコ (mm)" value={form.pitchYokoMm} onChange={(v) => set('pitchYokoMm', v)} />
        <NumField label="定尺 (mm)" value={form.stockMm} onChange={(v) => set('stockMm', v)} />
        <NumField label="重ね (mm)" value={form.lapMm} onChange={(v) => set('lapMm', v)} />
      </div>
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      <button
        type="button"
        onClick={() => {
          const { draft, error: err } = fromForm(form)
          setError(err)
          if (draft) onSubmit(draft)
        }}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
      >
        {submitLabel}
      </button>
    </div>
  )
}

function shapeSummary(shape: SlabShape): string {
  const base = `${shape.widthMm} × ${shape.heightMm}`
  return shape.type === 'l' ? `L字 ${base}` : `長方形 ${base}`
}

export function slabRegionDisplayLabel(regions: DrawingSlabRegion[], id: string): string {
  const idx = regions.findIndex((r) => r.id === id)
  const region = regions[idx]
  return region?.label?.trim() || `領域${idx + 1}`
}

export function SlabRegionPanel({
  regions,
  kind,
  direction,
  selectedId,
  placementDraft,
  onSelect,
  onArmPlacement,
  onCancelPlacement,
  onUpdate,
  onResize,
  onDelete,
}: {
  regions: DrawingSlabRegion[]
  kind: 'standard' | 'special'
  direction: SlabBarDirection
  selectedId: string | null
  placementDraft: SlabRegionDraft | null
  onSelect: (id: string | null) => void
  onArmPlacement: (draft: SlabRegionDraft) => void
  onCancelPlacement: () => void
  onUpdate: (id: string, draft: SlabRegionDraft) => void
  onResize: (id: string, factor: number) => void
  onDelete: (id: string) => void
}) {
  const selected = regions.find((r) => r.id === selectedId) ?? null

  const { schedule, hasShortLap, hasEvenSplit } = useMemo(() => {
    const items = regions.map((r) => ({
      diameter: r.settings.diameter,
      runs: buildRuns(shapeOutline(r.shape), r.settings),
    }))
    const runs = items.flatMap((i) => i.runs)
    return {
      schedule: aggregateSchedule(items),
      hasShortLap: runs.some((run) => run.warnings.includes('LAST_PIECE_SHORTER_THAN_LAP')),
      hasEvenSplit: runs.some((run) => run.warnings.includes('SHORT_RUN_SPLIT_EVENLY')),
    }
  }, [regions])

  const totalCount = schedule.reduce((sum, r) => sum + r.quantity, 0)

  return (
    <div className="w-72 shrink-0 flex flex-col rounded-lg border border-border bg-white overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">土間筋</h3>
        <p className="mt-0.5 text-xs text-muted">
          {kind === 'standard' ? `標準・${direction === 'tate' ? 'タテ' : 'ヨコ'}` : '特殊'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {kind === 'special' ? (
          <p className="px-4 py-6 text-center text-xs text-muted">特殊は準備中です。</p>
        ) : (
          <>
            <section className="border-b border-border px-4 py-3">
              <h4 className="mb-2 text-xs font-semibold">
                {selected ? `${slabRegionDisplayLabel(regions, selected.id)} を編集` : '新しい領域'}
              </h4>
              {selected ? (
                <>
                  <SlabRegionForm
                    key={`edit-${selected.id}`}
                    initial={{ shape: selected.shape, settings: selected.settings }}
                    submitLabel="更新"
                    onSubmit={(draft) => onUpdate(selected.id, draft)}
                  />
                  <div className="mt-2 flex items-center gap-1 text-xs">
                    <span className="text-muted">図面上の大きさ</span>
                    <button
                      type="button"
                      onClick={() => onResize(selected.id, 1 / 1.15)}
                      className="rounded border border-border px-2 py-0.5 hover:bg-gray-100"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => onResize(selected.id, 1.15)}
                      className="rounded border border-border px-2 py-0.5 hover:bg-gray-100"
                    >
                      ＋
                    </button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => onDelete(selected.id)}
                      className="rounded border border-red-200 px-2 py-0.5 text-red-600 hover:bg-red-50"
                    >
                      削除
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect(null)}
                    className="mt-2 w-full rounded-md border border-border px-3 py-1 text-xs hover:bg-gray-50"
                  >
                    選択を解除して新しい領域を追加
                  </button>
                </>
              ) : placementDraft ? (
                <div className="flex flex-col gap-2">
                  <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                    図面をクリックすると {shapeSummary(placementDraft.shape)} を配置します（Esc で中止）。
                  </p>
                  <button
                    type="button"
                    onClick={onCancelPlacement}
                    className="rounded-md border border-border px-3 py-1 text-xs hover:bg-gray-50"
                  >
                    配置をやめる
                  </button>
                </div>
              ) : (
                <SlabRegionForm
                  key="new"
                  initial={DEFAULT_SLAB_REGION_DRAFT}
                  submitLabel="図面に配置"
                  onSubmit={onArmPlacement}
                />
              )}
            </section>

            <section className="border-b border-border px-4 py-3">
              <h4 className="mb-1.5 text-xs font-semibold">領域一覧</h4>
              {regions.length === 0 ? (
                <p className="py-2 text-center text-xs text-muted">土間筋はまだありません。</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {regions.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(r.id === selectedId ? null : r.id)}
                        className={`w-full rounded-md border px-2 py-1 text-left text-xs ${
                          r.id === selectedId
                            ? 'border-amber-400 bg-amber-50'
                            : 'border-border hover:bg-gray-50'
                        }`}
                      >
                        <span className="font-medium">{slabRegionDisplayLabel(regions, r.id)}</span>
                        <span className="ml-2 text-muted">{shapeSummary(r.shape)}</span>
                        <span className="block text-[11px] text-muted">
                          {r.settings.diameter} タテ@{r.settings.pitchTateMm} ヨコ@{r.settings.pitchYokoMm}
                          {' '}曲げ{r.settings.bendMm}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="px-4 py-3">
              <h4 className="mb-1.5 text-xs font-semibold">集計（全領域・タテ＋ヨコ）</h4>
              {schedule.length === 0 ? (
                <p className="py-2 text-center text-xs text-muted">—</p>
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
                      <td className="py-0.5 text-right tabular-nums">{totalCount}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {hasShortLap ? (
                <p className="mt-2 text-[11px] leading-snug text-amber-800">
                  最後の本の直線部が重ね長さより短い区間があります。
                </p>
              ) : null}
              {hasEvenSplit ? (
                <p className="mt-1 text-[11px] leading-snug text-amber-800">
                  定尺 1 本に満たない短い区間は 2 本に等分しています（仕様未確定）。
                </p>
              ) : null}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
