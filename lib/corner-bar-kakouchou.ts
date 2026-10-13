import type { CornerBarSegment, MeasurementType } from '@/lib/corner-bar-presets'

/**
 * 外々・芯々で測った辺 1 本あたりの減り(mm)。
 *
 * 客先の手書き資料「外々 / 芯々 D10〜D22 マイナス 20㎜、内々 —」による。
 * 曲げの数ではなく辺ごとに数える。内々・寸法基準未設定の辺は減らさない。
 * ユニット側の computeShapeLengthMm（L字 1 回のみ -20）とは別物なので混ぜない。
 */
export const SEGMENT_DEDUCTION_MM = 20

const DEDUCTED_MEASUREMENT_TYPES: ReadonlySet<MeasurementType> = new Set([
  'SOTO_SOTO',
  'SHIN_SHIN',
])

/**
 * 付加筋の加工長(mm)。辺の合計から、外々・芯々の辺 1 本につき SEGMENT_DEDUCTION_MM を引く。
 *
 * 寸法が 1 つでも未入力の場合は計算できないので null を返す（画面では「—」）。
 */
export function cornerBarKakouchouMm(segments: CornerBarSegment[]): number | null {
  if (segments.length === 0) return null

  let sum = 0
  let deductedCount = 0
  for (const seg of segments) {
    if (seg.lengthMm == null || !Number.isFinite(seg.lengthMm) || seg.lengthMm <= 0) return null
    sum += seg.lengthMm
    if (seg.measurementType && DEDUCTED_MEASUREMENT_TYPES.has(seg.measurementType)) {
      deductedCount += 1
    }
  }

  const kakouchou = sum - SEGMENT_DEDUCTION_MM * deductedCount
  return kakouchou > 0 ? kakouchou : null
}
