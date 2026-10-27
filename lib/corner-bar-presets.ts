/**
 * 図面詳細画面の「コーナー筋」タブで扱う鉄筋オブジェクトのモデル。
 *
 * ユニット編集の派生ではなく、図面レベルの独立したオブジェクトとして扱う。
 * 将来 曲筋・玄関落とし筋 などが増えても構造を変えずに済むよう、
 * 次の 2 軸を分離している。
 *
 *   category  … 筋種類（コーナー筋 / 添え筋 / 特殊コーナー筋 …）
 *   shapeType … 形状トポロジー（L / U / Z / STEP …）
 *
 * 同じ L 形がコーナー筋にも添え筋にも使えるため、形状と筋種類は 1:1 にしない。
 *
 * 寸法は「鉄筋 1 本 ＝ 長さ 1 個」では持たない。
 * 形状を構成する辺（segment）ごとに寸法値(mm)と寸法基準（芯々／内々／外々）を持ち、
 * 辺の順序は資料の表記（例: 600 × 455 × 115 × 600）と一致させる。
 */

import type { SegmentColor } from '@/lib/segment-colors'

/** 寸法基準。辺ごとに個別に持つ（鉄筋全体の属性ではない） */
export type MeasurementType = 'SHIN_SHIN' | 'UCHI_UCHI' | 'SOTO_SOTO'

export const MEASUREMENT_TYPES: Array<{ id: MeasurementType; label: string }> = [
  { id: 'SHIN_SHIN', label: '芯々' },
  { id: 'UCHI_UCHI', label: '内々' },
  { id: 'SOTO_SOTO', label: '外々' },
]

export function measurementTypeLabel(value: MeasurementType | null | undefined): string {
  if (!value) return '未設定'
  return MEASUREMENT_TYPES.find((m) => m.id === value)?.label ?? '未設定'
}

/** 筋種類。UI ラベルは日本語、保存値は英字キー */
export type CornerBarCategory = 'CORNER' | 'SOE' | 'SPECIAL_CORNER'

export const CORNER_BAR_CATEGORIES: Array<{
  id: CornerBarCategory
  label: string
}> = [
  { id: 'CORNER', label: 'コーナー筋' },
  { id: 'SOE', label: '添え筋' },
  { id: 'SPECIAL_CORNER', label: '特殊コーナー筋' },
]

/** 付加筋を新しく置くときの既定の色。筋種類ごとに見分けやすい色にする */
export const DEFAULT_CORNER_BAR_COLORS: Record<CornerBarCategory, SegmentColor> = {
  CORNER: 'yellow',
  SOE: 'slate',
  SPECIAL_CORNER: 'fuchsia',
}

const LEGACY_CORNER_BAR_CATEGORY_LABELS: Record<string, string> = {
  BIG_CORNER: '特殊コーナー筋',
  PARTIAL_REINFORCE: '部分補強筋',
  BENT: '曲筋',
  GENKAN_DROP: '玄関落とし筋',
}

export function cornerBarCategoryLabel(category: string): string {
  return (
    CORNER_BAR_CATEGORIES.find((c) => c.id === category)?.label ??
    LEGACY_CORNER_BAR_CATEGORY_LABELS[category] ??
    category
  )
}

export const CORNER_BAR_DIAMETERS = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25'] as const

/** 形状トポロジー */
export type CornerBarShapeType =
  | 'STRAIGHT'
  | 'L'
  | 'U'
  | 'Z'
  | 'STEP'
  | 'T'
  | 'V_OFFSET'
  | 'V_STEP2'
  | 'V_STEP2_END'
  | 'V_NOTCH'
  | 'V_NOTCH_SIDE'
  | 'V_STEP3'

/**
 * 形状定義。辺の向きだけを持ち、寸法は持たない。
 *
 * directions は辺の順番どおりの単位ベクトル。
 * キャンバスと同じく y 軸は下向きが正なので、上へ伸ばす辺は y = -1。
 */
export interface CornerBarShapeDef {
  id: CornerBarShapeType
  label: string
  /** 辺ごとの向き（順序＝辺1, 辺2, …） */
  directions: Array<{ x: number; y: number }>
  /** 寸法未入力のときに使う既定値(mm)。辺の数と同じ長さ */
  defaultLengths: number[]
}

