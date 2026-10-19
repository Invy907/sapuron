// components/segment-panel.tsx

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DrawingSegment, Unit } from '@/lib/types/database'
import {
  DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM,
  pieceAdjustmentStorageKey,
} from '@/lib/optimize-settings'
import { startGlobalLoading } from '@/lib/global-loading'
import { UnitShapeThumbnail } from '@/components/unit-client'
import {
  decodeSegmentMeta,
  encodeSegmentMeta,
  getSegmentResolvedMarkNumber,
  getSegmentBars,
  getSegmentColor,
  getSegmentEffectiveLengthMm,
  getSegmentLabelPlacement,
  legacyFieldsFromBars,
  type SegmentBarItem,
  type SegmentColor,
} from '@/lib/segment-meta'
import {
  compareSegmentColorOrder,
  getSegmentColorLabelJa,
  getSegmentStrokeHex,
  normalizeSegmentColor,
  SEGMENT_COLOR_DEFINITIONS,
} from '@/lib/segment-colors'

const CIRCLED_NUMS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

/** 手動で色・鉄筋を変えたときはユニット参照を外す（メモの値はそのまま更新） */
const CLEAR_UNIT_LINK = {
  unit_id: null as string | null,
  unit_code: null as string | null,
  unit_name: null as string | null,
  mark_number: null as number | null,
}

function circledNumber(n: number | null): string {
  if (n == null) return ''
  const chars = [...CIRCLED_NUMS]
  return n >= 1 && n <= chars.length ? chars[n - 1] : `(${n})`
}

/** DBの units.id（UUID）のみ unit_id に保存可能（mock/local は FK 制約回避のため割当不可） */
function isPersistedUnitId(id: string): boolean {
  return !id.startsWith('mock-') && !id.startsWith('local-')
}

