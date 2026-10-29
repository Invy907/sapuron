// 土間筋（スラブ筋）の配筋・加工本分割・集計エンジン。
// UI に依存しない純粋関数のみを置く。座標はすべて mm、y 軸は下向き（図面と同じ）。

export type SlabBarDirection = 'tate' | 'yoko'

export type SlabPoint = { x: number; y: number }

export type SlabCutCorner = 'tl' | 'tr' | 'bl' | 'br'

export type SlabShape =
  | { type: 'rect'; widthMm: number; heightMm: number }
  | {
      type: 'l'
      widthMm: number
      heightMm: number
      cutCorner: SlabCutCorner
      cutWidthMm: number
      cutHeightMm: number
    }

export type SlabRebarSettings = {
  diameter: string
  pitchTateMm: number
  pitchYokoMm: number
  bendMm: number
  stockMm: number
  lapMm: number
}

/** 図面に描いた土間筋 1 本（代表線）ごとの配筋条件 */
export type DomaBarSettings = {
  diameter: string
  pitchMm: number
  bendMm: number
  stockMm: number
  lapMm: number
}

/** 土間筋の径選択肢（付加筋と同じ） */
export const DOMA_BAR_DIAMETERS = ['D10', 'D13', 'D16', 'D19'] as const

/**
 * 径ごとの標準「重ね」長さ(mm)。コーナー筋 L の片辺寸法と同じ比準（D13=600）。
 * ドロップダウンは D13(600) のように表示し、径変更時に重ねへ反映する。
 */
export const DOMA_STANDARD_LAP_MM: Record<string, number> = {
  D10: 450,
  D13: 600,
  D16: 750,
  D19: 900,
  D22: 1000,
  D25: 1150,
}

export function domaDiameterOptionLabel(diameter: string, lapMm?: number): string {
  const lap = lapMm ?? DOMA_STANDARD_LAP_MM[diameter]
  return lap != null ? `${diameter}(${lap})` : diameter
}

export function domaSettingsWithDiameter(
  diameter: string,
  prev: DomaBarSettings = DEFAULT_DOMA_BAR_SETTINGS,
): DomaBarSettings {
  const lapMm = DOMA_STANDARD_LAP_MM[diameter] ?? prev.lapMm
  return { ...prev, diameter, lapMm }
}

export const DEFAULT_DOMA_BAR_SETTINGS: DomaBarSettings = {
  diameter: 'D13',
  pitchMm: 200,
  bendMm: 150,
  stockMm: 6000,
  lapMm: DOMA_STANDARD_LAP_MM.D13,
}

export const DEFAULT_SLAB_REBAR_SETTINGS: SlabRebarSettings = {
  diameter: 'D13',
  pitchTateMm: 200,
  pitchYokoMm: 200,
  bendMm: 150,
  stockMm: 6000,
  lapMm: 600,
}

export type FabricationPieceKind = 'BENT' | 'STRAIGHT'

export type FabricationPiece = {
  kind: FabricationPieceKind
  lengthMm: number
}

/** 同じ設置長さ・同じ本数で並ぶ鉄筋の帯（矩形）。 */
export type SlabBand = {
  direction: SlabBarDirection
  /** 帯の外接矩形（mm） */
  x0: number
  y0: number
  x1: number
  y1: number
  /** 鉄筋 1 本の設置長さ（鉄筋方向の寸法） */
  runLengthMm: number
  /** 配筋幅（ピッチ方向の寸法） */
  spanMm: number
}

export type SlabRunWarning = 'LAST_PIECE_SHORTER_THAN_LAP' | 'SHORT_RUN_SPLIT_EVENLY'

export type BarRun = {
  band: SlabBand
  pitchMm: number
  count: number
  pieces: FabricationPiece[]
  warnings: SlabRunWarning[]
}

export type ScheduleRow = {
  diameter: string
  kind: FabricationPieceKind
  lengthMm: number
  quantity: number
}

export type SlabRebarResult = {
  runs: BarRun[]
  schedule: ScheduleRow[]
}

const EPS = 1e-6

