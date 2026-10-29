import {
  CORNER_BAR_CATEGORIES,
  CORNER_BAR_DIAMETERS,
  cornerBarCategoryLabel,
  cornerBarSegmentSumMm,
  cornerBarShapeLabel,
  clampCornerBarBendAngle,
  type CornerBarLayer,
  formatCornerBarDims,
  getCornerBarShape,
  isFreeShapeCategory,
  measurementTypeLabel,
  normalizeCornerBarBars,
  normalizeCornerBarHeightMm,
  ZERO_MEASUREMENT_DEDUCTIONS,
  type CornerBarBarItem,
  type CornerBarSegment,
  type MeasurementDeductionsMm,
  type MeasurementType,
} from '@/lib/corner-bar-presets'
import { cornerBarKakouchouMm } from '@/lib/corner-bar-kakouchou'

/**
 * 集計の入力。DrawingCornerBar をそのまま渡せる最小構造。
 *
 * 1 配置 = 1 筋種類（category）= 1 形状（shape_type）で、その中に
 * 径ごとの鉄筋（bars）が複数入る。集計は必ず bars を展開して
 * bar.quantity を足す。配置の件数は本数ではない。
 */
export interface AdditionalRebarPlacementLike {
  category: string
  shape_type: string
  bars?: unknown
  /** @deprecated bars が空の古い行のフォールバック用 */
  diameter?: string | null
  /** @deprecated bars が空の古い行のフォールバック用 */
  segments?: unknown
}

/** 「筋種類 / 形状 / 鉄筋径 / 各辺の寸法・寸法基準」が全て同じ鉄筋をまとめた 1 行 */
export interface AdditionalRebarSpecRow {
  key: string
  category: string
  categoryLabel: string
  shapeType: string
  shapeLabel: string
  diameter: string
  /** 辺の順序をそのまま保持する。寸法基準も落とさない */
  segments: CornerBarSegment[]
  /** 「600 × 455 × 115 × 600」 */
  dimsText: string
  /** 「600外々 × 455内々 × …」 寸法基準つきの表示用 */
  dimsDetailText: string
  /** 全ての辺が同じ寸法基準ならその値。混在・未設定なら null */
  uniformMeasurementType: MeasurementType | null
  /** 辺の単純合計(mm)。未入力の辺があれば null */
  segmentSumMm: number | null
  /** 加工長(mm)の参考値。計算できない場合は null */
  kakouchouMm: number | null
  /** くの字: 辺のあいだの角度（度）。角度を変えられない形状は undefined */
  bendAngleDeg?: number
  /** 段違い・斜めの高さ(mm)。図に書くだけで加工長には使わない。未入力は undefined */
  heightMm?: number
  /** 特殊コーナー筋の上・下。なしは undefined */
  layer?: CornerBarLayer
  quantity: number
}

export interface AdditionalRebarDiameterTotal {
  diameter: string
  quantity: number
}

export interface AdditionalRebarGroup {
  category: string
  label: string
  totalQuantity: number
  /** D10 → D13 → D16 → D19 → D22 の順。本数 0 の径は含まない */
  diameterTotals: AdditionalRebarDiameterTotal[]
  specRows: AdditionalRebarSpecRow[]
}

export interface AdditionalRebarSummary {
  totalQuantity: number
  groups: AdditionalRebarGroup[]
}

const DIAMETER_ORDER = new Map<string, number>(
  CORNER_BAR_DIAMETERS.map((d, i) => [d, i]),
)

const CATEGORY_ORDER = new Map<string, number>(
  CORNER_BAR_CATEGORIES.map((c, i) => [c.id, i]),
)

function diameterRank(diameter: string): number {
  return DIAMETER_ORDER.get(diameter.trim().toUpperCase()) ?? DIAMETER_ORDER.size
}

function categoryRank(category: string): number {
  return CATEGORY_ORDER.get(category) ?? CATEGORY_ORDER.size
}

function readStoredSegments(stored: unknown): CornerBarSegment[] {
  if (!Array.isArray(stored)) return []
  return stored.map((item, i) => {
    const rec = (item ?? {}) as Partial<CornerBarSegment>
    const length = Number(rec.lengthMm)
    const measurement = rec.measurementType
    return {
      id: typeof rec.id === 'string' && rec.id ? rec.id : `s${i + 1}`,
      lengthMm: Number.isFinite(length) && length > 0 ? length : null,
      measurementType:
        measurement === 'SHIN_SHIN' ||
        measurement === 'UCHI_UCHI' ||
        measurement === 'SOTO_SOTO'
          ? measurement
          : null,
    }
  })
}

