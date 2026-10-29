// components/optimize-client.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { DrawingCornerBar, DrawingSegment, Unit } from '@/lib/types/database'
import { CornerBarSummarySections } from '@/components/corner-bar-summary-view'
import { createClient } from '@/lib/supabase/client'
import { getSegmentLabelMap } from '@/lib/segment-labels'
import { optimize, type PieceInput, type OptimizationOutput } from '@/lib/optimizer'
import { OptimizationResultView } from '@/components/optimization-result-view'
import {
  ManufactureListView,
  buildManufactureUnitTotals,
  clampMemoFontPx,
  MEMO_BOX_TOP,
  MEMO_FONT_PX_DEFAULT,
  MEMO_TABLE_GAP_PX,
  type ManufactureLegendPositions,
} from '@/components/manufacture-list-view'
import type { UnitShapeLegendPosition } from '@/components/unit-client'
import {
  DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM,
  cornerBarLabelOverrideStorageKey,
  cornerBarQuantityOverrideStorageKey,
  kakouchouOverrideStorageKey,
  pieceAdjustmentStorageKey,
  printCardPlacementStorageKey,
  printCardPage2PlacementStorageKey,
  printCornerRowHeightStorageKey,
  printCardZoomStorageKey,
  tateCountOverrideStorageKey,
} from '@/lib/optimize-settings'
import {
  PrintLayoutModal,
  parsePrintCardPlacements,
  parsePrintCardZooms,
  type PrintCard,
  type PrintCardId,
  type PrintCardPlacement,
  type PrintCardPlacements,
  type PrintCardZooms,
} from '@/components/print-layout-modal'
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

type PrintCardPlacementState = {
  storageKey: string | null
  placements: PrintCardPlacements
}