export function shapeOutline(shape: SlabShape): SlabPoint[] {
  const w = shape.widthMm
  const h = shape.heightMm
  if (shape.type === 'rect') {
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ]
  }
  const cw = Math.min(Math.max(shape.cutWidthMm, 0), w)
  const ch = Math.min(Math.max(shape.cutHeightMm, 0), h)
  switch (shape.cutCorner) {
    case 'tl':
      return [
        { x: cw, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
        { x: 0, y: ch },
        { x: cw, y: ch },
      ]
    case 'tr':
      return [
        { x: 0, y: 0 },
        { x: w - cw, y: 0 },
        { x: w - cw, y: ch },
        { x: w, y: ch },
        { x: w, y: h },
        { x: 0, y: h },
      ]
    case 'bl':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: cw, y: h },
        { x: cw, y: h - ch },
        { x: 0, y: h - ch },
      ]
    case 'br':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h - ch },
        { x: w - cw, y: h - ch },
        { x: w - cw, y: h },
        { x: 0, y: h },
      ]
  }
}

export function isValidShape(shape: SlabShape): boolean {
  if (!(shape.widthMm > 0 && shape.heightMm > 0)) return false
  if (shape.type === 'rect') return true
  return (
    shape.cutWidthMm > 0 &&
    shape.cutHeightMm > 0 &&
    shape.cutWidthMm < shape.widthMm &&
    shape.cutHeightMm < shape.heightMm
  )
}

/** 直交多角形と軸平行な直線 (axis = value) の交差区間を返す。 */
function intersectLine(outline: SlabPoint[], axis: 'x' | 'y', value: number): Array<[number, number]> {
  const other = axis === 'x' ? 'y' : 'x'
  const hits: number[] = []
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % outline.length]
    const lo = Math.min(a[axis], b[axis])
    const hi = Math.max(a[axis], b[axis])
    if (hi - lo < EPS) continue
    if (value > lo && value < hi) {
      const t = (value - a[axis]) / (b[axis] - a[axis])
      hits.push(a[other] + t * (b[other] - a[other]))
    }
  }
  hits.sort((p, q) => p - q)
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < hits.length; i += 2) out.push([hits[i], hits[i + 1]])
  return out
}

/**
 * 鉄筋方向ごとに、設置長さが一定の矩形帯へ分解する。
 * タテ筋は x 方向に並ぶので x で区切り、ヨコ筋は y で区切る。
 * 隣り合う区間で設置区間が同じなら 1 つの帯にまとめる。
 */
export function decomposeBands(outline: SlabPoint[], direction: SlabBarDirection): SlabBand[] {
  const sweep: 'x' | 'y' = direction === 'tate' ? 'x' : 'y'
  const coords = Array.from(new Set(outline.map((p) => p[sweep]))).sort((a, b) => a - b)
  const bands: SlabBand[] = []
  for (let i = 0; i + 1 < coords.length; i++) {
    const s0 = coords[i]
    const s1 = coords[i + 1]
    if (s1 - s0 < EPS) continue
    for (const [r0, r1] of intersectLine(outline, sweep, (s0 + s1) / 2)) {
      const prev = bands.find((b) => {
        const [bs1, br0, br1] = sweep === 'x' ? [b.x1, b.y0, b.y1] : [b.y1, b.x0, b.x1]
        return Math.abs(bs1 - s0) < EPS && Math.abs(br0 - r0) < EPS && Math.abs(br1 - r1) < EPS
      })
      if (prev) {
        if (sweep === 'x') prev.x1 = s1
        else prev.y1 = s1
        prev.spanMm += s1 - s0
        continue
      }
      bands.push(
        sweep === 'x'
          ? { direction, x0: s0, x1: s1, y0: r0, y1: r1, runLengthMm: r1 - r0, spanMm: s1 - s0 }
          : { direction, x0: r0, x1: r1, y0: s0, y1: s1, runLengthMm: r1 - r0, spanMm: s1 - s0 }
      )
    }
  }
  return bands
}

/**
 * 本数 = 配筋範囲 ÷ ピッチ の切り上げ。寸法・ピッチは整数 mm で扱う。
 * 0 以下・整数でない値は計算しない（0 本）。画面を落とさないよう例外にはしない。
 * 端の鉄筋を別に足すか（+1）は現場の規則が確認できるまで入れない（Phase3 仕様 §7.1）。
 */