export const CORNER_BAR_SHAPES: CornerBarShapeDef[] = [
  {
    id: 'STRAIGHT',
    label: 'ストレート',
    directions: [{ x: 1, y: 0 }],
    defaultLengths: [1200],
  },
  {
    id: 'L',
    label: 'L形',
    directions: [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
    ],
    defaultLengths: [600, 600],
  },
  {
    id: 'Z',
    label: 'Z形',
    directions: [
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
    ],
    defaultLengths: [450, 300, 450],
  },
  {
    id: 'U',
    label: 'コの字',
    directions: [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    defaultLengths: [400, 500, 400],
  },
  {
    id: 'STEP',
    label: '階段形',
    directions: [
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
    ],
    defaultLengths: [600, 455, 115, 600],
  },
  {
    id: 'T',
    label: 'T形',
    directions: [
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
    ],
    defaultLengths: [300, 300, 400],
  },
  /** 特殊コーナー筋: 縦方向に段差（下→右→下） */
  {
    id: 'V_OFFSET',
    label: 'オフセット',
    directions: [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    defaultLengths: [600, 300, 600],
  },
  /** 特殊コーナー筋: 縦方向 2 段（ㄴㄴ、最後の縦線なし） */
  {
    id: 'V_STEP2',
    label: '2段階段',
    directions: [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ],
    defaultLengths: [200, 100, 200, 100],
  },
  /** 特殊コーナー筋: 縦方向 2 段（ㄴㄴ、最後に縦線あり） */
  {
    id: 'V_STEP2_END',
    label: '2段階段（下）',
    directions: [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    defaultLengths: [200, 100, 200, 100, 200],
  },
  /** 特殊コーナー筋: 欠き込み（下→右→下→左→下） */
  {
    id: 'V_NOTCH',
    label: '欠き込み',
    directions: [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
    ],
    defaultLengths: [400, 300, 400, 300, 400],
  },
  /** 特殊コーナー筋: 欠き込みの最後を横に戻す（下→右→下→左、最後の横が長い） */
  {
    id: 'V_NOTCH_SIDE',
    label: '欠き込み（横）',
    directions: [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ],
    defaultLengths: [300, 200, 300, 500],
  },
  /** 特殊コーナー筋: 縦方向 3 段階段。パレットからは外したが旧データ用に残す */
  {
    id: 'V_STEP3',
    label: '3段階段',
    directions: [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    defaultLengths: [100, 100, 100, 100, 100, 100, 100],
  },
]

export function getCornerBarShape(shapeType: string): CornerBarShapeDef | null {
  return CORNER_BAR_SHAPES.find((s) => s.id === shapeType) ?? null
}

export function cornerBarShapeLabel(shapeType: string): string {
  return getCornerBarShape(shapeType)?.label ?? shapeType
}

/** 筋種類ごとに形状が固定される場合のマッピング（添え筋＝ストレート、コーナー筋＝L形） */
const CATEGORY_FIXED_SHAPE: Partial<Record<CornerBarCategory, CornerBarShapeType>> = {
  CORNER: 'L',
  SOE: 'STRAIGHT',
}

/** 特殊コーナー筋で選べる形状（資料の手書き図に合わせたもの） */
export const SPECIAL_CORNER_SHAPE_TYPES: CornerBarShapeType[] = [
  'V_OFFSET',
  'V_STEP2',
  'V_NOTCH',
  'V_STEP2_END',
  'V_NOTCH_SIDE',
]

export function getFixedShapeForCategory(
  category: CornerBarCategory,
): CornerBarShapeType | null {
  return CATEGORY_FIXED_SHAPE[category] ?? null
}

export function isCategoryShapeFixed(category: CornerBarCategory): boolean {
  return getFixedShapeForCategory(category) != null
}

export function getCornerBarShapesForCategory(
  category: CornerBarCategory,
): CornerBarShapeDef[] {
  const fixed = getFixedShapeForCategory(category)
  if (fixed) {
    const shape = getCornerBarShape(fixed)
    return shape ? [shape] : []
  }
  if (category === 'SPECIAL_CORNER') {
    return SPECIAL_CORNER_SHAPE_TYPES.map((id) => getCornerBarShape(id)).filter(
      (shape): shape is CornerBarShapeDef => shape != null,
    )
  }
  return CORNER_BAR_SHAPES
}

/** パレット用。コーナー筋は L 形を 90° ずつ 4 通り、添え筋はストレート 1 つ */
export interface CornerBarShapeOption {
  key: string
  shapeType: CornerBarShapeType
  rotation: number
  label: string
  shape: CornerBarShapeDef
}

export function getCornerBarShapeOptionsForCategory(
  category: CornerBarCategory,
): CornerBarShapeOption[] {
  if (category === 'CORNER') {
    const shape = getCornerBarShape('L')
    if (!shape) return []
    return [0, 1, 2, 3].map((rotation) => ({
      key: `L-${rotation}`,
      shapeType: 'L',
      rotation,
      label: `L形 ${cornerBarRotationLabel(rotation)}`,
      shape,
    }))
  }
  if (category === 'SOE') {
    const shape = getCornerBarShape('STRAIGHT')
    if (!shape) return []
    return [0, 1].map((rotation) => ({
      key: `STRAIGHT-${rotation}`,
      shapeType: 'STRAIGHT',
      rotation,
      label: rotation === 0 ? '横' : '縦',
      shape,
    }))
  }
  if (category === 'SPECIAL_CORNER') {
    return SPECIAL_CORNER_SHAPE_TYPES.flatMap((shapeType) => {
      const shape = getCornerBarShape(shapeType)
      if (!shape) return []
      return [
        {
          key: shapeType,
          shapeType,
          rotation: 0,
          label: shape.label,
          shape,
        },
      ]
    })
  }
  return CORNER_BAR_SHAPES.map((shape) => ({
    key: shape.id,
    shapeType: shape.id,
    rotation: 0,
    label: shape.label,
    shape,
  }))
}

export function resolveCategoryShape(
  category: CornerBarCategory,
  shapeType?: CornerBarShapeType | string | null,
): CornerBarShapeType {
  const fixed = getFixedShapeForCategory(category)
  if (fixed) return fixed
  // 特殊コーナー筋はパレットにある形状だけを持つ（ストレートなどが残らないように）
  if (category === 'SPECIAL_CORNER') {
    if (shapeType && SPECIAL_CORNER_SHAPE_TYPES.includes(shapeType as CornerBarShapeType)) {
      return shapeType as CornerBarShapeType
    }
    return SPECIAL_CORNER_SHAPE_TYPES[0] ?? 'V_OFFSET'
  }
  if (shapeType && getCornerBarShape(shapeType)) return shapeType as CornerBarShapeType
  return 'STRAIGHT'
}

/**
 * コーナー筋 L 形の標準寸法（径ごと、辺1 × 辺2）。
 * D13 の 600×600 が UI・資料の基準。添え筋 D13=1200 はその 2 倍、他径は同比率。
 */
const CORNER_STANDARD_LENGTHS_MM: Record<string, readonly [number, number]> = {
  D13: [600, 600],
  D10: [450, 450],
  D16: [750, 750],
  D19: [900, 900],
  D22: [1000, 1000],
  D25: [1150, 1150],
}

/** 添え筋ストレートの標準寸法（径ごと） */
const SOE_STANDARD_LENGTHS_MM: Record<string, number> = {
  D13: 1200,
  D10: 900,
  D16: 1500,
  D19: 1800,
  D22: 2000,
  D25: 2300,
}

export function hasStandardSegmentLengths(category: CornerBarCategory): boolean {
  return category === 'CORNER' || category === 'SOE'
}

/** 筋種類・径に対応する標準寸法（mm）。未定義の径は null */
export function getStandardSegmentLengthsMm(
  category: CornerBarCategory,
  diameter: string,
  shapeType: CornerBarShapeType,
): number[] | null {
  if (category === 'SOE' && shapeType === 'STRAIGHT') {
    const len = SOE_STANDARD_LENGTHS_MM[diameter]
    return len != null ? [len] : null
  }
  if (category === 'CORNER' && shapeType === 'L') {
    const legs = CORNER_STANDARD_LENGTHS_MM[diameter]
    return legs ? [...legs] : null
  }
  return null
}

function formatStandardDimsLabel(category: CornerBarCategory, diameter: string): string | null {
  if (category === 'SOE') {
    const len = SOE_STANDARD_LENGTHS_MM[diameter]
    return len != null ? String(len) : null
  }
  if (category === 'CORNER') {
    const legs = CORNER_STANDARD_LENGTHS_MM[diameter]
    return legs ? `${legs[0]} × ${legs[1]}` : null
  }
  return null
}

/**
 * 鉄筋径プルダウン表示。コーナー筋・添え筋は寸法を括弧付きで示す。
 * 編集中の辺を渡した場合は標準寸法ではなく、現在入力されている寸法を表示する。
 */
export function cornerBarDiameterOptionLabel(
  category: CornerBarCategory,
  diameter: string,
  currentSegments?: CornerBarSegment[],
): string {
  if (!hasStandardSegmentLengths(category)) return diameter
  if (
    currentSegments &&
    currentSegments.length > 0 &&
    currentSegments.every((segment) => segment.lengthMm != null && segment.lengthMm > 0)
  ) {
    const dims = currentSegments.map((segment) => segment.lengthMm).join(' × ')
    return `${diameter}(${dims})`
  }
  const dims = formatStandardDimsLabel(category, diameter)
  return dims ? `${diameter}(${dims})` : diameter
}

/**
 * 保存する辺データ。
 *
 * lengthMm は未入力を許す（形状を先に置いて、寸法は後から入れる運用のため）。
 * labelOffset は寸法ラベルが重なったときにドラッグで避けるためのずれ。
 */
export interface CornerBarSegment {
  id: string
  lengthMm: number | null
  measurementType: MeasurementType | null
  /** 図面上の見た目の辺長倍率（mm とは独立。既定 1） */
  drawScale?: number
  labelOffsetX?: number
  labelOffsetY?: number
}

export const DEFAULT_CORNER_BAR_DRAW_SCALE = 1
export const MIN_CORNER_BAR_DRAW_SCALE = 0.25
/** 図面キャンバス上の辺の最大倍率（パネル図は別途 MIN_PANEL_THUMB_EDGE_RATIO で短縮下限） */
export const MAX_CORNER_BAR_DRAW_SCALE = 20

export function clampCornerBarDrawScale(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_CORNER_BAR_DRAW_SCALE
  return Math.min(MAX_CORNER_BAR_DRAW_SCALE, Math.max(MIN_CORNER_BAR_DRAW_SCALE, n))
}

/** コーナー筋・特殊コーナー筋のみ辺ごとの図面長調整を行う */
export function isPerEdgeVisualDrawCategory(category: string): boolean {
  return category === 'CORNER' || category === 'SPECIAL_CORNER'
}

export function scaleCornerBarDrawScale(current: unknown, factor: number): number {
  return clampCornerBarDrawScale(Number(current ?? 1) * factor)
}

/** 形状を選んだ直後の、寸法未入力の辺列を作る */
export function makeCornerBarSegments(shape: CornerBarShapeDef): CornerBarSegment[] {
  return shape.directions.map((_, i) => ({
    id: `s${i + 1}`,
    lengthMm: null,
    measurementType: null,
  }))
}

/**
 * 筋種類・径の標準寸法を辺に入れる。標準が無い径は既存値を維持する。
 * measurementType など標準以外の属性は既存値を保つ。
 */
export function applyStandardSegmentLengths(
  shape: CornerBarShapeDef,
  category: CornerBarCategory,
  diameter: string,
  existing?: CornerBarSegment[],
): CornerBarSegment[] {
  const standard = getStandardSegmentLengthsMm(
    category,
    diameter,
    shape.id as CornerBarShapeType,
  )
  return shape.directions.map((_, i) => {
    const prev = existing?.[i]
    return {
      id: prev?.id ?? `s${i + 1}`,
      lengthMm: standard?.[i] ?? prev?.lengthMm ?? null,
      measurementType: prev?.measurementType ?? null,
      ...(Number.isFinite(Number(prev?.labelOffsetX))
        ? { labelOffsetX: Number(prev?.labelOffsetX) }
        : {}),
      ...(Number.isFinite(Number(prev?.labelOffsetY))
        ? { labelOffsetY: Number(prev?.labelOffsetY) }
        : {}),
      ...(Number.isFinite(Number(prev?.drawScale))
        ? { drawScale: clampCornerBarDrawScale(prev?.drawScale) }
        : {}),
    }
  })
}

/**
 * 保存済みの辺データを形状に合わせて整える。
 * 形状の辺数と合わない古いデータでも、順序を保ったまま過不足を補正する。
 */
export function normalizeCornerBarSegments(
  shape: CornerBarShapeDef,
  stored: unknown,
): CornerBarSegment[] {
  const list = Array.isArray(stored) ? stored : []
  return shape.directions.map((_, i) => {
    const raw = list[i] as Partial<CornerBarSegment> | undefined
    const lengthRaw = Number(raw?.lengthMm)
    const measurement = raw?.measurementType
    return {
      id: typeof raw?.id === 'string' && raw.id ? raw.id : `s${i + 1}`,
      lengthMm: Number.isFinite(lengthRaw) && lengthRaw > 0 ? lengthRaw : null,
      measurementType:
        measurement === 'SHIN_SHIN' ||
        measurement === 'UCHI_UCHI' ||
        measurement === 'SOTO_SOTO'
          ? measurement
          : null,
      ...(Number.isFinite(Number(raw?.labelOffsetX))
        ? { labelOffsetX: Number(raw?.labelOffsetX) }
        : {}),
      ...(Number.isFinite(Number(raw?.labelOffsetY))
        ? { labelOffsetY: Number(raw?.labelOffsetY) }
        : {}),
      ...(Number.isFinite(Number(raw?.drawScale))
        ? { drawScale: clampCornerBarDrawScale(raw?.drawScale) }
        : {}),
    }
  })
}

/** 寸法が全部入っているか（一覧で未入力を目立たせるため） */
export function isCornerBarFullyDimensioned(segments: CornerBarSegment[]): boolean {
  return segments.length > 0 && segments.every((s) => s.lengthMm != null && s.lengthMm > 0)
}

/** 辺の合計(mm)。未入力の辺は 0 として足す */
export function cornerBarSegmentSumMm(segments: CornerBarSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.lengthMm ?? 0), 0)
}

/** 資料と同じ「600 × 455 × 115 × 600」表記 */
export function formatCornerBarDims(segments: CornerBarSegment[]): string {
  if (segments.length === 0) return ''
  return segments.map((s) => (s.lengthMm == null ? '—' : String(s.lengthMm))).join(' × ')
}

// --- 鉄筋（径ごとの本数と寸法） -----------------------------------------

/**
 * 1 配置に入る鉄筋 1 種類ぶん。
 *
 * 同じ位置に D10 と D13 を入れると実寸が違うため、寸法は径ごとに分けて持つ。
 * segments の要素数は形状の辺数と一致させる（順序＝辺1, 辺2, …）。
 *
 * 筋種類（category）と形状（shapeType）は配置側が 1 つだけ持つので、
 * 1 つの配置に別の筋種類が混ざることはない。
 */
export interface CornerBarBarItem {
  id: string
  /** D10 / D13 / D16 … */
  barType: string
  /** 本数 */
  quantity: number
  segments: CornerBarSegment[]
  /**
   * 特殊コーナー筋: 加工長を出すときに辺 1 本あたり引く長さ(mm)を寸法基準ごとに持つ。
   * 配置ごとに 1 組だけ入力するが、集計は鉄筋ごとに行うので全ての bars に同じ値を書く。
   * 無い（古いデータ・未入力）ときは全て 0 として扱う。
   */
  measurementDeductionsMm?: MeasurementDeductionsMm
}

/** 寸法基準ごとの辺 1 本あたりの減り(mm) */
export type MeasurementDeductionsMm = Record<MeasurementType, number>

export const ZERO_MEASUREMENT_DEDUCTIONS: MeasurementDeductionsMm = {
  UCHI_UCHI: 0,
  SOTO_SOTO: 0,
  SHIN_SHIN: 0,
}

/** 保存値を 0 以上の整数に揃える。どれも入っていなければ undefined */
export function normalizeMeasurementDeductions(
  value: unknown,
): MeasurementDeductionsMm | undefined {
  if (!value || typeof value !== 'object') return undefined
  const rec = value as Partial<Record<MeasurementType, unknown>>
  let found = false
  const out = { ...ZERO_MEASUREMENT_DEDUCTIONS }
  for (const { id } of MEASUREMENT_TYPES) {
    const n = Math.floor(Number(rec[id]))
    if (rec[id] == null || !Number.isFinite(n)) continue
    out[id] = Math.max(0, n)
    found = true
  }
  return found ? out : undefined
}

/** 配置の鉄筋に入っている減りの値（先頭の鉄筋を代表にする）。無ければ全て 0 */
export function cornerBarMeasurementDeductions(
  bars: CornerBarBarItem[],
): MeasurementDeductionsMm {
  return bars[0]?.measurementDeductionsMm ?? ZERO_MEASUREMENT_DEDUCTIONS
}

/** 減りの値を配置の全ての鉄筋に書く */
export function setCornerBarMeasurementDeductions(
  bars: CornerBarBarItem[],
  deductions: MeasurementDeductionsMm,
): CornerBarBarItem[] {
  return bars.map((bar) => ({ ...bar, measurementDeductionsMm: { ...deductions } }))
}

function withDeductions(
  deductions: MeasurementDeductionsMm | undefined,
): Pick<CornerBarBarItem, 'measurementDeductionsMm'> {
  return deductions ? { measurementDeductionsMm: { ...deductions } } : {}
}

export const DEFAULT_CORNER_BAR_DIAMETER = 'D13'

function normalizeBarQuantity(value: unknown): number {
  if (value == null || value === '') return 1
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 0) return 1
  return n
}

/** 追加ボタン用。既存 id と衝突しない連番を返す */
export function nextCornerBarBarId(bars: CornerBarBarItem[]): string {
  let max = 0
  for (const bar of bars) {
    const matched = /^b(\d+)$/.exec(bar.id)
    if (matched) max = Math.max(max, Number.parseInt(matched[1]!, 10))
  }
  return `b${max + 1}`
}

/** 径に対応する標準寸法を入れた鉄筋 1 件を作る */
export function makeCornerBarBar(
  shape: CornerBarShapeDef,
  category: CornerBarCategory,
  barType: string,
  base?: Partial<
    Pick<CornerBarBarItem, 'id' | 'quantity' | 'segments' | 'measurementDeductionsMm'>
  >,
): CornerBarBarItem {
  return {
    id: base?.id ?? 'b1',
    barType,
    quantity: normalizeBarQuantity(base?.quantity),
    segments: applyStandardSegmentLengths(shape, category, barType, base?.segments),
    ...withDeductions(base?.measurementDeductionsMm),
  }
}

/**
 * 径だけを変えた鉄筋 1 件を作る。
 *
 * 辺は新しい径の標準寸法で入れ替える。標準を持つ筋種類（コーナー筋・添え筋）で
 * 標準が無い径を選んだときは空にする。前の径の値をそのまま残すと、
 * 違う径の寸法が入ったままだと気づかずに配置されてしまうため。
 * もともと標準を持たない筋種類は手入力なので、入力済みの値は残す。
 */
export function changeCornerBarBarDiameter(
  shape: CornerBarShapeDef,
  category: CornerBarCategory,
  bar: CornerBarBarItem,
  barType: string,
): CornerBarBarItem {
  const standard = getStandardSegmentLengthsMm(
    category,
    barType,
    shape.id as CornerBarShapeType,
  )
  const clearWhenNoStandard = hasStandardSegmentLengths(category)
  return {
    id: bar.id,
    barType,
    quantity: normalizeBarQuantity(bar.quantity),
    segments: shape.directions.map((_, i) => {
      const prev = bar.segments[i]
      return {
        id: prev?.id ?? `s${i + 1}`,
        lengthMm: standard?.[i] ?? (clearWhenNoStandard ? null : prev?.lengthMm ?? null),
        measurementType: prev?.measurementType ?? null,
        ...(Number.isFinite(Number(prev?.labelOffsetX))
          ? { labelOffsetX: Number(prev?.labelOffsetX) }
          : {}),
        ...(Number.isFinite(Number(prev?.labelOffsetY))
          ? { labelOffsetY: Number(prev?.labelOffsetY) }
          : {}),
      }
    }),
    ...withDeductions(bar.measurementDeductionsMm),
  }
}

/**
 * 保存済みの bars を形状に合わせて整える。
 * bars が空の古い行は diameter / segments から 1 件に組み立てる。
 */
export function normalizeCornerBarBars(
  shape: CornerBarShapeDef,
  source: { bars?: unknown; diameter?: string | null; segments?: unknown },
): CornerBarBarItem[] {
  const raw = Array.isArray(source.bars) ? source.bars : []
  const normalized = raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null
      const rec = item as Partial<CornerBarBarItem>
      const barType = typeof rec.barType === 'string' ? rec.barType.trim() : ''
      if (!barType) return null
      return {
        id: typeof rec.id === 'string' && rec.id ? rec.id : `b${i + 1}`,
        barType,
        quantity: normalizeBarQuantity(rec.quantity),
        segments: normalizeCornerBarSegments(shape, rec.segments),
        ...withDeductions(normalizeMeasurementDeductions(rec.measurementDeductionsMm)),
      }
    })
    .filter((bar): bar is CornerBarBarItem => bar != null)

  if (normalized.length > 0) return normalized

  // 旧モデル（配置 = 径 1 つ）からのフォールバック
  const legacyDiameter = (source.diameter ?? '').trim() || DEFAULT_CORNER_BAR_DIAMETER
  return [
    {
      id: 'b1',
      barType: legacyDiameter,
      quantity: 1,
      segments: normalizeCornerBarSegments(shape, source.segments),
    },
  ]
}