/**
 * 配置 1 件を鉄筋の配列に展開する。
 *
 * 形状定義が見つかる場合は辺数を形状に合わせて整える。見つからない場合
 * （将来形状を削除した後の古いデータなど）でも本数を落とさないよう、
 * 保存されている辺をそのまま使う。
 */
function flattenPlacementBars(
  placement: AdditionalRebarPlacementLike,
): CornerBarBarItem[] {
  const shape = getCornerBarShape(placement.shape_type)
  if (shape) return normalizeCornerBarBars(shape, placement)

  const raw = Array.isArray(placement.bars) ? placement.bars : []
  const bars = raw
    .map((item, i) => {
      if (!item || typeof item !== 'object') return null
      const rec = item as Partial<CornerBarBarItem>
      const barType = typeof rec.barType === 'string' ? rec.barType.trim() : ''
      if (!barType) return null
      const quantity = Math.floor(Number(rec.quantity))
      return {
        id: typeof rec.id === 'string' && rec.id ? rec.id : `b${i + 1}`,
        barType,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        segments: readStoredSegments(rec.segments),
      }
    })
    .filter((bar): bar is CornerBarBarItem => bar != null)

  if (bars.length > 0) return bars

  const legacyDiameter = (placement.diameter ?? '').trim()
  if (!legacyDiameter) return []
  return [
    {
      id: 'b1',
      barType: legacyDiameter,
      quantity: 1,
      segments: readStoredSegments(placement.segments),
    },
  ]
}

/**
 * 「600外々 × 455内々 × …」。数字と基準ラベルを括弧なしで直結し、辺は「 × 」で区切る。
 * 寸法基準が未設定の辺は数字のみ。
 */
function formatDimsWithMeasurement(segments: CornerBarSegment[]): string {
  const parts = segments.map((s) => {
    const len = s.lengthMm == null ? '—' : String(s.lengthMm)
    const label = s.measurementType ? measurementTypeLabel(s.measurementType) : ''
    return label ? `${len}${label}` : len
  })
  return parts.join(' × ')
}

function resolveUniformMeasurementType(
  segments: CornerBarSegment[],
): MeasurementType | null {
  if (segments.length === 0) return null
  const first = segments[0]?.measurementType ?? null
  if (first == null) return null
  return segments.every((s) => s.measurementType === first) ? first : null
}

/**
 * 辺の寸法と寸法基準を含む、鉄筋 1 種類ぶんの同一判定キー。
 *
 * 数字が同じでも寸法基準（芯々 / 内々 / 外々）が違えば別の鉄筋なので、
 * 必ず両方をキーに入れる。
 */
function specKeyOf(
  category: string,
  shapeType: string,
  barType: string,
  segments: CornerBarSegment[],
  deductions: MeasurementDeductionsMm | undefined,
  deductionTotalMm: number | undefined,
  bendAngleDeg: number | undefined,
  layer: CornerBarLayer | undefined,
  heightMm: number | undefined,
): string {
  const dims = segments
    .map((s) => `${s.lengthMm ?? ''}@${s.measurementType ?? ''}`)
    .join(',')
  // 角度が違えば形が違う鉄筋なので別の行にする（角度を変えられる形状だけ）
  const base =
    `${category}|${shapeType}|${barType}|${segments.length}|${dims}` +
    (bendAngleDeg != null ? `|angle:${bendAngleDeg}` : '') +
    // 上と下は別の鉄筋。なしのときは付けず、上下を入れる前と同じ key のまま
    (layer ? `|layer:${layer}` : '') +
    // 高さが違えば図が違うので別の行にする（未入力のときは付けない）
    (heightMm != null ? `|height:${heightMm}` : '')
  // 減りが違えば加工長も違うので別の行にする。0 のときは付けず、
  // 減りを入れる前と同じ key のまま（結果ページの手入力が外れないように）
  if (deductionTotalMm != null) {
    return deductionTotalMm > 0 ? `${base}|dedTotal:${deductionTotalMm}` : base
  }
  if (!deductions || Object.values(deductions).every((mm) => mm === 0)) return base
  const ded = `${deductions.UCHI_UCHI},${deductions.SOTO_SOTO},${deductions.SHIN_SHIN}`
  return `${base}|ded:${ded}`
}

/**
 * 加工長の計算に使う減り。特殊コーナー筋・開口補強筋は配置ごとの入力値（未入力は全て 0）、
 * それ以外はこれまでどおり外々・芯々 -20 の既定ルールを使う。
 */