export function countBars(spanMm: number, pitchMm: number): number {
  if (!Number.isSafeInteger(spanMm) || !Number.isSafeInteger(pitchMm)) return 0
  if (spanMm <= 0 || pitchMm <= 0) return 0
  return Math.ceil(spanMm / pitchMm)
}

/**
 * 設置長さ L の鉄筋を加工本に分割する。
 * 両端は曲げ（bend）、1 本の加工本に曲げは片側だけなので最低 2 本。
 *   必要総長 = L + 2·bend + lap·(n−1)、n は 必要総長 ≤ n·stock を満たす最小値（n ≥ 2）
 *   1 本目 = stock（曲）、中間 = stock（直）、最後 = 残り（曲）
 */
export function splitRun(
  runLengthMm: number,
  settings: Pick<SlabRebarSettings, 'bendMm' | 'stockMm' | 'lapMm'>
): { pieces: FabricationPiece[]; warnings: SlabRunWarning[] } {
  const { bendMm, stockMm, lapMm } = settings
  if (!(runLengthMm > 0) || !(stockMm > lapMm) || stockMm <= 0) return { pieces: [], warnings: [] }

  const required = (n: number) => runLengthMm + 2 * bendMm + lapMm * (n - 1)
  let n = 2
  while (required(n) > n * stockMm + EPS) n++
  const total = required(n)
  const warnings: SlabRunWarning[] = []

  if (total <= stockMm + EPS) {
    // 1 本目を stock で埋められないほど短い区間は、仕様未確定のため 2 本に等分する
    const first = Math.ceil(total / 2 / 10) * 10
    warnings.push('SHORT_RUN_SPLIT_EVENLY')
    const last = total - first
    if (last - bendMm < lapMm) warnings.push('LAST_PIECE_SHORTER_THAN_LAP')
    return {
      pieces: [
        { kind: 'BENT', lengthMm: first },
        { kind: 'BENT', lengthMm: last },
      ],
      warnings,
    }
  }

  const pieces: FabricationPiece[] = [{ kind: 'BENT', lengthMm: stockMm }]
  for (let i = 0; i < n - 2; i++) pieces.push({ kind: 'STRAIGHT', lengthMm: stockMm })
  const last = Math.round(total - (n - 1) * stockMm)
  pieces.push({ kind: 'BENT', lengthMm: last })
  if (last - bendMm < lapMm) warnings.push('LAST_PIECE_SHORTER_THAN_LAP')
  return { pieces, warnings }
}

export function buildRuns(
  outline: SlabPoint[],
  settings: SlabRebarSettings,
  directions: SlabBarDirection[] = ['tate', 'yoko']
): BarRun[] {
  const runs: BarRun[] = []
  for (const direction of directions) {
    const pitchMm = direction === 'tate' ? settings.pitchTateMm : settings.pitchYokoMm
    for (const band of decomposeBands(outline, direction)) {
      const { pieces, warnings } = splitRun(band.runLengthMm, settings)
      runs.push({ band, pitchMm, count: countBars(band.spanMm, pitchMm), pieces, warnings })
    }
  }
  return runs
}

/** 設置区間の両端のうち、端部曲げを付ける側 */
export type DomaBends = 'both' | 'start' | 'end' | 'none'

export const DOMA_BENDS_OPTIONS: Array<{ id: DomaBends; label: string }> = [
  { id: 'both', label: '両端' },
  { id: 'start', label: '始点' },
  { id: 'end', label: '終点' },
  { id: 'none', label: 'なし' },
]

/** 設置区間の中での加工本 1 本。from/to は直線部の位置（区間の始点 0 〜 終点 L, mm） */
export type DomaRunPiece = FabricationPiece & {
  index: number
  bendStart: boolean
  bendEnd: boolean
  fromMm: number
  toMm: number
  /** 直線部が、つながる継手ぶんの重ね（重ね × 継手の数）に足りない */
  lapShort: boolean
}

export type DomaRunLap = { fromMm: number; toMm: number; mm: number }

export type DomaRunWarning = 'LAP_TOO_SHORT' | 'MANUAL_SUM_MISMATCH' | 'VALUE_TOO_LARGE'

/** これを超える設置長さ・配筋範囲は入力ミスの可能性が高い（住宅の土間で 50 m 超） */
export const DOMA_LARGE_VALUE_MM = 50000