/**
 * 筋種類・形状が変わったとき、各鉄筋の辺を新しい形状に合わせ直す。
 *
 * 形状が変わると辺の意味そのものが変わるので、既存の寸法は引き継がない。
 * 引き継いでしまうと、たとえば添え筋（ストレート 1200）から
 * 特殊コーナー筋に変えたときに辺1 だけ 1200 が残ってしまう。
 */
export function remapCornerBarBarsToShape(
  shape: CornerBarShapeDef,
  category: CornerBarCategory,
  bars: CornerBarBarItem[],
  preserveSegments = true,
): CornerBarBarItem[] {
  return bars.map((bar) =>
    makeCornerBarBar(shape, category, bar.barType, {
      id: bar.id,
      quantity: bar.quantity,
      segments: preserveSegments ? bar.segments : undefined,
      measurementDeductionsMm: bar.measurementDeductionsMm,
    }),
  )
}

/** 追加時の初期径。まだ使っていない径を順に選ぶ */
export function getNextCornerBarDiameter(existingBarTypes: string[]): string {
  const used = new Set(existingBarTypes.map((d) => d.trim().toUpperCase()))
  for (const d of CORNER_BAR_DIAMETERS) {
    if (!used.has(d)) return d
  }
  return CORNER_BAR_DIAMETERS[CORNER_BAR_DIAMETERS.length - 1]!
}