type PrintCardZoomState = {
  storageKey: string | null
  zooms: PrintCardZooms
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
  cornerBars = [],
}: {
  projectId: string
  segments: DrawingSegment[]
  initialFocusSegmentId?: string | null
  initialPieceLengthAdjustmentMm?: number
  autoRun?: boolean
  units?: Unit[]
  /** 現場内の全図面の付加筋。切断最適化とは別に、結果の最後に集計して出す */
  cornerBars?: DrawingCornerBar[]
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
  /** 積み込み日（自由入力。旧データは ISO YYYY-MM-DD） */
  const [customerDate, setCustomerDate] = useState('')
  /** 到着日（自由入力。旧データは YYYY-MM-DDTHH:mm） */
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

  const printPlacementStorageKey = useMemo(
    () => printCardPlacementStorageKey(projectId),
    [projectId],
  )
  const [printPlacementState, setPrintPlacementState] = useState<PrintCardPlacementState>({
    storageKey: null,
    placements: {},
  })
  const printCardPlacements =
    printPlacementState.storageKey === printPlacementStorageKey
      ? printPlacementState.placements
      : {}
  /** 印刷レイアウト画面（印刷ボタンで開く） */
  const [printLayoutOpen, setPrintLayoutOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setPrintPlacementState({
      storageKey: printPlacementStorageKey,
      placements: parsePrintCardPlacements(
        window.localStorage.getItem(printPlacementStorageKey),
      ),
    })
  }, [printPlacementStorageKey])

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      printPlacementState.storageKey !== printPlacementStorageKey
    ) {
      return
    }
    try {
      window.localStorage.setItem(
        printPlacementStorageKey,
        JSON.stringify(printPlacementState.placements),
      )
    } catch {
      // Ignore storage write errors so dragging remains usable.
    }
  }, [printPlacementState, printPlacementStorageKey])

  const handlePrintCardPlacementChange = useCallback(
    (id: PrintCardId, placement: PrintCardPlacement | null) => {
      setPrintPlacementState((current) => {
        const next: PrintCardPlacements = {
          ...(current.storageKey === printPlacementStorageKey ? current.placements : {}),
        }
        if (placement) next[id] = placement
        else delete next[id]
        return { storageKey: printPlacementStorageKey, placements: next }
      })
    },
    [printPlacementStorageKey],
  )

  const printZoomStorageKey = useMemo(() => printCardZoomStorageKey(projectId), [projectId])
  const [printZoomState, setPrintZoomState] = useState<PrintCardZoomState>({
    storageKey: null,
    zooms: {},
  })
  const printCardZooms =
    printZoomState.storageKey === printZoomStorageKey ? printZoomState.zooms : {}

  useEffect(() => {
    if (typeof window === 'undefined') return
    setPrintZoomState({
      storageKey: printZoomStorageKey,
      zooms: parsePrintCardZooms(window.localStorage.getItem(printZoomStorageKey)),
    })
  }, [printZoomStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || printZoomState.storageKey !== printZoomStorageKey) {
      return
    }
    try {
      window.localStorage.setItem(printZoomStorageKey, JSON.stringify(printZoomState.zooms))
    } catch {
      // Ignore storage write errors so resizing remains usable.
    }
  }, [printZoomState, printZoomStorageKey])

  const handlePrintCardZoomChange = useCallback(
    (id: PrintCardId, zoom: number | null) => {
      setPrintZoomState((current) => {
        const next: PrintCardZooms = {
          ...(current.storageKey === printZoomStorageKey ? current.zooms : {}),
        }
        if (zoom == null) delete next[id]
        else next[id] = zoom
        return { storageKey: printZoomStorageKey, zooms: next }
      })
    },
    [printZoomStorageKey],
  )

  // 2 ページ目の位置・大きさ。1 ページ目と同じ形で、原点だけ用紙の左上
  const printPage2StorageKey = useMemo(
    () => printCardPage2PlacementStorageKey(projectId),
    [projectId],
  )
  const [printPage2State, setPrintPage2State] = useState<PrintCardPlacementState>({
    storageKey: null,
    placements: {},
  })
  const printCardPage2Placements =
    printPage2State.storageKey === printPage2StorageKey ? printPage2State.placements : {}

  useEffect(() => {
    if (typeof window === 'undefined') return
    setPrintPage2State({
      storageKey: printPage2StorageKey,
      placements: parsePrintCardPlacements(window.localStorage.getItem(printPage2StorageKey)),
    })
  }, [printPage2StorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || printPage2State.storageKey !== printPage2StorageKey) {
      return
    }
    try {
      window.localStorage.setItem(printPage2StorageKey, JSON.stringify(printPage2State.placements))
    } catch {
      // Ignore storage write errors so dragging remains usable.
    }
  }, [printPage2State, printPage2StorageKey])

  const handlePrintCardPage2PlacementChange = useCallback(
    (id: PrintCardId, placement: PrintCardPlacement | null) => {
      setPrintPage2State((current) => {
        const next: PrintCardPlacements = {
          ...(current.storageKey === printPage2StorageKey ? current.placements : {}),
        }
        if (placement) next[id] = placement
        else delete next[id]
        return { storageKey: printPage2StorageKey, placements: next }
      })
    },
    [printPage2StorageKey],
  )

  // 付加筋カードの行ごとの高さ（印刷レイアウト画面で行の境目をドラッグして決める）
  const printCornerRowHeightKey = useMemo(
    () => printCornerRowHeightStorageKey(projectId),
    [projectId],
  )
  const [printCornerRowHeightState, setPrintCornerRowHeightState] = useState<{
    storageKey: string | null
    heights: Record<string, number>
  }>({ storageKey: null, heights: {} })
  const printCornerRowHeights =
    printCornerRowHeightState.storageKey === printCornerRowHeightKey
      ? printCornerRowHeightState.heights
      : {}

  useEffect(() => {
    if (typeof window === 'undefined') return
    let heights: Record<string, number> = {}
    try {
      const raw = window.localStorage.getItem(printCornerRowHeightKey)
      const parsed = raw ? (JSON.parse(raw) as unknown) : null
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const n = Number(value)
          if (Number.isFinite(n) && n > 0) heights[key] = n
        }
      }
    } catch {
      heights = {}
    }
    setPrintCornerRowHeightState({ storageKey: printCornerRowHeightKey, heights })
  }, [printCornerRowHeightKey])

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      printCornerRowHeightState.storageKey !== printCornerRowHeightKey
    ) {
      return
    }
    try {
      window.localStorage.setItem(
        printCornerRowHeightKey,
        JSON.stringify(printCornerRowHeightState.heights),
      )
    } catch {
      // ignore
    }
  }, [printCornerRowHeightState, printCornerRowHeightKey])

  /**
   * 行の高さを変えたら、カードに決めてあった高さは外して中身（行の合計）に合わせる。
   * カードの高さが残っていると、行を伸ばした分だけ中身が縮められてしまうため
   */
  const handlePrintCornerRowHeightChange = useCallback(
    (cardId: PrintCardId, rowKey: string, height: number | null) => {
      setPrintCornerRowHeightState((current) => {
        const heights = {
          ...(current.storageKey === printCornerRowHeightKey ? current.heights : {}),
        }
        if (height == null) delete heights[rowKey]
        else heights[rowKey] = height
        return { storageKey: printCornerRowHeightKey, heights }
      })
      const dropHeight = (current: PrintCardPlacementState, storageKey: string) => {
        const placements = current.storageKey === storageKey ? current.placements : {}
        const placement = placements[cardId]
        if (!placement || placement.h == null) return current
        const next = { ...placement }
        delete next.h
        return { storageKey, placements: { ...placements, [cardId]: next } }
      }
      setPrintPlacementState((current) => dropHeight(current, printPlacementStorageKey))
      setPrintPage2State((current) => dropHeight(current, printPage2StorageKey))
    },
    [printCornerRowHeightKey, printPage2StorageKey, printPlacementStorageKey],
  )

  const handleResetPrintCardPlacements = useCallback(() => {
    setPrintPlacementState({ storageKey: printPlacementStorageKey, placements: {} })
    setPrintZoomState({ storageKey: printZoomStorageKey, zooms: {} })
    setPrintPage2State({ storageKey: printPage2StorageKey, placements: {} })
    setPrintCornerRowHeightState({ storageKey: printCornerRowHeightKey, heights: {} })
  }, [printCornerRowHeightKey, printPage2StorageKey, printPlacementStorageKey, printZoomStorageKey])

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

  const kakouchouStorageKey = useMemo(
    () => kakouchouOverrideStorageKey(projectId),
    [projectId],
  )
  const [kakouchouOverrides, setKakouchouOverrides] = useState<Record<string, number>>({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(kakouchouStorageKey)
      const parsed = raw ? (JSON.parse(raw) as unknown) : null
      const next: Record<string, number> = {}
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const n = Number(value)
          if (Number.isFinite(n) && n > 0) next[key] = Math.floor(n)
        }
      }
      setKakouchouOverrides(next)
    } catch {
      setKakouchouOverrides({})
    }
  }, [kakouchouStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(kakouchouStorageKey, JSON.stringify(kakouchouOverrides))
    } catch {
      // ignore
    }
  }, [kakouchouOverrides, kakouchouStorageKey])

  const handleKakouchouOverrideChange = useCallback((rowKey: string, value: number | null) => {
    setKakouchouOverrides((prev) => {
      if (value == null) {
        if (!(rowKey in prev)) return prev
        const next = { ...prev }
        delete next[rowKey]
        return next
      }
      if (prev[rowKey] === value) return prev
      return { ...prev, [rowKey]: value }
    })
  }, [])

  const cornerBarQuantityStorageKey = useMemo(
    () => cornerBarQuantityOverrideStorageKey(projectId),
    [projectId],
  )
  const [cornerBarQuantityOverrides, setCornerBarQuantityOverrides] = useState<
    Record<string, number>
  >({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(cornerBarQuantityStorageKey)
      const parsed = raw ? (JSON.parse(raw) as unknown) : null
      const next: Record<string, number> = {}
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const n = Number(value)
          if (Number.isFinite(n) && n >= 0) next[key] = Math.floor(n)
        }
      }
      setCornerBarQuantityOverrides(next)
    } catch {
      setCornerBarQuantityOverrides({})
    }
  }, [cornerBarQuantityStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        cornerBarQuantityStorageKey,
        JSON.stringify(cornerBarQuantityOverrides),
      )
    } catch {
      // ignore
    }
  }, [cornerBarQuantityOverrides, cornerBarQuantityStorageKey])

  const handleCornerBarQuantityOverrideChange = useCallback(
    (rowKey: string, value: number | null) => {
      setCornerBarQuantityOverrides((prev) => {
        if (value == null) {
          if (!(rowKey in prev)) return prev
          const next = { ...prev }
          delete next[rowKey]
          return next
        }
        if (prev[rowKey] === value) return prev
        return { ...prev, [rowKey]: value }
      })
    },
    [],
  )

  const cornerBarLabelStorageKey = useMemo(
    () => cornerBarLabelOverrideStorageKey(projectId),
    [projectId],
  )
  const [cornerBarLabelOverrides, setCornerBarLabelOverrides] = useState<
    Record<string, string>
  >({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(cornerBarLabelStorageKey)
      const parsed = raw ? (JSON.parse(raw) as unknown) : null
      const next: Record<string, string> = {}
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === 'string' && value.trim() !== '') next[key] = value
        }
      }
      setCornerBarLabelOverrides(next)
    } catch {
      setCornerBarLabelOverrides({})
    }
  }, [cornerBarLabelStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        cornerBarLabelStorageKey,
        JSON.stringify(cornerBarLabelOverrides),
      )
    } catch {
      // ignore
    }
  }, [cornerBarLabelOverrides, cornerBarLabelStorageKey])

  const handleCornerBarLabelOverrideChange = useCallback(
    (rowKey: string, value: string | null) => {
      setCornerBarLabelOverrides((prev) => {
        if (value == null) {
          if (!(rowKey in prev)) return prev
          const next = { ...prev }
          delete next[rowKey]
          return next
        }
        if (prev[rowKey] === value) return prev
        return { ...prev, [rowKey]: value }
      })
    },
    [],
  )

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

  /** 印刷レイアウト画面の印刷ボタン。押した瞬間だけタイトルを消し、印刷ダイアログに出るファイル名をきれいにする */
  const handlePrint = useCallback(() => {
    const originalTitle = document.title
    document.title = ''
    const restoreTitle = () => {
      document.title = originalTitle
      window.removeEventListener('afterprint', restoreTitle)
    }
    window.addEventListener('afterprint', restoreTitle)
    window.print()
  }, [])

  const closePrintLayout = useCallback(() => setPrintLayoutOpen(false), [])

  // Ctrl+P などで直接印刷したときも、印刷レイアウト画面のシートを印刷する
  const canPrint = result != null && !calculating
  useEffect(() => {
    if (!canPrint) return
    const handleBeforePrint = () => flushSync(() => setPrintLayoutOpen(true))
    window.addEventListener('beforeprint', handleBeforePrint)
    return () => window.removeEventListener('beforeprint', handleBeforePrint)
  }, [canPrint])

  // 画面と印刷レイアウト画面の両方に同じものを出す
  const renderManufactureList = (tableOverlay?: ReactNode, hidePrintMemo = false) => (
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
      tableOverlay={tableOverlay}
      hidePrintMemo={hidePrintMemo}
    />
  )

  const barSummaryCard =
    barSummaryTable && barSummaryTable.length > 0 ? (
      <BarSummarySection rows={barSummaryTable} />
    ) : null

  const hookSummaryCard = result ? (
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
  ) : null

  /** printCardId を渡したとき（印刷レイアウト画面のカード）だけ、行の高さを変えられる */
  const renderCornerBarsCard = (placements: DrawingCornerBar[], printCardId?: PrintCardId) =>
    placements.length > 0 ? (
      <CornerBarSummarySections
        placements={placements}
        kakouchouOverrides={kakouchouOverrides}
        onKakouchouOverrideChange={handleKakouchouOverrideChange}
        labelOverrides={cornerBarLabelOverrides}
        onLabelOverrideChange={handleCornerBarLabelOverrideChange}
        quantityOverrides={cornerBarQuantityOverrides}
        onQuantityOverrideChange={handleCornerBarQuantityOverrideChange}
        rowHeights={printCardId ? printCornerRowHeights : undefined}
        onRowHeightChange={
          printCardId
            ? (rowKey, height) => handlePrintCornerRowHeightChange(printCardId, rowKey, height)
            : undefined
        }
      />
    ) : null

  // 結果ページは付加筋をまとめて 1 枚。印刷では特殊コーナー筋だけ別のカードにして、
  // 大きさ・位置を別々に変えられるようにする（行 key は同じなので手入力はそのまま効く）
  const cornerBarsCard = renderCornerBarsCard(cornerBars)
  const plainCornerBarsCard = renderCornerBarsCard(
    cornerBars.filter((cb) => cb.category !== 'SPECIAL_CORNER' && cb.category !== 'OPENING'),
    'corner-bars',
  )
  const specialCornerBarsCard = renderCornerBarsCard(
    cornerBars.filter((cb) => cb.category === 'SPECIAL_CORNER'),
    'special-corner-bars',
  )
  const openingBarsCard = renderCornerBarsCard(
    cornerBars.filter((cb) => cb.category === 'OPENING'),
    'opening-bars',
  )

  const printCards: PrintCard[] = []
  if (barSummaryCard) printCards.push({ id: 'bar-summary', label: '材料取り表', node: barSummaryCard })
  if (hookSummaryCard) printCards.push({ id: 'hook-summary', label: 'フック付', node: hookSummaryCard })
  if (plainCornerBarsCard) {
    printCards.push({ id: 'corner-bars', label: '付加筋', node: plainCornerBarsCard })
  }
  if (specialCornerBarsCard) {
    printCards.push({
      id: 'special-corner-bars',
      label: '特殊コーナー筋',
      node: specialCornerBarsCard,
    })
  }
  if (openingBarsCard) {
    printCards.push({ id: 'opening-bars', label: '開口補強筋', node: openingBarsCard })
  }
  if (customerMemo.trim()) {
    printCards.push({
      id: 'memo',
      label: 'メモ',
      node: (
        <div
          className="whitespace-pre-wrap break-words text-center leading-snug"
          style={{ fontSize: customerMemoFontPx }}
        >
          {customerMemo}
        </div>
      ),
      page1Only: true,
      // 動かす前は従来の印刷と同じ「表の右の余白」に置く。幅は用紙の右端まで（層の幅）
      defaultPlacement: (layer) => {
        const wrap = layer.parentElement
        const table = wrap?.querySelector('table')
        if (!wrap || !table) return null
        const x = table.offsetWidth + MEMO_TABLE_GAP_PX
        return {
          x,
          y: MEMO_BOX_TOP - wrap.offsetTop,
          w: Math.max(80, layer.offsetWidth - x),
        }
      },
    })
  }

  return (
    <div className="space-y-4">
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
        <section className="rounded-lg border border-border bg-white p-5">
          {renderManufactureList()}
        </section>
      )}

      {!calculating && (result || cornerBars.length > 0) && (
        <div className="space-y-4">
          {/* 結果 */}
          {result && (
            <section className="space-y-4">
              {barSummaryCard}
              {hookSummaryCard}
            </section>
          )}

          {/* 付加筋 集計結果。画面では切断最適化の結果の後ろに続けて出す */}
          {cornerBarsCard && <section className="space-y-4">{cornerBarsCard}</section>}
        </div>
      )}

      {/* 印刷ボタン。このページの一番下に固定する。押すと印刷レイアウト画面を開く */}
      {canPrint && (
        <div className="flex justify-end print:hidden">
          <button
            type="button"
            onClick={() => setPrintLayoutOpen(true)}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
          >
            印刷
          </button>
        </div>
      )}

      {/* 印刷はこの画面のシートだけを出すので、見えている配置がそのまま印刷される */}
      {canPrint && printLayoutOpen && (
        <PrintLayoutModal
          onClose={closePrintLayout}
          onPrint={handlePrint}
          placements={printCardPlacements}
          onPlacementChange={handlePrintCardPlacementChange}
          zooms={printCardZooms}
          onZoomChange={handlePrintCardZoomChange}
          page2Placements={printCardPage2Placements}
          onPage2PlacementChange={handlePrintCardPage2PlacementChange}
          onResetPlacements={handleResetPrintCardPlacements}
          hasOtherLayoutChanges={Object.keys(printCornerRowHeights).length > 0}
          renderPage1={(overlay, layeredIds) => (
            <section className="optimize-print-manufacture">
              {/* 既定位置を測る前（Ctrl+P で直接印刷したときなど）は元のメモを出す */}
              {renderManufactureList(overlay, layeredIds.has('memo'))}
            </section>
          )}
          cards={printCards}
        />
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

function BarSummarySection({ rows }: { rows: BarSummaryRow[] }) {
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
      {/* 見出しはカードの中に置く（カードを 1 ページ目へ移しても見出しが一緒に動く） */}
      <h2 className="mb-3 text-base font-semibold">材料取り</h2>
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
