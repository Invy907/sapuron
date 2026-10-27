export const DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM = -30

export function pieceAdjustmentStorageKey(projectId: string) {
  return `optimize-piece-adjustment:${projectId}`
}

/** 製作図リストのタテ筋手入力（行 key → 本数） */
export function tateCountOverrideStorageKey(projectId: string) {
  return `optimize-tate-count-overrides:${projectId}`
}

/** 付加筋集計の加工長手入力（集計行 key → mm） */
export function kakouchouOverrideStorageKey(projectId: string) {
  return `optimize-kakouchou-overrides:${projectId}`
}

/** 付加筋集計の筋種類名の手入力（集計行 key → 表示名） */
export function cornerBarLabelOverrideStorageKey(projectId: string) {
  return `optimize-corner-bar-label-overrides:${projectId}`
}

/** 付加筋集計の本数手入力（集計行 key → 本数） */
export function cornerBarQuantityOverrideStorageKey(projectId: string) {
  return `optimize-corner-bar-quantity-overrides:${projectId}`
}

/** 印刷 2 ページ目のカードを 1 ページ目へ移した位置（カード → 表の左上からの px） */
export function printCardPlacementStorageKey(projectId: string) {
  return `optimize-print-card-placements:${projectId}`
}

export function parsePieceLengthAdjustment(
  value: string | undefined | null,
): number {
  if (value == null || value === '') return DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : DEFAULT_PIECE_LENGTH_ADJUSTMENT_MM
}