export function SegmentPanel({
  segments,
  selectedSegmentIds,
  onReplaceSelection,
  onToggleSegmentSelection,
  onBulkApplyTemplateColor,
  onUpdate,
  onDelete,
  onSplit,
  onRotateLabel,
  onResetLabel,
  onPickLength,
  barTypes,
  projectId,
  canUndo,
  onUndo,
  units = [],
  templateOptions = [],
  activeTemplateId = '',
  activeTemplateColor = 'red',
}: {
  segments: DrawingSegment[]
  selectedSegmentIds: string[]
  onReplaceSelection: (ids: string[]) => void
  onToggleSegmentSelection: (id: string) => void
  onBulkApplyTemplateColor: (templateId: string, color: SegmentColor) => void | Promise<void>
  onUpdate: (id: string, updates: Partial<DrawingSegment>) => void
  onDelete: (id: string) => void
  onSplit?: (id: string) => void
  onRotateLabel?: (id: string) => void
  onResetLabel?: (id: string) => void
  onPickLength?: (id: string) => void
  barTypes: string[]
  projectId: string
  canUndo?: boolean
  onUndo?: () => void
  units?: Unit[]
  templateOptions?: Array<{ id: string; name: string }>
  activeTemplateId?: string
  activeTemplateColor?: SegmentColor
}) {
  const persistedUnits = units.filter(
    (u) => u.is_active !== false && isPersistedUnitId(u.id),
  )
  const router = useRouter()
  const [bulkTemplateId, setBulkTemplateId] = useState('')
  const [bulkColor, setBulkColor] = useState<SegmentColor>(activeTemplateColor)
  const [previewUnit, setPreviewUnit] = useState<Unit | null>(null)
  const [pieceLengthAdjustmentMm, setPieceLengthAdjustmentMm] = useState(
    DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM,
  )
  const adjustmentStorageKey = useMemo(
    () => pieceAdjustmentStorageKey(projectId),
    [projectId],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(adjustmentStorageKey)
      if (raw == null) return
      const parsed = Number.parseInt(raw, 10)
      if (Number.isFinite(parsed)) setPieceLengthAdjustmentMm(parsed)
    } catch {
      // Ignore malformed local data.
    }
  }, [adjustmentStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        adjustmentStorageKey,
        String(pieceLengthAdjustmentMm),
      )
    } catch {
      // Ignore storage write errors.
    }
  }, [adjustmentStorageKey, pieceLengthAdjustmentMm])

  function handleRunCalculation() {
    const rebarSegs = segments.filter((s) => s.bar_type !== 'SPACING')
    if (rebarSegs.length === 0) {
      alert('計算対象の線分データがありません。先に図面上に線分を追加してください。')
      return
    }

    for (const seg of rebarSegs) {
      const baseLen = getSegmentEffectiveLengthMm(seg, units)
      const adjusted = baseLen + (pieceLengthAdjustmentMm || 0)
      if (!Number.isFinite(adjusted) || adjusted <= 0) {
        alert(
          `鉄筋長さ補正値の結果、0mm以下になりました。\n長さ: ${baseLen}mm / 補正: ${pieceLengthAdjustmentMm}mm`,
        )
        return
      }
    }

    const params = new URLSearchParams({
      run: '1',
      adjustment: String(pieceLengthAdjustmentMm),
    })
    if (singleSelectedId) params.set('segmentId', singleSelectedId)
    startGlobalLoading()
    router.push(`/projects/${projectId}/optimize?${params.toString()}`)
  }
  const resolvedBulkTemplateId =
    bulkTemplateId && templateOptions.some((t) => t.id === bulkTemplateId)
      ? bulkTemplateId
      : activeTemplateId || templateOptions[0]?.id || ''
  const rebarSegments = segments.filter(
    (s) => !(s.bar_type === 'SPACING' && s.quantity === 0),
  )
  const singleSelectedId =
    selectedSegmentIds.length === 1 ? selectedSegmentIds[0]! : null
  const selected = singleSelectedId
    ? segments.find((s) => s.id === singleSelectedId) ?? null
    : null
  const selectedColor: SegmentColor = selected
    ? getSegmentColor(selected, units)
    : 'red'
  const selectedBars: SegmentBarItem[] = selected
    ? getSegmentBars(selected, units)
    : []
  const decoded = selected ? decodeSegmentMeta(selected.memo) : null
  const selectedLabelPlacement = selected
    ? getSegmentLabelPlacement(selected.memo)
    : null
  const selectedLabelIsCustomized =
    !!selectedLabelPlacement &&
    (selectedLabelPlacement.x != null ||
      selectedLabelPlacement.y != null ||
      selectedLabelPlacement.rotationSteps !== 0)
  // 円番号(ユニット由来)で集計し、表示長さは線分に保存された実長を優先（マスタ変更で既存線が変わらない）
  const getSegmentSummaryGroup = (seg: DrawingSegment, color: SegmentColor) => {
    const linkedUnit =
      seg.unit_id != null ? units.find((u) => u.id === seg.unit_id) ?? null : null
    const sameColorUnit =
      units.find(
        (u) =>
          u.is_active !== false &&
          isPersistedUnitId(u.id) &&
          normalizeSegmentColor(u.color) === color,
      ) ?? null
    const name =
      linkedUnit?.name?.trim() ||
      seg.unit_name?.trim() ||
      sameColorUnit?.name?.trim() ||
      getSegmentColorLabelJa(color)

    return {
      key: `color:${color}`,
      name,
      unit: linkedUnit ?? sameColorUnit ?? null,
    }
  }

  type CircleRow = {
    len: number
    no: number | null
    count: number
    color: SegmentColor
    groupKey: string
    groupName: string
    groupUnit: Unit | null
  }
  type CircleGroup = {
    key: string
    name: string
    color: SegmentColor
    unit: Unit | null
    rows: CircleRow[]
  }
  const circleGroups = (() => {
    const m = new Map<string, CircleRow>()
    for (const seg of rebarSegments) {
      const no = getSegmentResolvedMarkNumber(seg, units)
      const color = getSegmentColor(seg, units)
      const len = getSegmentEffectiveLengthMm(seg, units)
      const group = getSegmentSummaryGroup(seg, color)
      const key = `${group.key}::${no ?? 'none'}::${len}`
      const existing = m.get(key)
      if (!existing) {
        m.set(key, {
          len,
          no,
          count: 1,
          color,
          groupKey: group.key,
          groupName: group.name,
          groupUnit: group.unit,
        })
      } else {
        existing.count += 1
      }
    }

    const groups = new Map<string, CircleGroup>()
    for (const row of m.values()) {
      const existing = groups.get(row.groupKey)
      if (existing) {
        existing.rows.push(row)
      } else {
        groups.set(row.groupKey, {
          key: row.groupKey,
          name: row.groupName || '使用したユニット名',
          color: row.color,
          unit: row.groupUnit,
          rows: [row],
        })
      }
    }

    return [...groups.values()]
      .sort((a, b) => compareSegmentColorOrder(a.color, b.color))
      .map((group) => ({
        ...group,
        rows: group.rows.sort((a, b) => {
          if (b.len !== a.len) return b.len - a.len
          const aNo = a.no ?? Number.MAX_SAFE_INTEGER
          const bNo = b.no ?? Number.MAX_SAFE_INTEGER
          if (aNo !== bNo) return aNo - bNo
          return 0
        }),
      }))
  })()
  return (
    <div className="w-72 shrink-0 flex flex-col rounded-lg border border-border bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">
            線分一覧 ({rebarSegments.length})
          </h3>
          {onUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="text-[11px] text-muted hover:text-foreground disabled:opacity-40"
            >
              元に戻す
            </button>
          )}
        </div>
      </div>

      {/* 複数選択: 一括ユニット */}
      {selectedSegmentIds.length > 1 && (
        <div className="border-b border-border p-4 space-y-2 bg-amber-50/60">
          <div className="text-xs font-medium text-amber-900">
            {selectedSegmentIds.filter((sid) => {
              const s = segments.find((x) => x.id === sid)
              return s && !(s.bar_type === 'SPACING' && s.quantity === 0)
            }).length}
            本の鉄筋線を選択中
          </div>
          {persistedUnits.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] text-muted mb-0.5">
                  テンプレート一括適用
                </label>
                <select
                  value={resolvedBulkTemplateId}
                  onChange={(e) => setBulkTemplateId(e.target.value)}
                  className="w-full rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-primary bg-white"
                >
                  {templateOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-[92px]">
                <label className="block text-[10px] text-muted mb-0.5">色</label>
                <select
                  value={bulkColor}
                  onChange={(e) => setBulkColor(normalizeSegmentColor(e.target.value))}
                  className="w-full rounded border border-border px-2 py-1.5 text-xs outline-none focus:border-primary bg-white"
                >
                  {SEGMENT_COLOR_DEFINITIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.labelJa}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
                onClick={() => {
                  if (!resolvedBulkTemplateId) return
                  void onBulkApplyTemplateColor(resolvedBulkTemplateId, bulkColor)
                }}
              >
                適用
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-muted">
              保存済みユニットがないため一括適用できません。
            </p>
          )}
          <button
            type="button"
            className="text-[11px] text-muted hover:text-foreground underline"
            onClick={() => onReplaceSelection([])}
          >
            選択を解除
          </button>
        </div>
      )}

      {/* Selected segment editor */}
      {selected && (
        <div className="border-b border-border p-4 space-y-3 bg-blue-50/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-primary">
              線分の編集
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onReplaceSelection([])}
                className="text-[11px] text-muted hover:text-foreground transition-colors"
              >
                閉じる
              </button>
              {onSplit && (
                <button
                  type="button"
                  onClick={() => onSplit(selected.id)}
                  className="text-xs text-primary hover:underline"
                >
                  分割
                </button>
              )}
              <button
                onClick={() => onDelete(selected.id)}
                className="text-xs text-danger hover:underline"
              >
                削除
              </button>
            </div>
          </div>
          <div className="rounded-md border border-blue-200 bg-white/80 p-2">
            <div className="mb-1.5 text-[11px] font-medium text-slate-700">
              数値ラベル
            </div>
            <div className="flex flex-wrap gap-1.5">
              {onRotateLabel && (
                <button
                  type="button"
                  onClick={() => onRotateLabel(selected.id)}
                  className="rounded border border-border bg-white px-2 py-1 text-[11px] text-foreground hover:bg-slate-50"
                  title="数値ラベルを90°回転"
                >
                  90°回転
                </button>
              )}
              {onResetLabel && (
                <button
                  type="button"
                  onClick={() => onResetLabel(selected.id)}
                  disabled={!selectedLabelIsCustomized}
                  className="rounded border border-border bg-white px-2 py-1 text-[11px] text-foreground hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title="数値ラベルの位置・角度を初期状態に戻す"
                >
                  位置・角度を戻す
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-muted">
              図面上の数値をドラッグすると、線を動かさずに位置だけ変更できます。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted mb-0.5">長さ (mm)</label>
              {onPickLength ? (
                <button
                  type="button"
                  onClick={() => onPickLength(selected.id)}
                  className="w-full rounded border border-border bg-white px-2 py-1 text-left font-mono text-sm outline-none hover:border-primary hover:bg-primary/5 focus:border-primary"
                  title="クリックして長さを選択"
                >
                  {selected.length_mm.toLocaleString('ja-JP')}
                </button>
              ) : (
                <input
                  type="number"
                  value={selected.length_mm}
                  onChange={(e) =>
                    onUpdate(selected.id, {
                      length_mm: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
                />
              )}
            </div>
            <div>
                <label className="block text-xs text-muted mb-0.5">線の色</label>
                <select
                  value={normalizeSegmentColor(selectedColor)}
                  onChange={(e) => {
                    const nextColor = normalizeSegmentColor(e.target.value)
                    const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                    const bars = getSegmentBars(selected, units)
                    const note = meta?.note ?? legacyNote ?? null
                    const memo = encodeSegmentMeta({
                      v: 1,
                      color: nextColor,
                      bars,
                      note,
                      labelPlacement: meta?.labelPlacement ?? null,
                    })
                    onUpdate(selected.id, { memo, ...CLEAR_UNIT_LINK })
                  }}
                  className="w-full rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary bg-white"
                >
                  {SEGMENT_COLOR_DEFINITIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.labelJa}
                    </option>
                  ))}
                </select>
              </div>
          </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs text-muted">鉄筋（種類と本数）</label>
                <button
                  type="button"
                  onClick={() => {
                    const bars = getSegmentBars(selected, units)
                    const next = [
                      ...bars,
                      {
                        barType: getNextDefaultBarType(
                          bars.map((b) => b.barType),
                          barTypes,
                        ),
                        quantity: 1,
                      },
                    ]
                    const legacy = legacyFieldsFromBars(next)
                    const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                    const memo = encodeSegmentMeta({
                      v: 1,
                      color: meta?.color ?? selectedColor,
                      bars: next,
                      note: meta?.note ?? legacyNote ?? null,
                      labelPlacement: meta?.labelPlacement ?? null,
                    })
                    onUpdate(selected.id, {
                      memo,
                      bar_type: legacy.bar_type,
                      quantity: legacy.quantity,
                      ...CLEAR_UNIT_LINK,
                    })
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  + 追加
                </button>
              </div>
              <div className="space-y-2">
                {(selectedBars.length ? selectedBars : [{ barType: barTypes[0] ?? 'D10', quantity: 1 }]).map(
                  (row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={row.barType}
                        onChange={(e) => {
                          const bars = [...selectedBars]
                          if (bars.length === 0) bars.push(row)
                          bars[idx] = { ...bars[idx], barType: e.target.value }
                          const legacy = legacyFieldsFromBars(bars)
                          const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                          const memo = encodeSegmentMeta({
                            v: 1,
                            color: meta?.color ?? selectedColor,
                            bars,
                            note: meta?.note ?? legacyNote ?? null,
                            labelPlacement: meta?.labelPlacement ?? null,
                          })
                          onUpdate(selected.id, {
                            memo,
                            bar_type: legacy.bar_type,
                            quantity: legacy.quantity,
                            ...CLEAR_UNIT_LINK,
                          })
                        }}
                        className="flex-1 rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary bg-white"
                      >
                        {barTypes.map((bt) => (
                          <option key={bt} value={bt}>
                            {bt}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        value={row.quantity}
                        onChange={(e) => {
                          const bars = [...selectedBars]
                          if (bars.length === 0) bars.push(row)
                          bars[idx] = {
                            ...bars[idx],
                            quantity: Math.max(0, parseInt(e.target.value) || 0),
                          }
                          const legacy = legacyFieldsFromBars(bars)
                          const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                          const memo = encodeSegmentMeta({
                            v: 1,
                            color: meta?.color ?? selectedColor,
                            bars,
                            note: meta?.note ?? legacyNote ?? null,
                            labelPlacement: meta?.labelPlacement ?? null,
                          })
                          onUpdate(selected.id, {
                            memo,
                            bar_type: legacy.bar_type,
                            quantity: legacy.quantity,
                            ...CLEAR_UNIT_LINK,
                          })
                        }}
                        className="w-20 rounded border border-border px-2 py-1 text-sm font-mono outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const bars = selectedBars.filter((_, i) => i !== idx)
                          const nextBars = bars.length ? bars : [{ barType: barTypes[0] ?? 'D10', quantity: 1 }]
                          const legacy = legacyFieldsFromBars(nextBars)
                          const { meta, legacyNote } = decodeSegmentMeta(selected.memo)
                          const memo = encodeSegmentMeta({
                            v: 1,
                            color: meta?.color ?? selectedColor,
                            bars: nextBars,
                            note: meta?.note ?? legacyNote ?? null,
                            labelPlacement: meta?.labelPlacement ?? null,
                          })
                          onUpdate(selected.id, {
                            memo,
                            bar_type: legacy.bar_type,
                            quantity: legacy.quantity,
                            ...CLEAR_UNIT_LINK,
                          })
                        }}
                        className="text-xs text-danger hover:underline"
                        disabled={(selectedBars.length || 1) <= 1}
                      >
                        削除
                      </button>
                    </div>
                  ),
                )}
              </div>
            </div>
        </div>
      )}

      {/* Segment list (rebar only) — hidden while editing to avoid a squeezed scroll area */}
      {!selected && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {rebarSegments.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted">
              「線を描く」ツールで<br />
              図面上に線分を追加してください。
            </div>
          ) : (
            <div className="px-4 py-3 space-y-4">
              {circleGroups.map((group) => (
                <div key={group.key} className="space-y-1">
                  {group.unit ? (
                    <button
                      type="button"
                      onClick={() => setPreviewUnit(group.unit!)}
                      className="text-left text-[11px] font-semibold text-muted underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {group.name || '使用したユニット名'}
                    </button>
                  ) : (
                    <div className="text-[11px] font-semibold text-muted">
                      {group.name || '使用したユニット名'}
                    </div>
                  )}
                  <div className="space-y-1 text-[13px] font-semibold font-mono">
                    {group.rows
                      .filter((r) => r.count > 0)
                      .map((r) => (
                        <div
                          key={`${r.groupKey}-${r.no ?? 'none'}-${r.len}`}
                          style={{ color: getSegmentStrokeHex(r.color, false) }}
                        >
                          {circledNumber(r.no)}
                          {r.len.toLocaleString()} × {r.count}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Summary + calculation */}
      {rebarSegments.length > 0 && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <div className="text-xs text-muted space-y-1">
            <div className="flex justify-between">
              <span>線分の本数</span>
              <span className="font-medium text-foreground">
                {rebarSegments.length}本
              </span>
            </div>
            <div className="flex justify-between">
              <span>部材本数の合計（数量の合計）</span>
              <span className="font-medium text-foreground">
                {rebarSegments.reduce(
                  (sum, s) =>
                    sum + getSegmentBars(s, units).reduce((ss, b) => ss + b.quantity, 0),
                  0,
                )}本
              </span>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">
              鉄筋長さ補正値 (mm)
            </label>
            <input
              type="number"
              value={pieceLengthAdjustmentMm}
              onChange={(e) =>
                setPieceLengthAdjustmentMm(Number.parseInt(e.target.value) || 0)
              }
              className="w-full rounded border border-border px-2 py-1.5 text-sm font-mono outline-none focus:border-primary"
            />
            <p className="mt-1 text-[10px] leading-snug text-muted">
              マイナスで短く、プラスで長くします（例: -30）
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunCalculation}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
          >
            計算実行
          </button>
        </div>
      )}
      {previewUnit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">
                {previewUnit.name}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewUnit(null)}
                className="text-sm text-muted hover:text-foreground"
              >
                閉じる
              </button>
            </div>
            <div className="p-5">
              <UnitShapeThumbnail unit={previewUnit} large />
            </div>
            <div className="flex justify-end border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={() => setPreviewUnit(null)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function getNextDefaultBarType(
  existingBarTypes: string[],
  fallbackList: string[],
): string {
  const existing = new Set(existingBarTypes.map((b) => (b ?? '').toUpperCase()))
  const ordered = fallbackList.map((b) => (b ?? '').toUpperCase()).filter(Boolean)
  for (const bt of ordered) {
    if (!existing.has(bt)) return bt
  }
  return ordered[ordered.length - 1] ?? 'D10'
}
