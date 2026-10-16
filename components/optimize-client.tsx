// components/optimize-client.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DrawingSegment, Unit } from '@/lib/types/database'
import { createClient } from '@/lib/supabase/client'
import { getSegmentLabelMap } from '@/lib/segment-labels'
import { optimize, type PieceInput, type OptimizationOutput } from '@/lib/optimizer'
import { OptimizationResultView } from '@/components/optimization-result-view'
import {
  ManufactureListView,
  buildManufactureUnitTotals,
  clampMemoFontPx,
  MEMO_FONT_PX_DEFAULT,
  type ManufactureLegendPositions,
} from '@/components/manufacture-list-view'
import type { UnitShapeLegendPosition } from '@/components/unit-client'
import {
  DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM,
  pieceAdjustmentStorageKey,
  tateCountOverrideStorageKey,
} from '@/lib/optimize-settings'
import {
  getSegmentBars,
  getSegmentEffectiveLengthMm,
} from '@/lib/segment-meta'
import {
  buildUnitCalculationRows,
  type UnitCountRoundingMode,
} from '@/lib/unit-calculations'

const DEFAULT_STOCK_LENGTH_MM = 6000

type ManufactureLegendPositionState = {
  storageKey: string | null
  positions: ManufactureLegendPositions
}

function parseManufactureLegendPositions(raw: string | null): ManufactureLegendPositions {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const positions: ManufactureLegendPositions = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const parsePosition = (candidate: unknown): UnitShapeLegendPosition | null => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
        const x = (candidate as { x?: unknown }).x
        const y = (candidate as { y?: unknown }).y
        return typeof x === 'number' &&
          Number.isFinite(x) &&
          x >= 0 &&
          x <= 1 &&
          typeof y === 'number' &&
          Number.isFinite(y) &&
          y >= 0 &&
          y <= 1
          ? { x, y }
          : null
      }

      // 旧形式（D13/D10 のまとまり全体の中心）も、個別位置へ展開して引き継ぐ。
      const legacyGroupPosition = parsePosition(value)
      if (legacyGroupPosition) {
        positions[key] = {
          D13: {
            x: legacyGroupPosition.x,
            y: Math.max(0, legacyGroupPosition.y - 0.1),
          },
          D10: {
            x: legacyGroupPosition.x,
            y: Math.min(1, legacyGroupPosition.y + 0.1),
          },
        }
        continue
      }

      const diameterPositions: Record<string, UnitShapeLegendPosition> = {}
      for (const [diameter, candidate] of Object.entries(value)) {
        const position = parsePosition(candidate)
        if (position) diameterPositions[diameter] = position
      }
      if (Object.keys(diameterPositions).length > 0) positions[key] = diameterPositions
    }
    return positions
  } catch {
    return {}
  }
}