export function cornerBarBarsTotalQuantity(bars: CornerBarBarItem[]): number {
  return bars.reduce((sum, bar) => sum + bar.quantity, 0)
}

/** 全ての鉄筋で全ての辺の寸法が入っているか（未入力の警告用） */
export function isCornerBarBarsFullyDimensioned(bars: CornerBarBarItem[]): boolean {
  return bars.length > 0 && bars.every((bar) => isCornerBarFullyDimensioned(bar.segments))
}

/**
 * 旧列 diameter / segments に書き戻す値。
 * アプリはもう読まないが、ロールバックしても表示が壊れないよう bars[0] をミラーする。
 */
export function cornerBarLegacyFieldsFromBars(bars: CornerBarBarItem[]): {
  diameter: string | null
  segments: CornerBarSegment[]
} {
  const first = bars[0]
  return {
    diameter: first?.barType ?? null,
    segments: first?.segments ?? [],
  }
}

/**
 * 集計用に径と本数だけ取り出す。辺の寸法は見ないので形状定義が不要。
 * bars が空の古い行は diameter を 1 本として数える。
 */
export function cornerBarBarQuantities(source: {
  bars?: unknown
  diameter?: string | null
}): Array<{ barType: string; quantity: number }> {
  const raw = Array.isArray(source.bars) ? source.bars : []
  const out: Array<{ barType: string; quantity: number }> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Partial<CornerBarBarItem>
    const barType = typeof rec.barType === 'string' ? rec.barType.trim() : ''
    if (!barType) continue
    const quantity = normalizeBarQuantity(rec.quantity)
    if (quantity <= 0) continue
    out.push({ barType, quantity })
  }
  if (out.length > 0) return out
  const legacyDiameter = (source.diameter ?? '').trim()
  return [{ barType: legacyDiameter || '径未設定', quantity: 1 }]
}

