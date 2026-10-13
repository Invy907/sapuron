import type { DrawingSegment, Unit, UnitRebarSpacingItem } from '@/lib/types/database'
import {
  decodeSegmentMeta,
  getSegmentColor,
  getSegmentEffectiveLengthMm,
  resolveLinkedUnit,
} from '@/lib/segment-meta'
import { normalizeSegmentColor } from '@/lib/segment-colors'

export type UnitCountRoundingMode = 'round' | 'floor' | 'ceil'

export type UnitCalculationRow = {
  key: string
  unitId: string | null
  unitName: string
  unitCode: string | null
  pitchMm: number | null
  lengthMm: number
  baseCount: number
  barCount: number
  computedCount: number
  unitSummaryCount: number
  intervalLengthMm: number
  intervalTimesCount: number
  formulaText: string
  /** 結果表示用: ユニット形状の折れ線合計長さ（L字本数>0 の場合は 20mm 減算済） */
  unitShapeLengthMm: number
  /** 結果表示用: ユニットの L 字本数（DB の l_shape_count） */
  unitLShapeCount: number
}

function parseMm(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : null
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const match = raw.match(/@?\s*(\d+)/)
  if (!match) return null
  const mm = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(mm) ? mm : null
}

export function getUnitPitchMm(unit: Unit | null | undefined): number | null {
  if (!unit) return null
  const explicit = parseMm(unit.pitch_mm)
  if (explicit != null && explicit > 0) return explicit
  const detailPitch = parseMm(unit.detail_spec?.pitch)
  if (detailPitch != null && detailPitch > 0) return detailPitch
  return null
}

function spacingEndpoints(
  spacing: UnitRebarSpacingItem,
  unit: Unit,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const rebarById = Object.fromEntries((unit.rebar_layout?.rebars ?? []).map((rb) => [rb.id, rb]))
  const from = spacing.from ? rebarById[spacing.from] : null
  const to = spacing.to ? rebarById[spacing.to] : null
  const x1 = from?.x ?? spacing.x1
  const y1 = from?.y ?? spacing.y1
  const x2 = to?.x ?? spacing.x2
  const y2 = to?.y ?? spacing.y2
  if ([x1, y1, x2, y2].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return { x1: x1 as number, y1: y1 as number, x2: x2 as number, y2: y2 as number }
  }
  return null
}

function isDiagonalSpacing(spacing: UnitRebarSpacingItem, unit: Unit): boolean {
  const endpoints = spacingEndpoints(spacing, unit)
  if (!endpoints) return false
  const dx = Math.abs(endpoints.x2 - endpoints.x1)
  const dy = Math.abs(endpoints.y2 - endpoints.y1)
  return dx > 1 && dy > 1
}

/**
 * 結果表示用: ユニットの形状長さ合計 (mm)。
 *
 * 優先順:
 * 1. rebar_layout.shape_length_mm (保存済み計算値)
 * 2. spacings + annotations の数値ラベル合計 — is_excluded === true のみ除外
 *    (デフォルト ON: 未設定は経路長さとして合算)
 * 3. detail_geometry の実線分合計 (フォールバック)
 *
 * l_shape_count > 0 のとき最終値から 20mm を一度だけ減算 (2, 3 の場合のみ適用。
 * 1 は保存時に適用済み)。
 */