export function OptimizeClient({
  projectId,
  segments,
  initialFocusSegmentId,
  initialPieceLengthAdjustmentMm = DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM,
  autoRun = false,
  units: initialUnits = [],
}: {
  projectId: string
  segments: DrawingSegment[]
  initialFocusSegmentId?: string | null
  initialPieceLengthAdjustmentMm?: number
  autoRun?: boolean
  units?: Unit[]
}) {
  const [units, setUnits] = useState(initialUnits)
  const segmentLabelById = getSegmentLabelMap(segments)
  const segmentDrawingIdById = Object.fromEntries(
    segments.map((s) => [s.id, s.drawing_id]),
  )

  const [pieceLengthAdjustmentMm] = useState(initialPieceLengthAdjustmentMm)
  const [result, setResult] = useState<OptimizationOutput | null>(null)
  const [barSummaryTable, setBarSummaryTable] = useState<BarSummaryRow[] | null>(null)
  // 取引先ルール確認前: 例（18.2->18, 13.65->14）と同じ挙動になるよう round 固定
  const [unitCountRoundingMode] = useState<UnitCountRoundingMode>('round')
  const [customerCompany, setCustomerCompany] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerName, setCustomerName] = useState('')
  /** 積み込み日（日付のみ, ISO YYYY-MM-DD） */
  const [customerDate, setCustomerDate] = useState('')
  /** 到着日（日付＋時刻, datetime-local の YYYY-MM-DDTHH:mm） */
  const [customerArrival, setCustomerArrival] = useState('')
  /** 予定・注意事項などの自由記入メモ（製作図リストの右側） */
  const [customerMemo, setCustomerMemo] = useState('')
  const [customerMemoFontPx, setCustomerMemoFontPx] = useState(MEMO_FONT_PX_DEFAULT)
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(
    initialFocusSegmentId ?? null,
  )
  const [calculating, setCalculating] = useState(false)
  const autoRunStartedRef = useRef(false)

  const manufactureLegendStorageKey = useMemo(
    () => `optimize-manufacture-legend-positions:${projectId}`,
    [projectId],
  )
  const [manufactureLegendPositionState, setManufactureLegendPositionState] =
    useState<ManufactureLegendPositionState>({ storageKey: null, positions: {} })

  useEffect(() => {
    if (typeof window === 'undefined') return
    setManufactureLegendPositionState({
      storageKey: manufactureLegendStorageKey,
      positions: parseManufactureLegendPositions(
        window.localStorage.getItem(manufactureLegendStorageKey),
      ),
    })
  }, [manufactureLegendStorageKey])

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      manufactureLegendPositionState.storageKey !== manufactureLegendStorageKey
    ) {
      return
    }
    try {
      window.localStorage.setItem(
        manufactureLegendStorageKey,
        JSON.stringify(manufactureLegendPositionState.positions),
      )
    } catch {
      // Ignore storage write errors so dragging remains usable.
    }
  }, [manufactureLegendPositionState, manufactureLegendStorageKey])

  const handleManufactureLegendPositionChange = useCallback(
    (groupKey: string, diameter: string, position: UnitShapeLegendPosition) => {
      setManufactureLegendPositionState((current) => {
        const currentPositions =
          current.storageKey === manufactureLegendStorageKey ? current.positions : {}
        return {
          storageKey: manufactureLegendStorageKey,
          positions: {
            ...currentPositions,
            [groupKey]: {
              ...(currentPositions[groupKey] ?? {}),
              [diameter]: position,
            },
          },
        }
      })
    },
    [manufactureLegendStorageKey],
  )

  const adjustmentStorageKey = useMemo(
    () => pieceAdjustmentStorageKey(projectId),
    [projectId],
  )

  const tateOverrideStorageKey = useMemo(
    () => tateCountOverrideStorageKey(projectId),
    [projectId],
  )
  const [tateCountOverrides, setTateCountOverrides] = useState<Record<string, number>>({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(tateOverrideStorageKey)
      if (!raw) {
        setTateCountOverrides({})
        return
      }
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object') {
        setTateCountOverrides({})
        return
      }
      const next: Record<string, number> = {}
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const n = Number(value)
        if (Number.isFinite(n) && n >= 0) next[key] = Math.floor(n)
      }
      setTateCountOverrides(next)
    } catch {
      setTateCountOverrides({})
    }
  }, [tateOverrideStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(tateOverrideStorageKey, JSON.stringify(tateCountOverrides))
    } catch {
      // ignore
    }
  }, [tateCountOverrides, tateOverrideStorageKey])

  const handleTateCountOverrideChange = useCallback((rowKey: string, value: number | null) => {
    setTateCountOverrides((prev) => {
      if (value == null) {
        if (!(rowKey in prev)) return prev
        const next = { ...prev }
        delete next[rowKey]
        return next
      }
      const n = Math.max(0, Math.floor(value))
      if (prev[rowKey] === n) return prev
      return { ...prev, [rowKey]: n }
    })
  }, [])

  const unitCalculationRows = useMemo(
    () =>
      buildUnitCalculationRows(
        segments,
        units,
        unitCountRoundingMode,
        pieceLengthAdjustmentMm,
      ),
    [pieceLengthAdjustmentMm, segments, unitCountRoundingMode, units],
  )

  /** 製作図リストの「計」行と材料取りで同じ数量・タテ筋合計を使う */
  const manufactureTotalsByUnitId = useMemo(
    () =>
      buildManufactureUnitTotals(
        segments,
        units,
        pieceLengthAdjustmentMm,
        tateCountOverrides,
      ),
    [pieceLengthAdjustmentMm, segments, tateCountOverrides, units],
  )

  const handleShapeLengthSave = useCallback(
    async (unitId: string, lengthMm: number) => {
      if (
        unitId.startsWith('mock-') ||
        unitId.startsWith('local-')
      ) {
        return
      }

      const unit = units.find((u) => u.id === unitId)
      if (!unit) {
        throw new Error('ユニットが見つかりません')
      }

      const rebar_layout = {
        ...(unit.rebar_layout ?? { rebars: [], spacings: [], annotations: [] }),
        shape_length_mm: lengthMm,
      }

      const supabase = createClient()
      const { error } = await supabase
        .from('units')
        .update({ rebar_layout })
        .eq('id', unitId)

      if (error) throw error

      setUnits((prev) =>
        prev.map((u) => (u.id === unitId ? { ...u, rebar_layout } : u)),
      )
    },
    [units],
  )

  const customerInfoStorageKey = useMemo(
    () => `optimize-customer-info:${projectId}`,
    [projectId],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(customerInfoStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        company?: string
        address?: string
        name?: string
        date?: string
        arrival?: string
        memo?: string
        memoFontPx?: number
      }
      setCustomerCompany(parsed.company ?? '')
      setCustomerAddress(parsed.address ?? '')
      setCustomerName(parsed.name ?? '')
      setCustomerDate(parsed.date ?? '')
      setCustomerArrival(parsed.arrival ?? '')
      setCustomerMemo(parsed.memo ?? '')
      setCustomerMemoFontPx(
        parsed.memoFontPx == null
          ? MEMO_FONT_PX_DEFAULT
          : clampMemoFontPx(parsed.memoFontPx),
      )
    } catch {
      // Ignore malformed local data and continue with empty fields.
    }
  }, [customerInfoStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        customerInfoStorageKey,
        JSON.stringify({
          company: customerCompany,
          address: customerAddress,
          name: customerName,
          date: customerDate,
          arrival: customerArrival,
          memo: customerMemo,
          memoFontPx: customerMemoFontPx,
        }),
      )
    } catch {
      // Ignore storage write errors so the form stays usable.
    }
  }, [
    customerAddress,
    customerArrival,
    customerCompany,
    customerDate,
    customerInfoStorageKey,
    customerMemo,
    customerMemoFontPx,
    customerName,
  ])

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

  useEffect(() => {
    if (!autoRun || autoRunStartedRef.current) return
    autoRunStartedRef.current = true
    setCalculating(true)
    handleCalculate()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount when autoRun
  }, [autoRun])

  function handleCalculate() {
    const rebarSegments = segments.filter((s) => s.bar_type !== 'SPACING')
    const pieces: PieceInput[] = []
    for (const seg of rebarSegments) {
      const baseLen = getSegmentEffectiveLengthMm(seg, units)
      const adjusted = baseLen + (pieceLengthAdjustmentMm || 0)
      if (!Number.isFinite(adjusted) || adjusted <= 0) {
        setCalculating(false)
        alert(
          `鉄筋長さ補正値の結果、0mm以下になりました。\n長さ: ${baseLen}mm / 補正: ${pieceLengthAdjustmentMm}mm`,
        )
        return
      }
      const bars = getSegmentBars(seg, units)
      for (const b of bars) {
        for (let i = 0; i < b.quantity; i++) {
          pieces.push({
            segmentId: seg.id,
            lengthMm: Math.round(adjusted),
            barType: b.barType,
          })
        }
      }
    }

    if (pieces.length === 0) {
      setCalculating(false)
      alert('計算対象の線分データがありません。先に図面上に線分を追加してください。')
      return
    }

    setCalculating(true)
    queueMicrotask(() => {
      const output = optimize(pieces, DEFAULT_STOCK_LENGTH_MM, {
        algorithm: 'best-fit',
      })
      setResult(output)
      setBarSummaryTable(buildBarSummaryTable(pieces))
      setCalculating(false)
    })
  }

  return (
    <div className="optimize-print-root space-y-6">
      {/* 計算中表示 */}
      {calculating && (
        <section className="rounded-lg border border-border bg-white p-8 text-center">
          <div className="flex flex-col items-center gap-3 text-muted">
            <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm font-medium">切断最適化を計算しています...</p>
            <p className="text-xs">しばらくお待ちください</p>
          </div>
        </section>
      )}

      {/* 製作図リスト（新レイアウト・試験導入。計算実行後に表示。既存の計算結果はそのまま残す） */}
      {result && !calculating && (
        <section className="optimize-print-manufacture rounded-lg border border-border bg-white p-5">
          <ManufactureListView
            segments={segments}
            units={units}
            adjustmentMm={pieceLengthAdjustmentMm}
            customerCompany={customerCompany}
            onCustomerCompanyChange={setCustomerCompany}
            customerName={customerName}
            onCustomerNameChange={setCustomerName}
            customerAddress={customerAddress}
            onCustomerAddressChange={setCustomerAddress}
            customerDate={customerDate}
            onCustomerDateChange={setCustomerDate}
            customerArrival={customerArrival}
            onCustomerArrivalChange={setCustomerArrival}
            customerMemo={customerMemo}
            onCustomerMemoChange={setCustomerMemo}
            memoFontPx={customerMemoFontPx}
            onMemoFontPxChange={setCustomerMemoFontPx}
            legendPositions={
              manufactureLegendPositionState.storageKey === manufactureLegendStorageKey
                ? manufactureLegendPositionState.positions
                : {}
            }
            onLegendPositionChange={handleManufactureLegendPositionChange}
            tateCountOverrides={tateCountOverrides}
            onTateCountOverrideChange={handleTateCountOverrideChange}
          />
        </section>
      )}

      {/* 結果 */}
      {result && !calculating && (
        <section className="optimize-print-results space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">材料取り</h2>
          </div>
          {barSummaryTable && barSummaryTable.length > 0 && (
            <BarSummarySection
              rows={barSummaryTable}
              adjustmentMm={pieceLengthAdjustmentMm}
            />
          )}

          <OptimizationResultView
            result={result}
            stockLengthMm={DEFAULT_STOCK_LENGTH_MM}
            projectId={projectId}
            segmentLabelById={segmentLabelById}
            segmentDrawingIdById={segmentDrawingIdById}
            focusSegmentId={focusSegmentId ?? undefined}
            unitCalculationRows={unitCalculationRows}
            roundingMode={unitCountRoundingMode}
            units={units}
            onShapeLengthSave={handleShapeLengthSave}
            manufactureTotalsByUnitId={manufactureTotalsByUnitId}
          />
        </section>
      )}
    </div>
  )
}