export type DomaRunLayout = {
  pieces: DomaRunPiece[]
  laps: DomaRunLap[]
  /** 本数（配筋範囲 ÷ ピッチ の切り上げ） */
  count: number
  /** 必要な加工長さの合計 = L + 端部曲げ × 曲げ数 + 重ね × (本数 − 1) */
  requiredTotalMm: number
  source: 'auto' | 'manual'
  warnings: DomaRunWarning[]
}

function bendCountOf(bends: DomaBends): number {
  return bends === 'both' ? 2 : bends === 'none' ? 0 : 1
}

/** 自動分割で使用する定尺。保存済みの stockMm は旧設定との互換用。 */
export const DOMA_STOCK_CANDIDATES_MM = [6000, 5500, 5000, 4500, 4000, 3000, 2750, 2250] as const
export const DOMA_MIN_PIECE_DIFFERENCE_MM = 1000

/**
 * 両端曲げは候補定尺 + 残りの 2 本を優先する。
 * 各本の直線部に重ねが入り、長さの差が 1000 mm 以上の組合せのうち最も差が小さいものを選ぶ。
 * 2 本に収まらない長い区間は、従来どおり最大定尺で 3 本以上に分ける。
 */
function autoDomaPieceLengths(
  lengthMm: number,
  bends: DomaBends,
  settings: Pick<DomaBarSettings, 'bendMm' | 'stockMm' | 'lapMm'>,
): number[] {
  const { bendMm, lapMm } = settings
  const stockMm: number = DOMA_STOCK_CANDIDATES_MM[0]
  if (!Number.isFinite(lengthMm) || !Number.isFinite(bendMm) || !Number.isFinite(lapMm) ||
      lengthMm <= 0 || bendMm < 0 || lapMm < 0 || lapMm >= stockMm) return []
  const required = (n: number) => Math.round(lengthMm + bendCountOf(bends) * bendMm + lapMm * (n - 1))
  if (bends !== 'both' && required(1) <= stockMm) return [required(1)]

  const firstBend = bends === 'both' || bends === 'start' ? bendMm : 0
  const lastBend = bends === 'both' || bends === 'end' ? bendMm : 0
  const total = required(2)
  const pairs = DOMA_STOCK_CANDIDATES_MM.map((first) => [first, total - first])
    .filter(([first, last]) =>
      first - last >= DOMA_MIN_PIECE_DIFFERENCE_MM &&
      first - firstBend >= lapMm && last - lastBend >= lapMm &&
      first > firstBend && last > lastBend && last <= stockMm)
    .sort((a, b) => (a[0] - a[1]) - (b[0] - b[1]))
  if (pairs.length) return pairs[0]!
  // 短い区間など、条件に合う継手が作れず 1 本で収まる場合は分割しない。
  if (required(1) <= stockMm) return [required(1)]

  let n = 3
  while (required(n) > n * stockMm + EPS) n++
  const lengths = Array.from({ length: n - 1 }, () => stockMm)
  lengths.push(required(n) - (n - 1) * stockMm)
  const shortfall = lapMm - (lengths[n - 1]! - lastBend)
  if (shortfall > 0) {
    lengths[n - 2]! -= shortfall
    lengths[n - 1]! += shortfall
  }
  return lengths
}

/**
 * 図面に描いた設置区間 1 つ（土間筋 1 セット）の加工本・重ね・本数。
 *
 * override（加工本の長さの手入力）があればそれを使い、合計が
 * L + 端部曲げ × 曲げ数 + 重ね × (本数 − 1) と合わなければ MANUAL_SUM_MISMATCH を出す
 * （ずれを自動で直したり隠したりしない）。
 * 始点側の曲げは 1 本目、終点側の曲げは最後の本に付く。
 */
