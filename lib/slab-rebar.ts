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
export const DOMA_BAR_DIAMETERS = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25'] as const

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

export const DEFAULT_DOMA_BAR_SETTINGS: DomaBarSettings = domaSettingsWithDiameter('D13')

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

export function countBars(spanMm: number, pitchMm: number): number {
  if (!(spanMm > 0) || !(pitchMm > 0)) return 0
  return Math.ceil(spanMm / pitchMm - EPS)
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

/** 描いた土間筋 1 本（代表線）の本数と加工本 */
export function computeDomaBar(
  runLengthMm: number,
  spanMm: number,
  settings: DomaBarSettings
): { count: number; pieces: FabricationPiece[]; warnings: SlabRunWarning[] } {
  return { count: countBars(spanMm, settings.pitchMm), ...splitRun(runLengthMm, settings) }
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