interface BarSummaryRow {
  lengthMm: number
  byBarType: Record<string, number>
  total: number
}

function compareBarTypeDesc(a: string, b: string): number {
  const parse = (value: string) => {
    const match = value.match(/^D(\d+)$/i)
    return match ? Number.parseInt(match[1] ?? '', 10) : null
  }
  const an = parse(a)
  const bn = parse(b)
  if (an != null && bn != null && an !== bn) return bn - an
  if (an != null && bn == null) return -1
  if (an == null && bn != null) return 1
  return a.localeCompare(b)
}

function buildBarSummaryTable(pieces: PieceInput[]): BarSummaryRow[] {
  const map = new Map<number, Map<string, number>>()
  for (const p of pieces) {
    let byType = map.get(p.lengthMm)
    if (!byType) {
      byType = new Map()
      map.set(p.lengthMm, byType)
    }
    byType.set(p.barType, (byType.get(p.barType) ?? 0) + 1)
  }
  const allBarTypes = new Set<string>()
  for (const byType of map.values()) {
    for (const bt of byType.keys()) allBarTypes.add(bt)
  }
  const rows: BarSummaryRow[] = []
  for (const [lengthMm, byType] of map.entries()) {
    const obj: Record<string, number> = {}
    let total = 0
    for (const bt of allBarTypes) {
      const qty = byType.get(bt) ?? 0
      obj[bt] = qty
      total += qty
    }
    rows.push({ lengthMm, byBarType: obj, total })
  }
  rows.sort((a, b) => b.lengthMm - a.lengthMm)
  return rows
}