function deductionsFor(
  category: string,
  bar: CornerBarBarItem,
): MeasurementDeductionsMm | undefined {
  if (!isFreeShapeCategory(category)) return undefined
  return bar.measurementDeductionsMm ?? ZERO_MEASUREMENT_DEDUCTIONS
}

/**
 * 全配置の鉄筋を展開して「筋種類 → 鉄筋径 / 寸法」で集計する。
 *
 * 結果ページ・印刷・CSV・材料取りから使い回せるよう、UI に依存しない値だけを返す。
 */
export function aggregateAdditionalRebars(
  placements: AdditionalRebarPlacementLike[],
): AdditionalRebarSummary {
  type GroupAcc = {
    category: string
    totalQuantity: number
    diameters: Map<string, number>
    specs: Map<string, AdditionalRebarSpecRow>
  }

  const groups = new Map<string, GroupAcc>()
  let totalQuantity = 0

  for (const placement of placements) {
    const category = placement.category
    const shapeType = placement.shape_type
    const adjustableAngle = getCornerBarShape(shapeType)?.adjustableAngle === true
    const hasHeight = getCornerBarShape(shapeType)?.hasHeight === true

    let group = groups.get(category)
    if (!group) {
      group = {
        category,
        totalQuantity: 0,
        diameters: new Map(),
        specs: new Map(),
      }
      groups.set(category, group)
    }

    for (const bar of flattenPlacementBars(placement)) {
      if (bar.quantity <= 0) continue
      const diameter = bar.barType.trim().toUpperCase()

      group.totalQuantity += bar.quantity
      totalQuantity += bar.quantity
      group.diameters.set(diameter, (group.diameters.get(diameter) ?? 0) + bar.quantity)

      const deductions = deductionsFor(category, bar)
      // 特殊コーナー筋・開口補強筋で全体の減りを入れた配置は、辺ごとの減りの代わりにそれを引く
      const totalDeduction = isFreeShapeCategory(category) ? bar.deductionTotalMm : undefined
      const bendAngleDeg = adjustableAngle ? clampCornerBarBendAngle(bar.bendAngleDeg) : undefined
      const heightMm = hasHeight ? normalizeCornerBarHeightMm(bar.heightMm) ?? undefined : undefined
      const key = specKeyOf(
        category,
        shapeType,
        diameter,
        bar.segments,
        deductions,
        totalDeduction,
        bendAngleDeg,
        bar.layer,
        heightMm,
      )
      const existing = group.specs.get(key)
      if (existing) {
        existing.quantity += bar.quantity
        continue
      }

      const allDimensioned =
        bar.segments.length > 0 &&
        bar.segments.every((s) => s.lengthMm != null && s.lengthMm > 0)

      group.specs.set(key, {
        key,
        category,
        categoryLabel: cornerBarCategoryLabel(category),
        shapeType,
        shapeLabel: cornerBarShapeLabel(shapeType),
        diameter,
        segments: bar.segments,
        dimsText: formatCornerBarDims(bar.segments),
        dimsDetailText: formatDimsWithMeasurement(bar.segments),
        uniformMeasurementType: resolveUniformMeasurementType(bar.segments),
        segmentSumMm: allDimensioned ? cornerBarSegmentSumMm(bar.segments) : null,
        kakouchouMm: cornerBarKakouchouMm(bar.segments, deductions, totalDeduction),
        ...(bendAngleDeg != null ? { bendAngleDeg } : {}),
        ...(heightMm != null ? { heightMm } : {}),
        ...(bar.layer ? { layer: bar.layer } : {}),
        quantity: bar.quantity,
      })
    }
  }

  const orderedGroups = [...groups.values()]
    .filter((g) => g.totalQuantity > 0)
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category))
    .map<AdditionalRebarGroup>((g) => ({
      category: g.category,
      label: cornerBarCategoryLabel(g.category),
      totalQuantity: g.totalQuantity,
      diameterTotals: [...g.diameters.entries()]
        .map(([diameter, quantity]) => ({ diameter, quantity }))
        .filter((d) => d.quantity > 0)
        .sort(
          (a, b) =>
            diameterRank(a.diameter) - diameterRank(b.diameter) ||
            a.diameter.localeCompare(b.diameter),
        ),
      specRows: [...g.specs.values()].sort(
        (a, b) =>
          diameterRank(a.diameter) - diameterRank(b.diameter) ||
          a.diameter.localeCompare(b.diameter) ||
          (b.kakouchouMm ?? -1) - (a.kakouchouMm ?? -1) ||
          a.dimsText.localeCompare(b.dimsText),
      ),
    }))

  return { totalQuantity, groups: orderedGroups }
}