export function getUnitShapeLengthMm(unit: Unit | null | undefined): number {
  if (!unit) return 0
  const lCount = Math.max(0, Math.floor(unit.l_shape_count ?? 0))
  const applyLAdjust = (n: number) => (lCount > 0 ? n - 20 : n)

  // 1. 保存済み計算値
  const stored = unit.rebar_layout?.shape_length_mm
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored

  // 2. annotations の数値合計 (is_excluded === true のみ除外)
  // 間隔線(spacings)は視覚用のみで計算対象外
  const annotations = unit.rebar_layout?.annotations ?? []
  const numericAnnotations = annotations
    .map((a) => ({ value: parseMm(a.text), excluded: a.is_excluded === true }))
    .filter((a): a is { value: number; excluded: boolean } => a.value != null && a.value > 0)

  if (numericAnnotations.length > 0) {
    const sum = numericAnnotations
      .filter((a) => !a.excluded)
      .reduce((s, a) => s + a.value, 0)
    return applyLAdjust(sum)
  }

  // 3. フォールバック: detail_geometry の実線分合計
  const geo = unit.detail_geometry
  if (!geo || !geo.points?.length || !geo.segments?.length) return 0
  const byKey = new Map(geo.points.map((p) => [p.key, p]))
  let total = 0
  for (const seg of geo.segments) {
    const a = byKey.get(seg.from)
    const b = byKey.get(seg.to)
    if (!a || !b) continue
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return applyLAdjust(Math.round(total))
}

/**
 * 手入力で上書きされた shape_length_mm を無視した、自動計算の形状長さ (mm)。
 * 結果画面で手入力値かどうかを見分けるのに使う。
 */
export function getUnitAutoShapeLengthMm(unit: Unit | null | undefined): number {
  if (!unit) return 0
  return getUnitShapeLengthMm({
    ...unit,
    rebar_layout: unit.rebar_layout
      ? { ...unit.rebar_layout, shape_length_mm: null }
      : unit.rebar_layout,
  })
}

/**
 * ユニット保存前に rebar_layout.shape_length_mm を計算して返す。
 * annotations の数値ラベルを合算し、is_excluded === true の項目のみ除外。
 * 間隔線(spacings)は視覚用のため計算対象外。
 * l_shape_count > 0 なら合計から 20 減算。
 * 有効な数値が一件もなければ null を返す。
 */
export function computeShapeLengthMm(
  _spacings: unknown,
  annotations: { text: string; is_excluded?: boolean }[],
  lShapeCount: number,
): number | null {
  function extractMm(raw: string): number | null {
    const m = String(raw ?? '').trim().match(/@?\s*(\d+)/)
    if (!m) return null
    const v = Number.parseInt(m[1] ?? '', 10)
    return Number.isFinite(v) && v > 0 ? v : null
  }

  const values = annotations
    .filter((a) => a.is_excluded !== true)
    .map((a) => extractMm(a.text))
    .filter((v): v is number => v != null)

  if (values.length === 0) return null
  const sum = values.reduce((s, v) => s + v, 0)
  const lCount = Math.max(0, Math.floor(lShapeCount))
  return lCount > 0 ? sum - 20 : sum
}

export function getUnitIntervalLengthMm(unit: Unit | null | undefined): number {
  if (!unit?.rebar_layout?.spacings?.length) return 0
  return unit.rebar_layout.spacings.reduce((sum, spacing) => {
    const mm = parseMm(spacing.label)
    if (mm == null || mm <= 0) return sum
    const adjusted = isDiagonalSpacing(spacing, unit) ? mm : Math.max(0, mm - 30)
    return sum + adjusted
  }, 0)
}

/**
 * タテ筋本数（呼称 ÷ ピッチ、小数 0.25 未満は切り捨て・0.25 以上は +1）
 *
 * 例: 3,640 ÷ 200 = 18.20 → 18 本 / 2,275 ÷ 200 = 11.375 → 12 本
 */
export function getPitchBaseCount(nominalLengthMm: number, pitchMm: number): number {
  if (!Number.isFinite(pitchMm) || pitchMm <= 0) return 0
  if (!Number.isFinite(nominalLengthMm) || nominalLengthMm <= 0) return 0
  const quotient = nominalLengthMm / pitchMm
  const integerPart = Math.floor(quotient)
  const fractionalPart = quotient - integerPart
  return fractionalPart >= 0.25 ? integerPart + 1 : integerPart
}

function getSegmentCalculationBarCount(segment: DrawingSegment): number {
  const { meta } = decodeSegmentMeta(segment.memo)
  const memoCount = meta?.bars?.reduce((sum, item) => {
    const qty = Math.max(0, Math.floor(Number(item.quantity) || 0))
    return sum + qty
  }, 0)
  if (memoCount != null && memoCount > 0) return memoCount
  return Math.max(0, Math.floor(Number(segment.quantity) || 0))
}

/**
 * 計算用にユニットを解決する。
 * 1. 線分に unit_id が付いていればそれを使用
 * 2. 未リンクなら同色・アクティブな永続化済みユニットを使用（入力サマリと同じ挙動）
 */
function resolveUnitForCalc(segment: DrawingSegment, units: Unit[]): Unit | null {
  const linked = resolveLinkedUnit(segment, units)
  if (linked) return linked
  const color = getSegmentColor(segment, units)
  const isPersisted = (id: string) => !id.startsWith('mock-') && !id.startsWith('local-')
  return (
    units.find(
      (u) =>
        u.is_active !== false &&
        isPersisted(u.id) &&
        normalizeSegmentColor(u.color) === color,
    ) ?? null
  )
}

export function buildUnitCalculationRows(
  segments: DrawingSegment[],
  units: Unit[],
  roundingMode: UnitCountRoundingMode = 'round',
  adjustmentMm = 0,
): UnitCalculationRow[] {
  void roundingMode
  return segments
    .filter((segment) => segment.bar_type !== 'SPACING')
    .map((segment) => {
      const unit = resolveUnitForCalc(segment, units)
      const lengthMm = getSegmentEffectiveLengthMm(segment, units)
      const pitchMm = getUnitPitchMm(unit)
      const barCount = getSegmentCalculationBarCount(segment)
      const actualLengthMm = lengthMm + (adjustmentMm || 0)
      const baseCount = pitchMm && pitchMm > 0 ? getPitchBaseCount(lengthMm, pitchMm) : 0
      const computedCount = baseCount * barCount
      const unitSummaryCount = baseCount
      const intervalLengthMm = getUnitIntervalLengthMm(unit)
      const unitShapeLengthMm = getUnitShapeLengthMm(unit)
      const unitLShapeCount = Math.max(0, Math.floor(unit?.l_shape_count ?? 0))

      return {
        key: `${segment.id}:${unit?.id ?? 'unlinked'}`,
        unitId: unit?.id ?? null,
        unitName: unit?.name ?? segment.unit_name ?? segment.label ?? '未割当',
        unitCode: unit?.code ?? segment.unit_code ?? null,
        pitchMm,
        lengthMm,
        baseCount,
        barCount,
        computedCount,
        unitSummaryCount,
        intervalLengthMm,
        intervalTimesCount: intervalLengthMm * computedCount,
        formulaText:
          pitchMm && pitchMm > 0
            ? `${lengthMm}(呼称) ÷ ${pitchMm} = ${(lengthMm / pitchMm).toFixed(2)} -> ${baseCount}(0.25丸め)`
            : `${lengthMm} / ピッチ未設定`,
        unitShapeLengthMm,
        unitLShapeCount,
      }
    })
    .filter((row) => row.pitchMm != null && row.barCount > 0)
}
