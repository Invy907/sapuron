// components/drawing-viewer.tsx

'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { startGlobalLoading } from '@/lib/global-loading'
import { loadPdfDocument } from '@/lib/pdfjs'
import { useRouter } from 'next/navigation'
import type { DrawingCornerBar, DrawingSegment } from '@/lib/types/database'
import type { Unit } from '@/lib/types/database'
import { getSegmentLabelMap } from '@/lib/segment-labels'
import { SegmentPanel } from '@/components/segment-panel'
import { CornerBarPanel } from '@/components/corner-bar-panel'
import {
  clampCornerBarSizePx,
  cornerBarCanvasGeometry,
  cornerBarCategoryLabel,
  cornerBarRotationLabel,
  cornerBarSegmentLines,
  cornerBarShapeLabel,
  cornerBarRotationFromDrag,
  DEFAULT_CORNER_BAR_SIZE_PX,
  getDefaultCornerBarSizePxForPlacement,
  resolveCornerBarShape,
  getCornerBarShapeOptionsForCategory,
  buildCornerBarPrintSummary,
  cornerBarLegacyFieldsFromBars,
  makeCornerBarDraft,
  cornerBarThumbPath,
  normalizeCornerBarBars,
  normalizeCornerBarFlip,
  cornerBarOriginKeepingVertex,
  cornerBarDraggableEnds,
  resizeCornerBarEdgeToPoint,
  normalizeCornerBarRotation,
  isPerEdgeVisualDrawCategory,
  DEFAULT_CORNER_BAR_COLORS,
  type CornerBarBarItem,
  type CornerBarCategory,
  type CornerBarGeometry,
  type CornerBarPlacementDraft,
} from '@/lib/corner-bar-presets'
import {
  decodeSegmentMeta,
  encodeSegmentMeta,
  getSegmentBars,
  getSegmentColor,
  getSegmentEffectiveLengthMm,
  getSegmentLabelPlacement,
  getSegmentResolvedMarkNumber,
  getSegmentMarkNumberForCanvas,
  legacyFieldsFromBars,
  parseMarkFromUnitCode,
  shiftSegmentLabelPlacementMemo,
  updateSegmentLabelPlacementMemo,
  type SegmentBarItem,
  type SegmentColor,
  type SegmentLabelPlacement,
} from '@/lib/segment-meta'
import {
  pushRecentUnitId,
  readRecentUnitIds,
} from '@/lib/drawing-unit-prefs'
import { UnitShapeThumbnail, UnitVariantLengthList } from '@/components/unit-client'
import {
  compareSegmentColorOrder,
  getSegmentColorLabelJa,
  getSegmentStrokeHex,
  isSegmentColor,
  normalizeSegmentColor,
  SEGMENT_COLOR_DEFINITIONS,
} from '@/lib/segment-colors'
import {
  buildShapeSketch,
  getDefaultDetailSpec,
  normalizeDetailSpecForTemplate,
  shapeTypeToDetailTemplate,
} from '@/lib/unit-detail-shape'
import {
  buildTemplateSummaries,
  resolveVariantByTemplateColorLength,
  snapLengthMm,
  type TemplateSummary,
} from '@/lib/unit-variant-resolver'
import { generateUnitCode } from '@/lib/unit-types'
import {
  fetchLengthPresetGroupsFromDb,
  type LengthPresetGroup,
} from '@/lib/length-presets'

interface Point {
  x: number
  y: number
}

type QuickRebarInsertSeed = {
  bars: SegmentBarItem[]
  color: SegmentColor
  unitId: string | null
  unitCode: string | null
  unitName: string | null
  markNumber: number | null
  label: string
  /** 番号モーダル確定後は Variant 自動解決をスキップ */
  skipVariantResolution: boolean
}

type QuickMarkPickModalState = {
  p1: Point
  p2: Point
  lengthMm: number
  base: string
  numbered: Unit[]
  availableMarks: number[]
  sourceUnit: Unit
}

type LengthPresetDrawModalState = {
  mode: 'draw' | 'edit'
  segmentId?: string
  p1: Point
  p2: Point
  sourceUnit: Unit
  preset: LengthPresetGroup
}

const BAR_TYPES = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25', 'D29', 'D32']
const MIN_REBAR_LENGTH_MM = 10
const CIRCLED_SUMMARY_NUMS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

type DrawingPrintSummaryRow = {
  len: number
  no: number | null
  count: number
  color: SegmentColor
}

type DrawingPrintSummaryGroup = {
  key: string
  name: string
  color: SegmentColor
  rows: DrawingPrintSummaryRow[]
}

function isPersistedUnitId(id: string): boolean {
  return !id.startsWith('mock-') && !id.startsWith('local-')
}

function circledSummaryNumber(n: number | null): string {
  if (n == null) return ''
  const chars = [...CIRCLED_SUMMARY_NUMS]
  return n >= 1 && n <= chars.length ? chars[n - 1]! : `(${n})`
}

function drawingPrintSummaryDetailText(row: DrawingPrintSummaryRow): string {
  return `${row.len.toLocaleString('ja-JP')} × ${row.count}`
}