// --- 図形化 -------------------------------------------------------------

/**
 * 図面上の大きさ（bbox の長辺, px）。
 *
 * 実寸(mm)をそのまま図面座標に使うと大きすぎる。mm は集計用。
 * 全体スケールは size_px、コーナー/特殊コーナーは辺ごとに drawScale も使う。
 */
export const DEFAULT_CORNER_BAR_SIZE_PX = 110
/** クリック配置の既定 size_px（コーナー筋。既存データの size_px 未設定時のフォールバックは 110 のまま） */
export const DEFAULT_CORNER_BAR_PLACEMENT_SIZE_PX = 33
/** 添え筋はストレート 1 辺のため、コーナー既定の 1.5 倍で見やすくする */
export const DEFAULT_SOE_PLACEMENT_SIZE_PX = 50
/** 特殊コーナー筋は形状が複雑なため、コーナー既定の 2 倍 */
export const DEFAULT_SPECIAL_CORNER_PLACEMENT_SIZE_PX =
  DEFAULT_CORNER_BAR_PLACEMENT_SIZE_PX * 2
export const MIN_CORNER_BAR_SIZE_PX = 20
export const MAX_CORNER_BAR_SIZE_PX = 3000

/** 図面クリック配置時の既定 size_px（筋種類ごと。後から選択タブの ± で調整） */
export function getDefaultCornerBarSizePxForPlacement(
  category: CornerBarCategory = 'CORNER',
): number {
  if (category === 'SOE') return DEFAULT_SOE_PLACEMENT_SIZE_PX
  if (category === 'SPECIAL_CORNER') return DEFAULT_SPECIAL_CORNER_PLACEMENT_SIZE_PX
  return DEFAULT_CORNER_BAR_PLACEMENT_SIZE_PX
}

export function clampCornerBarSizePx(sizePx: number): number {
  if (!Number.isFinite(sizePx)) return DEFAULT_CORNER_BAR_SIZE_PX
  return Math.min(MAX_CORNER_BAR_SIZE_PX, Math.max(MIN_CORNER_BAR_SIZE_PX, sizePx))
}

/** ドラッグした矩形から大きさを決める。長辺をそのまま形状の長辺にする */
export function cornerBarSizePxFromDrag(dx: number, dy: number): number {
  return clampCornerBarSizePx(Math.max(Math.abs(dx), Math.abs(dy)))
}

/**
 * ドラッグ矩形から付加筋の向き（0/1/2/3）を推定する。
 * 添え筋（ストレート）は長辺方向に伸ばす。縦長ドラッグなら 90° 回転。
 */
export function cornerBarRotationFromDrag(
  dx: number,
  dy: number,
  category: CornerBarCategory,
  shapeType: CornerBarShapeType,
  fallbackRotation = 0,
): number {
  if (category === 'SOE' && shapeType === 'STRAIGHT') {
    return Math.abs(dy) > Math.abs(dx) ? 1 : 0
  }
  return normalizeCornerBarRotation(fallbackRotation)
}

/** クリックだけでは配置しない。ドラッグ量が下限以上のときだけ true */
export function isCornerBarDragPlacement(dx: number, dy: number): boolean {
  return Math.max(Math.abs(dx), Math.abs(dy)) >= MIN_CORNER_BAR_SIZE_PX
}

/** 短い辺が潰れて掴めなくならないよう、最長辺に対して下限を置く比率 */
const MIN_SEGMENT_RATIO = 0.12

/**
 * パネル形状図（アンカー辺選択時）。他辺がアンカー基準長の何割以下には縮まないか。
 * L形で 1 辺を最大まで伸ばしたとき 2 辺が約 1/4 程度で止まる想定。
 */
export const MIN_PANEL_THUMB_EDGE_RATIO = 0.25

function applyMinSegmentLengthFloor(lengths: number[]): number[] {
  const floor = Math.max(...lengths, 1) * MIN_SEGMENT_RATIO
  return lengths.map((v) => Math.max(v, floor))
}

/**
 * 図面上の辺の比率。defaultLengths × drawScale（mm 入力とは連動しない）。
 */
