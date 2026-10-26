// components/optimization-result-view.tsx

'use client'

import { useEffect, useMemo, useState } from 'react'
import type { OptimizationOutput } from '@/lib/optimizer'
import {
  getUnitAutoShapeLengthMm,
  type UnitCalculationRow,
  type UnitCountRoundingMode,
} from '@/lib/unit-calculations'
import type { Unit } from '@/lib/types/database'
import { UnitShapeThumbnail } from '@/components/unit-client'

/**
 * ユニットが「二重線 ON」かどうか。
 * 二重線は形状編集で detail_geometry.segments[].doubleLine に保存される
 * （ON にすると全セグメントに付与される）。ON = D13 / OFF = D10 として表示する。
 */
function getHookBarLabel(unit: Unit | null): string | null {
  if (!unit) return null
  const segments = unit.detail_geometry?.segments
  if (!Array.isArray(segments) || segments.length === 0) return 'D10'
  return segments.some((s) => s?.doubleLine === true) ? 'D13' : 'D10'
}

interface UnitResultSummary {
  key: string
  unitId: string | null
  unitName: string
  shapeLengthMm: number
  /** 手入力を無視した自動計算の長さ。ユニットが無い行は null */
  autoShapeLengthMm: number | null
  totalCount: number
}

export function OptimizationResultView({
  result,
  stockLengthMm,
  projectId,
  segmentLabelById,
  segmentDrawingIdById,
  focusSegmentId,
  unitCalculationRows,
  roundingMode,
  units = [],
  onShapeLengthSave,
  manufactureTotalsByUnitId,
}: {
  result: OptimizationOutput
  stockLengthMm: number
  projectId: string
  segmentLabelById: Record<string, string>
  segmentDrawingIdById: Record<string, string>
  focusSegmentId?: string | null
  unitCalculationRows: UnitCalculationRow[]
  roundingMode: UnitCountRoundingMode
  units?: Unit[]
  onShapeLengthSave?: (unitId: string, lengthMm: number) => Promise<void>
  /** 製作図リストの「計」行と同じ数量・タテ筋合計。タテ筋合計を本数として表示する */
  manufactureTotalsByUnitId?: Map<string, { qtyTotal: number; tateTotal: number }>
}) {
  void stockLengthMm
  void projectId
  void result
  void segmentLabelById
  void segmentDrawingIdById
  void focusSegmentId
  void roundingMode

  const [shapeLengthOverrides, setShapeLengthOverrides] = useState<
    Record<string, number>
  >({})
  const [editingShapeKey, setEditingShapeKey] = useState<string | null>(null)
  const [shapeLengthDraft, setShapeLengthDraft] = useState('')
  const [savingShapeKey, setSavingShapeKey] = useState<string | null>(null)
  const [saveErrorKey, setSaveErrorKey] = useState<string | null>(null)

  const unitById = useMemo(
    () => new Map(units.map((u) => [u.id, u])),
    [units],
  )

  const unitSummaries = useMemo<UnitResultSummary[]>(() => {
    const map = new Map<string, UnitResultSummary>()
    for (const row of unitCalculationRows) {
      const key = row.unitId ?? `name:${row.unitName}`
      const existing = map.get(key)
      if (existing) {
        existing.totalCount += row.unitSummaryCount
      } else {
        map.set(key, {
          key,
          unitId: row.unitId,
          unitName: row.unitName,
          shapeLengthMm: row.unitShapeLengthMm,
          autoShapeLengthMm: row.unitId
            ? getUnitAutoShapeLengthMm(unitById.get(row.unitId))
            : null,
          totalCount: row.unitSummaryCount,
        })
      }
    }
    // 本数は製作図リストの「計」行（Σ 数量 × タテ筋）と同じ値を使い、両者が食い違わないようにする
    return Array.from(map.values())
      .map((s) => {
        const totals = s.unitId
          ? manufactureTotalsByUnitId?.get(s.unitId)
          : undefined
        return totals ? { ...s, totalCount: totals.tateTotal } : s
      })
      .filter((s) => s.totalCount > 0)
  }, [manufactureTotalsByUnitId, unitById, unitCalculationRows])

  useEffect(() => {
    const validKeys = new Set(unitSummaries.map((s) => s.key))
    setShapeLengthOverrides((prev) => {
      const next: Record<string, number> = {}
      for (const [k, v] of Object.entries(prev)) {
        if (validKeys.has(k)) next[k] = v
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [unitSummaries])

  const noSummaryReason = useMemo<string | null>(() => {
    if (unitSummaries.length > 0) return null
    if (unitCalculationRows.length === 0) {
      return 'ユニット別集計の対象となる線分がありません（線分にユニットが割り当てられていない、または同色の永続化済みユニットがありません）。'
    }
    const hasZeroCount = unitCalculationRows.some((r) => r.computedCount === 0)
    if (hasZeroCount) {
      return 'ピッチ・本数から算出した本数が 0 のため集計に含まれません（長さ < ピッチ、または本数が 0）。'
    }
    return 'ユニット別集計の対象が見つかりませんでした。'
  }, [unitSummaries, unitCalculationRows])

  return (
    <div className="space-y-4">
      <div className="print-hook-summary rounded-lg border-2 border-primary bg-white p-5">
        {unitSummaries.length > 0 ? (
          <div className="flex flex-col gap-3 print:gap-1">
            {unitSummaries.map((s) => (
              <div
                key={s.key}
                className="hook-card rounded-md border border-border bg-white px-3 py-2 text-sm leading-snug"
              >
                <div className="font-medium text-foreground">{s.unitName}</div>
                <div className="mt-1 flex items-center gap-2">
                  {(() => {
                    const u = s.unitId ? unitById.get(s.unitId) ?? null : null
                    const barLabel = getHookBarLabel(u)
                    return (
                      <>
                        {u ? (
                          <UnitShapeThumbnail
                            unit={u}
                            shapeOnly
                            singleLineShape
                            thumbClassName="h-9 w-14 shrink-0 print:h-6 print:w-10"
                          />
                        ) : null}
                        {barLabel ? (
                          <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground print:text-xs">
                            {barLabel}
                          </span>
                        ) : null}
                      </>
                    )
                  })()}
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-base font-semibold tabular-nums">
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={`${s.unitName} の長さ (mm)`}
                    value={
                      editingShapeKey === s.key
                        ? shapeLengthDraft
                        : (
                            shapeLengthOverrides[s.key] ?? s.shapeLengthMm
                          ).toLocaleString('ja-JP')
                    }
                    onFocus={() => {
                      setSaveErrorKey(null)
                      setEditingShapeKey(s.key)
                      setShapeLengthDraft(
                        String(shapeLengthOverrides[s.key] ?? s.shapeLengthMm),
                      )
                    }}
                    onChange={(e) => {
                      setShapeLengthDraft(e.target.value.replace(/[^\d]/g, ''))
                    }}
                    onBlur={async () => {
                      // 空欄で確定したら自動計算の長さに戻す
                      const n =
                        shapeLengthDraft.trim() === '' && s.autoShapeLengthMm
                          ? s.autoShapeLengthMm
                          : Number.parseInt(shapeLengthDraft, 10)
                      const previous =
                        shapeLengthOverrides[s.key] ?? s.shapeLengthMm
                      setEditingShapeKey(null)

                      if (!Number.isFinite(n) || n <= 0) return

                      setShapeLengthOverrides((prev) => ({
                        ...prev,
                        [s.key]: n,
                      }))

                      if (
                        !s.unitId ||
                        !onShapeLengthSave ||
                        n === previous
                      ) {
                        return
                      }

                      setSavingShapeKey(s.key)
                      setSaveErrorKey(null)
                      try {
                        await onShapeLengthSave(s.unitId, n)
                        setShapeLengthOverrides((prev) => {
                          const next = { ...prev }
                          delete next[s.key]
                          return next
                        })
                      } catch {
                        setSaveErrorKey(s.key)
                      } finally {
                        setSavingShapeKey(null)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    title={
                      s.autoShapeLengthMm
                        ? `自動: ${s.autoShapeLengthMm.toLocaleString('ja-JP')}（空欄で自動に戻す）`
                        : undefined
                    }
                    className={`w-[5.5rem] rounded border border-border bg-white px-1.5 py-0.5 text-base font-semibold outline-none focus:border-primary print:border-transparent print:bg-transparent print:p-0 ${
                      s.autoShapeLengthMm != null &&
                      (shapeLengthOverrides[s.key] ?? s.shapeLengthMm) !== s.autoShapeLengthMm
                        ? 'text-primary print:text-inherit'
                        : ''
                    }`}
                  />
                  <span className="text-muted">×</span>
                  <span>{s.totalCount.toLocaleString('ja-JP')}</span>
                  {savingShapeKey === s.key ? (
                    <span className="text-xs font-normal text-muted print:hidden">
                      保存中…
                    </span>
                  ) : null}
                  {saveErrorKey === s.key ? (
                    <span className="text-xs font-normal text-red-600 print:hidden">
                      保存に失敗しました
                    </span>
                  ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">{noSummaryReason}</p>
        )}
      </div>
    </div>
  )
}