function buildDrawingPrintSummaryRowHtml(
  row: DrawingPrintSummaryRow,
  color: string,
): string {
  const mark = circledSummaryNumber(row.no)
  const detail = escapeHtml(drawingPrintSummaryDetailText(row))
  const markHtml = mark
    ? `<span class="summary-mark">${escapeHtml(mark)}</span>`
    : ''
  return `<div class="summary-row" style="color:${color};">${markHtml}<span class="summary-detail">${detail}</span></div>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildCornerBarPrintSummaryHtml(
  summary: ReturnType<typeof buildCornerBarPrintSummary>,
  left: number,
  top: number,
  scale: number,
): string {
  const rows = summary.detailRows
    .map((row) => {
      const color = getSegmentStrokeHex(normalizeSegmentColor(row.color), false)
      const label = `${cornerBarCategoryLabel(row.category)} ${row.diameter}`
      return `<div class="corner-summary-row"><span class="corner-summary-label-wrap"><span class="corner-summary-chip" style="background:${color};"></span><span class="corner-summary-label">${escapeHtml(label)}</span></span><span class="corner-summary-qty">${row.qty} 本</span></div>`
    })
    .join('')
  return `<div class="summary corner-summary" style="left:${left}px;top:${top}px;--sum-scale:${scale};"><div class="corner-summary-rows">${rows}</div></div>`
}

function buildDrawingPrintSummaryGroups(
  segments: DrawingSegment[],
  units: Unit[],
): DrawingPrintSummaryGroup[] {
  type AccRow = DrawingPrintSummaryRow & {
    groupKey: string
    groupName: string
  }
  const rows = new Map<string, AccRow>()
  const rebarSegments = segments.filter(
    (s) => !(s.bar_type === 'SPACING' && s.quantity === 0),
  )

  for (const seg of rebarSegments) {
    const color = getSegmentColor(seg, units)
    const linkedUnit =
      seg.unit_id != null ? units.find((u) => u.id === seg.unit_id) ?? null : null
    const sameColorUnit =
      units.find(
        (u) =>
          u.is_active !== false &&
          isPersistedUnitId(u.id) &&
          normalizeSegmentColor(u.color) === color,
      ) ?? null
    const groupKey = `color:${color}`
    const groupName =
      linkedUnit?.name?.trim() ||
      seg.unit_name?.trim() ||
      sameColorUnit?.name?.trim() ||
      getSegmentColorLabelJa(color)
    const len = getSegmentEffectiveLengthMm(seg, units)
    const no = getSegmentResolvedMarkNumber(seg, units)
    const key = `${groupKey}::${no ?? 'none'}::${len}`
    const existing = rows.get(key)
    if (existing) {
      existing.count += 1
    } else {
      rows.set(key, {
        len,
        no,
        count: 1,
        color,
        groupKey,
        groupName,
      })
    }
  }

  const groups = new Map<string, DrawingPrintSummaryGroup>()
  for (const row of rows.values()) {
    const existing = groups.get(row.groupKey)
    if (existing) {
      existing.rows.push(row)
    } else {
      groups.set(row.groupKey, {
        key: row.groupKey,
        name: row.groupName,
        color: row.color,
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
        return aNo - bNo
      }),
    }))
}

function getUnitCodeBase(u: Pick<Unit, 'code' | 'name' | 'id'>): string {
  const raw = (u.code ?? u.name ?? u.id).trim()
  const m = raw.match(/^([a-zA-Z]+)-\d+$/)
  return (m?.[1] ?? raw).toLowerCase()
}

/** 番号選択モーダル等の表示用 */
function formatUnitLengthMmJa(u: Pick<Unit, 'length_mm' | 'spacing_mm'>): string {
  if (typeof u.length_mm === 'number' && Number.isFinite(u.length_mm)) {
    return `${u.length_mm.toLocaleString('ja-JP')}mm`
  }
  if (typeof u.spacing_mm === 'number' && Number.isFinite(u.spacing_mm)) {
    return `${u.spacing_mm.toLocaleString('ja-JP')}mm`
  }
  return '長さ未登録'
}

/** 同一系統ユニットの「使用中の番号」（mark_number 優先、無ければ code 末尾の採番用数字） */
function collectSuffixMarksForBase(
  units: Unit[],
  source: Pick<Unit, 'code' | 'color' | 'name' | 'id'>,
): number[] {
  const base = getUnitCodeBase(source)
  const color = normalizeSegmentColor(source.color)
  const out: number[] = []
  for (const u of units) {
    if (getUnitCodeBase(u) !== base) continue
    if (normalizeSegmentColor(u.color) !== color) continue
    if (typeof u.mark_number === 'number' && Number.isFinite(u.mark_number)) {
      out.push(u.mark_number)
      continue
    }
    const p = parseMarkFromUnitCode(u.code)
    if (p != null) out.push(p)
  }
  return out
}

function nextCodeSuffixForBase(
  units: Unit[],
  source: Pick<Unit, 'code' | 'color' | 'name' | 'id'>,
): number {
  const used = collectSuffixMarksForBase(units, source)
  return used.length > 0 ? Math.max(...used) + 1 : 1
}

/** 図面上のピクセル距離を mm として扱う（1px≒1mm 想定。必要なら後で係数を追加） */
function canvasDistanceToLengthMm(p1: Point, p2: Point): number {
  return Math.max(1, Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y)))
}

type LastAction =
  | { type: 'create'; segment: DrawingSegment }
  | { type: 'delete'; segment: DrawingSegment }
  | { type: 'update'; before: DrawingSegment; after: DrawingSegment }
  | { type: 'move'; before: DrawingSegment[]; after: DrawingSegment[] }
  | {
      type: 'split'
      before: DrawingSegment
      created: [DrawingSegment, DrawingSegment]
    }
  | { type: 'corner-create'; cornerBar: DrawingCornerBar }
  | { type: 'corner-delete'; cornerBar: DrawingCornerBar }
  | { type: 'corner-update'; before: DrawingCornerBar }
  | null

/** コーナー筋レイヤーの表示・編集対象 */
type DrawingLayer = 'unit' | 'corner'

/** 画面・印刷キャプチャ共通の描画オプション */
type DrawingPaintOptions = {
  showSegments: boolean
  showCornerBars: boolean
  segmentEmphasis: 'full' | 'dim' | 'hidden'
  cornerEmphasis: 'full' | 'dim' | 'hidden'
  /** false のとき選択ハイライト・分割プレビュー等を省略（印刷用） */
  interactiveHighlight: boolean
  /** ユニット描画中・分割ホバー（ユニットタブの操作フィードバック） */
  showUnitInteractionOverlay?: boolean
}

const REFERENCE_LAYER_ALPHA = 0.45

function paintEmphasisAlpha(emphasis: 'full' | 'dim' | 'hidden'): number {
  if (emphasis === 'hidden') return 0
  return emphasis === 'dim' ? REFERENCE_LAYER_ALPHA : 1
}

type CornerBarDragState = {
  id: string
  origin: Point
  start: { x: number; y: number }
  snapshot: DrawingCornerBar
}

/**
 * 付加筋の端点ドラッグ（辺の図面上の長さを変える）。
 * snapshot から毎回計算し直すので、途中の値が積み重ならない。
 */
type CornerBarEdgeDragState = {
  id: string
  edgeIndex: number
  snapshot: DrawingCornerBar
}

/** 形状未選択のままクリックしたあと、モーダルで形状を選んだら配置する待ち状態 */
type PendingCornerBarPlacement = {
  center: Point
  sizePx: number
}

type SegmentDragState = {
  ids: string[]
  origin: Point
  startPositions: Record<string, { x1: number; y1: number; x2: number; y2: number }>
  snapshots: Record<string, DrawingSegment>
}

type SegmentLabelDragState = {
  segmentId: string
  origin: Point
  startPlacement: SegmentLabelPlacement
  snapshot: DrawingSegment
}

type SegmentLabelRenderInfo = {
  kind: 'spacing' | 'length' | 'mark'
  text: string
  x: number
  y: number
  angle: number
  fontPx: number
  halfWidth: number
  halfHeight: number
}

export function DrawingViewer({
  drawingId,
  projectId,
  imageUrl,
  fileType,
  initialSegments,
  initialSelectedSegmentId,
  initialCornerBars = [],
  units: serverUnits = [],
}: {
  drawingId: string
  projectId: string
  imageUrl: string
  fileType: string
  initialSegments: DrawingSegment[]
  initialSelectedSegmentId?: string
  initialCornerBars?: DrawingCornerBar[]
  units?: Unit[]
}) {
  const enableTemplateVariantFlow = process.env.NEXT_PUBLIC_TEMPLATE_VARIANT_FLOW !== '0'
  const rotationStorageKey = `drawing:${drawingId}:rotationSteps`
  const layerStorageKey = `drawing:${drawingId}:layer`

  const [segments, setSegments] = useState<DrawingSegment[]>(initialSegments)
  const [drawing, setDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState<Point | null>(null)
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null)

  const [previewUnit, setPreviewUnit] = useState<Unit | null>(null)

  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>(() =>
    initialSelectedSegmentId ? [initialSelectedSegmentId] : [],
  )
  const selectedLabelSegmentIdRef = useRef<string | null>(null)
  const [unitPrefsTick, setUnitPrefsTick] = useState(0)

  const focusedSegmentId =
    selectedSegmentIds.length > 0
      ? selectedSegmentIds[selectedSegmentIds.length - 1]!
      : null

  const recentUnitIds = useMemo(() => {
    void unitPrefsTick
    return readRecentUnitIds(projectId)
  }, [projectId, unitPrefsTick])

  const [lastAction, setLastAction] = useState<LastAction>(null)
  const [splitArmedSegmentId, setSplitArmedSegmentId] = useState<string | null>(
    null,
  )
  const [splitHoverPoint, setSplitHoverPoint] = useState<Point | null>(null)
  const [lastSplitMarker, setLastSplitMarker] = useState<{
    point: Point
    segmentIds: [string, string]
  } | null>(null)
  const [rotationSteps, setRotationSteps] = useState<number>(0) // 0/1/2/3 => 0/90/180/270deg clockwise
  const thumbUploadTimerRef = useRef<number | null>(null)
  const didInitThumbRef = useRef(false)

  function normalizeRotationSteps(steps: number): number {
    return ((steps % 4) + 4) % 4
  }

  function readSavedRotationSteps(): number | null {
    try {
      const raw = window.localStorage.getItem(rotationStorageKey)
      if (raw == null) return null
      const n = Number.parseInt(raw, 10)
      if (!Number.isFinite(n)) return null
      return normalizeRotationSteps(n)
    } catch {
      return null
    }
  }

  function saveRotationSteps(steps: number) {
    try {
      window.localStorage.setItem(rotationStorageKey, String(normalizeRotationSteps(steps)))
    } catch {
      // ignore
    }
  }
  const [newSegmentDraft, setNewSegmentDraft] = useState<{
    p1: Point
    p2: Point
    lengthMm: string
    color: SegmentColor
    bars: { barType: string; quantity: string }[]
    label: string
  } | null>(null)

  /** 線を描く: red-1/2… の番号選択（prompt の代わり）。長さ任意入力もここに集約 */
  const [quickMarkPickModal, setQuickMarkPickModal] = useState<QuickMarkPickModalState | null>(null)
  const quickMarkPickModalRef = useRef<QuickMarkPickModalState | null>(null)
  quickMarkPickModalRef.current = quickMarkPickModal
  const [lengthPresetDrawModal, setLengthPresetDrawModal] = useState<LengthPresetDrawModalState | null>(null)
  const lengthPresetDrawModalRef = useRef<LengthPresetDrawModalState | null>(null)
  lengthPresetDrawModalRef.current = lengthPresetDrawModal
  const submitLengthPresetDrawLengthRef = useRef<
    ((ctx: LengthPresetDrawModalState, lengthMm: number, markNumber: number | null) => Promise<void>) | null
  >(null)
  const [lengthPresetCustomMm, setLengthPresetCustomMm] = useState('')
  const [quickMarkArbitraryMm, setQuickMarkArbitraryMm] = useState('')
  const quickMarkArbitraryInputRef = useRef<HTMLInputElement>(null)
  /** 新しいバリアント追加インプット */
  const [quickMarkNewMm, setQuickMarkNewMm] = useState('')
  const [quickMarkNewMark, setQuickMarkNewMark] = useState('')
  const quickMarkNewMmInputRef = useRef<HTMLInputElement>(null)
  /** 描画中に追加したバリアントをページリロードなしで反映するためのローカルキャッシュ */
  const [localExtraUnits, setLocalExtraUnits] = useState<Unit[]>([])
  const submitQuickMarkPickUnitRef = useRef<
    ((chosenUnit: Unit, ctx: QuickMarkPickModalState) => Promise<void>) | null
  >(null)

  useEffect(() => {
    if (!quickMarkPickModal) {
      setQuickMarkArbitraryMm('')
      setQuickMarkNewMm('')
      setQuickMarkNewMark('')
    }
  }, [quickMarkPickModal])

  const lastUsedRebarDraftKey = `project:${projectId}:lastUsedRebarDraft:v1`

  type StoredRebarDraft = {
    color: SegmentColor
    bars: SegmentBarItem[]
  }

  function readLastUsedRebarDraft(): StoredRebarDraft | null {
    try {
      const raw = window.localStorage.getItem(lastUsedRebarDraftKey)
      if (!raw) return null
      const obj = JSON.parse(raw) as unknown
      if (!obj || typeof obj !== 'object') return null
      const rec = obj as Record<string, unknown>
      const colorRaw = rec.color
      const color: SegmentColor | null = isSegmentColor(colorRaw)
        ? colorRaw
        : null

      const barsRaw = rec.bars
      const bars: SegmentBarItem[] = Array.isArray(barsRaw)
        ? barsRaw
            .map((x) => {
              if (!x || typeof x !== 'object') return null
              const xx = x as Record<string, unknown>
              const barType = String(xx.barType ?? '').trim()
              const quantity = Math.floor(Number(xx.quantity) || 0)
              if (!barType || quantity <= 0) return null
              return { barType, quantity }
            })
            .filter((x): x is SegmentBarItem => !!x)
        : []

      if (!color || bars.length === 0) return null
      return { color, bars }
    } catch {
      return null
    }
  }

  function writeLastUsedRebarDraft(draft: StoredRebarDraft) {
    try {
      window.localStorage.setItem(
        lastUsedRebarDraftKey,
        JSON.stringify({
          color: draft.color,
          bars: draft.bars.map((b) => ({ barType: b.barType, quantity: b.quantity })),
        }),
      )
    } catch {
      // ignore
    }
  }
  const [tool, setTool] = useState<'select' | 'draw'>('select')

  /** ユニット線分レイヤーと、コーナー筋レイヤーをタブで切り替える */
  const [layer, setLayer] = useState<DrawingLayer>('unit')
  const [cornerBars, setCornerBars] = useState<DrawingCornerBar[]>(initialCornerBars)
  const cornerBarsRef = useRef(cornerBars)
  useEffect(() => {
    cornerBarsRef.current = cornerBars
  }, [cornerBars])
  /** 同一付加筋 id の DB 更新を直列化（bars の上書き競合を防ぐ） */
  const cornerBarSaveChainsRef = useRef(new Map<string, Promise<void>>())
  const pendingCornerBarSaveCountRef = useRef(0)
  const [selectedCornerBarId, setSelectedCornerBarId] = useState<string | null>(null)
  /** パレットで選んだ形状と寸法。図面クリックでこの設定を配置する */
  const [placementDraft, setPlacementDraft] = useState<CornerBarPlacementDraft | null>(null)
  const [activePlacementCategory, setActivePlacementCategory] =
    useState<CornerBarCategory>('CORNER')
  const [cornerBarDrag, setCornerBarDrag] = useState<CornerBarDragState | null>(null)
  const [cornerBarEdgeDrag, setCornerBarEdgeDrag] = useState<CornerBarEdgeDragState | null>(
    null,
  )
  /** 端点に乗っているときのカーソル（辺の向きに合わせた ↔ / ↕） */
  const [cornerBarEndHoverCursor, setCornerBarEndHoverCursor] = useState<string | null>(null)
  const [cornerBarShapeSelectModalOpen, setCornerBarShapeSelectModalOpen] = useState(false)
  const [pendingCornerBarPlacement, setPendingCornerBarPlacement] =
    useState<PendingCornerBarPlacement | null>(null)
  /** 付加筋レイヤーの操作モード。ユニットレイヤーの tool と同じ役割 */
  const [cornerTool, setCornerTool] = useState<'select' | 'place'>('select')
  /** 付加筋タブでユニット線分を隠し、付加筋だけを表示する */
  const [cornerBarsOnlyView, setCornerBarsOnlyView] = useState(false)
  /**
   * これから配置する付加筋の色（配置設定で選ぶ）。筋種類ごとに覚え、
   * まだ選んでいない筋種類は既定の色（コーナー筋＝黄・添え筋＝灰・特殊コーナー筋＝マゼンタ）
   */
  const [cornerPlacementColorByCategory, setCornerPlacementColorByCategory] = useState<
    Partial<Record<CornerBarCategory, SegmentColor>>
  >({})
  /** 選択モードで空白をドラッグしたときのトースト */
  const [selectModeEmptyDrag, setSelectModeEmptyDrag] = useState<{ origin: Point } | null>(null)
  const [selectModeCannotDrawToastOpen, setSelectModeCannotDrawToastOpen] = useState(false)

  const cornerBarPlacementCategory = (placementDraft?.category ??
    activePlacementCategory) as CornerBarCategory
  const cornerPlacementColor =
    cornerPlacementColorByCategory[cornerBarPlacementCategory] ??
    DEFAULT_CORNER_BAR_COLORS[cornerBarPlacementCategory] ??
    'red'
  const setCornerPlacementColor = useCallback(
    (color: SegmentColor) =>
      setCornerPlacementColorByCategory((prev) => ({
        ...prev,
        [cornerBarPlacementCategory]: color,
      })),
    [cornerBarPlacementCategory],
  )
  const cornerBarShapeModalOptions = useMemo(
    () => getCornerBarShapeOptionsForCategory(cornerBarPlacementCategory),
    [cornerBarPlacementCategory],
  )

  /** パレットで選んだ形状と寸法。配置ツールで図面クリックすると配置する */
  function changePlacementDraft(draft: CornerBarPlacementDraft | null) {
    setPlacementDraft(draft)
    if (draft?.category) {
      setActivePlacementCategory(draft.category as CornerBarCategory)
    }
  }

  function enterCornerPlaceMode() {
    setSelectedCornerBarId(null)
    setCornerTool('place')
  }

  function selectCornerBar(id: string | null) {
    setSelectedCornerBarId(id)
    if (id != null) setCornerTool('select')
  }

  function selectCornerBarShapeFromModal(
    shapeType: CornerBarPlacementDraft['shapeType'],
    rotation: number,
  ) {
    const draft = makeCornerBarDraft(shapeType, {
      ...(placementDraft ?? { category: cornerBarPlacementCategory }),
      rotation,
    })
    changePlacementDraft(draft)
    setCornerBarShapeSelectModalOpen(false)
    const pending = pendingCornerBarPlacement
    setPendingCornerBarPlacement(null)
    if (pending) {
      void insertCornerBarAt(draft, pending.center, pending.sizePx)
    }
  }

  function placeCornerBarAtCanvasPoint(pt: Point) {
    const category = (placementDraft?.category ??
      cornerBarPlacementCategory) as CornerBarCategory
    const sizePx = getDefaultCornerBarSizePxForPlacement(category)
    if (!placementDraft) {
      setPendingCornerBarPlacement({ center: pt, sizePx })
      setCornerBarShapeSelectModalOpen(true)
      return
    }
    void insertCornerBarAt(placementDraft, pt, sizePx)
  }
  const cornerBarDragMovedRef = useRef(false)
  /** 付加筋の線上にマウスがあるときだけカーソルを変える（配置待ちでも十字と区別） */
  const [cornerBarHovering, setCornerBarHovering] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  /** 図面エリアを画面全体に広げる（A3 比率は維持したまま拡大） */
  const [isFullscreen, setIsFullscreen] = useState(false)
  /** A3 横（1.4142:1）の枠。枠に収まる最大サイズを実測して canvas に反映する */
  const a3FrameRef = useRef<HTMLDivElement>(null)
  const [a3BoxSize, setA3BoxSize] = useState<{ w: number; h: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 })
  const [segmentDrag, setSegmentDrag] = useState<SegmentDragState | null>(null)
  const segmentDragMovedRef = useRef(false)
  const [segmentLabelDrag, setSegmentLabelDrag] =
    useState<SegmentLabelDragState | null>(null)
  const segmentLabelDragMovedRef = useRef(false)
  const [printSummaryPos, setPrintSummaryPos] = useState<Point>({ x: 24, y: 24 })
  const [printSummaryScale, setPrintSummaryScale] = useState(1)
  const [cornerPrintSummaryPos, setCornerPrintSummaryPos] = useState<Point>({ x: 24, y: 24 })
  const [cornerPrintSummaryScale, setCornerPrintSummaryScale] = useState(1)
  const [printPreviewLayer, setPrintPreviewLayer] = useState<DrawingLayer>('unit')
  const [printModalImageUrl, setPrintModalImageUrl] = useState<string | null>(null)
  /** 印刷用画像の実サイズ（図面部分だけを切り出すため canvas とは異なる） */
  const [printImageSize, setPrintImageSize] = useState<{ w: number; h: number } | null>(
    null,
  )
  /** 図面印刷の用紙（既定は A3 横） */
  const [printPaper, setPrintPaper] = useState<PrintPaper>('a3-landscape')
  const [summaryDragging, setSummaryDragging] = useState(false)
  const summaryDragRef = useRef<Point | null>(null)
  const summaryBoxRef = useRef<HTMLDivElement>(null)
  const printPreviewRef = useRef<HTMLDivElement>(null)

  const supabase = createClient()
  const router = useRouter()

  /** ルーターキャッシュで古い initialCornerBars が渡っても DB と揃える */
  const reloadDrawingDataFromDb = useCallback(async () => {
    if (pendingCornerBarSaveCountRef.current > 0) return

    const [cornerResult, segmentResult] = await Promise.all([
      supabase
        .from('drawing_corner_bars')
        .select('*')
        .eq('drawing_id', drawingId)
        .order('created_at', { ascending: true })
        .returns<DrawingCornerBar[]>(),
      supabase
        .from('drawing_segments')
        .select('*')
        .eq('drawing_id', drawingId)
        .order('created_at', { ascending: true })
        .returns<DrawingSegment[]>(),
    ])

    if (pendingCornerBarSaveCountRef.current > 0) return

    if (!cornerResult.error && cornerResult.data) {
      cornerBarsRef.current = cornerResult.data
      setCornerBars(cornerResult.data)
    }
    if (!segmentResult.error && segmentResult.data) {
      setSegments(segmentResult.data)
    }
  }, [drawingId, supabase])

  useEffect(() => {
    void reloadDrawingDataFromDb()
  }, [reloadDrawingDataFromDb])

  useEffect(() => {
    function onPageShow(ev: PageTransitionEvent) {
      if (ev.persisted) void reloadDrawingDataFromDb()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [reloadDrawingDataFromDb])

  /** サーバーで空でも、ブラウザのセッションで再取得（RLS/SSR差異のフォロー） */
  const [clientUnits, setClientUnits] = useState<Unit[] | null>(null)

  useEffect(() => {
    if (serverUnits.length > 0) {
      setClientUnits(null)
      return
    }
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('units')
        .select('*')
        .order('created_at', { ascending: true })
        .returns<Unit[]>()
      if (cancelled) return
      if (error) {
        console.warn('[DrawingViewer] units の読み込みに失敗:', error.message)
        setClientUnits([])
        return
      }
      setClientUnits(data ?? [])
    })()
    return () => {
      cancelled = true
    }
    // supabase は createClient() の参照が変わるため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 上記
  }, [serverUnits.length])

  useEffect(() => {
    if (!segmentDrag) return

    const drag = segmentDrag
    const dragThreshold = 2

    function pointFromClient(clientX: number, clientY: number): Point {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const xr = (clientX - rect.left - offset.x) / scale
      const yr = (clientY - rect.top - offset.y) / scale
      const img = imgRef.current
      if (!img) return { x: xr, y: yr }
      const w = img.width
      const h = img.height
      const steps = ((rotationSteps % 4) + 4) % 4
      if (steps === 0) return { x: xr, y: yr }
      if (steps === 1) return { x: yr, y: h - xr }
      if (steps === 2) return { x: w - xr, y: h - yr }
      return { x: w - yr, y: xr }
    }

    function applyDelta(dx: number, dy: number) {
      setSegments((prev) =>
        prev.map((seg) => {
          const start = drag.startPositions[seg.id]
          if (!start) return seg
          const snapshot = drag.snapshots[seg.id]
          return {
            ...seg,
            x1: start.x1 + dx,
            y1: start.y1 + dy,
            x2: start.x2 + dx,
            y2: start.y2 + dy,
            memo: snapshot
              ? shiftSegmentLabelPlacementMemo(snapshot.memo, dx, dy)
              : seg.memo,
          }
        }),
      )
    }

    function handleMove(ev: MouseEvent) {
      const pt = pointFromClient(ev.clientX, ev.clientY)
      const dx = pt.x - drag.origin.x
      const dy = pt.y - drag.origin.y
      if (!segmentDragMovedRef.current && Math.hypot(dx, dy) < dragThreshold / scale) {
        return
      }
      segmentDragMovedRef.current = true
      applyDelta(dx, dy)
    }

    function handleUp(ev: MouseEvent) {
      const pt = pointFromClient(ev.clientX, ev.clientY)
      const dx = pt.x - drag.origin.x
      const dy = pt.y - drag.origin.y
      if (segmentDragMovedRef.current) {
        void commitSegmentDrag(drag, dx, dy)
      }
      segmentDragMovedRef.current = false
      setSegmentDrag(null)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [segmentDrag, offset.x, offset.y, scale, rotationSteps])

  useEffect(() => {
    if (!segmentLabelDrag) return

    const drag = segmentLabelDrag
    const dragThreshold = 2

    function pointFromClient(clientX: number, clientY: number): Point {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const xr = (clientX - rect.left - offset.x) / scale
      const yr = (clientY - rect.top - offset.y) / scale
      const img = imgRef.current
      if (!img) return { x: xr, y: yr }
      const w = img.width
      const h = img.height
      const steps = normalizeRotationSteps(rotationSteps)
      if (steps === 0) return { x: xr, y: yr }
      if (steps === 1) return { x: yr, y: h - xr }
      if (steps === 2) return { x: w - xr, y: h - yr }
      return { x: w - yr, y: xr }
    }

    function applyDelta(dx: number, dy: number) {
      const nextPlacement: SegmentLabelPlacement = {
        ...drag.startPlacement,
        x: (drag.startPlacement.x ?? 0) + dx,
        y: (drag.startPlacement.y ?? 0) + dy,
      }
      const memo = updateSegmentLabelPlacementMemo(
        drag.snapshot.memo,
        nextPlacement,
      )
      setSegments((prev) =>
        prev.map((seg) =>
          seg.id === drag.segmentId ? { ...seg, memo } : seg,
        ),
      )
    }

    function handleMove(ev: MouseEvent) {
      const pt = pointFromClient(ev.clientX, ev.clientY)
      const dx = pt.x - drag.origin.x
      const dy = pt.y - drag.origin.y
      if (
        !segmentLabelDragMovedRef.current &&
        Math.hypot(dx, dy) < dragThreshold / scale
      ) {
        return
      }
      segmentLabelDragMovedRef.current = true
      applyDelta(dx, dy)
    }

    function handleUp(ev: MouseEvent) {
      const pt = pointFromClient(ev.clientX, ev.clientY)
      const dx = pt.x - drag.origin.x
      const dy = pt.y - drag.origin.y
      if (segmentLabelDragMovedRef.current) {
        void commitSegmentLabelDrag(drag, dx, dy)
      } else {
        setSegments((prev) =>
          prev.map((seg) =>
            seg.id === drag.segmentId ? drag.snapshot : seg,
          ),
        )
      }
      segmentLabelDragMovedRef.current = false
      setSegmentLabelDrag(null)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [segmentLabelDrag, offset.x, offset.y, scale, rotationSteps])

  const effectiveUnits = useMemo(() => {
    const base = serverUnits.length > 0 ? serverUnits : (clientUnits ?? [])
    if (localExtraUnits.length === 0) return base
    const baseIds = new Set(base.map((u) => u.id))
    return [...base, ...localExtraUnits.filter((u) => !baseIds.has(u.id))]
  }, [serverUnits, clientUnits, localExtraUnits])
  const focusedSegment = useMemo(
    () => (focusedSegmentId ? segments.find((s) => s.id === focusedSegmentId) ?? null : null),
    [focusedSegmentId, segments],
  )
  const focusedSegmentUnit = useMemo(() => {
    if (!focusedSegment?.unit_id) return null
    return effectiveUnits.find((u) => u.id === focusedSegment.unit_id) ?? null
  }, [focusedSegment, effectiveUnits])

  /** DB保存済み（UUID）かつ無効でないユニットのみモーダル・割当に使う */
  const persistedActiveUnits = useMemo(
    () => effectiveUnits.filter((u) => u.is_active !== false && isPersistedUnitId(u.id)),
    [effectiveUnits],
  )

  const unitById = useMemo(() => {
    return new Map(effectiveUnits.map((u) => [u.id, u]))
  }, [effectiveUnits])

  const segmentsSortedForLabels = [...segments].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  )
  const labelById = getSegmentLabelMap(segments)
  const drawingPrintSummaryGroups = useMemo(
    () => buildDrawingPrintSummaryGroups(segments, effectiveUnits),
    [segments, effectiveUnits],
  )
  const cornerBarPrintSummary = useMemo(
    () => buildCornerBarPrintSummary(cornerBars, normalizeSegmentColor),
    [cornerBars],
  )
  const printPreviewHasSummary =
    printPreviewLayer === 'corner'
      ? cornerBars.length > 0
      : drawingPrintSummaryGroups.length > 0
  const activePrintSummaryPos =
    printPreviewLayer === 'corner' ? cornerPrintSummaryPos : printSummaryPos
  const activePrintSummaryScale =
    printPreviewLayer === 'corner' ? cornerPrintSummaryScale : printSummaryScale
  const setActivePrintSummaryPos =
    printPreviewLayer === 'corner' ? setCornerPrintSummaryPos : setPrintSummaryPos
  const setActivePrintSummaryScale =
    printPreviewLayer === 'corner' ? setCornerPrintSummaryScale : setPrintSummaryScale

  useEffect(() => {
    if (!summaryDragging) return

    function handleMove(ev: MouseEvent) {
      const container = printPreviewRef.current
      const drag = summaryDragRef.current
      if (!container || !drag) return
      const rect = container.getBoundingClientRect()
      const nextX = ev.clientX - rect.left - drag.x
      const nextY = ev.clientY - rect.top - drag.y
      const boxEl = summaryBoxRef.current
      const boxW = (boxEl?.offsetWidth ?? 120) * activePrintSummaryScale
      const boxH = (boxEl?.offsetHeight ?? 80) * activePrintSummaryScale
      setActivePrintSummaryPos({
        x: Math.max(0, Math.min(nextX, Math.max(0, rect.width - boxW))),
        y: Math.max(0, Math.min(nextY, Math.max(0, rect.height - boxH))),
      })
    }

    function handleUp() {
      summaryDragRef.current = null
      setSummaryDragging(false)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [summaryDragging, activePrintSummaryScale, setActivePrintSummaryPos])

  function computeNextSegmentLabel(): string {
    const last = segmentsSortedForLabels[segmentsSortedForLabels.length - 1]
    if (segmentsSortedForLabels.length === 0) return 'S01'
    const lb = labelById[last.id]
    const m = lb?.match(/^S(\d{2})$/)
    if (m) return `S${String(Number(m[1]) + 1).padStart(2, '0')}`
    return `S${String(segmentsSortedForLabels.length + 1).padStart(2, '0')}`
  }

  const activeUnitStorageKey = `project:${projectId}:activeDrawingUnitId`
  const activeTemplateStorageKey = `project:${projectId}:activeTemplateId`
  const activeColorStorageKey = `project:${projectId}:activeTemplateColor`
  const activeLengthPresetStorageKey = `project:${projectId}:activeLengthPresetGroupId`
  const [activeDrawingUnitId, setActiveDrawingUnitId] = useState<string | null>(null)
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [activeTemplateColor, setActiveTemplateColor] = useState<SegmentColor>('red')
  const [lengthPresetGroups, setLengthPresetGroups] = useState<LengthPresetGroup[]>([])
  const [activeLengthPresetGroupId, setActiveLengthPresetGroupId] = useState<string | null>(null)
  const [lengthPresetSelectUnit, setLengthPresetSelectUnit] = useState<Unit | null>(null)

  const templateSummaries = useMemo<TemplateSummary[]>(
    () => buildTemplateSummaries(persistedActiveUnits),
    [persistedActiveUnits],
  )

  const activeUnit = useMemo(
    () =>
      activeDrawingUnitId
        ? persistedActiveUnits.find((u) => u.id === activeDrawingUnitId) ?? null
        : null,
    [activeDrawingUnitId, persistedActiveUnits],
  )

  const activeLengthPresetGroup = useMemo(
    () =>
      activeLengthPresetGroupId
        ? lengthPresetGroups.find((g) => g.id === activeLengthPresetGroupId) ?? null
        : null,
    [activeLengthPresetGroupId, lengthPresetGroups],
  )

  // アクティブユニット選択肢: 色ベース（例: red）ごとに 1 件だけ代表を持つ
  // （描画時には後続 prompt で存在する番号（1/2/3等）を選択）
  const activeUnitChoices = useMemo(() => {
    const baseToRep = new Map<string, Unit>()
    const sorted = [...persistedActiveUnits].sort(
      (a, b) => (a.mark_number ?? Number.MAX_SAFE_INTEGER) - (b.mark_number ?? Number.MAX_SAFE_INTEGER),
    )
    for (const u of sorted) {
      const base = getUnitCodeBase(u)
      if (!baseToRep.has(base)) baseToRep.set(base, u)
    }
    return [...baseToRep.values()]
  }, [persistedActiveUnits])

  const activeTemplate = useMemo(
    () => templateSummaries.find((t) => t.id === activeTemplateId) ?? null,
    [templateSummaries, activeTemplateId],
  )

  function selectActiveDrawingUnit(unitId: string | null, opts?: { openLengthPresetPicker?: boolean }) {
    setActiveDrawingUnitId(unitId)
    if (!unitId) {
      setActiveLengthPresetGroupId(null)
      setLengthPresetSelectUnit(null)
      return
    }
    const picked = persistedActiveUnits.find((u) => u.id === unitId) ?? null
    if (!picked) return
    setActiveTemplateId(picked.template_id ?? `shape:${picked.shape_type}`)
    setActiveTemplateColor(normalizeSegmentColor(picked.color))
    pushRecentUnitId(projectId, unitId)
    setUnitPrefsTick((x) => x + 1)
    if (opts?.openLengthPresetPicker) {
      setLengthPresetSelectUnit(picked)
    }
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(activeUnitStorageKey)
      if (raw && isPersistedUnitId(raw)) setActiveDrawingUnitId(raw)
    } catch {
      // ignore
    }
  }, [activeUnitStorageKey, projectId])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(activeTemplateStorageKey)
      if (!raw) return
      setActiveTemplateId(raw)
    } catch {
      // ignore
    }
  }, [activeTemplateStorageKey, projectId])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(activeColorStorageKey)
      if (!raw) return
      setActiveTemplateColor(normalizeSegmentColor(raw))
    } catch {
      // ignore
    }
  }, [activeColorStorageKey, projectId])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(activeLengthPresetStorageKey)
      if (raw) setActiveLengthPresetGroupId(raw)
    } catch {
      // ignore
    }
  }, [activeLengthPresetStorageKey, projectId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await fetchLengthPresetGroupsFromDb(supabase)
      if (!cancelled) setLengthPresetGroups(list)
    })()
    return () => {
      cancelled = true
    }
    // supabase is created per render by the local helper; projectId is the meaningful reload boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    try {
      if (activeDrawingUnitId) {
        window.localStorage.setItem(activeUnitStorageKey, activeDrawingUnitId)
      } else {
        window.localStorage.removeItem(activeUnitStorageKey)
      }
    } catch {
      // ignore
    }
  }, [activeDrawingUnitId, activeUnitStorageKey])

  useEffect(() => {
    try {
      if (activeLengthPresetGroupId) {
        window.localStorage.setItem(activeLengthPresetStorageKey, activeLengthPresetGroupId)
      } else {
        window.localStorage.removeItem(activeLengthPresetStorageKey)
      }
    } catch {
      // ignore
    }
  }, [activeLengthPresetGroupId, activeLengthPresetStorageKey])

  useEffect(() => {
    try {
      if (activeTemplateId) {
        window.localStorage.setItem(activeTemplateStorageKey, activeTemplateId)
      } else {
        window.localStorage.removeItem(activeTemplateStorageKey)
      }
      window.localStorage.setItem(activeColorStorageKey, activeTemplateColor)
    } catch {
      // ignore
    }
  }, [activeTemplateId, activeTemplateStorageKey, activeTemplateColor, activeColorStorageKey])

  useEffect(() => {
    if (!activeDrawingUnitId) return
    if (!persistedActiveUnits.some((u) => u.id === activeDrawingUnitId)) {
      setActiveDrawingUnitId(null)
    }
  }, [activeDrawingUnitId, persistedActiveUnits])

  useEffect(() => {
    if (!activeLengthPresetGroupId) return
    if (lengthPresetGroups.length === 0) return
    if (!lengthPresetGroups.some((g) => g.id === activeLengthPresetGroupId)) {
      setActiveLengthPresetGroupId(null)
    }
  }, [activeLengthPresetGroupId, lengthPresetGroups])

  /** 保存済みユニットが1件だけなら、アクティブ未設定時に自動選択（連続描画の摩擦を減らす） */
  useEffect(() => {
    if (activeDrawingUnitId) return
    if (persistedActiveUnits.length !== 1) return
    setActiveDrawingUnitId(persistedActiveUnits[0].id)
  }, [activeDrawingUnitId, persistedActiveUnits])

  useEffect(() => {
    if (templateSummaries.length === 0) {
      setActiveTemplateId(null)
      return
    }
    if (activeTemplateId && templateSummaries.some((t) => t.id === activeTemplateId)) return
    setActiveTemplateId(templateSummaries[0].id)
  }, [activeTemplateId, templateSummaries])

  const getSegmentLabelRenderInfo = useCallback(
    (seg: DrawingSegment): SegmentLabelRenderInfo => {
      const placement = getSegmentLabelPlacement(seg.memo)
      const midX = (seg.x1 + seg.x2) / 2
      const midY = (seg.y1 + seg.y2) / 2
      const s = normalizeRotationSteps(rotationSteps)
      const counterAngleRad = (-s * Math.PI) / 2
      const rotationOffset = placement.rotationSteps * (Math.PI / 2)
      const isSpacing = seg.bar_type === 'SPACING' && seg.quantity === 0

      if (isSpacing) {
        const text = String(seg.length_mm)
        const fontPx = 10
        return {
          kind: 'spacing',
          text,
          x: placement.x ?? midX,
          y: placement.y ?? midY - 6 / scale,
          angle: counterAngleRad + rotationOffset,
          fontPx,
          halfWidth: Math.max(10, text.length * fontPx * 0.36) / scale,
          halfHeight: 8 / scale,
        }
      }

      const circleNum = getSegmentMarkNumberForCanvas(seg, effectiveUnits)
      if (circleNum != null) {
        return {
          kind: 'mark',
          text: String(circleNum),
          x: placement.x ?? midX,
          y: placement.y ?? midY - 2 / scale,
          angle: counterAngleRad + rotationOffset,
          fontPx: 11,
          halfWidth: 11 / scale,
          halfHeight: 11 / scale,
        }
      }

      const text = getSegmentEffectiveLengthMm(seg, effectiveUnits).toLocaleString('ja-JP')
      const dx = seg.x2 - seg.x1
      const dy = seg.y2 - seg.y1
      const segAngle = Math.atan2(dy, dx)
      const screenX = Math.cos(segAngle + s * Math.PI / 2)
      const screenY = Math.sin(segAngle + s * Math.PI / 2)
      const shouldFlip = screenX < 0 || (Math.abs(screenX) < 1e-9 && screenY < 0)
      const baseAngle = shouldFlip ? segAngle + Math.PI : segAngle
      const fontPx = text.replace(/,/g, '').length > 5 ? 10 : 12
      return {
        kind: 'length',
        text,
        x: placement.x ?? midX,
        y: placement.y ?? midY,
        angle: baseAngle + rotationOffset,
        fontPx,
        halfWidth: Math.max(12, text.length * fontPx * 0.36) / scale,
        halfHeight: 9 / scale,
      }
    },
    [effectiveUnits, rotationSteps, scale],
  )

  const isPointInsideSegmentLabel = useCallback(
    (point: Point, seg: DrawingSegment): boolean => {
      const info = getSegmentLabelRenderInfo(seg)
      const dx = point.x - info.x
      const dy = point.y - info.y
      if (info.kind === 'mark') {
        return Math.hypot(dx, dy) <= 13 / scale
      }
      const cos = Math.cos(info.angle)
      const sin = Math.sin(info.angle)
      const localX = dx * cos + dy * sin
      const localY = -dx * sin + dy * cos
      return (
        Math.abs(localX) <= info.halfWidth + 5 / scale &&
        Math.abs(localY) <= info.halfHeight + 4 / scale
      )
    },
    [getSegmentLabelRenderInfo, scale],
  )

  /**
   * 保存済みの付加筋を、図面座標系の折れ線に展開する。
   * コーナー/特殊コーナーは defaultLengths × drawScale、mm は使わない。
   */
  const cornerBarGeometryOf = useCallback((cb: DrawingCornerBar): CornerBarGeometry | null => {
    // くの字は配置ごとの角度で辺の向きが変わる
    const shape = resolveCornerBarShape(cb.shape_type, cb.bars)
    if (!shape) return null
    const drawSegments = isPerEdgeVisualDrawCategory(cb.category)
      ? (normalizeCornerBarBars(shape, cb)[0]?.segments ?? [])
      : []
    return cornerBarCanvasGeometry(
      shape,
      drawSegments,
      cb.x,
      cb.y,
      cb.rotation,
      cb.size_px ?? DEFAULT_CORNER_BAR_SIZE_PX,
      normalizeCornerBarFlip(cb.flipped),
    )
  }, [])

  const findCornerBarAtPoint = useCallback(
    (pt: Point, clickRadius: number): DrawingCornerBar | null => {
      // 後から置いたものを優先して掴めるように末尾から探す
      for (let i = cornerBars.length - 1; i >= 0; i -= 1) {
        const cb = cornerBars[i]!
        const geometry = cornerBarGeometryOf(cb)
        if (!geometry) continue
        const hit = cornerBarSegmentLines(geometry).some(
          ({ p1, p2 }) => distToSegment(pt, p1, p2) < clickRadius,
        )
        if (hit) return cb
      }
      return null
    },
    [cornerBars, cornerBarGeometryOf],
  )

  /**
   * 選択中の付加筋の端点（ドラッグで辺を伸び縮みできる所）を探す。
   * 辺ごとに図面上の長さを持つコーナー筋・特殊コーナー筋だけが対象。
   */
  /**
   * 付加筋の端点（ドラッグで辺を伸び縮みできる所）を探す。
   * 選択モードは選択中の 1 本だけ。位置モードは選択していなくても掴めるよう、
   * 全ての付加筋を上に描かれているものから順に探す。
   */
  const findCornerBarEndAtPoint = useCallback(
    (
      pt: Point,
      radius: number,
      anyCornerBar = false,
    ): { cornerBar: DrawingCornerBar; edgeIndex: number; cursor: string } | null => {
      const selected = cornerBars.find((c) => c.id === selectedCornerBarId)
      const candidates = anyCornerBar
        ? [
            ...(selected ? [selected] : []),
            ...[...cornerBars].reverse().filter((c) => c.id !== selectedCornerBarId),
          ]
        : selected
          ? [selected]
          : []
      for (const cb of candidates) {
        if (!isPerEdgeVisualDrawCategory(cb.category)) continue
        const shape = resolveCornerBarShape(cb.shape_type, cb.bars)
        const geometry = cornerBarGeometryOf(cb)
        if (!shape || !geometry) continue
        for (const end of cornerBarDraggableEnds(shape)) {
          const p = geometry.points[end.vertexIndex]
          const neighbor = geometry.points[end.edgeIndex === 0 ? 1 : end.edgeIndex]
          if (!p || !neighbor || Math.hypot(pt.x - p.x, pt.y - p.y) > radius) continue
          // 図面の表示回転が 90°/270° なら画面上では縦横が入れ替わる
          const horizontalOnCanvas = Math.abs(p.x - neighbor.x) >= Math.abs(p.y - neighbor.y)
          const horizontalOnScreen =
            rotationSteps % 2 === 0 ? horizontalOnCanvas : !horizontalOnCanvas
          return {
            cornerBar: cb,
            edgeIndex: end.edgeIndex,
            cursor: horizontalOnScreen ? 'ew-resize' : 'ns-resize',
          }
        }
      }
      return null
    },
    [cornerBars, selectedCornerBarId, cornerBarGeometryOf, rotationSteps],
  )

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(layerStorageKey)
      if (raw === 'corner' || raw === 'unit') setLayer(raw)
    } catch {
      // ignore
    }
  }, [layerStorageKey])

  useEffect(() => {
    try {
      window.localStorage.setItem(layerStorageKey, layer)
    } catch {
      // ignore
    }
  }, [layer, layerStorageKey])

  /** レイヤーを切り替えたら、もう片方のレイヤーの選択状態は残さない */
  function switchLayer(next: DrawingLayer) {
    if (next === layer) return
    setLayer(next)
    setDrawing(false)
    setStartPoint(null)
    setCurrentPoint(null)
    setSplitArmedSegmentId(null)
    setSplitHoverPoint(null)
    setSegmentDrag(null)
    setSegmentLabelDrag(null)
    setCornerBarDrag(null)
    setCornerBarEdgeDrag(null)
    setCornerBarHovering(false)
    setCornerBarEndHoverCursor(null)
    if (next === 'corner') {
      setSelectedSegmentIds([])
      setTool('select')
      setCornerTool('select')
    } else {
      setSelectedCornerBarId(null)
      setPlacementDraft(null)
    }
  }

  async function insertCornerBarAt(
    draft: CornerBarPlacementDraft,
    pt: Point,
    sizePx: number,
    drag?: { dx: number; dy: number },
  ) {
    const shape = resolveCornerBarShape(draft.shapeType, draft.bars)
    if (!shape) return
    const rotation = drag
      ? cornerBarRotationFromDrag(
          drag.dx,
          drag.dy,
          draft.category,
          draft.shapeType,
          draft.rotation,
        )
      : normalizeCornerBarRotation(draft.rotation)
    // draft の bars は makeCornerBarDraft で形状に合わせて正規化済み
    const bars = draft.bars
    const row = {
      drawing_id: drawingId,
      page_no: 1,
      category: draft.category,
      shape_type: shape.id,
      bars,
      ...cornerBarLegacyFieldsFromBars(bars),
      x: pt.x,
      y: pt.y,
      size_px: clampCornerBarSizePx(sizePx),
      rotation,
      flipped:
        draft.category === 'SPECIAL_CORNER'
          ? normalizeCornerBarFlip(draft.flipped)
          : false,
      color:
        cornerPlacementColorByCategory[draft.category] ??
        DEFAULT_CORNER_BAR_COLORS[draft.category] ??
        cornerPlacementColor,
      label: null as string | null,
    }
    const { data, error } = await supabase
      .from('drawing_corner_bars')
      .insert(row)
      .select()
      .single<DrawingCornerBar>()
    if (error || !data) {
      alert('コーナー筋の追加に失敗しました。')
      return
    }
    setCornerBars((prev) => [...prev, data])
    setLastAction({ type: 'corner-create', cornerBar: data })
  }

  /** 同じ設定・同じ寸法のまま、重ならないよう少しずらして複製する */
  async function duplicateCornerBar(id: string) {
    const source = cornerBars.find((cb) => cb.id === id)
    if (!source) return
    const offsetPx = 40
    const row = {
      drawing_id: source.drawing_id,
      page_no: source.page_no,
      category: source.category,
      shape_type: source.shape_type,
      bars: source.bars,
      diameter: source.diameter,
      segments: source.segments,
      x: source.x + offsetPx,
      y: source.y + offsetPx,
      size_px: source.size_px,
      rotation: source.rotation,
      flipped: normalizeCornerBarFlip(source.flipped),
      color: source.color,
      label: source.label,
    }
    const { data, error } = await supabase
      .from('drawing_corner_bars')
      .insert(row)
      .select()
      .single<DrawingCornerBar>()
    if (error || !data) {
      alert('コーナー筋の複製に失敗しました。')
      return
    }
    setCornerBars((prev) => [...prev, data])
    setSelectedCornerBarId(data.id)
    setLastAction({ type: 'corner-create', cornerBar: data })
  }

  function replaceCornerBarLocal(id: string, next: DrawingCornerBar) {
    cornerBarsRef.current = cornerBarsRef.current.map((cb) => (cb.id === id ? next : cb))
    setCornerBars([...cornerBarsRef.current])
  }

  async function persistCornerBarUpdate(
    id: string,
    updates: Partial<DrawingCornerBar>,
  ): Promise<boolean> {
    const before = cornerBarsRef.current.find((cb) => cb.id === id)
    if (!before) return false
    const next = { ...before, ...updates }
    replaceCornerBarLocal(id, next)
    const { error } = await supabase.from('drawing_corner_bars').update(updates).eq('id', id)
    if (error) {
      replaceCornerBarLocal(id, before)
      alert('付加筋の保存に失敗しました。')
      return false
    }
    setLastAction({ type: 'corner-update', before })
    return true
  }

  function enqueueCornerBarUpdate(
    id: string,
    buildUpdates: (latest: DrawingCornerBar) => Partial<DrawingCornerBar> | null,
  ): Promise<void> {
    const prev = cornerBarSaveChainsRef.current.get(id) ?? Promise.resolve()
    const job = prev.then(async () => {
      pendingCornerBarSaveCountRef.current += 1
      try {
        const latest = cornerBarsRef.current.find((cb) => cb.id === id)
        if (!latest) return
        const updates = buildUpdates(latest)
        if (!updates || Object.keys(updates).length === 0) return
        await persistCornerBarUpdate(id, updates)
      } finally {
        pendingCornerBarSaveCountRef.current -= 1
      }
    })
    cornerBarSaveChainsRef.current.set(id, job)
    return job
  }

  async function flushCornerBarSaveQueue() {
    for (let pass = 0; pass < 20; pass += 1) {
      while (pendingCornerBarSaveCountRef.current > 0) {
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      const tails = [...cornerBarSaveChainsRef.current.values()]
      if (tails.length === 0) return
      await Promise.all(tails)
    }
  }

  function updateCornerBar(id: string, updates: Partial<DrawingCornerBar>) {
    void enqueueCornerBarUpdate(id, () => updates)
  }

  function patchCornerBarBars(
    id: string,
    patch: (bars: CornerBarBarItem[]) => CornerBarBarItem[],
    options?: { keepVertexIndex?: number },
  ) {
    void enqueueCornerBarUpdate(id, (latest) => {
      const shape = resolveCornerBarShape(latest.shape_type, latest.bars)
      if (!shape) return null
      const currentBars = normalizeCornerBarBars(shape, latest)
      const bars = patch(currentBars)
      const keepVertexIndex = options?.keepVertexIndex
      if (keepVertexIndex != null && isPerEdgeVisualDrawCategory(latest.category)) {
        // 図面上の形は bars[0] の drawScale で決まる（cornerBarGeometryOf と同じ）
        const origin = cornerBarOriginKeepingVertex(
          shape,
          currentBars[0]?.segments ?? [],
          bars[0]?.segments ?? [],
          { x: latest.x, y: latest.y },
          latest.rotation,
          latest.size_px ?? DEFAULT_CORNER_BAR_SIZE_PX,
          normalizeCornerBarFlip(latest.flipped),
          keepVertexIndex,
        )
        return { bars, ...cornerBarLegacyFieldsFromBars(bars), x: origin.x, y: origin.y }
      }
      return { bars, ...cornerBarLegacyFieldsFromBars(bars) }
    })
  }

  async function goToCornerBarSummary(href: string) {
    startGlobalLoading()
    await flushCornerBarSaveQueue()
    router.refresh()
    router.push(href)
  }

  async function deleteCornerBar(id: string) {
    const target = cornerBars.find((cb) => cb.id === id)
    if (!target) return
    const { error } = await supabase.from('drawing_corner_bars').delete().eq('id', id)
    if (error) return
    setCornerBars((prev) => prev.filter((cb) => cb.id !== id))
    if (selectedCornerBarId === id) setSelectedCornerBarId(null)
    setLastAction({ type: 'corner-delete', cornerBar: target })
  }

  async function commitCornerBarDrag(drag: CornerBarDragState, dx: number, dy: number) {
    const nextX = drag.start.x + dx
    const nextY = drag.start.y + dy
    const { error } = await supabase
      .from('drawing_corner_bars')
      .update({ x: nextX, y: nextY })
      .eq('id', drag.id)
    if (error) {
      setCornerBars((prev) => prev.map((cb) => (cb.id === drag.id ? drag.snapshot : cb)))
      return
    }
    setLastAction({ type: 'corner-update', before: drag.snapshot })
  }

  useEffect(() => {
    if (!selectModeEmptyDrag) return

    const origin = selectModeEmptyDrag.origin

    function pointFromClient(clientX: number, clientY: number): Point {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const xr = (clientX - rect.left - offset.x) / scale
      const yr = (clientY - rect.top - offset.y) / scale
      const img = imgRef.current
      if (!img) return { x: xr, y: yr }
      const w = img.width
      const h = img.height
      const steps = ((rotationSteps % 4) + 4) % 4
      if (steps === 0) return { x: xr, y: yr }
      if (steps === 1) return { x: yr, y: h - xr }
      if (steps === 2) return { x: w - xr, y: h - yr }
      return { x: w - yr, y: xr }
    }

    function handleUp(ev: MouseEvent) {
      const pt = pointFromClient(ev.clientX, ev.clientY)
      const dx = pt.x - origin.x
      const dy = pt.y - origin.y
      setSelectModeEmptyDrag(null)
      if (Math.hypot(dx, dy) > 5) {
        setSelectModeCannotDrawToastOpen(true)
      }
    }

    window.addEventListener('mouseup', handleUp)
    return () => window.removeEventListener('mouseup', handleUp)
  }, [selectModeEmptyDrag, offset.x, offset.y, scale, rotationSteps])

  useEffect(() => {
    if (!selectModeCannotDrawToastOpen) return
    const id = window.setTimeout(() => setSelectModeCannotDrawToastOpen(false), 2800)
    return () => window.clearTimeout(id)
  }, [selectModeCannotDrawToastOpen])

  useEffect(() => {
    if (!cornerBarDrag) return

    const drag = cornerBarDrag
    const dragThreshold = 2

    function pointFromClient(clientX: number, clientY: number): Point {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const xr = (clientX - rect.left - offset.x) / scale
      const yr = (clientY - rect.top - offset.y) / scale
      const img = imgRef.current
      if (!img) return { x: xr, y: yr }
      const w = img.width
      const h = img.height
      const steps = ((rotationSteps % 4) + 4) % 4
      if (steps === 0) return { x: xr, y: yr }
      if (steps === 1) return { x: yr, y: h - xr }
      if (steps === 2) return { x: w - xr, y: h - yr }
      return { x: w - yr, y: xr }
    }

    function handleMove(ev: MouseEvent) {
      const pt = pointFromClient(ev.clientX, ev.clientY)
      const dx = pt.x - drag.origin.x
      const dy = pt.y - drag.origin.y
      if (!cornerBarDragMovedRef.current && Math.hypot(dx, dy) < dragThreshold / scale) {
        return
      }
      cornerBarDragMovedRef.current = true
      setCornerBars((prev) =>
        prev.map((cb) =>
          cb.id === drag.id ? { ...cb, x: drag.start.x + dx, y: drag.start.y + dy } : cb,
        ),
      )
    }

    function handleUp(ev: MouseEvent) {
      const pt = pointFromClient(ev.clientX, ev.clientY)
      const dx = pt.x - drag.origin.x
      const dy = pt.y - drag.origin.y
      if (cornerBarDragMovedRef.current) {
        void commitCornerBarDrag(drag, dx, dy)
      }
      cornerBarDragMovedRef.current = false
      setCornerBarDrag(null)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cornerBarDrag, offset.x, offset.y, scale, rotationSteps])

  useEffect(() => {
    if (!cornerBarEdgeDrag) return

    const drag = cornerBarEdgeDrag
    const shape = resolveCornerBarShape(drag.snapshot.shape_type, drag.snapshot.bars)
    if (!shape) return
    const snapshotBars = normalizeCornerBarBars(shape, drag.snapshot)
    let latest: Partial<DrawingCornerBar> | null = null

    function updatesAt(clientX: number, clientY: number): Partial<DrawingCornerBar> | null {
      if (!shape) return null
      const resized = resizeCornerBarEdgeToPoint(
        shape,
        snapshotBars[0]?.segments ?? [],
        { x: drag.snapshot.x, y: drag.snapshot.y },
        drag.snapshot.rotation,
        drag.snapshot.size_px ?? DEFAULT_CORNER_BAR_SIZE_PX,
        normalizeCornerBarFlip(drag.snapshot.flipped),
        drag.edgeIndex,
        clientPointToCanvas(clientX, clientY),
      )
      if (!resized) return null
      const drawScale = resized.segments[drag.edgeIndex]?.drawScale
      // 図面上の長さは径によらず同じ形で描くので、全ての鉄筋に同じ倍率を書く
      const bars = snapshotBars.map((bar) => ({
        ...bar,
        segments: bar.segments.map((seg, i) =>
          i === drag.edgeIndex ? { ...seg, drawScale } : seg,
        ),
      }))
      return {
        bars,
        ...cornerBarLegacyFieldsFromBars(bars),
        x: resized.origin.x,
        y: resized.origin.y,
      }
    }

    function handleMove(ev: MouseEvent) {
      const updates = updatesAt(ev.clientX, ev.clientY)
      if (!updates) return
      latest = updates
      setCornerBars((prev) => prev.map((cb) => (cb.id === drag.id ? { ...cb, ...updates } : cb)))
    }

    async function handleUp() {
      setCornerBarEdgeDrag(null)
      if (!latest) return
      const updates = latest
      const { error } = await supabase.from('drawing_corner_bars').update(updates).eq('id', drag.id)
      if (error) {
        setCornerBars((prev) => prev.map((cb) => (cb.id === drag.id ? drag.snapshot : cb)))
        alert('付加筋の保存に失敗しました。')
        return
      }
      setLastAction({ type: 'corner-update', before: drag.snapshot })
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cornerBarEdgeDrag, offset.x, offset.y, scale, rotationSteps])

  const paintDrawing = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      canvasWidth: number,
      canvasHeight: number,
      options: DrawingPaintOptions,
    ) => {
      const img = imgRef.current
      if (!img || !imgLoaded) return

      ctx.clearRect(0, 0, canvasWidth, canvasHeight)
      ctx.save()
      ctx.translate(offset.x, offset.y)
      ctx.scale(scale, scale)
      applyRotationTransform(ctx, img.width, img.height, rotationSteps)
      ctx.drawImage(img, 0, 0)

      const segmentAlpha = paintEmphasisAlpha(options.segmentEmphasis)
      const cornerAlpha = paintEmphasisAlpha(options.cornerEmphasis)
      const visibleSegments =
        options.showSegments && options.segmentEmphasis !== 'hidden' ? segments : []

      if (visibleSegments.length > 0 && segmentAlpha > 0) {
        ctx.save()
        if (segmentAlpha < 1) ctx.globalAlpha = segmentAlpha
        visibleSegments.forEach((seg) => {
      const isSelected =
        options.interactiveHighlight &&
        options.segmentEmphasis === 'full' &&
        selectedSegmentIds.includes(seg.id)
      const isSpacing = seg.bar_type === 'SPACING' && seg.quantity === 0
      const isLastSplit =
        options.segmentEmphasis === 'full' &&
        !!lastSplitMarker &&
        lastSplitMarker.segmentIds.includes(seg.id)
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      const segColor = getSegmentColor(seg, effectiveUnits)
      const baseStroke = isSpacing
        ? isSelected
          ? '#0f766e'
          : '#22c55e'
        : getSegmentStrokeHex(segColor, isSelected)
      if (isSelected) {
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(seg.x1, seg.y1)
        ctx.lineTo(seg.x2, seg.y2)
        ctx.strokeStyle = isSpacing ? 'rgba(16, 185, 129, 0.24)' : 'rgba(250, 204, 21, 0.34)'
        ctx.lineWidth = 10 / scale
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.restore()
      }
      ctx.strokeStyle = isLastSplit && !isSelected ? baseStroke : baseStroke
      ctx.lineWidth =
        isSelected ? 3 / scale : isLastSplit ? 3 / scale : 2 / scale
      ctx.lineCap = isSpacing ? 'round' : 'butt'
      if (isSpacing) {
        ctx.setLineDash([4 / scale, 4 / scale])
      }
      ctx.stroke()
      if (isSpacing) {
        ctx.setLineDash([])
      }

      if (isSelected) {
        ctx.save()
        const handleR = 5 / scale
        const handleStroke = isSpacing ? '#0f766e' : getSegmentStrokeHex(segColor, true)
        for (const p of [
          { x: seg.x1, y: seg.y1 },
          { x: seg.x2, y: seg.y2 },
        ]) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, handleR, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
          ctx.lineWidth = 2 / scale
          ctx.strokeStyle = handleStroke
          ctx.stroke()
        }
        ctx.restore()
      }

      const baseFill = isSpacing
        ? isSelected
          ? '#0f766e'
          : '#16a34a'
        : getSegmentStrokeHex(segColor, isSelected)
      const stroke = getSegmentStrokeHex(segColor, false)
      const labelInfo = getSegmentLabelRenderInfo(seg)

      if (labelInfo.kind === 'mark') {
        const r = 9 / scale
        ctx.beginPath()
        ctx.arc(labelInfo.x, labelInfo.y, r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.fill()
        ctx.lineWidth = 2 / scale
        ctx.strokeStyle = isSelected ? getSegmentStrokeHex(segColor, true) : stroke
        ctx.stroke()

        ctx.save()
        ctx.translate(labelInfo.x, labelInfo.y)
        ctx.rotate(labelInfo.angle)
        ctx.font = `bold ${labelInfo.fontPx / scale}px sans-serif`
        ctx.fillStyle = isSelected ? getSegmentStrokeHex(segColor, true) : stroke
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(labelInfo.text, 0, 0)
        ctx.restore()
      } else {
        ctx.save()
        ctx.translate(labelInfo.x, labelInfo.y)
        ctx.rotate(labelInfo.angle)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        if (labelInfo.kind === 'length') {
          ctx.font = `800 ${labelInfo.fontPx / scale}px sans-serif`
          ctx.lineJoin = 'round'
          ctx.miterLimit = 2
          const fillCol = isSelected ? getSegmentStrokeHex(segColor, true) : stroke
          ctx.lineWidth = 3 / scale
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
          ctx.strokeText(labelInfo.text, 0, 0)
          ctx.fillStyle = fillCol
          ctx.fillText(labelInfo.text, 0, 0)
        } else {
          ctx.font = `${labelInfo.fontPx / scale}px sans-serif`
          ctx.fillStyle = baseFill
          ctx.fillText(labelInfo.text, 0, 0)
        }
        ctx.restore()
      }

      if (isSelected) {
        ctx.save()
        ctx.translate(labelInfo.x, labelInfo.y)
        ctx.rotate(labelInfo.kind === 'mark' ? 0 : labelInfo.angle)
        ctx.setLineDash([3 / scale, 2 / scale])
        ctx.lineWidth = 1 / scale
        ctx.strokeStyle = '#2563eb'
        ctx.strokeRect(
          -labelInfo.halfWidth,
          -labelInfo.halfHeight,
          labelInfo.halfWidth * 2,
          labelInfo.halfHeight * 2,
        )
        ctx.restore()
      }
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
        })

        drawRebarSegmentEndCaps(ctx, visibleSegments, scale, effectiveUnits)
        ctx.restore()
      }

      if (options.showCornerBars && options.cornerEmphasis !== 'hidden' && cornerAlpha > 0) {
        ctx.save()
        if (cornerAlpha < 1) ctx.globalAlpha = cornerAlpha
      cornerBars.forEach((cb) => {
        const geometry = cornerBarGeometryOf(cb)
        if (!geometry) return
        const isSelected =
          options.interactiveHighlight &&
          options.cornerEmphasis === 'full' &&
          cb.id === selectedCornerBarId
        const strokeHex = getSegmentStrokeHex(cb.color, isSelected)

        const tracePath = () => {
          ctx.beginPath()
          geometry.points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y)
            else ctx.lineTo(p.x, p.y)
          })
        }

        if (isSelected) {
          ctx.save()
          tracePath()
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.34)'
          ctx.lineWidth = 10 / scale
          ctx.lineCap = 'round'
          ctx.stroke()
          ctx.restore()
        }

        ctx.save()
        tracePath()
        ctx.strokeStyle = strokeHex
        ctx.lineWidth = (isSelected ? 3 : 2) / scale
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()
        ctx.restore()

        const xs = geometry.points.map((p) => p.x)
        const ys = geometry.points.map((p) => p.y)
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2

        // 曲げ位置が分かるように、選択中は中間の節点に印を打つ
        if (isSelected) {
          ctx.save()
          ctx.fillStyle = strokeHex
          geometry.points.slice(1, -1).forEach((p) => {
            ctx.beginPath()
            ctx.arc(p.x, p.y, 3 / scale, 0, Math.PI * 2)
            ctx.fill()
          })
          ctx.restore()
        }

        // 選択中のコーナー筋・特殊コーナー筋は、両端に辺を伸び縮みさせる掴み所を出す
        const shape = isSelected && isPerEdgeVisualDrawCategory(cb.category)
          ? resolveCornerBarShape(cb.shape_type, cb.bars)
          : null
        if (shape) {
          ctx.save()
          ctx.fillStyle = '#ffffff'
          ctx.strokeStyle = strokeHex
          ctx.lineWidth = 2 / scale
          for (const end of cornerBarDraggableEnds(shape)) {
            const p = geometry.points[end.vertexIndex]
            if (!p) continue
            ctx.beginPath()
            ctx.arc(p.x, p.y, 5 / scale, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
          ctx.restore()
        }

        // 寸法は径ごとに違うため図面には出さない。位置と形だけを描き、
        // 実寸は右パネルで径ごとに確認・修正する
        if (cb.label) {
          const top = Math.min(...ys)
          ctx.save()
          ctx.font = `${14 / scale}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.lineWidth = 3 / scale
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'
          ctx.strokeText(cb.label, cx, top - 20 / scale)
          ctx.fillStyle = strokeHex
          ctx.fillText(cb.label, cx, top - 20 / scale)
          ctx.restore()
        }
      })
        ctx.restore()
      }

    if (
      options.showUnitInteractionOverlay &&
      options.interactiveHighlight &&
      splitArmedSegmentId &&
      splitHoverPoint
    ) {
      ctx.beginPath()
      ctx.arc(splitHoverPoint.x, splitHoverPoint.y, 6 / scale, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(37, 99, 235, 0.25)'
      ctx.fill()
      ctx.lineWidth = 2 / scale
      ctx.strokeStyle = '#2563eb'
      ctx.stroke()
    }

    if (
      options.showUnitInteractionOverlay &&
      options.interactiveHighlight &&
      drawing &&
      startPoint &&
      currentPoint
    ) {
      ctx.beginPath()
      ctx.moveTo(startPoint.x, startPoint.y)
      ctx.lineTo(currentPoint.x, currentPoint.y)
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 2 / scale
      ctx.setLineDash([6 / scale, 4 / scale])
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.restore()
    },
    [
      segments,
      selectedSegmentIds,
      drawing,
      startPoint,
      currentPoint,
      imgLoaded,
      scale,
      offset,
      splitArmedSegmentId,
      splitHoverPoint,
      lastSplitMarker,
      rotationSteps,
      effectiveUnits,
      getSegmentLabelRenderInfo,
      cornerBars,
      selectedCornerBarId,
      cornerBarGeometryOf,
    ],
  )

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !imgLoaded) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const screenOptions: DrawingPaintOptions =
      layer === 'unit'
        ? {
            showSegments: true,
            showCornerBars: false,
            segmentEmphasis: 'full',
            cornerEmphasis: 'hidden',
            interactiveHighlight: true,
            showUnitInteractionOverlay: true,
          }
        : {
            showSegments: !cornerBarsOnlyView,
            showCornerBars: true,
            segmentEmphasis: cornerBarsOnlyView ? 'hidden' : 'full',
            cornerEmphasis: 'full',
            interactiveHighlight: true,
            showUnitInteractionOverlay: false,
          }

    paintDrawing(ctx, canvas.width, canvas.height, screenOptions)
  }, [imgLoaded, layer, cornerBarsOnlyView, paintDrawing])

  const captureDrawingForPrint = useCallback(
    (targetLayer: DrawingLayer): string | null => {
      const canvas = canvasRef.current
      if (!canvas || !imgLoaded) return null
      const off = document.createElement('canvas')
      off.width = canvas.width
      off.height = canvas.height
      const ctx = off.getContext('2d')
      if (!ctx) return null

      const printOptions: DrawingPaintOptions =
        targetLayer === 'unit'
          ? {
              showSegments: true,
              showCornerBars: false,
              segmentEmphasis: 'full',
              cornerEmphasis: 'hidden',
              interactiveHighlight: false,
              showUnitInteractionOverlay: false,
            }
          : {
              showSegments: false,
              showCornerBars: true,
              segmentEmphasis: 'hidden',
              cornerEmphasis: 'full',
              interactiveHighlight: false,
              showUnitInteractionOverlay: false,
            }

      paintDrawing(ctx, off.width, off.height, printOptions)
      return off.toDataURL('image/png')
    },
    [imgLoaded, paintDrawing],
  )

  useEffect(() => {
    drawCanvas()
  }, [drawCanvas])

  useEffect(() => {
    if (!imgLoaded) return
    saveRotationSteps(rotationSteps)
  }, [rotationSteps, imgLoaded])

  useEffect(() => {
    if (!imgLoaded) return
    if (!didInitThumbRef.current) {
      // Skip initial mount thumbnail generation; wait for a real edit.
      didInitThumbRef.current = true
      return
    }
    if (thumbUploadTimerRef.current) {
      window.clearTimeout(thumbUploadTimerRef.current)
    }
    thumbUploadTimerRef.current = window.setTimeout(() => {
      void uploadCompositeThumbnail()
    }, 1200)
    return () => {
      if (thumbUploadTimerRef.current) window.clearTimeout(thumbUploadTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, imgLoaded, rotationSteps])

  useEffect(() => {
    if (!splitArmedSegmentId) return
    if (!selectedSegmentIds.includes(splitArmedSegmentId)) {
      setSplitArmedSegmentId(null)
      setSplitHoverPoint(null)
    }
  }, [selectedSegmentIds, splitArmedSegmentId])

  useEffect(() => {
    if (!lastSplitMarker) return
    if (!focusedSegmentId) return
    if (!lastSplitMarker.segmentIds.includes(focusedSegmentId)) {
      setLastSplitMarker(null)
    }
  }, [focusedSegmentId, lastSplitMarker])

  useEffect(() => {
    const selectedLabelId = selectedLabelSegmentIdRef.current
    if (selectedLabelId && !selectedSegmentIds.includes(selectedLabelId)) {
      selectedLabelSegmentIdRef.current = null
    }
  }, [selectedSegmentIds])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toUpperCase()
      const isTyping =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        t?.isContentEditable

      /**
       * ショートカットの判定。
       * 日本語/韓国語入力(IME)がオンだと e.key が「ㅇ」「あ」等になり文字比較が効かないため、
       * 物理キー(e.code)を優先して判定する。
       */
      const isKey = (letter: string) =>
        e.code === `Key${letter.toUpperCase()}` ||
        e.key.toLowerCase() === letter.toLowerCase()
      const isDigit = (digit: string) =>
        e.code === `Digit${digit}` || e.code === `Numpad${digit}` || e.key === digit

      if (e.key === 'Escape') {
        if (cornerBarShapeSelectModalOpen) {
          setCornerBarShapeSelectModalOpen(false)
          setPendingCornerBarPlacement(null)
          return
        }
        if (lengthPresetDrawModalRef.current) {
          setLengthPresetDrawModal(null)
          return
        }
        if (quickMarkPickModalRef.current) {
          setQuickMarkPickModal(null)
          setQuickMarkArbitraryMm('')
          setQuickMarkNewMm('')
          setQuickMarkNewMark('')
          return
        }
        if (newSegmentDraft) {
          setNewSegmentDraft(null)
          return
        }
        if (layer === 'corner') {
          if (cornerTool === 'place') {
            setCornerTool('select')
            return
          }
          return
        }
        setSplitArmedSegmentId(null)
        setSplitHoverPoint(null)
        if (drawing) {
          setDrawing(false)
          setStartPoint(null)
          setCurrentPoint(null)
          return
        }
        if (tool === 'draw') {
          setTool('select')
          return
        }
        return
      }

      /** 番号選択モーダル: 入力欄にフォーカスがないとき 1–9 で該当マークのユニットを即確定 */
      if (lengthPresetDrawModalRef.current && !isTyping) {
        const modal = lengthPresetDrawModalRef.current
        if (/^[1-7]$/.test(e.key)) {
          const idx = Number.parseInt(e.key, 10) - 1
          const lengthMm = modal.preset.lengths[idx]
          if (typeof lengthMm === 'number' && Number.isFinite(lengthMm) && lengthMm > 0) {
            e.preventDefault()
            setLengthPresetDrawModal(null)
            void submitLengthPresetDrawLengthRef.current?.(modal, lengthMm, idx + 1)
            return
          }
        }
      }

      if (quickMarkPickModalRef.current && !isTyping) {
        const modal = quickMarkPickModalRef.current
        if (/^[0-9]$/.test(e.key)) {
          const d = Number.parseInt(e.key, 10)
          const matched = modal.numbered.find((x) => x.mark_number === d)
          if (matched) {
            e.preventDefault()
            setQuickMarkPickModal(null)
            setQuickMarkArbitraryMm('')
            setQuickMarkNewMm('')
            setQuickMarkNewMark('')
            void submitQuickMarkPickUnitRef.current?.(matched, modal)
            return
          }
        }
      }

      if (isTyping) return

      const setActiveByUnitId = (unitId: string) => {
        setActiveDrawingUnitId(unitId)
        const picked = persistedActiveUnits.find((u) => u.id === unitId) ?? null
        if (picked) {
          setActiveTemplateId(picked.template_id ?? `shape:${picked.shape_type}`)
          setActiveTemplateColor(normalizeSegmentColor(picked.color))
        }
        pushRecentUnitId(projectId, unitId)
        setUnitPrefsTick((x) => x + 1)
      }

      const setUnitByCode = (code: string) => {
        const u = effectiveUnits.find(
          (x) =>
            x.is_active !== false && isPersistedUnitId(x.id) && x.code === code,
        )
        if (!u) return
        setActiveByUnitId(u.id)
      }

      const setUnitByColor = (color: 'red' | 'blue') => {
        setActiveTemplateColor(color)
        const list = effectiveUnits
          .filter(
            (u) =>
              u.is_active !== false &&
              isPersistedUnitId(u.id) &&
              normalizeSegmentColor(u.color) === color,
          )
          .sort((a, b) => (a.mark_number ?? 0) - (b.mark_number ?? 0))
        const u = list[0]
        if (!u) return
        setActiveByUnitId(u.id)
      }

      if (isDigit('1')) {
        e.preventDefault()
        setUnitByCode('red-1')
        return
      }
      if (isDigit('2')) {
        e.preventDefault()
        setUnitByCode('red-2')
        return
      }
      if (isDigit('4')) {
        e.preventDefault()
        setUnitByCode('blue-4')
        return
      }
      if (isKey('r')) {
        e.preventDefault()
        setUnitByColor('red')
        return
      }
      if (isKey('b')) {
        e.preventDefault()
        setUnitByColor('blue')
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const rebarSorted = [...segments]
          .filter((s) => !(s.bar_type === 'SPACING' && s.quantity === 0))
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        const last = rebarSorted[0]
        if (!last) return
        if (last.unit_id && isPersistedUnitId(last.unit_id)) {
          setActiveDrawingUnitId(last.unit_id)
          const lastUnit = effectiveUnits.find((u) => u.id === last.unit_id) ?? null
          if (lastUnit) {
            setActiveTemplateId(lastUnit.template_id ?? `shape:${lastUnit.shape_type}`)
            setActiveTemplateColor(normalizeSegmentColor(lastUnit.color))
          }
          pushRecentUnitId(projectId, last.unit_id)
          setUnitPrefsTick((x) => x + 1)
        }
        const color = getSegmentColor(last, effectiveUnits)
        const bars = getSegmentBars(last, effectiveUnits)
        if (bars.length > 0) {
          writeLastUsedRebarDraft({ color, bars })
        }
        return
      }

      if (isKey('f')) {
        e.preventDefault()
        pendingFitRef.current = true
        setIsFullscreen((prev) => !prev)
        return
      }
      // 描画ツールの切り替えはユニットレイヤー専用
      if (isKey('d') && layer === 'unit') {
        e.preventDefault()
        setTool('draw')
        return
      }
      // コーナー筋レイヤーでは D を配置ツールに割り当てる（ユニットの描画と同じ役割）
      if (isKey('d') && layer === 'corner') {
        e.preventDefault()
        enterCornerPlaceMode()
        return
      }
      if (isKey('s') && layer === 'unit') {
        e.preventDefault()
        setTool('select')
        return
      }
      if (isKey('s') && layer === 'corner') {
        e.preventDefault()
        setCornerTool('select')
        return
      }
      if (isKey('z') && layer === 'corner' && selectedCornerBarId) {
        e.preventDefault()
        void deleteCornerBar(selectedCornerBarId)
        return
      }
      if (isKey('z') && layer === 'unit' && selectedSegmentIds.length > 0) {
        e.preventDefault()
        void Promise.all(selectedSegmentIds.map((id) => deleteSegment(id)))
        return
      }
      if (isKey('c')) {
        e.preventDefault()
        const rebarSorted = [...segments]
          .filter((s) => !(s.bar_type === 'SPACING' && s.quantity === 0))
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        const last = rebarSorted[0]
        if (!last) return
        if (last.unit_id && isPersistedUnitId(last.unit_id)) {
          setActiveDrawingUnitId(last.unit_id)
          const lastUnit = effectiveUnits.find((u) => u.id === last.unit_id) ?? null
          if (lastUnit) {
            setActiveTemplateId(lastUnit.template_id ?? `shape:${lastUnit.shape_type}`)
            setActiveTemplateColor(normalizeSegmentColor(lastUnit.color))
          }
          pushRecentUnitId(projectId, last.unit_id)
          setUnitPrefsTick((x) => x + 1)
        }
        const color = getSegmentColor(last, effectiveUnits)
        const bars = getSegmentBars(last, effectiveUnits)
        if (bars.length > 0) {
          writeLastUsedRebarDraft({ color, bars })
        }
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    segments,
    effectiveUnits,
    projectId,
    tool,
    drawing,
    newSegmentDraft,
    selectedSegmentIds,
    layer,
    placementDraft,
    cornerTool,
    selectedCornerBarId,
    cornerBarShapeSelectModalOpen,
  ])

  useEffect(() => {
    if (fileType === 'pdf') {
      let cancelled = false
      async function loadPdf() {
        try {
          const res = await fetch(imageUrl)
          const data = await res.arrayBuffer()
          if (cancelled) return
          const doc = await loadPdfDocument(data)
          const page = await doc.getPage(1)
          // 重要: 線分の座標はこのラスタ画像のピクセル座標で保存されるため、
          // scale は 2 固定から変更しないこと（変えると既存の線分が全てずれる）。
          const viewport = page.getViewport({ scale: 2 })
          const off = document.createElement('canvas')
          off.width = viewport.width
          off.height = viewport.height
          const ctx = off.getContext('2d')
          if (!ctx) return
          const renderTask = page.render({ canvas: off, canvasContext: ctx, viewport })
          await renderTask.promise
          if (cancelled) return
          const dataUrl = off.toDataURL('image/png')
          const img = new Image()
          img.onload = () => {
            if (cancelled) return
            imgRef.current = img
            const canvas = canvasRef.current
            const container = containerRef.current
            if (canvas && container) {
              canvas.width = container.clientWidth
              canvas.height = container.clientHeight
              const defaultSteps = img.width < img.height ? 1 : 0
              const savedSteps = readSavedRotationSteps()
              const stepsToUse = savedSteps ?? defaultSteps
              setRotationSteps(stepsToUse)
              applyFitView(container.clientWidth, container.clientHeight, stepsToUse)
            }
            setImgLoaded(true)
          }
          img.src = dataUrl
        } catch (err) {
          if (!cancelled) console.error('PDF load error:', err)
        }
      }
      loadPdf()
      return () => { cancelled = true }
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) {
        canvas.width = container.clientWidth
        canvas.height = container.clientHeight
        const defaultSteps = img.width < img.height ? 1 : 0
        const savedSteps = readSavedRotationSteps()
        const stepsToUse = savedSteps ?? defaultSteps
        setRotationSteps(stepsToUse)
        applyFitView(container.clientWidth, container.clientHeight, stepsToUse)
      }
      setImgLoaded(true)
    }
    img.src = imageUrl
  }, [imageUrl, fileType])

  /** 図面（ページ全体）を A3 枠に収まる最大サイズで中央に表示する */
  const applyFitView = useCallback((boxW: number, boxH: number, steps: number) => {
    const img = imgRef.current
    if (!img || !(boxW > 0) || !(boxH > 0)) return
    const { w: rotW, h: rotH } = getRotatedDims(img.width, img.height, steps)
    const nextScale = computeFitScale(boxW, boxH, rotW, rotH)
    setScale(nextScale)
    setOffset({
      x: (boxW - rotW * nextScale) / 2,
      y: (boxH - rotH * nextScale) / 2,
    })
  }, [])

  // A3 横比率（1.4142:1）で枠に収まる最大サイズを計算する。
  // cqh 等の CSS だけでは flex 由来の高さを解決できないため JS で実測する。
  useEffect(() => {
    const frame = a3FrameRef.current
    if (!frame) return
    const A3_RATIO = 1.4142

    function measure() {
      const el = a3FrameRef.current
      if (!el) return
      const fw = el.clientWidth
      const fh = el.clientHeight
      if (fw <= 0 || fh <= 0) return
      const w = Math.floor(Math.min(fw, fh * A3_RATIO))
      const h = Math.floor(w / A3_RATIO)
      setA3BoxSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    }

    measure()
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null
    observer?.observe(frame)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [isFullscreen])

  /**
   * 全画面の切り替え時は「全体」を押した状態（枠に合わせた表示）で始める。
   * 枠サイズは切り替え直後ではなく ResizeObserver の計測後に確定するため、
   * a3BoxSize が落ち着くまで（最後の更新から 300ms）フィットを追従させる。
   */
  const pendingFitRef = useRef(false)
  useEffect(() => {
    if (!pendingFitRef.current) return
    if (!imgLoaded || !a3BoxSize) return
    applyFitView(a3BoxSize.w, a3BoxSize.h, rotationSteps)
    const timer = setTimeout(() => {
      pendingFitRef.current = false
    }, 300)
    return () => clearTimeout(timer)
  }, [isFullscreen, a3BoxSize, imgLoaded, rotationSteps, applyFitView])

  /** 全画面の切り替え（切り替え後に自動で枠に合わせる） */
  const toggleFullscreen = useCallback(() => {
    pendingFitRef.current = true
    setIsFullscreen((prev) => !prev)
  }, [])

  useEffect(() => {
    function handleResize() {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (canvas && container) {
        const w = container.clientWidth
        const h = container.clientHeight
        if (w <= 0 || h <= 0) return
        if (canvas.width === w && canvas.height === h) return
        canvas.width = w
        canvas.height = h
        drawCanvas()
      }
    }
    window.addEventListener('resize', handleResize)

    // 全画面の切り替えや A3 枠のリサイズは window resize が発生しないため、
    // コンテナ自体のサイズ変化を監視して canvas を追従させる。
    const container = containerRef.current
    const observer =
      typeof ResizeObserver !== 'undefined' && container
        ? new ResizeObserver(() => handleResize())
        : null
    if (observer && container) observer.observe(container)

    return () => {
      window.removeEventListener('resize', handleResize)
      observer?.disconnect()
    }
  }, [drawCanvas])

  function clientPointToCanvas(clientX: number, clientY: number): Point {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const xr = (clientX - rect.left - offset.x) / scale
    const yr = (clientY - rect.top - offset.y) / scale
    const img = imgRef.current
    if (!img) return { x: xr, y: yr }

    const w = img.width
    const h = img.height
    const steps = ((rotationSteps % 4) + 4) % 4

    // The rendering applies rotation after the offset/scale transform.
    // Here we undo it so mouse input stays aligned with segment coordinates.
    if (steps === 0) return { x: xr, y: yr }
    if (steps === 1) return { x: yr, y: h - xr } // 90deg clockwise
    if (steps === 2) return { x: w - xr, y: h - yr } // 180deg
    return { x: w - yr, y: xr } // 270deg clockwise
  }

  function screenToCanvas(e: React.MouseEvent): Point {
    return clientPointToCanvas(e.clientX, e.clientY)
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button === 1) {
      setPanning(true)
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
      return
    }

    if (layer === 'corner') {
      if (e.button !== 0) return
      const pt = screenToCanvas(e)
      // 付加筋の端点は、移動・配置より先に「辺を伸ばす」ドラッグとして掴む。
      // 位置モードでも、置いた付加筋の端をそのまま伸び縮みできるようにする
      const end = findCornerBarEndAtPoint(pt, 8 / scale, cornerTool === 'place')
      if (end) {
        setCornerBarEdgeDrag({
          id: end.cornerBar.id,
          edgeIndex: end.edgeIndex,
          snapshot: end.cornerBar,
        })
        setCornerBarEndHoverCursor(end.cursor)
        return
      }
      const hit = findCornerBarAtPoint(pt, 10 / scale)
      if (hit) {
        if (cornerTool === 'select') {
          selectCornerBar(hit.id)
          cornerBarDragMovedRef.current = false
          setCornerBarDrag({
            id: hit.id,
            origin: pt,
            start: { x: hit.x, y: hit.y },
            snapshot: hit,
          })
        }
        return
      }
      if (cornerTool === 'place') {
        setSelectedCornerBarId(null)
        placeCornerBarAtCanvasPoint(pt)
      } else {
        setSelectedCornerBarId(null)
        setSelectModeEmptyDrag({ origin: pt })
      }
      return
    }

    if (tool === 'draw' && e.button === 0) {
      const pt = screenToCanvas(e)
      setDrawing(true)
      setStartPoint(pt)
      setCurrentPoint(pt)
    }

    if (tool === 'select' && e.button === 0) {
      const pt = screenToCanvas(e)
      const clickRadius = 10 / scale
      if (splitArmedSegmentId) {
        const target = segments.find((s) => s.id === splitArmedSegmentId)
        if (!target) {
          setSplitArmedSegmentId(null)
          setSplitHoverPoint(null)
          return
        }
        const distance = distToSegment(
          pt,
          { x: target.x1, y: target.y1 },
          { x: target.x2, y: target.y2 },
        )
        if (distance < clickRadius) {
          void splitSegmentAtPoint(target, pt)
          return
        }
      }

      const foundLabel = [...segments]
        .reverse()
        .find((seg) => isPointInsideSegmentLabel(pt, seg))
      if (foundLabel) {
        let nextIds: string[]
        if (e.ctrlKey || e.metaKey) {
          nextIds = selectedSegmentIds.includes(foundLabel.id)
            ? selectedSegmentIds.filter((id) => id !== foundLabel.id)
            : [...selectedSegmentIds, foundLabel.id]
        } else {
          nextIds = [foundLabel.id]
        }
        setSelectedSegmentIds(nextIds)
        selectedLabelSegmentIdRef.current = nextIds.includes(foundLabel.id)
          ? foundLabel.id
          : null
        setSegmentDrag(null)

        if (nextIds.includes(foundLabel.id)) {
          const info = getSegmentLabelRenderInfo(foundLabel)
          const placement = getSegmentLabelPlacement(foundLabel.memo)
          segmentLabelDragMovedRef.current = false
          setSegmentLabelDrag({
            segmentId: foundLabel.id,
            origin: pt,
            startPlacement: {
              ...placement,
              x: info.x,
              y: info.y,
            },
            snapshot: foundLabel,
          })
        } else {
          setSegmentLabelDrag(null)
        }
        return
      }

      const found = segments.find((seg) => {
        return distToSegment(pt, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }) < clickRadius
      })
      selectedLabelSegmentIdRef.current = null

      let nextIds: string[]
      if (e.ctrlKey || e.metaKey) {
        if (found) {
          nextIds = selectedSegmentIds.includes(found.id)
            ? selectedSegmentIds.filter((id) => id !== found.id)
            : [...selectedSegmentIds, found.id]
        } else {
          nextIds = selectedSegmentIds
        }
        setSelectedSegmentIds(nextIds)
      } else {
        if (found && selectedSegmentIds.includes(found.id)) {
          nextIds = selectedSegmentIds
        } else {
          nextIds = found ? [found.id] : []
        }
        setSelectedSegmentIds(nextIds)
      }

      if (found && nextIds.includes(found.id)) {
        const startPositions: SegmentDragState['startPositions'] = {}
        const snapshots: SegmentDragState['snapshots'] = {}
        for (const id of nextIds) {
          const seg = segments.find((s) => s.id === id)
          if (!seg) continue
          startPositions[id] = { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 }
          snapshots[id] = seg
        }
        segmentDragMovedRef.current = false
        setSegmentDrag({ ids: nextIds, origin: pt, startPositions, snapshots })
      } else {
        setSegmentDrag(null)
        if (!found) {
          setSelectModeEmptyDrag({ origin: pt })
        }
      }
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (panning) {
      setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
      return
    }
    if (segmentDrag || segmentLabelDrag || cornerBarDrag || cornerBarEdgeDrag) {
      return
    }
    if (layer === 'corner') {
      const pt = screenToCanvas(e)
      const end = findCornerBarEndAtPoint(pt, 8 / scale, cornerTool === 'place')
      setCornerBarEndHoverCursor(end?.cursor ?? null)
      setCornerBarHovering(!!findCornerBarAtPoint(pt, 10 / scale))
      return
    }
    if (tool === 'select' && splitArmedSegmentId) {
      const pt = screenToCanvas(e)
      const target = segments.find((s) => s.id === splitArmedSegmentId)
      if (!target) {
        setSplitHoverPoint(null)
      } else {
        const clickRadius = 10 / scale
        const distance = distToSegment(
          pt,
          { x: target.x1, y: target.y1 },
          { x: target.x2, y: target.y2 },
        )
        if (distance < clickRadius) {
          const { projectedPoint } = projectPointToSegment(
            pt,
            { x: target.x1, y: target.y1 },
            { x: target.x2, y: target.y2 },
          )
          setSplitHoverPoint(projectedPoint)
        } else {
          setSplitHoverPoint(null)
        }
      }
    } else if (splitHoverPoint) {
      setSplitHoverPoint(null)
    }
    if (drawing) {
      let pt = screenToCanvas(e)
      if (startPoint && e.shiftKey) {
        const dx = Math.abs(pt.x - startPoint.x)
        const dy = Math.abs(pt.y - startPoint.y)
        if (dx > dy) {
          // 水平方向にスナップ
          pt = { x: pt.x, y: startPoint.y }
        } else {
          // 垂直方向にスナップ
          pt = { x: startPoint.x, y: pt.y }
        }
      }
      setCurrentPoint(pt)
    }
  }

  async function handleMouseUp(e: React.MouseEvent) {
    if (panning) {
      setPanning(false)
      return
    }
    if (segmentDrag || segmentLabelDrag || cornerBarDrag) {
      return
    }
    if (layer === 'corner') return

    if (drawing && startPoint && currentPoint && !newSegmentDraft) {
      const p1 = startPoint
      const p2 = currentPoint
      const dx = p2.x - p1.x
      const dy = p2.y - p1.y
      const pixelLen = Math.sqrt(dx * dx + dy * dy)

      if (pixelLen > 5) {
        const geomLen = canvasDistanceToLengthMm(p1, p2)
        const drawSnapCandidates = persistedActiveUnits
          .filter(
            (u) =>
              (u.template_id ?? `shape:${u.shape_type}`) === (activeTemplateId ?? '') &&
              normalizeSegmentColor(u.color) === normalizeSegmentColor(activeTemplateColor),
          )
          .map((u) => u.length_mm)
          .filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0)
        const snappedLen = snapLengthMm(geomLen, drawSnapCandidates)
        const useModal = e.altKey

        if (snappedLen < MIN_REBAR_LENGTH_MM) {
          alert(`${MIN_REBAR_LENGTH_MM}mm未満の鉄筋線分は作成できません。`)
          setDrawing(false)
          setStartPoint(null)
          setCurrentPoint(null)
          return
        }

        if (useModal) {
          openNewSegmentForm(p1, p2, { precomputedLengthMm: snappedLen })
        } else {
          await quickInsertRebar(p1, p2, snappedLen)
        }
      }
    }
    setDrawing(false)
    setStartPoint(null)
    setCurrentPoint(null)
  }

  function getWheelZoomFactor(e: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>): number {
    // macOS trackpad pinch is sent as ctrl+wheel
    if (e.ctrlKey) {
      return Math.exp(-e.deltaY * 0.004)
    }
    // Discrete mouse wheel notch (line mode or large pixel delta)
    if (e.deltaMode === 1 || Math.abs(e.deltaY) >= 50) {
      return e.deltaY < 0 ? 1.1 : 0.9
    }
    // Trackpad two-finger scroll in pixel mode
    return Math.exp(-e.deltaY * 0.002)
  }

  const handleWheelNative = useCallback(
    (e: WheelEvent) => {
      if (!imgLoaded) return
      e.preventDefault()
      e.stopPropagation()

      const factor = getWheelZoomFactor(e)
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      setScale((prev) => {
        const newScale = Math.max(0.1, Math.min(10, prev * factor))
        setOffset((o) => ({
          x: mx - (mx - o.x) * (newScale / prev),
          y: my - (my - o.y) * (newScale / prev),
        }))
        return newScale
      })
    },
    [imgLoaded],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.addEventListener('wheel', handleWheelNative, { passive: false })
    return () => container.removeEventListener('wheel', handleWheelNative)
  }, [handleWheelNative])

  function openNewSegmentForm(
    p1: Point,
    p2: Point,
    opts?: { precomputedLengthMm?: number },
  ) {
    const last = segmentsSortedForLabels[segmentsSortedForLabels.length - 1]
    const nextLabel = computeNextSegmentLabel()
    const unitDefaults = activeUnit

    // モーダルは例外入力。ただしアクティブユニットがあれば色・鉄筋・ラベルはそこを最優先。
    const stored = readLastUsedRebarDraft()

    const lastBars = last ? getSegmentBars(last, effectiveUnits) : []
    const barsFromUnit =
      unitDefaults?.bars?.length &&
      unitDefaults.bars.every((b) => BAR_TYPES.includes(b.diameter as (typeof BAR_TYPES)[number]))
        ? unitDefaults.bars.map((b) => ({
            barType: b.diameter,
            quantity: b.qtyPerUnit,
          }))
        : null

    const defaultBars =
      barsFromUnit ??
      (stored?.bars?.length
        ? stored.bars
        : lastBars.length
          ? lastBars
          : [{ barType: 'D10', quantity: 1 }])

    const supportedBars = defaultBars.filter((b) => BAR_TYPES.includes(b.barType as (typeof BAR_TYPES)[number]))
    const finalBars = supportedBars.length ? supportedBars : [{ barType: 'D10', quantity: 1 }]

    const defaultColor: SegmentColor = normalizeSegmentColor(
      activeTemplateColor ??
        unitDefaults?.color ??
        stored?.color ??
        (last ? getSegmentColor(last, effectiveUnits) : 'red'),
    )

    const lengthMmInit =
      opts?.precomputedLengthMm != null ? String(opts.precomputedLengthMm) : ''

    const labelForRebar =
      unitDefaults != null
        ? (unitDefaults.code ?? unitDefaults.name ?? nextLabel)
        : nextLabel

    setNewSegmentDraft({
      p1,
      p2,
      lengthMm: lengthMmInit,
      color: defaultColor,
      bars: finalBars.map((b) => ({
        barType: b.barType,
        quantity: String(b.quantity),
      })),
      label: labelForRebar,
    })
  }

  async function quickInsertRebarContinue(
    p1: Point,
    p2: Point,
    lengthMm: number,
    seed: QuickRebarInsertSeed | null,
  ) {
    if (lengthMm < MIN_REBAR_LENGTH_MM) {
      alert(`${MIN_REBAR_LENGTH_MM}mm未満の鉄筋線分は作成できません。`)
      return
    }

    const nextLabel = computeNextSegmentLabel()
    const templateId = activeTemplateId ?? templateSummaries[0]?.id ?? null
    const preferredColor = normalizeSegmentColor(activeTemplateColor)

    let bars: SegmentBarItem[] = seed?.bars ?? []
    let color: SegmentColor = seed?.color ?? preferredColor
    let unitId: string | null = seed?.unitId ?? null
    let unitCode: string | null = seed?.unitCode ?? null
    let unitName: string | null = seed?.unitName ?? null
    let markNumber: number | null = seed?.markNumber ?? null
    let label: string = seed?.label ?? nextLabel

    if (!seed?.skipVariantResolution && enableTemplateVariantFlow && templateId) {
      const resolved = resolveVariantByTemplateColorLength(
        persistedActiveUnits,
        templateId,
        preferredColor,
        lengthMm,
      )
      let chosen = resolved.matched
      if (!chosen && resolved.candidates.length > 0) {
        const list = resolved.candidates
          .map((c, i) => `${i + 1}. ${c.code ?? c.unitName} (${c.lengthMm ?? '-'}mm)`)
          .join('\n')
        const pickRaw = window.prompt(
          `一致する Variant がありません。\n候補を選択してください（番号入力）\n\n${list}`,
          '1',
        )
        const idx = Number.parseInt((pickRaw ?? '').trim(), 10)
        if (Number.isFinite(idx) && idx >= 1 && idx <= resolved.candidates.length) {
          chosen = resolved.candidates[idx - 1]!
        }
      }
      if (!chosen && resolved.createSuggestion) {
        const goCreate = window.confirm(
          `Variant が見つかりません。\nTemplate: ${resolved.createSuggestion.templateId}\nColor: ${resolved.createSuggestion.color}\nLength: ${resolved.createSuggestion.lengthMm}mm\n\n/units で新規 Variant を作成しますか？`,
        )
        if (goCreate) {
          startGlobalLoading()
          router.push(
            `/units?templateId=${encodeURIComponent(resolved.createSuggestion.templateId)}&color=${encodeURIComponent(resolved.createSuggestion.color)}&length_mm=${resolved.createSuggestion.lengthMm}`,
          )
        }
        return
      }
      if (chosen) {
        const matchedUnit = persistedActiveUnits.find((u) => u.id === chosen.variantId) ?? null
        color = chosen.color
        bars = chosen.bars.map((b) => ({ barType: b.diameter, quantity: b.qtyPerUnit }))
        unitId = chosen.variantId
        unitCode = chosen.code
        unitName = chosen.unitName
        markNumber = chosen.markNumber
        label = chosen.code ?? chosen.unitName ?? nextLabel
        setActiveDrawingUnitId(chosen.variantId)
        setActiveTemplateId(chosen.templateId)
        setActiveTemplateColor(chosen.color)
        if (matchedUnit) {
          pushRecentUnitId(projectId, matchedUnit.id)
          setUnitPrefsTick((x) => x + 1)
        }
      }
    }

    if (bars.length === 0) {
      const stored = readLastUsedRebarDraft()
      const last = segmentsSortedForLabels[segmentsSortedForLabels.length - 1]
      const lastBars = last ? getSegmentBars(last, effectiveUnits) : []
      const defaultBars =
        stored?.bars?.length
          ? stored.bars
          : lastBars.length
            ? lastBars
            : [{ barType: 'D10', quantity: 1 }]
      const supportedBars = defaultBars.filter((b) =>
        BAR_TYPES.includes(b.barType as (typeof BAR_TYPES)[number]),
      )
      bars = supportedBars.length ? supportedBars : [{ barType: 'D10', quantity: 1 }]
      color = normalizeSegmentColor(stored?.color ?? preferredColor)
      if (!seed?.skipVariantResolution) {
        unitId = null
        unitCode = null
        unitName = null
        markNumber = null
        label = nextLabel
      }
    }

    const legacy = legacyFieldsFromBars(bars)
    const memo = encodeSegmentMeta({ v: 1, color, bars, note: null })

    const { data, error } = await supabase
      .from('drawing_segments')
      .insert({
        drawing_id: drawingId,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        length_mm: lengthMm,
        quantity: legacy.quantity,
        bar_type: legacy.bar_type,
        label: label.trim() || null,
        memo,
        unit_id: unitId,
        unit_code: unitCode,
        unit_name: unitName,
        mark_number: markNumber,
      })
      .select()
      .single<DrawingSegment>()

    if (error) {
      alert('保存に失敗しました: ' + error.message)
      return
    }
    if (data) {
      setSegments((prev) => [...prev, data])
      setSelectedSegmentIds([data.id])
      setLastAction({ type: 'create', segment: data })
      writeLastUsedRebarDraft({ color, bars })
      if (unitId) {
        pushRecentUnitId(projectId, unitId)
        setUnitPrefsTick((x) => x + 1)
      }
    }
  }

  async function quickInsertRebar(p1: Point, p2: Point, lengthMm: number) {
    if (
      activeUnit &&
      activeLengthPresetGroup &&
      activeLengthPresetGroup.lengths.some((len) => Number.isFinite(len) && len > 0)
    ) {
      setLengthPresetDrawModal({
        mode: 'draw',
        p1,
        p2,
        sourceUnit: activeUnit,
        preset: activeLengthPresetGroup,
      })
      setLengthPresetCustomMm('')
      return
    }

    if (activeUnit) {
      const base = getUnitCodeBase(activeUnit)
      const ac = normalizeSegmentColor(activeUnit.color)
      const sameBase = persistedActiveUnits
        .filter((u) => getUnitCodeBase(u) === base && normalizeSegmentColor(u.color) === ac)
        .sort((a, b) => {
          const ma =
            typeof a.mark_number === 'number'
              ? a.mark_number
              : parseMarkFromUnitCode(a.code) ?? 0
          const mb =
            typeof b.mark_number === 'number'
              ? b.mark_number
              : parseMarkFromUnitCode(b.code) ?? 0
          return ma - mb
        })
      const numbered = sameBase.filter(
        (u) =>
          typeof u.length_mm === 'number' && Number.isFinite(u.length_mm) && u.length_mm > 0,
      )
      const nextMark = nextCodeSuffixForBase(persistedActiveUnits, activeUnit)
      const availableMarks = numbered
        .map((u) => u.mark_number)
        .filter((n): n is number => typeof n === 'number')
      setQuickMarkNewMark('')
      setQuickMarkPickModal({
        p1,
        p2,
        lengthMm,
        base,
        numbered,
        availableMarks,
        sourceUnit: activeUnit,
      })
      return
    }
    await quickInsertRebarContinue(p1, p2, lengthMm, null)
  }

  async function submitQuickMarkPickUnit(chosenUnit: Unit, ctx: QuickMarkPickModalState) {
    const bars = chosenUnit.bars
      .filter((b) => BAR_TYPES.includes(b.diameter as (typeof BAR_TYPES)[number]))
      .map((b) => ({ barType: b.diameter, quantity: b.qtyPerUnit }))
    setActiveDrawingUnitId(chosenUnit.id)
    setActiveTemplateId(chosenUnit.template_id ?? `shape:${chosenUnit.shape_type}`)
    setActiveTemplateColor(normalizeSegmentColor(chosenUnit.color))
    /** 図面上のピクセル距離(ctx)ではなく、割当 variant の length_mm を線分に保存する（7300 指定で 3000 と出る不整合を防ぐ） */
    const segmentLengthMm =
      typeof chosenUnit.length_mm === 'number' &&
      Number.isFinite(chosenUnit.length_mm) &&
      chosenUnit.length_mm > 0
        ? chosenUnit.length_mm
        : ctx.lengthMm
    await quickInsertRebarContinue(ctx.p1, ctx.p2, segmentLengthMm, {
      bars,
      color: normalizeSegmentColor(chosenUnit.color),
      unitId: chosenUnit.id,
      unitCode: chosenUnit.code ?? null,
      unitName: chosenUnit.name ?? null,
      markNumber: chosenUnit.mark_number ?? null,
      label:
        chosenUnit.mark_number != null
          ? String(chosenUnit.mark_number)
          : String(segmentLengthMm),
      skipVariantResolution: true,
    })
  }
  submitQuickMarkPickUnitRef.current = submitQuickMarkPickUnit

  function resolveSourceUnitForSegment(segment: DrawingSegment): Unit | null {
    if (activeUnit) return activeUnit
    if (segment.unit_id) {
      const linked = effectiveUnits.find((u) => u.id === segment.unit_id)
      if (linked) return linked
    }
    const color = getSegmentColor(segment, effectiveUnits)
    return (
      persistedActiveUnits.find(
        (u) =>
          u.is_active !== false &&
          isPersistedUnitId(u.id) &&
          normalizeSegmentColor(u.color) === color,
      ) ?? null
    )
  }

  function openLengthPickerForSegment(segmentId: string) {
    const segment = segments.find((s) => s.id === segmentId)
    if (!segment) return
    if (segment.bar_type === 'SPACING' && segment.quantity === 0) return

    if (
      !activeLengthPresetGroup ||
      !activeLengthPresetGroup.lengths.some((len) => Number.isFinite(len) && len > 0)
    ) {
      alert('長さプリセットを選択してください。（図面上部のプリセットボタンから選択）')
      return
    }

    const sourceUnit = resolveSourceUnitForSegment(segment)
    if (!sourceUnit) {
      alert('対応するユニットが見つかりません。')
      return
    }

    setLengthPresetCustomMm('')
    setLengthPresetDrawModal({
      mode: 'edit',
      segmentId,
      p1: { x: segment.x1, y: segment.y1 },
      p2: { x: segment.x2, y: segment.y2 },
      sourceUnit,
      preset: activeLengthPresetGroup,
    })
  }

  async function applyLengthToExistingSegment(
    segmentId: string,
    lengthMm: number,
    markNumber: number | null,
    sourceUnit: Unit,
  ) {
    const segment = segments.find((s) => s.id === segmentId)
    if (!segment) return

    const color = normalizeSegmentColor(sourceUnit.color)
    const sameFamily = (u: Unit) =>
      getUnitCodeBase(u) === getUnitCodeBase(sourceUnit) &&
      normalizeSegmentColor(u.color) === color

    const matchedVariant = persistedActiveUnits.find(
      (u) =>
        sameFamily(u) &&
        typeof u.length_mm === 'number' &&
        Number.isFinite(u.length_mm) &&
        u.length_mm === lengthMm,
    )

    if (matchedVariant) {
      const bars = matchedVariant.bars
        .filter((b) => BAR_TYPES.includes(b.diameter as (typeof BAR_TYPES)[number]))
        .map((b) => ({ barType: b.diameter, quantity: b.qtyPerUnit }))
      const finalBars = bars.length ? bars : [{ barType: 'D10', quantity: 1 }]
      const legacy = legacyFieldsFromBars(finalBars)
      const { meta, legacyNote } = decodeSegmentMeta(segment.memo)
      const resolvedMark = markNumber ?? matchedVariant.mark_number ?? null
      const memo = encodeSegmentMeta({
        v: 1,
        color: normalizeSegmentColor(matchedVariant.color),
        bars: finalBars,
        note: meta?.note ?? legacyNote ?? null,
        labelPlacement: meta?.labelPlacement ?? null,
      })
      await updateSegment(segmentId, {
        length_mm: lengthMm,
        memo,
        bar_type: legacy.bar_type,
        quantity: legacy.quantity,
        unit_id: matchedVariant.id,
        unit_code: matchedVariant.code ?? null,
        unit_name: matchedVariant.name ?? null,
        mark_number: resolvedMark,
        label: resolvedMark != null ? String(resolvedMark) : segment.label,
      })
      return
    }

    const resolvedMark = markNumber ?? segment.mark_number ?? null
    await updateSegment(segmentId, {
      length_mm: lengthMm,
      mark_number: resolvedMark,
      label: markNumber != null ? String(markNumber) : segment.label,
    })
  }

  async function submitLengthPresetDrawLength(
    ctx: LengthPresetDrawModalState,
    lengthMm: number,
    markNumber: number | null,
  ) {
    if (ctx.mode === 'edit' && ctx.segmentId) {
      await applyLengthToExistingSegment(ctx.segmentId, lengthMm, markNumber, ctx.sourceUnit)
      return
    }

    const source = ctx.sourceUnit
    const color = normalizeSegmentColor(source.color)
    const sameFamily = (u: Unit) =>
      getUnitCodeBase(u) === getUnitCodeBase(source) &&
      normalizeSegmentColor(u.color) === color

    const matchedVariant = persistedActiveUnits.find(
      (u) =>
        sameFamily(u) &&
        typeof u.length_mm === 'number' &&
        Number.isFinite(u.length_mm) &&
        u.length_mm === lengthMm,
    )
    if (matchedVariant) {
      const bars = matchedVariant.bars
        .filter((b) => BAR_TYPES.includes(b.diameter as (typeof BAR_TYPES)[number]))
        .map((b) => ({ barType: b.diameter, quantity: b.qtyPerUnit }))
      await quickInsertRebarContinue(ctx.p1, ctx.p2, lengthMm, {
        bars: bars.length ? bars : [{ barType: 'D10', quantity: 1 }],
        color: normalizeSegmentColor(matchedVariant.color),
        unitId: matchedVariant.id,
        unitCode: matchedVariant.code ?? null,
        unitName: matchedVariant.name ?? null,
        markNumber: markNumber ?? matchedVariant.mark_number ?? null,
        label:
          markNumber != null
            ? String(markNumber)
            : matchedVariant.code ?? matchedVariant.name ?? computeNextSegmentLabel(),
        skipVariantResolution: true,
      })
      return
    }

    const bars = source.bars
      .filter((b) => BAR_TYPES.includes(b.diameter as (typeof BAR_TYPES)[number]))
      .map((b) => ({ barType: b.diameter, quantity: b.qtyPerUnit }))
    const finalBars = bars.length ? bars : [{ barType: 'D10', quantity: 1 }]
    await quickInsertRebarContinue(ctx.p1, ctx.p2, lengthMm, {
      bars: finalBars,
      color,
      unitId: null,
      unitCode: null,
      unitName: null,
      markNumber,
      label: markNumber != null ? String(markNumber) : computeNextSegmentLabel(),
      skipVariantResolution: true,
    })
  }
  submitLengthPresetDrawLengthRef.current = submitLengthPresetDrawLength

  async function submitQuickMarkArbitraryLength(ctx: QuickMarkPickModalState, mmStr: string) {
    const v = parseInt(mmStr.trim(), 10)
    if (!Number.isFinite(v) || v <= 0) {
      alert('有効な長さ (mm) を入力してください。')
      return
    }
    const nextLabel = computeNextSegmentLabel()
    const stored = readLastUsedRebarDraft()
    const first = ctx.numbered[0]!
    const fromUnit = first.bars
      .filter((b) => BAR_TYPES.includes(b.diameter as (typeof BAR_TYPES)[number]))
      .map((b) => ({ barType: b.diameter, quantity: b.qtyPerUnit }))
    const defaultBars = stored?.bars?.length ? stored.bars : fromUnit
    const supportedBars = defaultBars.filter((b) =>
      BAR_TYPES.includes(b.barType as (typeof BAR_TYPES)[number]),
    )
    const bars = supportedBars.length ? supportedBars : [{ barType: 'D10', quantity: 1 }]
    const color = normalizeSegmentColor(activeTemplateColor)
    await quickInsertRebarContinue(ctx.p1, ctx.p2, v, {
      bars,
      color,
      unitId: null,
      unitCode: null,
      unitName: null,
      markNumber: null,
      label: nextLabel,
      skipVariantResolution: true,
    })
  }

  async function createAndUseNewVariant(
    ctx: QuickMarkPickModalState,
    mmStr: string,
    markStr: string,
  ) {
    const mm = parseInt(mmStr.trim(), 10)
    if (!Number.isFinite(mm) || mm <= 0) {
      alert('有効な長さ (mm) を入力してください。')
      return
    }
    const markRaw = markStr.trim()
    let userMark: number | null = null
    if (markRaw) {
      const parsed = parseInt(markRaw, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        alert('有効な番号を入力してください。')
        return
      }
      userMark = parsed
    }

    const source = ctx.sourceUnit
    const color = normalizeSegmentColor(source.color as SegmentColor)

    const sameFamily = (u: Unit) =>
      getUnitCodeBase(u) === getUnitCodeBase(source) &&
      normalizeSegmentColor(u.color) === color

    const hasVariantLength = (u: Unit) =>
      typeof u.length_mm === 'number' && Number.isFinite(u.length_mm) && u.length_mm > 0

    if (userMark != null) {
      const filledSameMark = persistedActiveUnits.find(
        (u) =>
          sameFamily(u) &&
          typeof u.mark_number === 'number' &&
          u.mark_number === userMark &&
          hasVariantLength(u),
      )
      if (filledSameMark) {
        if (filledSameMark.length_mm === mm) {
          setQuickMarkPickModal(null)
          setQuickMarkNewMm('')
          setQuickMarkNewMark('')
          await submitQuickMarkPickUnit(filledSameMark, ctx)
          return
        }
        const {
          data: { user: userForUpdate },
        } = await supabase.auth.getUser()
        if (!userForUpdate) {
          alert('ログインが必要です。')
          return
        }
        let { data: upd, error: updErr } = await supabase
          .from('units')
          .update({ length_mm: mm, bars: source.bars })
          .eq('id', filledSameMark.id)
          .select()
          .single<Unit>()
        if (updErr && /(detail_(spec|geometry)|rebar_layout)/i.test(updErr.message)) {
          const retry = await supabase
            .from('units')
            .update({ length_mm: mm })
            .eq('id', filledSameMark.id)
            .select()
            .single<Unit>()
          upd = retry.data
          updErr = retry.error
        }
        if (updErr) {
          alert('長さの更新に失敗しました: ' + updErr.message)
          return
        }
        if (upd) {
          await router.refresh()
          setQuickMarkPickModal(null)
          setQuickMarkNewMm('')
          setQuickMarkNewMark('')
          await submitQuickMarkPickUnit(upd, ctx)
        }
        return
      }
    }

    const codeSuffix = userMark ?? nextCodeSuffixForBase(persistedActiveUnits, source)
    const code = generateUnitCode(color, codeSuffix)

    const placeholderByMark =
      userMark != null
        ? persistedActiveUnits.find(
            (u) =>
              sameFamily(u) &&
              typeof u.mark_number === 'number' &&
              u.mark_number === userMark &&
              !hasVariantLength(u),
          )
        : null
    const placeholderByCode = persistedActiveUnits.find(
      (u) => (u.code ?? '').toLowerCase() === code.toLowerCase() && !hasVariantLength(u),
    )
    const rowToFill = placeholderByMark ?? placeholderByCode ?? null

    const filledByCode = persistedActiveUnits.find(
      (u) => (u.code ?? '').toLowerCase() === code.toLowerCase() && hasVariantLength(u),
    )
    if (filledByCode && !rowToFill) {
      if (filledByCode.length_mm === mm) {
        setQuickMarkPickModal(null)
        setQuickMarkNewMm('')
        setQuickMarkNewMark('')
        await submitQuickMarkPickUnit(filledByCode, ctx)
        return
      }
      const {
        data: { user: userForCodeUpd },
      } = await supabase.auth.getUser()
      if (!userForCodeUpd) {
        alert('ログインが必要です。')
        return
      }
      let { data: updCode, error: errCode } = await supabase
        .from('units')
        .update({ length_mm: mm, bars: source.bars })
        .eq('id', filledByCode.id)
        .select()
        .single<Unit>()
      if (errCode && /(detail_(spec|geometry)|rebar_layout)/i.test(errCode.message)) {
        const retry = await supabase
          .from('units')
          .update({ length_mm: mm })
          .eq('id', filledByCode.id)
          .select()
          .single<Unit>()
        updCode = retry.data
        errCode = retry.error
      }
      if (errCode) {
        alert('長さの更新に失敗しました: ' + errCode.message)
        return
      }
      if (updCode) {
        await router.refresh()
        setQuickMarkPickModal(null)
        setQuickMarkNewMm('')
        setQuickMarkNewMark('')
        await submitQuickMarkPickUnit(updCode, ctx)
      }
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      alert('ログインが必要です。')
      return
    }

    if (rowToFill) {
      const updatePayload = {
        length_mm: mm,
        bars: source.bars,
      }
      let { data, error } = await supabase
        .from('units')
        .update(updatePayload)
        .eq('id', rowToFill.id)
        .select()
        .single<Unit>()
      if (error && /(detail_(spec|geometry)|rebar_layout)/i.test(error.message)) {
        const retry = await supabase
          .from('units')
          .update({ length_mm: mm })
          .eq('id', rowToFill.id)
          .select()
          .single<Unit>()
        data = retry.data
        error = retry.error
      }
      if (error) {
        alert('長さの登録に失敗しました: ' + error.message)
        return
      }
      if (data) {
        await router.refresh()
        setQuickMarkPickModal(null)
        setQuickMarkNewMm('')
        setQuickMarkNewMark('')
        await submitQuickMarkPickUnit(data, ctx)
      }
      return
    }

    /** 番号未指定時は、同じ系統・同じ長さ(mm)の既存行があれば新規 INSERT せずそれを使う（4095 が red-7 / red-8 のように増えるのを防ぐ） */
    if (userMark == null) {
      const existingSameLength = persistedActiveUnits.find(
        (u) => sameFamily(u) && hasVariantLength(u) && u.length_mm === mm,
      )
      if (existingSameLength) {
        setQuickMarkPickModal(null)
        setQuickMarkNewMm('')
        setQuickMarkNewMark('')
        await submitQuickMarkPickUnit(existingSameLength, ctx)
        return
      }
    }

    const payload = {
      user_id: user.id,
      name: source.name,
      location_type: source.location_type,
      shape_type: source.shape_type,
      color: source.color,
      bars: source.bars,
      spacing_mm: source.spacing_mm,
      description: source.description,
      is_active: true,
      template_id: source.template_id,
      length_mm: mm,
      mark_number: userMark,
      code,
      /** /units と同じバリアント群に入るよう、元ユニットの詳細を引き継ぐ（無いと unitVariantGroupKey が分かれ同名が二重表示になる） */
      detail_spec: source.detail_spec ?? null,
      detail_geometry: source.detail_geometry ?? null,
      rebar_layout: source.rebar_layout ?? null,
    }

    let { data, error } = await supabase
      .from('units')
      .insert(payload)
      .select()
      .single<Unit>()

    if (error && /(detail_(spec|geometry)|rebar_layout)/i.test(error.message)) {
      const {
        detail_spec: _ds,
        detail_geometry: _dg,
        rebar_layout: _rl,
        ...fallbackPayload
      } = payload
      const retry = await supabase
        .from('units')
        .insert(fallbackPayload)
        .select()
        .single<Unit>()
      data = retry.data
      error = retry.error
    }

    if (error) {
      alert('バリアント保存に失敗しました: ' + error.message)
      return
    }
    if (!data) return

    setLocalExtraUnits((prev) => [...prev, data])
    setQuickMarkPickModal(null)
    setQuickMarkNewMm('')
    setQuickMarkNewMark('')
    await submitQuickMarkPickUnit(data, ctx)
  }

  async function confirmNewSegment() {
    if (!newSegmentDraft) return
    const { p1, p2 } = newSegmentDraft
    const lengthMm = parseInt(newSegmentDraft.lengthMm, 10)
    const bars: SegmentBarItem[] = newSegmentDraft.bars
      .map((b) => ({
        barType: b.barType,
        quantity: Math.max(0, parseInt(b.quantity, 10) || 0),
      }))
      .filter((b) => b.barType && b.quantity > 0)
    if (isNaN(lengthMm) || lengthMm <= 0) {
      alert('有効な長さ (mm) を入力してください。')
      return
    }
    if (lengthMm < MIN_REBAR_LENGTH_MM) {
      alert(`${MIN_REBAR_LENGTH_MM}mm未満の鉄筋線分は作成できません。`)
      return
    }
    if (bars.length === 0) {
      alert('鉄筋種別と数量を入力してください。')
      return
    }
    const legacy = legacyFieldsFromBars(bars)
    const memo = encodeSegmentMeta({
      v: 1,
      color: normalizeSegmentColor(newSegmentDraft.color),
      bars,
      note: null,
    })

    const unitRow = activeUnit ? activeUnit : null

    const { data, error } = await supabase
      .from('drawing_segments')
      .insert({
        drawing_id: drawingId,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        length_mm: lengthMm,
        quantity: legacy.quantity,
        bar_type: legacy.bar_type,
        label: newSegmentDraft.label.trim() || null,
        memo,
        unit_id: unitRow?.id ?? null,
        unit_code: unitRow?.code ?? null,
        unit_name: unitRow?.name ?? null,
        mark_number: unitRow?.mark_number ?? null,
      })
      .select()
      .single<DrawingSegment>()

    if (!error && data) {
      setSegments((prev) => [...prev, data])
      setSelectedSegmentIds([data.id])
      setLastAction({ type: 'create', segment: data })
      writeLastUsedRebarDraft({
        color: normalizeSegmentColor(newSegmentDraft.color),
        bars,
      })
      if (unitRow?.id) {
        pushRecentUnitId(projectId, unitRow.id)
        setUnitPrefsTick((x) => x + 1)
      }
      setNewSegmentDraft(null)
    }
  }

  async function updateSegment(id: string, updates: Partial<DrawingSegment>) {
    const { error } = await supabase
      .from('drawing_segments')
      .update(updates)
      .eq('id', id)

    if (!error) {
      setSegments((prev) => {
        const before = prev.find((s) => s.id === id)
        const next = prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
        if (before) {
          const after = next.find((s) => s.id === id)!
          setLastAction({ type: 'update', before, after })
        }
        return next
      })
    }
  }

  async function rotateSegmentLabel90(id: string) {
    const segment = segments.find((seg) => seg.id === id)
    if (!segment) return
    const placement = getSegmentLabelPlacement(segment.memo)
    const memo = updateSegmentLabelPlacementMemo(segment.memo, {
      ...placement,
      rotationSteps: (placement.rotationSteps + 3) % 4,
    })
    await persistSegmentLabelMemo(segment, memo)
  }

  async function resetSegmentLabel(id: string) {
    const segment = segments.find((seg) => seg.id === id)
    if (!segment) return
    const memo = updateSegmentLabelPlacementMemo(segment.memo, null)
    await persistSegmentLabelMemo(segment, memo)
  }

  async function persistSegmentLabelMemo(
    before: DrawingSegment,
    memo: string | null,
  ) {
    const after: DrawingSegment = { ...before, memo }
    setSegments((prev) =>
      prev.map((seg) => (seg.id === before.id ? after : seg)),
    )

    const { error } = await supabase
      .from('drawing_segments')
      .update({ memo })
      .eq('id', before.id)

    if (error) {
      setSegments((prev) =>
        prev.map((seg) => (seg.id === before.id ? before : seg)),
      )
      alert('数値ラベルの更新に失敗しました。')
      return
    }

    setLastAction({ type: 'update', before, after })
  }

  async function commitSegmentLabelDrag(
    drag: SegmentLabelDragState,
    dx: number,
    dy: number,
  ) {
    const placement: SegmentLabelPlacement = {
      ...drag.startPlacement,
      x: Math.round(((drag.startPlacement.x ?? 0) + dx) * 100) / 100,
      y: Math.round(((drag.startPlacement.y ?? 0) + dy) * 100) / 100,
    }
    const memo = updateSegmentLabelPlacementMemo(
      drag.snapshot.memo,
      placement,
    )
    const after: DrawingSegment = { ...drag.snapshot, memo }
    const { error } = await supabase
      .from('drawing_segments')
      .update({ memo })
      .eq('id', drag.segmentId)

    if (error) {
      setSegments((prev) =>
        prev.map((seg) =>
          seg.id === drag.segmentId ? drag.snapshot : seg,
        ),
      )
      alert('数値ラベルの移動に失敗しました。')
      return
    }

    setSegments((prev) =>
      prev.map((seg) => (seg.id === drag.segmentId ? after : seg)),
    )
    setLastAction({ type: 'update', before: drag.snapshot, after })
    void uploadCompositeThumbnail()
  }

  async function commitSegmentDrag(drag: SegmentDragState, dx: number, dy: number) {
    const rdx = Math.round(dx)
    const rdy = Math.round(dy)
    if (rdx === 0 && rdy === 0) {
      setSegments((prev) =>
        prev.map((seg) => {
          const start = drag.startPositions[seg.id]
          if (!start) return seg
          return {
            ...seg,
            ...start,
            memo: drag.snapshots[seg.id]?.memo ?? seg.memo,
          }
        }),
      )
      return
    }

    const before: DrawingSegment[] = []
    const after: DrawingSegment[] = []
    const patches: {
      id: string
      x1: number
      y1: number
      x2: number
      y2: number
      memo: string | null
    }[] = []

    for (const id of drag.ids) {
      const start = drag.startPositions[id]
      if (!start) continue
      const seg = drag.snapshots[id]
      if (!seg) continue
      const b: DrawingSegment = {
        ...seg,
        x1: start.x1,
        y1: start.y1,
        x2: start.x2,
        y2: start.y2,
      }
      const a: DrawingSegment = {
        ...seg,
        x1: start.x1 + rdx,
        y1: start.y1 + rdy,
        x2: start.x2 + rdx,
        y2: start.y2 + rdy,
        memo: shiftSegmentLabelPlacementMemo(seg.memo, rdx, rdy),
      }
      before.push(b)
      after.push(a)
      patches.push({
        id,
        x1: a.x1,
        y1: a.y1,
        x2: a.x2,
        y2: a.y2,
        memo: a.memo,
      })
    }

    if (patches.length === 0) return

    const results = await Promise.all(
      patches.map((p) =>
        supabase
          .from('drawing_segments')
          .update({
            x1: p.x1,
            y1: p.y1,
            x2: p.x2,
            y2: p.y2,
            memo: p.memo,
          })
          .eq('id', p.id),
      ),
    )

    if (results.every((r) => !r.error)) {
      setSegments((prev) =>
        prev.map((seg) => {
          const moved = after.find((x) => x.id === seg.id)
          return moved ?? seg
        }),
      )
      setLastAction({ type: 'move', before, after })
      void uploadCompositeThumbnail()
    } else {
      setSegments((prev) =>
        prev.map((seg) => {
          const orig = before.find((x) => x.id === seg.id)
          return orig ?? seg
        }),
      )
      alert('線分の移動に失敗しました。')
    }
  }

  async function bulkApplyTemplateColorToSelection(templateId: string, color: SegmentColor) {
    if (!enableTemplateVariantFlow) return
    const ids = selectedSegmentIds.filter((sid) => {
      const s = segments.find((x) => x.id === sid)
      return s && !(s.bar_type === 'SPACING' && s.quantity === 0)
    })
    if (ids.length === 0) return

    for (const id of ids) {
      const seg = segments.find((s) => s.id === id)
      if (!seg) continue
      const resolved = resolveVariantByTemplateColorLength(
        persistedActiveUnits,
        templateId,
        color,
        seg.length_mm,
      )
      const chosen = resolved.matched ?? resolved.candidates[0] ?? null
      if (!chosen) continue
      const bars: SegmentBarItem[] = chosen.bars.map((b) => ({
        barType: b.diameter,
        quantity: b.qtyPerUnit,
      }))
      const legacy = legacyFieldsFromBars(bars)
      const { meta, legacyNote } = decodeSegmentMeta(seg.memo)
      const memo = encodeSegmentMeta({
        v: 1,
        color: chosen.color,
        bars,
        note: meta?.note ?? legacyNote ?? null,
        labelPlacement: meta?.labelPlacement ?? null,
      })
      await updateSegment(id, {
        memo,
        bar_type: legacy.bar_type,
        quantity: legacy.quantity,
        label: chosen.code ?? chosen.unitName,
        unit_id: chosen.variantId,
        unit_code: chosen.code ?? null,
        unit_name: chosen.unitName ?? null,
        mark_number: chosen.markNumber ?? 1,
      })
    }
    const firstApplied = persistedActiveUnits.find(
      (u) =>
        (u.template_id ?? `shape:${u.shape_type}`) === templateId &&
        normalizeSegmentColor(u.color) === normalizeSegmentColor(color),
    )
    if (firstApplied) {
      setActiveDrawingUnitId(firstApplied.id)
      setActiveTemplateId(templateId)
      setActiveTemplateColor(normalizeSegmentColor(color))
      pushRecentUnitId(projectId, firstApplied.id)
      setUnitPrefsTick((x) => x + 1)
    }
  }

  async function deleteSegment(id: string) {
    const { error } = await supabase
      .from('drawing_segments')
      .delete()
      .eq('id', id)

    if (!error) {
      setSegments((prev) => {
        const deleted = prev.find((s) => s.id === id)
        if (deleted) setLastAction({ type: 'delete', segment: deleted })
        const next = prev.filter((s) => s.id !== id)
        return next
      })
      if (selectedSegmentIds.includes(id)) {
        setSelectedSegmentIds((prev) => prev.filter((x) => x !== id))
      }
    }
  }

  async function splitSegmentAtPoint(segment: DrawingSegment, clickPoint: Point) {
    const a = { x: segment.x1, y: segment.y1 }
    const b = { x: segment.x2, y: segment.y2 }
    const { projectedPoint } = projectPointToSegment(clickPoint, a, b)

    const minDistanceFromEndpoint = 10 / scale
    const distanceToA = Math.hypot(projectedPoint.x - a.x, projectedPoint.y - a.y)
    const distanceToB = Math.hypot(projectedPoint.x - b.x, projectedPoint.y - b.y)
    if (distanceToA < minDistanceFromEndpoint || distanceToB < minDistanceFromEndpoint) {
      alert('端点に近すぎるため分割できません。もう少し中央をクリックしてください。')
      return
    }

    const trimmedLabel = segment.label?.trim() ?? ''
    const labelA = trimmedLabel ? `${trimmedLabel}-1` : null
    const labelB = trimmedLabel ? `${trimmedLabel}-2` : null

    // 鉄筋線分の length_mm はプリセット/入力で選んだ呼称。比例配分すると
    // 3,800 を 2 本に分けたつもりが 1,900 + 1,900 になるため、分割後も同じ呼称を保つ。
    const lengthA = segment.length_mm
    const lengthB = segment.length_mm
    if (segment.length_mm < MIN_REBAR_LENGTH_MM) {
      alert(`${MIN_REBAR_LENGTH_MM}mm未満の鉄筋線分は分割できません。`)
      return
    }

    const unitFields = {
      unit_id: segment.unit_id ?? null,
      unit_code: segment.unit_code ?? null,
      unit_name: segment.unit_name ?? null,
      mark_number: segment.mark_number ?? null,
    }
    const splitMemo = updateSegmentLabelPlacementMemo(segment.memo, null)
    const insertRows = [
      {
        drawing_id: drawingId,
        x1: segment.x1,
        y1: segment.y1,
        x2: projectedPoint.x,
        y2: projectedPoint.y,
        length_mm: lengthA,
        quantity: segment.quantity,
        bar_type: segment.bar_type,
        label: labelA,
        memo: splitMemo,
        ...unitFields,
      },
      {
        drawing_id: drawingId,
        x1: projectedPoint.x,
        y1: projectedPoint.y,
        x2: segment.x2,
        y2: segment.y2,
        length_mm: lengthB,
        quantity: segment.quantity,
        bar_type: segment.bar_type,
        label: labelB,
        memo: splitMemo,
        ...unitFields,
      },
    ] as const

    const { data: createdSegments, error: insertError } = await supabase
      .from('drawing_segments')
      .insert(insertRows)
      .select()
      .returns<DrawingSegment[]>()

    if (insertError || !createdSegments || createdSegments.length !== 2) {
      alert('分割に失敗しました。')
      return
    }

    const { error: deleteError } = await supabase
      .from('drawing_segments')
      .delete()
      .eq('id', segment.id)

    if (deleteError) {
      await supabase
        .from('drawing_segments')
        .delete()
        .in(
          'id',
          createdSegments.map((s) => s.id),
        )
      alert('分割に失敗しました。')
      return
    }

    const [createdA, createdB] = createdSegments
    setSegments((prev) => [
      ...prev.filter((s) => s.id !== segment.id),
      createdA,
      createdB,
    ])
    setSelectedSegmentIds([createdA.id])
    setSplitArmedSegmentId(null)
    setSplitHoverPoint(null)
    setLastSplitMarker({
      point: projectedPoint,
      segmentIds: [createdA.id, createdB.id],
    })
    setLastAction({
      type: 'split',
      before: segment,
      created: [createdA, createdB],
    })
  }

  async function handleUndo() {
    if (!lastAction) return
    if (lastAction.type === 'create') {
      const { segment } = lastAction
      const { error } = await supabase
        .from('drawing_segments')
        .delete()
        .eq('id', segment.id)
      if (!error) {
        setSegments((prev) => prev.filter((s) => s.id !== segment.id))
        setSelectedSegmentIds([])
        setLastAction(null)
      }
    } else if (lastAction.type === 'delete') {
      const { segment } = lastAction
      const { data, error } = await supabase
        .from('drawing_segments')
        .insert(segment)
        .select()
        .single<DrawingSegment>()
      if (!error && data) {
        setSegments((prev) => [...prev, data])
        setSelectedSegmentIds([data.id])
        setLastAction(null)
      }
    } else if (lastAction.type === 'update') {
      const { before } = lastAction
      const { error } = await supabase
        .from('drawing_segments')
        .update({
          x1: before.x1,
          y1: before.y1,
          x2: before.x2,
          y2: before.y2,
          length_mm: before.length_mm,
          quantity: before.quantity,
          bar_type: before.bar_type,
          label: before.label,
          memo: before.memo,
          unit_id: before.unit_id ?? null,
          unit_code: before.unit_code ?? null,
          unit_name: before.unit_name ?? null,
          mark_number: before.mark_number ?? null,
        })
        .eq('id', before.id)
      if (!error) {
        setSegments((prev) => prev.map((s) => (s.id === before.id ? before : s)))
        setSelectedSegmentIds([before.id])
        setLastAction(null)
      }
    } else if (lastAction.type === 'move') {
      const { before } = lastAction
      const results = await Promise.all(
        before.map((b) =>
          supabase
            .from('drawing_segments')
            .update({
              x1: b.x1,
              y1: b.y1,
              x2: b.x2,
              y2: b.y2,
              memo: b.memo,
            })
            .eq('id', b.id),
        ),
      )
      if (results.every((r) => !r.error)) {
        setSegments((prev) =>
          prev.map((seg) => {
            const orig = before.find((b) => b.id === seg.id)
            return orig ?? seg
          }),
        )
        setSelectedSegmentIds(before.map((b) => b.id))
        setLastAction(null)
        void uploadCompositeThumbnail()
      }
    } else if (lastAction.type === 'split') {
      const { before, created } = lastAction
      const createdIds = created.map((s) => s.id)
      const { error: deleteNewError } = await supabase
        .from('drawing_segments')
        .delete()
        .in('id', createdIds)
      if (deleteNewError) return
      const { data: restored, error: restoreError } = await supabase
        .from('drawing_segments')
        .insert(before)
        .select()
        .single<DrawingSegment>()
      if (!restoreError && restored) {
        setSegments((prev) => [
          ...prev.filter((s) => !createdIds.includes(s.id)),
          restored,
        ])
        setSelectedSegmentIds([restored.id])
        setLastAction(null)
      }
    } else if (lastAction.type === 'corner-create') {
      const { cornerBar } = lastAction
      const { error } = await supabase
        .from('drawing_corner_bars')
        .delete()
        .eq('id', cornerBar.id)
      if (!error) {
        setCornerBars((prev) => prev.filter((cb) => cb.id !== cornerBar.id))
        setSelectedCornerBarId(null)
        setLastAction(null)
      }
    } else if (lastAction.type === 'corner-delete') {
      const { cornerBar } = lastAction
      const { data, error } = await supabase
        .from('drawing_corner_bars')
        .insert(cornerBar)
        .select()
        .single<DrawingCornerBar>()
      if (!error && data) {
        setCornerBars((prev) => [...prev, data])
        setSelectedCornerBarId(data.id)
        setLastAction(null)
      }
    } else if (lastAction.type === 'corner-update') {
      const { before } = lastAction
      const { error } = await supabase
        .from('drawing_corner_bars')
        .update({
          x: before.x,
          y: before.y,
          size_px: before.size_px,
          rotation: before.rotation,
          flipped: normalizeCornerBarFlip(before.flipped),
          category: before.category,
          shape_type: before.shape_type,
          bars: before.bars,
          diameter: before.diameter,
          segments: before.segments,
          color: before.color,
          label: before.label,
        })
        .eq('id', before.id)
      if (!error) {
        setCornerBars((prev) => prev.map((cb) => (cb.id === before.id ? before : cb)))
        setSelectedCornerBarId(before.id)
        setLastAction(null)
      }
    }
  }

  function refitForRotation(nextSteps: number) {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !container) return
    setRotationSteps(nextSteps)
    applyFitView(container.clientWidth, container.clientHeight, nextSteps)
  }

  /** 現在の枠に合わせて図面を再フィットする（ズームの「画面に合わせる」） */
  function fitToBox() {
    const container = containerRef.current
    if (!container) return
    applyFitView(container.clientWidth, container.clientHeight, rotationSteps)
  }

  function zoomByFactor(factor: number) {
    const container = containerRef.current
    setScale((prev) => {
      const next = Math.max(0.1, Math.min(10, prev * factor))
      // 枠の中心を基準に拡大縮小する
      if (container) {
        const cx = container.clientWidth / 2
        const cy = container.clientHeight / 2
        setOffset((o) => ({
          x: cx - (cx - o.x) * (next / prev),
          y: cy - (cy - o.y) * (next / prev),
        }))
      }
      return next
    })
  }

  function rotateRight90() {
    const nextSteps = ((rotationSteps + 1) % 4 + 4) % 4
    refitForRotation(nextSteps)
  }

  function rotateLeft90() {
    const nextSteps = ((rotationSteps + 3) % 4 + 4) % 4
    refitForRotation(nextSteps)
    void uploadCompositeThumbnail(nextSteps)
  }

  async function uploadCompositeThumbnail(stepsOverride?: number) {
    const img = imgRef.current
    if (!img || !imgLoaded) return

    const segmentsToDraw = segments.filter(
      (s) => !(s.bar_type === 'SPACING' && s.quantity === 0),
    )

    const steps = typeof stepsOverride === 'number' ? stepsOverride : rotationSteps
    const normalizedSteps = normalizeRotationSteps(steps)

    const { w: rotW, h: rotH } = getRotatedDims(
      img.width,
      img.height,
      normalizedSteps,
    )
    const maxDim = 320
    const scaleDown = Math.min(1, maxDim / Math.max(rotW, rotH))

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rotW * scaleDown))
    canvas.height = Math.max(1, Math.round(rotH * scaleDown))

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.save()
    ctx.scale(scaleDown, scaleDown)
    applyRotationTransform(ctx, img.width, img.height, normalizedSteps)
    ctx.drawImage(img, 0, 0)
    ctx.lineCap = 'round'

    segmentsToDraw.forEach((seg) => {
      const segColor = getSegmentColor(seg, effectiveUnits)
      const stroke = getSegmentStrokeHex(segColor, false)
      ctx.beginPath()
      ctx.moveTo(seg.x1, seg.y1)
      ctx.lineTo(seg.x2, seg.y2)
      ctx.strokeStyle = stroke
      ctx.lineWidth = 2
      ctx.stroke()

      const dx = seg.x2 - seg.x1
      const dy = seg.y2 - seg.y1
      const d = Math.hypot(dx, dy)
      if (d > 1e-6) {
        const nx = -dy / d
        const ny = dx / d
        const h = 5
        ctx.beginPath()
        ctx.moveTo(seg.x1 - nx * h, seg.y1 - ny * h)
        ctx.lineTo(seg.x1 + nx * h, seg.y1 + ny * h)
        ctx.moveTo(seg.x2 - nx * h, seg.y2 - ny * h)
        ctx.lineTo(seg.x2 + nx * h, seg.y2 + ny * h)
        ctx.strokeStyle = stroke
        ctx.stroke()
      }
    })

    ctx.restore()

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    if (!blob) return

    const thumbPath = `${projectId}/${drawingId}.thumb.png`
    const { error } = await supabase.storage
      .from('drawings')
      .upload(thumbPath, blob, { upsert: true, contentType: 'image/png' })
    if (error) {
      // Thumbnail generation is a best-effort feature.
      console.warn('Thumbnail upload error:', error)
    }
  }

  function openPrintPreview() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !imgLoaded) return

    setPrintPreviewLayer(layer)

    const captured = captureDrawingForPrint(layer)
    if (captured) {
      setPrintImageSize({ w: canvas.width, h: canvas.height })
      setPrintModalImageUrl(captured)
      return
    }

    // 図面部分だけを切り出す処理（用紙に合わせる用）。いまは既定動作に戻しているため無効。
    // 有効化すると印刷画像の座標系が変わるため、要約ボックスの位置を再調整する必要がある。
    const CROP_TO_DRAWING = false
    if (CROP_TO_DRAWING && img) {
      const { w: rotW, h: rotH } = getRotatedDims(img.width, img.height, rotationSteps)
      const x0 = Math.max(0, Math.floor(offset.x))
      const y0 = Math.max(0, Math.floor(offset.y))
      const x1 = Math.min(canvas.width, Math.ceil(offset.x + rotW * scale))
      const y1 = Math.min(canvas.height, Math.ceil(offset.y + rotH * scale))
      const w = x1 - x0
      const h = y1 - y0
      if (w > 8 && h > 8) {
        const cropped = document.createElement('canvas')
        cropped.width = w
        cropped.height = h
        const cctx = cropped.getContext('2d')
        if (cctx) {
          cctx.drawImage(canvas, x0, y0, w, h, 0, 0, w, h)
          setPrintImageSize({ w, h })
          setPrintModalImageUrl(cropped.toDataURL('image/png'))
          return
        }
      }
    }

    setPrintImageSize({ w: canvas.width, h: canvas.height })
    setPrintModalImageUrl(canvas.toDataURL('image/png'))
  }

  function handlePrintDrawing() {
    const canvas = canvasRef.current
    const preview = printPreviewRef.current
    const dataUrl = printModalImageUrl
    if (!canvas || !preview || !dataUrl) return

    // 印刷用画像（図面部分の切り出し）の実サイズを基準にする
    const printImgW = printImageSize?.w ?? canvas.width
    const printImgH = printImageSize?.h ?? canvas.height

    const rect = preview.getBoundingClientRect()
    const scaleX = rect.width > 0 ? printImgW / rect.width : 1
    const scaleY = rect.height > 0 ? printImgH / rect.height : 1
    const summaryPos =
      printPreviewLayer === 'corner' ? cornerPrintSummaryPos : printSummaryPos
    const summaryScaleRaw =
      printPreviewLayer === 'corner' ? cornerPrintSummaryScale : printSummaryScale
    const summaryLeft = Math.round(summaryPos.x * scaleX)
    const summaryTop = Math.round(summaryPos.y * scaleY)
    const summaryScale = Math.max(0.7, Math.min(1.8, summaryScaleRaw))
    const summaryHtml =
      printPreviewLayer === 'corner' && cornerBars.length > 0
        ? buildCornerBarPrintSummaryHtml(
            cornerBarPrintSummary,
            summaryLeft,
            summaryTop,
            summaryScale,
          )
        : drawingPrintSummaryGroups.length > 0
          ? `<div class="summary" style="left:${summaryLeft}px;top:${summaryTop}px;--sum-scale:${summaryScale};">${drawingPrintSummaryGroups
              .map((group) => {
                const color = getSegmentStrokeHex(group.color, false)
                const rows = group.rows
                  .map((row) => buildDrawingPrintSummaryRowHtml(row, color))
                  .join('')
                return `<section class="summary-group"><h2>${escapeHtml(group.name)}</h2>${rows}</section>`
              })
              .join('')}</div>`
          : ''

    // 選択した用紙に「用紙に合わせる」相当でぴったり収める。
    // ブラウザの印刷ダイアログの倍率は JS から変更できないため、
    // 印刷可能領域と同じサイズの枠を作り、内容を transform で拡大縮小して配置する。
    const PX_PER_MM = 96 / 25.4
    const PAGE_MARGIN_MM = 5
    const fitToA3Landscape = printPaper === 'a3-landscape'
    const printableWpx = (A3_LANDSCAPE.widthMm - PAGE_MARGIN_MM * 2) * PX_PER_MM
    const printableHpx = (A3_LANDSCAPE.heightMm - PAGE_MARGIN_MM * 2) * PX_PER_MM

    // キャンバスには図面の外側に空白が含まれるため、キャンバス全体ではなく
    // 「図面が写っている矩形」を基準に合わせる。座標系（=要約ボックスの位置）は
    // 変えずに transform だけで寄せるので、ドラッグした位置はそのまま保たれる。
    let fitX = 0
    let fitY = 0
    let fitW = printImgW
    let fitH = printImgH
    const img = imgRef.current
    if (img) {
      const { w: rotW, h: rotH } = getRotatedDims(img.width, img.height, rotationSteps)
      const x0 = Math.max(0, offset.x)
      const y0 = Math.max(0, offset.y)
      const x1 = Math.min(printImgW, offset.x + rotW * scale)
      const y1 = Math.min(printImgH, offset.y + rotH * scale)
      if (x1 - x0 > 8 && y1 - y0 > 8) {
        fitX = x0
        fitY = y0
        fitW = x1 - x0
        fitH = y1 - y0
      }
    }

    const printScale = Math.min(printableWpx / fitW, printableHpx / fitH)
    // transform-origin: top left なので、図面矩形が中央に来るように起点をずらす
    const printLeft = (printableWpx - fitW * printScale) / 2 - fitX * printScale
    const printTop = (printableHpx - fitH * printScale) / 2 - fitY * printScale

    // A3 横固定なら用紙を指定して合わせ込み、そうでなければブラウザ設定に任せる
    const pageRule = fitToA3Landscape
      ? `@page { size: ${A3_LANDSCAPE.cssSize}; margin: ${PAGE_MARGIN_MM}mm; }`
      : `@page { margin: 8mm; }`
    const printFitCss = fitToA3Landscape
      ? `
      /* A3 横の印刷可能領域と同じ枠を作り、その中に図面を合わせて配置する */
      html, body { width: ${printableWpx}px; height: ${printableHpx}px; overflow: hidden; }
      .page {
        position: relative;
        width: ${printableWpx}px;
        height: ${printableHpx}px;
        overflow: hidden;
      }
      .sheet {
        position: absolute;
        left: ${printLeft}px;
        top: ${printTop}px;
        width: ${printImgW}px;
        max-width: none;
        margin: 0;
        transform: scale(${printScale});
        transform-origin: top left;
      }`
      : `
      .sheet { max-width: 100%; }`

    const win = window.open('', '_blank')
    if (!win) {
      window.print()
      return
    }

    win.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>drawing-print</title>
  <style>
    /* 用紙はアプリ側のモーダルで選ぶ */
    ${pageRule}
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; font-family: Arial, "Hiragino Kaku Gothic ProN", Meiryo, sans-serif; }
    .sheet { position: relative; width: ${printImgW}px; max-width: 100vw; margin: 0 auto; }
    .sheet img { display: block; width: 100%; height: auto; }
    .summary {
      position: absolute;
      min-width: 0;
      padding: 0;
      background: transparent;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      font-weight: 700;
      line-height: 1.32;
    }
    .summary-group + .summary-group { margin-top: calc(18px * var(--sum-scale, 1)); }
    .summary h2 {
      /* ユニット名と直下の数値の間隔は最小にする */
      margin: 0;
      color: #64748b;
      font-size: calc(18px * var(--sum-scale, 1));
      line-height: 1.05;
    }
    .summary-row {
      display: flex;
      align-items: baseline;
      gap: calc(4px * var(--sum-scale, 1));
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      white-space: nowrap;
    }
    .summary-mark {
      font-size: calc(22px * var(--sum-scale, 1));
      line-height: 1;
      flex-shrink: 0;
    }
    .summary-detail {
      font-size: calc(18px * var(--sum-scale, 1));
      line-height: 1.2;
    }
    .corner-summary {
      min-width: calc(150px * var(--sum-scale, 1));
      padding: calc(8px * var(--sum-scale, 1)) calc(12px * var(--sum-scale, 1));
      background: rgba(255, 255, 255, 0.85);
      border: 1px solid rgba(203, 213, 225, 0.7);
      border-radius: calc(6px * var(--sum-scale, 1));
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
    }
    .corner-summary-pills {
      display: flex;
      flex-wrap: wrap;
      gap: calc(4px * var(--sum-scale, 1));
    }
    .corner-summary-pill {
      border-radius: calc(4px * var(--sum-scale, 1));
      padding: calc(2px * var(--sum-scale, 1)) calc(6px * var(--sum-scale, 1));
      font-size: calc(11px * var(--sum-scale, 1));
      color: #64748b;
      background: #f1f5f9;
      white-space: nowrap;
    }
    .corner-summary-pill-active {
      color: #0f172a;
      background: rgba(37, 99, 235, 0.1);
    }
    .corner-summary-divider {
      margin: calc(8px * var(--sum-scale, 1)) 0;
      border-top: 1px solid #e2e8f0;
    }
    .corner-summary-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: calc(8px * var(--sum-scale, 1));
      font-size: calc(11px * var(--sum-scale, 1));
      color: #64748b;
      white-space: nowrap;
    }
    .corner-summary-row + .corner-summary-row {
      margin-top: calc(2px * var(--sum-scale, 1));
    }
    .corner-summary-chip {
      display: inline-block;
      width: calc(12px * var(--sum-scale, 1));
      height: calc(12px * var(--sum-scale, 1));
      border-radius: calc(2px * var(--sum-scale, 1));
      flex-shrink: 0;
    }
    .corner-summary-label-wrap {
      display: flex;
      align-items: center;
      gap: calc(6px * var(--sum-scale, 1));
      flex: 1;
      min-width: 0;
    }
    .corner-summary-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .corner-summary-qty {
      color: #0f172a;
      flex-shrink: 0;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }${printFitCss}
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="sheet">
      <img src="${dataUrl}" alt="drawing" />
      ${summaryHtml}
    </div>
  </div>
  <script>
    window.addEventListener('load', () => {
      window.focus();
      window.print();
    });
  </script>