function relativeSegmentLengths(
  shape: CornerBarShapeDef,
  segments?: CornerBarSegment[],
): number[] {
  const raw = shape.directions.map((_, i) => {
    const base = shape.defaultLengths[i] ?? 300
    const scale = clampCornerBarDrawScale(segments?.[i]?.drawScale ?? DEFAULT_CORNER_BAR_DRAW_SCALE)
    return base * scale
  })
  return applyMinSegmentLengthFloor(raw)
}

/**
 * パネル形状図用。anchor 辺の見かけ長を一定にし、他辺は相対比率だけ変える。
 */
export function drawEdgeLengthsForThumb(
  shape: CornerBarShapeDef,
  segments: CornerBarSegment[] | undefined,
  anchorEdgeIndex: number | null | undefined,
): number[] {
  const base = shape.directions.map((_, i) => shape.defaultLengths[i] ?? 300)
  const scaled = base.map((b, i) =>
    b * clampCornerBarDrawScale(segments?.[i]?.drawScale ?? DEFAULT_CORNER_BAR_DRAW_SCALE),
  )
  if (
    anchorEdgeIndex == null ||
    anchorEdgeIndex < 0 ||
    anchorEdgeIndex >= scaled.length ||
    scaled[anchorEdgeIndex]! <= 0
  ) {
    return applyMinSegmentLengthFloor(scaled)
  }
  const refAnchor = base[anchorEdgeIndex]!
  const anchorCurrent = scaled[anchorEdgeIndex]!
  const minOther = refAnchor * MIN_PANEL_THUMB_EDGE_RATIO
  const lengths = scaled.map((_, i) => {
    const relative = refAnchor * (scaled[i]! / anchorCurrent)
    if (i === anchorEdgeIndex) return relative
    return Math.max(relative, minOther)
  })
  return applyMinSegmentLengthFloor(lengths)
}

export interface CornerBarGeometry {
  /** 辺の順に連なる頂点。points[i] → points[i+1] が辺 i */
  points: Array<{ x: number; y: number }>
}

function cornerBarPointsFromLengths(
  shape: CornerBarShapeDef,
  lengths: number[],
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }]
  shape.directions.forEach((dir, i) => {
    const len = lengths[i] ?? 0
    const prev = points[points.length - 1]!
    points.push({ x: prev.x + dir.x * len, y: prev.y + dir.y * len })
  })
  return points
}

function cornerBarPolylineNaturalSpan(points: Array<{ x: number; y: number }>): number {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  )
}

/**
 * 原点 (0,0) 起点で、辺を順番につないだ折れ線を作る。
 * 与えた lengths の bbox 長辺が sizePx になるよう一括スケール（サムネイル用）。
 */
export function buildCornerBarGeometryFromLengths(
  shape: CornerBarShapeDef,
  lengths: number[],
  sizePx: number = DEFAULT_CORNER_BAR_SIZE_PX,
): CornerBarGeometry {
  const points = cornerBarPointsFromLengths(shape, lengths)
  const natural = cornerBarPolylineNaturalSpan(points)
  if (natural <= 0) return { points }
  const k = clampCornerBarSizePx(sizePx) / natural
  return { points: points.map((p) => ({ x: p.x * k, y: p.y * k })) }
}

/**
 * 図面キャンバス用。size_px は drawScale=1 の形の bbox に対するスケール。
 * 辺の drawScale を上げるとその辺だけ px 長く伸びる（他辺は基準スケールのまま）。
 */
export function buildCornerBarGeometry(
  shape: CornerBarShapeDef,
  segments: CornerBarSegment[] = [],
  sizePx: number = DEFAULT_CORNER_BAR_SIZE_PX,
): CornerBarGeometry {
  const drawLengths = relativeSegmentLengths(shape, segments.length > 0 ? segments : undefined)
  const baselineLengths = relativeSegmentLengths(shape, undefined)
  const baselineNatural = cornerBarPolylineNaturalSpan(
    cornerBarPointsFromLengths(shape, baselineLengths),
  )
  if (baselineNatural <= 0) {
    return buildCornerBarGeometryFromLengths(shape, drawLengths, sizePx)
  }
  const k = clampCornerBarSizePx(sizePx) / baselineNatural
  const scaledLengths = drawLengths.map((len) => len * k)
  return { points: cornerBarPointsFromLengths(shape, scaledLengths) }
}

/** 辺 i の描画長（buildCornerBarGeometry 後の座標系） */
export function cornerBarGeometryEdgeLength(
  geometry: CornerBarGeometry,
  edgeIndex: number,
): number {
  const p1 = geometry.points[edgeIndex]
  const p2 = geometry.points[edgeIndex + 1]
  if (!p1 || !p2) return 0
  return Math.hypot(p2.x - p1.x, p2.y - p1.y)
}

export function normalizeCornerBarRotation(steps: number): number {
  return ((Math.round(steps) % 4) + 4) % 4
}

/** ボタン 1 回で 90 度ずつ進める */
export function nextCornerBarRotation(steps: number): number {
  return normalizeCornerBarRotation(steps + 1)
}

export function cornerBarRotationLabel(steps: number): string {
  return `${normalizeCornerBarRotation(steps) * 90}°`
}

export function normalizeCornerBarFlip(value: unknown): boolean {
  return value === true || value === 1 || value === 'true'
}

/** 左右反転（ローカル座標の x を反転してから回転する） */
export function mirrorCornerBarPointHorizontal(p: { x: number; y: number }): {
  x: number
  y: number
} {
  return { x: -p.x, y: p.y }
}

export function toggleCornerBarFlip(flipped: boolean): boolean {
  return !normalizeCornerBarFlip(flipped)
}

export function cornerBarFlipLabel(flipped: boolean): string {
  return normalizeCornerBarFlip(flipped) ? '反転' : '標準'
}

/** 反転 → 90° 単位回転の順で向きを決める */
export function applyCornerBarOrientation(
  p: { x: number; y: number },
  rotationSteps: number,
  flipped = false,
): { x: number; y: number } {
  const base = normalizeCornerBarFlip(flipped)
    ? mirrorCornerBarPointHorizontal(p)
    : p
  return rotateCornerBarPoint(base, rotationSteps)
}

/** 90 度単位の回転（0/1/2/3 = 0/90/180/270 度、時計回り） */
export function rotateCornerBarPoint(
  p: { x: number; y: number },
  rotationSteps: number,
): { x: number; y: number } {
  const steps = ((Math.round(rotationSteps) % 4) + 4) % 4
  switch (steps) {
    case 1:
      return { x: -p.y, y: p.x }
    case 2:
      return { x: -p.x, y: -p.y }
    case 3:
      return { x: p.y, y: -p.x }
    default:
      return { x: p.x, y: p.y }
  }
}

/**
 * 図面上に描くための絶対座標。
 * 形状の bbox 中心を配置点 (originX, originY) に合わせる。
 */