function BarSummarySection({
  rows,
  adjustmentMm,
}: {
  rows: BarSummaryRow[]
  adjustmentMm: number
}) {
  const allBarTypes = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r.byBarType))),
  ).sort(compareBarTypeDesc)
  const totals: Record<string, number> = {}
  for (const bt of allBarTypes) totals[bt] = 0
  for (const row of rows) {
    for (const bt of allBarTypes) {
      totals[bt] += row.byBarType[bt] ?? 0
    }
  }

  return (
    <div className="print-bar-summary rounded-lg border-2 border-primary bg-white p-5">
      {adjustmentMm !== 0 && (
        <p className="text-xs text-muted mb-3">
          鉄筋長さ補正値: {adjustmentMm > 0 ? '+' : ''}
          {adjustmentMm}mm 適用済み
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-lg">
          <thead>
            <tr className="border-b-2 border-border text-left">
              <th className="pb-2 pr-4 font-semibold">長さ (mm)</th>
              {allBarTypes.map((bt) => (
                <th key={bt} className="pb-2 px-3 font-semibold text-center">
                  {bt}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.lengthMm}>
                <td className="py-2 pr-4 font-mono font-medium">
                  {row.lengthMm.toLocaleString()}
                </td>
                {allBarTypes.map((bt) => (
                  <td
                    key={bt}
                    className="py-2 px-3 text-center font-mono"
                  >
                    {row.byBarType[bt] || '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="pt-2 pr-4">合計</td>
              {allBarTypes.map((bt) => (
                <td key={bt} className="pt-2 px-3 text-center font-mono">
                  {totals[bt]}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