</body>
</html>`)
    win.document.close()
  }

  // 全画面ではツールバーを左の縦レールにするため、幅の要る「アクティブユニット」欄は
  // 図面を隠さない右パネル側の上部に置く。通常表示では従来どおりツールバー内に並べる。
  const activeUnitBar = (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-white/80 px-2 py-1">
      <span className="text-[11px] font-medium text-muted whitespace-nowrap">
        アクティブユニット
      </span>
      <select
        value={activeDrawingUnitId ?? ''}
        onChange={(ev) => {
          const v = ev.target.value ? ev.target.value : null
          selectActiveDrawingUnit(v, { openLengthPresetPicker: true })
        }}
        className="max-w-[200px] rounded border border-border px-2 py-1 text-xs outline-none focus:border-primary"
        title="先にユニットと表示色を選ぶと入力しやすくなります。選択した線は Z キーで削除できます。Shift キーを押しながら描画すると、線を水平または垂直にまっすぐ描けます。"
      >
        <option value="">ユニットを選択してください</option>
        {activeUnitChoices.map((u) => {
          const name = (u.name ?? '').trim() || (u.code ?? '').trim() || getUnitCodeBase(u)
          const colorJa = getSegmentColorLabelJa(normalizeSegmentColor(u.color))
          const label = `${name}(${colorJa})`

          return (
            <option key={u.id} value={u.id}>
              {label.slice(0, 80)}
            </option>
          )
        })}
      </select>
      {activeUnit ? (
        <>
          <span
            className="hidden sm:inline text-[11px] text-muted truncate max-w-[180px]"
            title={activeUnit.name}
          >
            {activeUnit.name}
          </span>
          {(activeUnit.detail_spec || activeUnit.detail_geometry) && (
            <button
              type="button"
              onClick={() => setPreviewUnit(activeUnit)}
              className="hidden sm:inline rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 hover:bg-indigo-100"
              title="詳細形状のプレビュー"
            >
              プレビュー
            </button>
          )}
          <button
            type="button"
            onClick={() => setLengthPresetSelectUnit(activeUnit)}
            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-100"
            title="長さプリセットを選択"
          >
            {activeLengthPresetGroup ? activeLengthPresetGroup.name : 'プリセットなし'}
          </button>
        </>
      ) : null}
    </div>
  )

  /** 全画面時: ツールバーは左端の縦レール（図面と重ならない余白に置く） */
  const toolButtonClass = (active: boolean, activeBg = 'bg-primary') =>
    `rounded-md transition-colors ${isFullscreen ? 'w-full px-1 py-1.5 text-[11px]' : 'px-3 py-1.5 text-sm'} ${
      active ? `${activeBg} text-white` : 'bg-gray-100 text-foreground hover:bg-gray-200'
    }`

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-[55] overflow-hidden bg-white'
          : 'flex flex-1 gap-2 min-h-0'
      }
    >
      {/* Canvas area（全画面ではツールバー・パネルを図面の上に重ねる） */}
      <div
        className={
          isFullscreen ? 'absolute inset-0 flex flex-col' : 'flex-1 flex flex-col min-w-0'
        }
      >
        <div
          className={
            isFullscreen
              ? 'absolute left-2 top-2 bottom-2 z-20 flex w-20 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border bg-white/90 px-1.5 py-2 shadow-sm backdrop-blur-sm'
              : 'mb-2 flex flex-col gap-1.5'
          }
        >
          {/* レイヤータブ: コーナー筋は何も描かれていない図面の上で編集する */}
          <div
            className={
              isFullscreen
                ? 'flex flex-col items-stretch gap-1 rounded-md border border-border bg-white p-1'
                : 'inline-flex w-fit items-center gap-1 rounded-md border border-border bg-white p-1'
            }
            role="tablist"
            aria-label="編集レイヤー"
          >
            {(
              [
                { id: 'unit' as DrawingLayer, label: 'ユニット' },
                { id: 'corner' as DrawingLayer, label: '付加筋' },
              ]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={layer === t.id}
                onClick={() => switchLayer(t.id)}
                className={`rounded py-1 font-medium whitespace-nowrap transition-colors ${
                  // 全画面の細いツールバーでは左右の余白を詰めて 1 行に収める
                  isFullscreen ? 'w-full px-1 text-[11px]' : 'px-3 text-xs'
                } ${
                  layer === t.id
                    ? 'bg-primary text-white'
                    : 'text-muted hover:bg-gray-100 hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div
            className={
              isFullscreen
                ? 'flex flex-col items-stretch gap-1.5'
                : 'flex flex-wrap items-center gap-2'
            }
          >
          {layer === 'unit' ? (
            <>
              <button
                onClick={() => setTool('select')}
                className={toolButtonClass(tool === 'select')}
              >
                選択
              </button>
              <button
                onClick={() => setTool('draw')}
                className={toolButtonClass(tool === 'draw')}
              >
                線を描く
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setCornerTool('select')}
                className={toolButtonClass(cornerTool === 'select')}
                title="配置した部材を選択し、ドラッグで移動します (S)"
              >
                選択
              </button>
              <button
                type="button"
                onClick={enterCornerPlaceMode}
                className={toolButtonClass(cornerTool === 'place')}
                title="図面をクリックして新しい部材を置きます (D)"
              >
                位置
              </button>
              <button
                type="button"
                onClick={() => setCornerBarsOnlyView((prev) => !prev)}
                className={toolButtonClass(cornerBarsOnlyView, 'bg-slate-700')}
                title="ユニット線分を隠して付加筋だけ表示します"
                aria-pressed={cornerBarsOnlyView}
              >
                付加筋のみ
              </button>
            </>
          )}
          {!isFullscreen && layer === 'unit' ? activeUnitBar : null}
          {isFullscreen ? <div className="my-0.5 border-t border-border" /> : null}
          <button
            type="button"
            onClick={rotateLeft90}
            disabled={!imgLoaded}
            className={`rounded-md transition-colors ${
              isFullscreen ? 'w-full px-1 py-1.5 text-[11px]' : 'px-2 py-1.5 text-sm'
            } ${
              !imgLoaded ? 'bg-gray-100 text-muted cursor-not-allowed' : 'bg-gray-100 text-foreground hover:bg-gray-200'
            }`}
            title="左に90度回転"
          >
            ↺ 90°
          </button>
          <div
            className={
              isFullscreen
                ? 'flex flex-col items-stretch gap-0.5 rounded-md border border-border bg-white px-1 py-1'
                : 'inline-flex items-center gap-1 rounded-md border border-border bg-white px-1 py-0.5'
            }
          >
            <button
              type="button"
              onClick={() => zoomByFactor(1 / 1.2)}
              disabled={!imgLoaded}
              className="rounded px-1.5 py-0.5 text-sm text-foreground hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              title="縮小"
              aria-label="縮小"
            >
              −
            </button>
            <span className="min-w-[46px] text-center text-[11px] tabular-nums text-muted">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomByFactor(1.2)}
              disabled={!imgLoaded}
              className="rounded px-1.5 py-0.5 text-sm text-foreground hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              title="拡大"
              aria-label="拡大"
            >
              ＋
            </button>
            <button
              type="button"
              onClick={fitToBox}
              disabled={!imgLoaded}
              className="rounded px-1.5 py-0.5 text-[11px] text-foreground hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              title="画面に合わせる"
            >
              全体
            </button>
          </div>
          {isFullscreen ? <div className="my-0.5 border-t border-border" /> : null}
          <button
            type="button"
            onClick={openPrintPreview}
            disabled={!imgLoaded}
            className={`rounded-md bg-gray-100 text-foreground transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 ${
              isFullscreen ? 'w-full px-1 py-1.5 text-[11px]' : 'px-2 py-1.5 text-sm'
            }`}
            title="印刷プレビューを開く"
          >
            印刷
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`rounded-md transition-colors ${
              isFullscreen
                ? 'w-full bg-primary px-1 py-1.5 text-[11px] text-white hover:bg-primary-hover'
                : 'bg-gray-100 px-2 py-1.5 text-sm text-foreground hover:bg-gray-200'
            }`}
            title={isFullscreen ? '全画面を終了 (F)' : '図面を全画面で表示 (F)'}
          >
            {isFullscreen ? '⤢ 終了' : '⤢ 全画面'}
          </button>
          <span
            className={`text-xs text-muted ml-2 ${
              isFullscreen && !splitArmedSegmentId ? 'hidden' : ''
            }`}
          >
            {layer === 'corner'
              ? 'Sキー: 選択／Dキー: 位置／Escキー: 位置をやめる／Zキー: 選択した部材を削除／Fキー: 全画面'
              : splitArmedSegmentId
                ? 'Escキー: 分割をキャンセル'
                : 'Escキー: 描画取消／Dキー: 描画／Sキー: 選択／Fキー: 全画面／Zキー: 削除／Shift+描画: 水平・垂直'}
          </span>
          </div>
          {layer === 'unit' && persistedActiveUnits.length === 0 ? (
            <p className="text-[11px] leading-snug text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 max-w-3xl">
              {effectiveUnits.length === 0
                ? '図面で選べる保存済みユニットがありません。ユニット管理で「新規作成」→「保存」するか、supabase/seed-default-units.sql を実行して初期データを投入してください。'
                : 'ユニットは読み込めましたが、すべて無効（無効化）か、図面で使えないIDのため一覧に表示されていません。'}
            </p>
          ) : null}
        </div>
        <div
          ref={a3FrameRef}
          className={
            isFullscreen
              ? // 左の縦レールと右のパネル領域を避けて中央寄せ（用紙がツールバーに隠れない）
                'drawing-a3-frame absolute inset-y-0 left-[6rem] right-[19rem] flex items-center justify-center'
              : 'drawing-a3-frame relative flex flex-1 min-h-0 items-center justify-center'
          }
        >
        <div
          ref={containerRef}
          className="drawing-a3-box relative rounded-lg border border-border bg-gray-50 overflow-hidden overscroll-none"
          style={{
            width: a3BoxSize ? `${a3BoxSize.w}px` : '100%',
            height: a3BoxSize ? `${a3BoxSize.h}px` : '100%',
            cursor: panning
              ? 'grabbing'
              : layer === 'corner'
                ? cornerBarDrag
                  ? 'move'
                  : cornerBarEndHoverCursor
                    ? cornerBarEndHoverCursor
                    : cornerTool === 'place'
                      ? 'crosshair'
                      : cornerBarHovering
                        ? 'pointer'
                        : 'default'
                : tool === 'draw'
                  ? 'crosshair'
                  : segmentLabelDrag
                    ? 'grabbing'
                    : segmentDrag
                      ? 'move'
                      : tool === 'select'
                        ? 'pointer'
                        : 'default',
          }}
        >
          {!imgLoaded && fileType === 'pdf' ? (
            <div className="flex items-center justify-center w-full h-full text-muted text-sm">
              PDFを読み込み中...
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              setCornerBarHovering(false)
              if (!cornerBarEdgeDrag) setCornerBarEndHoverCursor(null)
            }}
            className="block w-full h-full touch-none"
            style={{ display: imgLoaded ? 'block' : 'none' }}
          />
        </div>
        </div>
      </div>

      {/* Side panel（全画面では図面の上に重ねて表示） */}
      <div
        className={
          isFullscreen
            ? 'absolute right-2 top-2 bottom-2 z-20 flex w-72 flex-col gap-1.5 drop-shadow-lg'
            : 'contents'
        }
      >
      {isFullscreen && layer === 'unit' ? activeUnitBar : null}
      <div className={isFullscreen ? 'flex min-h-0 flex-1' : 'contents'}>
      {layer === 'corner' ? (
      <CornerBarPanel
        cornerBars={cornerBars}
        summaryHref={`/projects/${projectId}/optimize?run=1`}
        selectedCornerBarId={selectedCornerBarId}
        placementModeActive={cornerTool === 'place'}
        placementDraft={placementDraft}
        activePlacementCategory={activePlacementCategory}
        onActivePlacementCategoryChange={setActivePlacementCategory}
        placementColor={cornerPlacementColor}
        onPlacementColorChange={setCornerPlacementColor}
        onChangePlacementDraft={changePlacementDraft}
        onSelectCornerBar={selectCornerBar}
        onUpdate={(id, updates) => updateCornerBar(id, updates)}
        onPatchCornerBarBars={patchCornerBarBars}
        onGoToSummary={(href) => void goToCornerBarSummary(href)}
        onDelete={(id) => void deleteCornerBar(id)}
        onDuplicate={(id) => void duplicateCornerBar(id)}
        canUndo={!!lastAction}
        onUndo={handleUndo}
      />
      ) : (
      <SegmentPanel
        segments={segments}
        selectedSegmentIds={selectedSegmentIds}
        onReplaceSelection={(ids) => setSelectedSegmentIds(ids)}
        onToggleSegmentSelection={(id) =>
          setSelectedSegmentIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
        onBulkApplyTemplateColor={bulkApplyTemplateColorToSelection}
        onUpdate={updateSegment}
        onDelete={deleteSegment}
        onRotateLabel={(id) => void rotateSegmentLabel90(id)}
        onResetLabel={(id) => void resetSegmentLabel(id)}
        onSplit={(id) => {
          setTool('select')
          setSelectedSegmentIds([id])
          setSplitArmedSegmentId(id)
          setSplitHoverPoint(null)
          setLastSplitMarker(null)
        }}
        onPickLength={openLengthPickerForSegment}
        barTypes={BAR_TYPES}
        projectId={projectId}
        canUndo={!!lastAction}
        onUndo={handleUndo}
        units={effectiveUnits}
        templateOptions={templateSummaries.map((t) => ({ id: t.id, name: t.name }))}
        activeTemplateId={activeTemplateId ?? ''}
        activeTemplateColor={activeTemplateColor}
      />
      )}
      </div>
      </div>

      {printModalImageUrl && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/55 p-4">
          <div className="mx-auto flex w-full max-w-6xl flex-1 min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">印刷プレビュー</h2>
                <p className="text-xs text-muted">
                  入力データのボックスをドラッグして位置を決めてから印刷してください。
                </p>
                <div className="mt-2 inline-flex items-center gap-2 rounded border border-border bg-slate-50 px-2 py-1 text-xs">
                  <span className="text-muted">用紙</span>
                  <select
                    value={printPaper}
                    onChange={(e) => setPrintPaper(e.target.value as PrintPaper)}
                    className="rounded border border-border bg-white px-1.5 py-0.5 text-[11px] outline-none focus:border-primary"
                    title="A3 横で固定するか、ブラウザの印刷設定に従うかを選びます"
                  >
                    {PRINT_PAPER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-muted">
                    {printPaper === 'a3-landscape'
                      ? 'A3 横に合わせて印刷します（ダイアログの用紙・倍率は変更できません）'
                      : '印刷ダイアログで用紙・向き・倍率を選べます'}
                  </span>
                </div>
                {printPreviewHasSummary && (
                  <div className="mt-2 inline-flex items-center gap-2 rounded border border-border bg-slate-50 px-2 py-1 text-xs">
                    <span className="text-muted">サイズ</span>
                    <button
                      type="button"
                      onClick={() =>
                        setActivePrintSummaryScale((prev) =>
                          Math.max(0.7, Number((prev - 0.1).toFixed(2))),
                        )
                      }
                      className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-white"
                      aria-label="decrease summary size"
                    >
                      -
                    </button>
                    <input
                      type="range"
                      min={70}
                      max={180}
                      step={5}
                      value={Math.round(activePrintSummaryScale * 100)}
                      onChange={(e) => {
                        const next = Number(e.target.value) / 100
                        setActivePrintSummaryScale(Math.max(0.7, Math.min(1.8, next)))
                      }}
                      aria-label="summary size"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setActivePrintSummaryScale((prev) =>
                          Math.min(1.8, Number((prev + 0.1).toFixed(2))),
                        )
                      }
                      className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-white"
                      aria-label="increase summary size"
                    >
                      +
                    </button>
                    <span className="w-10 text-right font-mono text-[11px] text-slate-700">
                      {Math.round(activePrintSummaryScale * 100)}%
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintDrawing}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
                >
                  印刷
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPrintModalImageUrl(null)
                    setSummaryDragging(false)
                    summaryDragRef.current = null
                  }}
                  className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:bg-gray-50"
                >
                  閉じる
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-4">
              <div
                ref={printPreviewRef}
                className="relative mx-auto w-fit max-w-full overflow-hidden bg-white shadow"
              >
                <img
                  src={printModalImageUrl}
                  alt="drawing print preview"
                  className="block max-h-[72vh] max-w-full select-none"
                  draggable={false}
                />
                {printPreviewHasSummary && (
                  <div
                    ref={summaryBoxRef}
                    className="absolute z-20 min-w-[150px] cursor-move select-none rounded-md border border-slate-300/70 bg-white/85 px-3 py-2 shadow-sm backdrop-blur-[1px]"
                    style={{
                      left: activePrintSummaryPos.x,
                      top: activePrintSummaryPos.y,
                      transform: `scale(${activePrintSummaryScale})`,
                      transformOrigin: 'top left',
                    }}
                    onMouseDown={(ev) => {
                      ev.preventDefault()
                      ev.stopPropagation()
                      summaryDragRef.current = {
                        x: ev.clientX - ev.currentTarget.getBoundingClientRect().left,
                        y: ev.clientY - ev.currentTarget.getBoundingClientRect().top,
                      }
                      setSummaryDragging(true)
                    }}
                    title="Drag to set print position"
                  >
                    {printPreviewLayer === 'corner' ? (
                      <div className="space-y-0.5">
                        {cornerBarPrintSummary.detailRows.map((row) => (
                          <div
                            key={`${row.category}/${row.diameter}/${row.color}`}
                            className="flex items-center justify-between gap-2 text-[10px] text-muted"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                className="h-3 w-3 shrink-0 rounded-sm"
                                style={{
                                  backgroundColor: getSegmentStrokeHex(
                                    normalizeSegmentColor(row.color),
                                    false,
                                  ),
                                }}
                              />
                              <span className="truncate">
                                {cornerBarCategoryLabel(row.category)} {row.diameter}
                              </span>
                            </span>
                            <span className="shrink-0 text-foreground">{row.qty} 本</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {drawingPrintSummaryGroups.map((group) => {
                          const color = getSegmentStrokeHex(group.color, false)
                          return (
                            <section key={group.key}>
                              <div className="text-sm font-bold leading-none text-slate-500">
                                {group.name}
                              </div>
                              <div className="space-y-0.5 font-mono font-bold leading-tight">
                                {group.rows.map((row) => {
                                  const mark = circledSummaryNumber(row.no)
                                  return (
                                    <div
                                      key={`${group.key}-${row.no ?? 'none'}-${row.len}`}
                                      className="flex items-baseline gap-1"
                                      style={{ color }}
                                    >
                                      {mark ? (
                                        <span className="shrink-0 text-[15px] leading-none">
                                          {mark}
                                        </span>
                                      ) : null}
                                      <span className="text-[13px]">
                                        {drawingPrintSummaryDetailText(row)}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            </section>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectModeCannotDrawToastOpen && (
        <div className="fixed inset-x-0 top-4 z-[60] flex justify-center px-4 pointer-events-none">
          <div
            role="alert"
            className="pointer-events-auto flex max-w-lg items-center gap-3 rounded-lg bg-red-600 px-4 py-3 shadow-lg shadow-red-900/20"
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-red-600"
              aria-hidden
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 0010 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <p className="min-w-0 flex-1 text-sm font-medium text-white">
              選択モードでは描けません
            </p>
            <button
              type="button"
              onClick={() => setSelectModeCannotDrawToastOpen(false)}
              className="shrink-0 rounded-md p-1 text-white/80 transition hover:bg-white/10 hover:text-white"
              aria-label="閉じる"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {cornerBarShapeSelectModalOpen && (
        <div className="fixed inset-0 z-[46] flex items-center justify-center bg-black/45 p-4">
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="corner-bar-shape-select-title"
          >
            <div className="border-b border-border px-6 py-4">
              <h2 id="corner-bar-shape-select-title" className="text-base font-semibold">
                形状を選んでください
              </h2>
            </div>
            <div className="px-6 py-4">
              <div
                className={`grid gap-2 ${
                  cornerBarPlacementCategory === 'CORNER'
                    ? 'grid-cols-4'
                    : cornerBarPlacementCategory === 'SOE' ||
                        cornerBarPlacementCategory === 'SPECIAL_CORNER'
                      ? 'grid-cols-2'
                      : 'grid-cols-3'
                }`}
              >
                {cornerBarShapeModalOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    title={option.label}
                    aria-label={option.label}
                    onClick={() =>
                      selectCornerBarShapeFromModal(option.shapeType, option.rotation)
                    }
                    className="flex items-center justify-center rounded border border-border bg-white p-1 transition-colors hover:border-primary hover:bg-primary/5"
                  >
                    <svg
                      width={56}
                      height={42}
                      viewBox="0 0 56 42"
                      aria-hidden="true"
                    >
                      <path
                        d={cornerBarThumbPath(option.shape, 56, 42, 7, option.rotation)}
                        fill="none"
                        stroke="#0f172a"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end border-t border-border px-6 py-3">
              <button
                type="button"
                onClick={() => {
                  setCornerBarShapeSelectModalOpen(false)
                  setPendingCornerBarPlacement(null)
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {lengthPresetSelectUnit && (
        <div className="fixed inset-0 z-[46] flex items-center justify-center bg-black/45 p-4">
          <div
            className="w-full max-w-lg rounded-xl bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="length-preset-select-title"
          >
            <div className="border-b border-border px-6 py-4">
              <h2 id="length-preset-select-title" className="text-base font-semibold">
                長さプリセットを選択
              </h2>
              <p className="mt-1 text-xs text-muted">
                {lengthPresetSelectUnit.name} で線を描くときに使う長さ候補を選べます。
              </p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  setActiveLengthPresetGroupId(null)
                  setLengthPresetSelectUnit(null)
                }}
                className={`mb-3 w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                  activeLengthPresetGroupId == null
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-white hover:bg-gray-50'
                }`}
              >
                <div className="text-sm font-semibold">プリセットなし</div>
                <div className="mt-1 text-xs text-muted">
                  この図面上で使う長さを、線を描くたびに直接決めます。
                </div>
              </button>
              {lengthPresetGroups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted">
                  保存済みの長さプリセットがありません。
                </p>
              ) : (
                <div className="space-y-2">
                  {lengthPresetGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => {
                        setActiveLengthPresetGroupId(group.id)
                        setLengthPresetSelectUnit(null)
                      }}
                      className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                        activeLengthPresetGroupId === group.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-white hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold">{group.name}</span>
                      </div>
                      {group.description ? (
                        <div className="mt-1 text-xs text-muted">{group.description}</div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {group.lengths.slice(0, 12).map((len) => (
                          <span
                            key={len}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-mono text-slate-700"
                          >
                            {len.toLocaleString('ja-JP')}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end border-t border-border px-6 py-3">
              <button
                type="button"
                onClick={() => setLengthPresetSelectUnit(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {lengthPresetDrawModal && (
        <div className="fixed inset-0 z-[46] flex items-center justify-center bg-black/45 p-4">
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="length-preset-draw-title"
          >
            <div className="border-b border-border px-6 py-4">
              <h2 id="length-preset-draw-title" className="text-base font-semibold">
                {lengthPresetDrawModal.mode === 'edit' ? '長さを変更' : '長さを選択'}
              </h2>
              <p className="mt-1 text-xs text-muted">
                {lengthPresetDrawModal.preset.name} の長さをクリック、または数字キーで選択できます。
              </p>
            </div>
            <div className="px-6 py-4">
              <div className="space-y-2">
                {lengthPresetDrawModal.preset.lengths.map((len, idx) => (
                  <button
                    key={`${len}-${idx}`}
                    type="button"
                    onClick={() => {
                      const ctx = lengthPresetDrawModal
                      setLengthPresetDrawModal(null)
                      void submitLengthPresetDrawLength(ctx, len, idx < 7 ? idx + 1 : null)
                    }}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-white px-3 py-2.5 text-left hover:border-primary hover:bg-primary/5"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-bold text-slate-700">
                      {idx < 7 ? idx + 1 : '-'}
                    </div>
                    <div className="font-mono text-sm font-semibold">
                      {len.toLocaleString('ja-JP')}mm
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-dashed border-border bg-slate-50 px-3 py-3">
                <label className="mb-1 block text-xs font-medium text-muted">
                  任意の長さ
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={lengthPresetCustomMm}
                    onChange={(e) => setLengthPresetCustomMm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      const v = Number.parseInt(lengthPresetCustomMm.trim(), 10)
                      if (!Number.isFinite(v) || v <= 0) return
                      const ctx = lengthPresetDrawModal
                      setLengthPresetDrawModal(null)
                      setLengthPresetCustomMm('')
                      void submitLengthPresetDrawLength(ctx, v, null)
                    }}
                    placeholder="例: 3000"
                    className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm font-mono outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const v = Number.parseInt(lengthPresetCustomMm.trim(), 10)
                      if (!Number.isFinite(v) || v <= 0) return
                      const ctx = lengthPresetDrawModal
                      setLengthPresetDrawModal(null)
                      setLengthPresetCustomMm('')
                      void submitLengthPresetDrawLength(ctx, v, null)
                    }}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover"
                  >
                    使用
                  </button>
                </div>
              </div>
            </div>
            <div className="flex justify-end border-t border-border px-6 py-3">
              <button
                type="button"
                onClick={() => {
                  setLengthPresetDrawModal(null)
                  setLengthPresetCustomMm('')
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {quickMarkPickModal && (
        <div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/45 p-4">
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-mark-title"
          >
            <div className="border-b border-border px-6 py-4">
              <h2 id="quick-mark-title" className="text-base font-semibold">
                {quickMarkPickModal.base} — 長さ・番号を選択
              </h2>
              <p className="mt-1 text-xs text-muted">
                登録済みの長さを選ぶか、下のフォームで新しい長さを追加してください。
                {quickMarkPickModal.numbered.length > 0 && ' キーボードの数字（1–9）でも選択できます。'}
              </p>
            </div>
            <div className="space-y-4 px-6 py-4">
              {quickMarkPickModal.numbered.length > 0 ? (
                <div>
                  <div className="mb-2 text-[11px] font-medium text-muted">登録済みの長さ</div>
                  <div className="flex flex-wrap gap-2">
                    {quickMarkPickModal.numbered.map((u) => {
                      const uc = normalizeSegmentColor(u.color)
                      const stroke = getSegmentStrokeHex(uc, false)
                      const tint = getSegmentStrokeHex(uc, true)
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            if (!quickMarkPickModal) return
                            const ctx = quickMarkPickModal
                            setQuickMarkPickModal(null)
                            setQuickMarkArbitraryMm('')
                            setQuickMarkNewMm('')
                            setQuickMarkNewMark('')
                            void submitQuickMarkPickUnit(u, ctx)
                          }}
                          className="flex min-w-[7.5rem] flex-col items-start rounded-lg border-2 px-3 py-2 text-left text-sm font-semibold transition hover:shadow-sm"
                          style={{ borderColor: stroke, color: tint }}
                        >
                          <span className="font-mono leading-tight">
                            {typeof u.mark_number === 'number' ? `${u.mark_number}番 ` : ''}
                            {u.code ?? u.name}
                          </span>
                          <span
                            className="mt-0.5 text-[11px] font-normal leading-tight opacity-90"
                            style={{ color: stroke }}
                          >
                            {formatUnitLengthMmJa(u)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted">
                  まだ長さが登録されていません。下のフォームで最初の長さを追加してください。
                </p>
              )}

              <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 space-y-3">
                <div className="text-xs font-semibold text-emerald-900">新しい長さを追加</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-emerald-800 mb-1">長さ (mm)</label>
                    <input
                      ref={quickMarkNewMmInputRef}
                      type="number"
                      min={1}
                      inputMode="numeric"
                      placeholder="例: 3000"
                      value={quickMarkNewMm}
                      onChange={(e) => setQuickMarkNewMm(e.target.value)}
                      autoFocus={quickMarkPickModal.numbered.length === 0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (!quickMarkPickModal) return
                          const ctx = quickMarkPickModal
                          void createAndUseNewVariant(ctx, quickMarkNewMm, quickMarkNewMark)
                        }
                      }}
                      className="w-full rounded-md border border-emerald-300 bg-white px-2 py-1.5 text-sm font-mono outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-emerald-800 mb-1">
                      番号（任意・空欄は円なしで長さ表示）
                    </label>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      placeholder="空欄で自動"
                      value={quickMarkNewMark}
                      onChange={(e) => setQuickMarkNewMark(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (!quickMarkPickModal) return
                          const ctx = quickMarkPickModal
                          void createAndUseNewVariant(ctx, quickMarkNewMm, quickMarkNewMark)
                        }
                      }}
                      className="w-full rounded-md border border-emerald-300 bg-white px-2 py-1.5 text-sm font-mono outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!quickMarkPickModal) return
                    const ctx = quickMarkPickModal
                    void createAndUseNewVariant(ctx, quickMarkNewMm, quickMarkNewMark)
                  }}
                  disabled={!quickMarkNewMm}
                  className="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  この長さを保存して使用
                </button>
              </div>
            </div>
            <div className="flex justify-end border-t border-border px-6 py-3">
              <button
                type="button"
                onClick={() => {
                  setQuickMarkPickModal(null)
                  setQuickMarkArbitraryMm('')
                  setQuickMarkNewMm('')
                  setQuickMarkNewMark('')
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {newSegmentDraft && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white shadow-lg flex flex-col max-h-[90vh]">
            <div className="px-6 pt-6 pb-4 border-b border-border">
              <h2 className="text-base font-semibold">新しい線分の入力</h2>
              <div className="mt-3">
                  <div className="text-xs font-medium text-muted mb-2">
                    登録ユニットから反映（任意）
                  </div>
                  {persistedActiveUnits.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {persistedActiveUnits.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setNewSegmentDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    color: normalizeSegmentColor(u.color),
                                    bars: u.bars.map((b) => ({
                                      barType: b.diameter,
                                      quantity: String(b.qtyPerUnit),
                                    })),
                                    label: u.code ?? u.name ?? prev.label,
                                  }
                                : prev,
                            )
                          }}
                          className="rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition-colors hover:shadow-sm bg-white"
                          style={{
                            borderColor: getSegmentStrokeHex(
                              normalizeSegmentColor(u.color),
                              false,
                            ),
                            color: getSegmentStrokeHex(
                              normalizeSegmentColor(u.color),
                              true,
                            ),
                          }}
                        >
                          {u.code ?? u.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted leading-relaxed">
                      ここにチップが出るのは、
                      <strong className="text-foreground">ユニット管理</strong>
                      で<strong>保存済み</strong>の有効なユニットだけです。
                      画面にだけあるモック／未保存のユニットは表示されません。
                    </p>
                  )}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">長さ (mm)</label>
                <input
                  type="number"
                  value={newSegmentDraft.lengthMm}
                  onChange={(e) =>
                    setNewSegmentDraft((prev) =>
                      prev ? { ...prev, lengthMm: e.target.value } : prev,
                    )
                  }
                  className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
                  autoFocus
                />
              </div>
                <div>
                  <label className="block text-xs text-muted mb-1">線の色</label>
                  <select
                    value={normalizeSegmentColor(newSegmentDraft.color)}
                    onChange={(e) =>
                      setNewSegmentDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              color: normalizeSegmentColor(e.target.value),
                            }
                          : prev,
                      )
                    }
                    className="w-full rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary"
                  >
                    {SEGMENT_COLOR_DEFINITIONS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.labelJa}
                      </option>
                    ))}
                  </select>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">ユニット</label>
                <input
                  type="text"
                  value={newSegmentDraft.label}
                  onChange={(e) =>
                    setNewSegmentDraft((prev) =>
                      prev ? { ...prev, label: e.target.value } : prev,
                    )
                  }
                  className="w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted">鉄筋（種類と本数）</div>
                <div className="space-y-2">
                  {newSegmentDraft.bars.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={row.barType}
                        onChange={(e) =>
                          setNewSegmentDraft((prev) => {
                            if (!prev) return prev
                            const next = [...prev.bars]
                            next[idx] = { ...next[idx], barType: e.target.value }
                            return { ...prev, bars: next }
                          })
                        }
                        className="flex-1 rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-primary bg-white"
                      >
                        {BAR_TYPES.map((bt) => (
                          <option key={bt} value={bt}>
                            {bt}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        value={row.quantity}
                        onChange={(e) =>
                          setNewSegmentDraft((prev) => {
                            if (!prev) return prev
                            const next = [...prev.bars]
                            next[idx] = { ...next[idx], quantity: e.target.value }
                            return { ...prev, bars: next }
                          })
                        }
                        className="w-20 rounded border border-border px-2 py-1 text-sm font-mono outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setNewSegmentDraft((prev) => {
                            if (!prev) return prev
                            const next = prev.bars.filter((_, i) => i !== idx)
                            return { ...prev, bars: next.length ? next : prev.bars }
                          })
                        }
                        className="text-xs text-danger hover:underline"
                        disabled={newSegmentDraft.bars.length <= 1}
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setNewSegmentDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            bars: [
                              ...prev.bars,
                              {
                                barType: getNextDefaultBarType(
                                  prev.bars.map((b) => b.barType),
                                  BAR_TYPES,
                                ),
                                quantity: '1',
                              },
                            ],
                          }
                        : prev,
                    )
                  }
                  className="text-xs text-primary hover:underline"
                >
                  + 追加
                </button>
              </div>
            </div>{/* end overflow scroll area */}
            <div className="flex justify-end gap-2 border-t border-border px-6 pb-6 pt-4">
              <button
                type="button"
                onClick={() => setNewSegmentDraft(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void confirmNewSegment()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}

      {previewUnit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-xl">
            <div className="px-6 pt-5 pb-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">{previewUnit.name}</h3>
                <p className="text-xs text-muted">{previewUnit.code ?? '-'}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewUnit(null)}
                className="text-xs text-muted underline"
              >
                閉じる
              </button>
            </div>
            <div className="p-4">
              <div className="rounded border border-border bg-slate-50 p-2">
                <UnitShapeThumbnail unit={previewUnit} large />
                <UnitVariantLengthList allUnits={serverUnits} unit={previewUnit} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 図面印刷の用紙設定。
 * - 'a3-landscape': A3 横で固定し、用紙にぴったり合わせて印刷する
 *   （@page で用紙を指定するため、ブラウザ側の用紙・倍率の選択欄は隠れる）
 * - 'browser': 用紙を指定せず、ブラウザの印刷ダイアログの設定に従う
 */
type PrintPaper = 'a3-landscape' | 'browser'

const PRINT_PAPER_OPTIONS: { value: PrintPaper; label: string }[] = [
  { value: 'a3-landscape', label: 'A3 横（ぴったり合わせる）' },
  { value: 'browser', label: 'ブラウザの設定に従う' },
]

const A3_LANDSCAPE = { widthMm: 420, heightMm: 297, cssSize: 'A3 landscape' }

/** A3 枠に収まる最大倍率。PDF は高解像度でラスタライズしているため 100% を超える拡大も許容する。 */
function computeFitScale(
  boxW: number,
  boxH: number,
  rotW: number,
  rotH: number,
  maxScale = 4,
): number {
  if (!(rotW > 0) || !(rotH > 0) || !(boxW > 0) || !(boxH > 0)) return 1
  return Math.max(0.1, Math.min(boxW / rotW, boxH / rotH, maxScale))
}

function getRotatedDims(w: number, h: number, steps: number): { w: number; h: number } {
  const s = ((steps % 4) + 4) % 4
  if (s % 2 === 1) {
    return { w: h, h: w }
  }
  return { w, h }
}

function applyRotationTransform(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  steps: number,
) {
  const s = ((steps % 4) + 4) % 4
  // Mapping (original -> rotated) for clockwise steps:
  // s=0:  (x, y) -> (x, y)
  // s=1:  (x, y) -> (h - y, x)
  // s=2:  (x, y) -> (w - x, h - y)
  // s=3:  (x, y) -> (y, w - x)
  if (s === 0) return
  if (s === 1) {
    // x' = -y + h, y' = x
    ctx.transform(0, 1, -1, 0, h, 0)
    return
  }
  if (s === 2) {
    // x' = -x + w, y' = -y + h
    ctx.transform(-1, 0, 0, -1, w, h)
    return
  }
  // s === 3
  // x' = y, y' = -x + w
  ctx.transform(0, -1, 1, 0, 0, w)
}

function UnitDetailMiniPreview({ unit }: { unit: Unit }) {
  const template = shapeTypeToDetailTemplate(unit.shape_type)
  const spec = normalizeDetailSpecForTemplate(
    template,
    unit.detail_spec ?? getDefaultDetailSpec(template),
  )
  const sketch = buildShapeSketch(template, spec)
  const byKey = Object.fromEntries(sketch.geometry.points.map((p) => [p.key, p]))
  const { minX, minY, maxX, maxY } = sketch.geometry.bounds
  const pad = 18
  const w = Math.max(120, maxX - minX + pad * 2)
  const h = Math.max(70, maxY - minY + pad * 2)
  const color = getSegmentStrokeHex(normalizeSegmentColor(unit.color), false)

  return (
    <svg viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`} className="h-20 w-full rounded border border-border bg-slate-50">
      {sketch.geometry.segments.map((s, idx) => {
        const p1 = byKey[s.from]
        const p2 = byKey[s.to]
        if (!p1 || !p2) return null
        return (
          <line
            key={`${s.from}-${s.to}-${idx}`}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
          />
        )
      })}
      <text x={minX - pad + 8} y={maxY + pad - 6} fontSize={10} fill="#334155">
        pitch: {spec.pitch} / mark: {unit.mark_number ?? '-'}
      </text>
    </svg>
  )
}

/** 鉄筋線ごとに両端へ直交する短線を描く（寸法線の端チックのような「I」形） */
function drawRebarSegmentEndCaps(
  ctx: CanvasRenderingContext2D,
  segments: DrawingSegment[],
  scale: number,
  units: Unit[] | null | undefined,
) {
  const rebarSegments = segments.filter(
    (s) => !(s.bar_type === 'SPACING' && s.quantity === 0),
  )
  const halfTick = 5 / scale

  ctx.save()
  ctx.lineWidth = 2 / scale

  for (const seg of rebarSegments) {
    const p1 = { x: seg.x1, y: seg.y1 }
    const p2 = { x: seg.x2, y: seg.y2 }
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const d = Math.hypot(dx, dy)
    if (d < 1e-6) continue

    const nx = -dy / d
    const ny = dx / d
    const stroke = getSegmentStrokeHex(getSegmentColor(seg, units), false)
    ctx.strokeStyle = stroke
    ctx.beginPath()
    ctx.moveTo(p1.x - nx * halfTick, p1.y - ny * halfTick)
    ctx.lineTo(p1.x + nx * halfTick, p1.y + ny * halfTick)
    ctx.moveTo(p2.x - nx * halfTick, p2.y - ny * halfTick)
    ctx.lineTo(p2.x + nx * halfTick, p2.y + ny * halfTick)
    ctx.stroke()
  }

  ctx.restore()
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2)
}

function projectPointToSegment(
  p: Point,
  a: Point,
  b: Point,
): { t: number; projectedPoint: Point } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return { t: 0, projectedPoint: { ...a } }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return {
    t,
    projectedPoint: { x: a.x + t * dx, y: a.y + t * dy },
  }
}

// getSegmentColor moved to lib/segment-meta

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