export function cornerBarCanvasGeometry(
  shape: CornerBarShapeDef,
  segments: CornerBarSegment[],
  originX: number,
  originY: number,
  rotationSteps = 0,
  sizePx: number = DEFAULT_CORNER_BAR_SIZE_PX,
  flipped = false,
): CornerBarGeometry {
  const base = buildCornerBarGeometry(shape, segments, sizePx)
  const rotated = base.points.map((p) =>
    applyCornerBarOrientation(p, rotationSteps, flipped),
  )
  const xs = rotated.map((p) => p.x)
  const ys = rotated.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return {
    points: rotated.map((p) => ({ x: originX + (p.x - cx), y: originY + (p.y - cy) })),
  }
}

/**
 * 辺 1 本の図面上の長さ（drawScale）を変えるとき、図面上で動かさない頂点の番号。
 *
 * 辺は形状の残りにつながっている側を止め、反対側（自由端の側）へ伸び縮みさせる。
 * 先頭の辺は終点、それ以外の辺は始点が残りの形状とつながっている。
 * たとえば L 形で横の辺を伸ばすと、角（横の辺の左端）は動かず右へ伸びる。
 */
export function cornerBarFixedVertexForEdge(edgeIndex: number): number {
  return edgeIndex === 0 ? 1 : edgeIndex
}

/**
 * 辺の drawScale を before → after に変えても、vertexIndex の頂点が図面上で
 * 同じ位置に残る配置点。配置点は bbox の中心なので、何もしないと形状全体がずれる。
 */
export function cornerBarOriginKeepingVertex(
  shape: CornerBarShapeDef,
  before: CornerBarSegment[],
  after: CornerBarSegment[],
  origin: { x: number; y: number },
  rotationSteps: number,
  sizePx: number,
  flipped: boolean,
  vertexIndex: number,
): { x: number; y: number } {
  const prev = cornerBarCanvasGeometry(
    shape, before, origin.x, origin.y, rotationSteps, sizePx, flipped,
  ).points[vertexIndex]
  const next = cornerBarCanvasGeometry(
    shape, after, origin.x, origin.y, rotationSteps, sizePx, flipped,
  ).points[vertexIndex]
  if (!prev || !next) return origin
  return { x: origin.x + prev.x - next.x, y: origin.y + prev.y - next.y }
}

/**
 * 図面上でドラッグして伸び縮みできる辺と、掴む端点。
 * 掴めるのは形状の両端（先頭の辺の始点と最後の辺の終点）だけで、
 * 反対側の端は cornerBarFixedVertexForEdge の頂点として止まる。
 */
export function cornerBarDraggableEnds(
  shape: CornerBarShapeDef,
): Array<{ edgeIndex: number; vertexIndex: number }> {
  const last = shape.directions.length - 1
  if (last < 1) return []
  return [
    { edgeIndex: 0, vertexIndex: 0 },
    { edgeIndex: last, vertexIndex: last + 1 },
  ]
}

/**
 * 端点を point までドラッグしたときの、その辺の drawScale と配置点。
 *
 * 辺の向きは変えず、止める頂点から辺の向きに測った point までの距離を新しい長さにする。
 * 辺が短すぎて下限（applyMinSegmentLengthFloor）に当たっていると drawScale と
 * 長さが比例しないので、数回当て直してマウスに合わせる。
 */
export function resizeCornerBarEdgeToPoint(
  shape: CornerBarShapeDef,
  segments: CornerBarSegment[],
  origin: { x: number; y: number },
  rotationSteps: number,
  sizePx: number,
  flipped: boolean,
  edgeIndex: number,
  point: { x: number; y: number },
): { segments: CornerBarSegment[]; origin: { x: number; y: number } } | null {
  const fixedIndex = cornerBarFixedVertexForEdge(edgeIndex)
  const movingIndex = edgeIndex === 0 ? 0 : edgeIndex + 1
  const geometryOf = (segs: CornerBarSegment[]) =>
    cornerBarCanvasGeometry(shape, segs, origin.x, origin.y, rotationSteps, sizePx, flipped)
  const edgeLength = (segs: CornerBarSegment[]) => {
    const pts = geometryOf(segs).points
    const a = pts[fixedIndex]
    const b = pts[movingIndex]
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
  }

  const points = geometryOf(segments).points
  const fixed = points[fixedIndex]
  const moving = points[movingIndex]
  const startLength = edgeLength(segments)
  if (!fixed || !moving || startLength <= 0) return null
  const dirX = (moving.x - fixed.x) / startLength
  const dirY = (moving.y - fixed.y) / startLength
  // 止める頂点を越えて反対側へ引いた分は 0 とみなし、最小倍率で止める
  const target = Math.max(0, (point.x - fixed.x) * dirX + (point.y - fixed.y) * dirY)

  const withScale = (drawScale: number) =>
    segments.map((seg, i) => (i === edgeIndex ? { ...seg, drawScale } : seg))
  let drawScale = clampCornerBarDrawScale(segments[edgeIndex]?.drawScale)
  let next = segments
  for (let pass = 0; pass < 4; pass += 1) {
    const length = edgeLength(next)
    if (length <= 0) break
    const adjusted = clampCornerBarDrawScale((drawScale * target) / length)
    if (Math.abs(adjusted - drawScale) < 1e-4 && pass > 0) break
    drawScale = adjusted
    next = withScale(drawScale)
  }

  return {
    segments: next,
    origin: cornerBarOriginKeepingVertex(
      shape, segments, next, origin, rotationSteps, sizePx, flipped, fixedIndex,
    ),
  }
}

/** 辺 i の両端。辺の順序と 1 対 1 で対応する */
export function cornerBarSegmentLines(
  geometry: CornerBarGeometry,
): Array<{ index: number; p1: { x: number; y: number }; p2: { x: number; y: number } }> {
  const out: Array<{ index: number; p1: { x: number; y: number }; p2: { x: number; y: number } }> =
    []
  for (let i = 0; i < geometry.points.length - 1; i += 1) {
    out.push({ index: i, p1: geometry.points[i]!, p2: geometry.points[i + 1]! })
  }
  return out
}