export function layoutDomaRun(
  lengthMm: number,
  spanMm: number,
  bends: DomaBends,
  settings: DomaBarSettings,
  override?: number[] | null,
): DomaRunLayout {
  const { bendMm, lapMm } = settings
  const manual = Array.isArray(override) && override.length > 0
  const lengths = manual
    ? override.map((v) => Math.round(v))
    : autoDomaPieceLengths(lengthMm, bends, settings)
  const n = lengths.length
  const requiredTotalMm = lengthMm + bendCountOf(bends) * bendMm + lapMm * Math.max(n - 1, 0)
  const warnings: DomaRunWarning[] = []
  if (manual && lengths.reduce((sum, v) => sum + v, 0) !== requiredTotalMm) {
    warnings.push('MANUAL_SUM_MISMATCH')
  }

  const pieces: DomaRunPiece[] = []
  let from = 0
  lengths.forEach((len, i) => {
    const bendStart = i === 0 && (bends === 'both' || bends === 'start')
    const bendEnd = i === n - 1 && (bends === 'both' || bends === 'end')
    const straight = len - (bendStart ? bendMm : 0) - (bendEnd ? bendMm : 0)
    // 合計が合っていても、短い本は継手の重ねを取れない（中間の本は両側に重ねが要る）
    const joints = (i > 0 ? 1 : 0) + (i < n - 1 ? 1 : 0)
    pieces.push({
      index: i,
      kind: bendStart || bendEnd ? 'BENT' : 'STRAIGHT',
      lengthMm: len,
      bendStart,
      bendEnd,
      fromMm: from,
      toMm: from + straight,
      lapShort: straight < lapMm * joints,
    })
    from = from + straight - lapMm
  })
  if (pieces.some((p) => p.lapShort)) warnings.push('LAP_TOO_SHORT')
  if (lengthMm > DOMA_LARGE_VALUE_MM || spanMm > DOMA_LARGE_VALUE_MM) warnings.push('VALUE_TOO_LARGE')
  const laps: DomaRunLap[] = pieces.slice(1).map((p, i) => ({
    fromMm: p.fromMm,
    toMm: pieces[i]!.toMm,
    mm: pieces[i]!.toMm - p.fromMm,
  }))

  return {
    pieces,
    laps,
    count: countBars(spanMm, settings.pitchMm),
    requiredTotalMm,
    source: manual ? 'manual' : 'auto',
    warnings,
  }
}

/** 1本の変更量を他の本へ移し、加工総長・重ね・最大定尺を維持する。 */
export function rebalanceDomaPieces(
  layout: DomaRunLayout, index: number, lengthMm: number, bendMm: number, lapMm: number,
): number[] | null {
  if (!Number.isSafeInteger(lengthMm) || !layout.pieces[index]) return null
  const lengths = layout.pieces.map((p) => p.lengthMm)
  const minimum = layout.pieces.map((p, i) =>
    bendMm * (Number(p.bendStart) + Number(p.bendEnd)) +
    Math.max(1, lapMm * (Number(i > 0) + Number(i < lengths.length - 1))))
  if (lengthMm < minimum[index] || lengthMm > 6000) return null
  lengths[index] = lengthMm
  let delta = layout.requiredTotalMm - lengths.reduce((a, b) => a + b, 0)
  for (let i = lengths.length - 1; i >= 0; i--) {
    if (i === index) continue
    const move = Math.max(minimum[i] - lengths[i], Math.min(6000 - lengths[i], delta))
    lengths[i] += move
    delta -= move
  }
  if (delta !== 0 || (lengths.length === 2 && Math.abs(lengths[0] - lengths[1]) < 1000)) return null
  return lengths
}

export function aggregateSchedule(
  items: Array<{ diameter: string; runs: Array<Pick<BarRun, 'count' | 'pieces'>> }>
): ScheduleRow[] {
  const map = new Map<string, ScheduleRow>()
  for (const { diameter, runs } of items) {
    for (const run of runs) {
      for (const piece of run.pieces) {
        const key = `${diameter}|${piece.kind}|${piece.lengthMm}`
        const row = map.get(key)
        if (row) row.quantity += run.count
        else map.set(key, { diameter, kind: piece.kind, lengthMm: piece.lengthMm, quantity: run.count })
      }
    }
  }
  return Array.from(map.values())
    .filter((r) => r.quantity > 0)
    .sort(
      (a, b) =>
        a.diameter.localeCompare(b.diameter) ||
        b.lengthMm - a.lengthMm ||
        (a.kind === b.kind ? 0 : a.kind === 'BENT' ? -1 : 1)
    )
}

export function buildSchedule(shape: SlabShape, settings: SlabRebarSettings): SlabRebarResult {
  const runs = buildRuns(shapeOutline(shape), settings)
  return { runs, schedule: aggregateSchedule([{ diameter: settings.diameter, runs }]) }
}