export function cornerBarGeometryBounds(geometry: CornerBarGeometry): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const xs = geometry.points.map((p) => p.x)
  const ys = geometry.points.map((p) => p.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

/**
 * 指定した箱にぴったり収めた辺の頂点。points[i] → points[i+1] が辺 i。
 *
 * サムネイルの path と、寸法を書き込んだ図解のラベル位置を同じ座標系で
 * 求めたいので、当てはめの計算をここに 1 つだけ置く。
 */
export function cornerBarThumbPoints(
  shape: CornerBarShapeDef,
  boxW: number,
  boxH: number,
  pad = 6,
  rotationSteps = 0,
  flipped = false,
  segments?: CornerBarSegment[],
  anchorEdgeIndex?: number | null,
): Array<{ x: number; y: number }> {
  const lengths = drawEdgeLengthsForThumb(shape, segments, anchorEdgeIndex)
  const refSize = Math.max(...lengths, DEFAULT_CORNER_BAR_SIZE_PX)
  const geometry = buildCornerBarGeometryFromLengths(shape, lengths, refSize)
  const rotated = {
    points: geometry.points.map((p) =>
      applyCornerBarOrientation(p, rotationSteps, flipped),
    ),
  }
  const b = cornerBarGeometryBounds(rotated)
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxY - b.minY)
  const scale = Math.min((boxW - pad * 2) / w, (boxH - pad * 2) / h)
  const offsetX = (boxW - w * scale) / 2
  const offsetY = (boxH - h * scale) / 2
  return rotated.points.map((p) => ({
    x: offsetX + (p.x - b.minX) * scale,
    y: offsetY + (p.y - b.minY) * scale,
  }))
}

/**
 * 辺ごとのラベル位置。中点から形状の外側へ gap だけずらす。
 *
 * 番号バッジ（パネル）と寸法（結果ページの図解）で同じ置き方をしたいので、
 * 外向きの判定をここに 1 つだけ置く。
 */
export function cornerBarSegmentLabelAnchors(
  points: Array<{ x: number; y: number }>,
  gap: number,
): Array<{ index: number; x: number; y: number; mx: number; my: number }> {
  if (points.length < 2) return []
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2

  return points.slice(0, -1).map((p1, i) => {
    const p2 = points[i + 1]!
    const mx = (p1.x + p2.x) / 2
    const my = (p1.y + p2.y) / 2
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy) || 1
    // 辺に直交する向きのうち、形状の外を向くほうへラベルをずらす
    let nx = -dy / len
    let ny = dx / len
    if (nx * (mx - cx) + ny * (my - cy) < 0) {
      nx = -nx
      ny = -ny
    }
    return { index: i, x: mx + nx * gap, y: my + ny * gap, mx, my }
  })
}

/** パレットのサムネイル用 SVG path */
export function cornerBarThumbPath(
  shape: CornerBarShapeDef,
  boxW: number,
  boxH: number,
  pad = 6,
  rotationSteps = 0,
  flipped = false,
): string {
  return cornerBarThumbPoints(shape, boxW, boxH, pad, rotationSteps, flipped)
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
}

// --- 印刷要約（パネル下部・印刷プレビューで共有） -------------------------

export type CornerBarPrintSummaryCategoryCount = {
  category: CornerBarCategory
  label: string
  count: number
}

export type CornerBarPrintSummaryDetailRow = {
  category: string
  diameter: string
  color: string
  qty: number
}

export type CornerBarPrintSummary = {
  categoryCounts: CornerBarPrintSummaryCategoryCount[]
  detailRows: CornerBarPrintSummaryDetailRow[]
}

type CornerBarForPrintSummary = {
  category: string
  diameter?: string | null
  bars?: unknown
  color: string
}

/**
 * 付加筋パネル下部・印刷要約ボックス用の集計。
 * 配置数ではなく、径ごとの本数を合計する。
 */
export function buildCornerBarPrintSummary(
  cornerBars: CornerBarForPrintSummary[],
  normalizeColor: (color: string) => string = (c) => c,
): CornerBarPrintSummary {
  const countByCategory = new Map<string, number>()
  const detailMap = new Map<
    string,
    { category: string; diameter: string; color: string; qty: number }
  >()
  for (const cb of cornerBars) {
    const color = normalizeColor(cb.color ?? 'red')
    for (const bar of cornerBarBarQuantities(cb)) {
      countByCategory.set(cb.category, (countByCategory.get(cb.category) ?? 0) + bar.quantity)
      const key = `${cb.category}/${bar.barType}/${color}`
      const prev = detailMap.get(key)
      if (prev) prev.qty += bar.quantity
      else
        detailMap.set(key, {
          category: cb.category,
          diameter: bar.barType,
          color,
          qty: bar.quantity,
        })
    }
  }

  const categoryCounts = CORNER_BAR_CATEGORIES.map((c) => ({
    category: c.id,
    label: c.label,
    count: countByCategory.get(c.id) ?? 0,
  })).filter((c) => c.count > 0)

  const detailRows = [...detailMap.values()].sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.diameter.localeCompare(b.diameter) ||
      a.color.localeCompare(b.color),
  )

  return { categoryCounts, detailRows }
}

// --- 配置前の設定 -------------------------------------------------------

/**
 * パレットで選んでから図面をクリックするまでの、配置待ちの設定。
 * 筋種類・形状・鉄筋（径と本数）・向きをここで決める。
 *
 * 辺の寸法は径ごとの標準値を入れておき、細かい調整は配置後に右パネルで行う。
 */
export interface CornerBarPlacementDraft {
  category: CornerBarCategory
  shapeType: CornerBarShapeType
  /** 径ごとの本数と寸法。配置時にそのまま bars として保存する */
  bars: CornerBarBarItem[]
  /** 0/1/2/3 = 0/90/180/270 度 */
  rotation: number
  /** 特殊コーナー筋のみ: 左右反転 */
  flipped?: boolean
}

export function makeCornerBarDraft(
  shapeType: CornerBarShapeType,
  base?: Partial<CornerBarPlacementDraft>,
): CornerBarPlacementDraft {
  const category = base?.category ?? 'CORNER'
  const shape = getCornerBarShape(shapeType)
  // 形状を変えたときは径と本数だけ引き継ぎ、辺の寸法は入れ直す
  const sameShape = base?.shapeType === shapeType
  const bars = !shape
    ? base?.bars ?? []
    : base?.bars?.length
      ? remapCornerBarBarsToShape(shape, category, base.bars, sameShape)
      : [makeCornerBarBar(shape, category, DEFAULT_CORNER_BAR_DIAMETER, { id: 'b1' })]
  const flipped =
    category === 'SPECIAL_CORNER' ? normalizeCornerBarFlip(base?.flipped) : false
  return {
    category,
    shapeType,
    bars,
    rotation: base?.rotation ?? 0,
    flipped,
  }
}

/** 筋種類を切り替えたとき、形状未選択でも使える既定の配置設定 */
export function defaultPlacementDraftForCategory(
  category: CornerBarCategory,
  rotation = 0,
): CornerBarPlacementDraft {
  if (category === 'SOE') {
    return makeCornerBarDraft('STRAIGHT', { category, rotation })
  }
  if (category === 'SPECIAL_CORNER') {
    return makeCornerBarDraft(resolveCategoryShape('SPECIAL_CORNER'), {
      category,
      rotation,
    })
  }
  return makeCornerBarDraft('L', { category: 'CORNER', rotation })
}
