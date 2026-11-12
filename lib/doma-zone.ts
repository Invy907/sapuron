// 特殊土間筋: 図面で指定した矩形の範囲（入隅など）に入れるタテ・ヨコの土間筋。
// 範囲 1 つを drawing_doma_runs の 1 行（kind = 'special'）に保存し、タテ・ヨコの土間筋は毎回ここで作る。
//   x1,y1,x2,y2 … 範囲の対角（図面座標）
//   length_mm   … タテ方向の範囲の長さ / span_mm … ヨコ方向の範囲の長さ
//   settings.zone … 壁の辺・はみ出し・手入力の加工本（DomaZoneSpec）
// 各辺は、壁なら土間筋を端部曲げで止め、壁でなければ範囲の外へ「はみ出し」（既定は重ね）だけ伸ばす。

import type { DrawingDomaDimension, DrawingDomaRun } from '@/lib/types/database'
import { countBars, type DomaBends, type SlabBarDirection } from './slab-rebar'

/** 範囲の辺（図面座標。top は y が小さい側、left は x が小さい側） */
export type DomaZoneEdge = 'top' | 'bottom' | 'left' | 'right'

export const DOMA_ZONE_EDGES: DomaZoneEdge[] = ['top', 'bottom', 'left', 'right']

export type DomaZoneSpec = {
  /** タテ筋が図面座標の y の向きに伸びるか（描いたときの表示回転で決まる） */
  tateAlongY: boolean
  /** 壁（土間筋を端部曲げで止める）辺 */
  walls: Record<DomaZoneEdge, boolean>
  /** 壁でない辺から範囲の外へ伸ばす長さ。未設定なら重ね */
  extendMm?: number
  /** 入れる向き。未設定なら両方 */
  directions?: Partial<Record<SlabBarDirection, boolean>>
  /** 向きごとの加工本の長さの手入力。null・未設定なら自動 */
  overrides?: Partial<Record<SlabBarDirection, number[] | null>>
}

export const DEFAULT_DOMA_ZONE_WALLS: Record<DomaZoneEdge, boolean> = {
  top: false,
  bottom: false,
  left: false,
  right: false,
}

/** 特殊土間筋の既定ピッチ（範囲の中は標準より細かく入れる） */
export const DEFAULT_DOMA_ZONE_PITCH_MM = 150

export const DOMA_ZONE_COLOR = '#16a34a'

export function domaZoneSpecOf(zone: Pick<DrawingDomaRun, 'settings'>): DomaZoneSpec {
  return zone.settings.zone ?? { tateAlongY: true, walls: DEFAULT_DOMA_ZONE_WALLS }
}

export function domaZoneExtendMm(zone: Pick<DrawingDomaRun, 'settings'>): number {
  return domaZoneSpecOf(zone).extendMm ?? zone.settings.lapMm
}

export function domaZoneHasDirection(zone: Pick<DrawingDomaRun, 'settings'>, direction: SlabBarDirection) {
  return domaZoneSpecOf(zone).directions?.[direction] !== false
}

/** 範囲の外接矩形（図面座標） */
export function domaZoneRect(zone: Pick<DrawingDomaRun, 'x1' | 'y1' | 'x2' | 'y2'>) {
  return {
    minX: Math.min(zone.x1, zone.x2),
    maxX: Math.max(zone.x1, zone.x2),
    minY: Math.min(zone.y1, zone.y2),
    maxY: Math.max(zone.y1, zone.y2),
  }
}

/** その向きの土間筋の始点側・終点側の辺 */
export function domaZoneEndEdges(
  spec: Pick<DomaZoneSpec, 'tateAlongY'>,
  direction: SlabBarDirection,
): [DomaZoneEdge, DomaZoneEdge] {
  const alongY = direction === 'tate' ? spec.tateAlongY : !spec.tateAlongY
  return alongY ? ['top', 'bottom'] : ['left', 'right']
}

function bendsOf(startWall: boolean, endWall: boolean): DomaBends {
  if (startWall && endWall) return 'both'
  if (startWall) return 'start'
  if (endWall) return 'end'
  return 'none'
}

/** 範囲 1 つから作る、向きごとの土間筋の長さ L・配筋範囲・端部曲げ */
export function domaZoneRunValues(
  zone: Pick<DrawingDomaRun, 'length_mm' | 'span_mm' | 'settings'>,
  direction: SlabBarDirection,
) {
  const spec = domaZoneSpecOf(zone)
  const [startEdge, endEdge] = domaZoneEndEdges(spec, direction)
  const startWall = spec.walls[startEdge]
  const endWall = spec.walls[endEdge]
  const extendMm = domaZoneExtendMm(zone)
  const sizeMm = direction === 'tate' ? zone.length_mm : zone.span_mm
  return {
    sizeMm,
    lengthMm: sizeMm + (startWall ? 0 : extendMm) + (endWall ? 0 : extendMm),
    spanMm: direction === 'tate' ? zone.span_mm : zone.length_mm,
    bends: bendsOf(startWall, endWall),
    startExtendMm: startWall ? 0 : extendMm,
    endExtendMm: endWall ? 0 : extendMm,
    override: spec.overrides?.[direction] ?? null,
  }
}

/**
 * 範囲 1 つを、向きごとの土間筋（標準と同じ形の行）にする。集計・印刷・図面の線で標準と同じ計算を使うため。
 * 線（x1..y2）は範囲の中央を通る代表線で、はみ出しの分だけ範囲の外へ伸ばす。id は「範囲の id:向き」
 */
export function domaZoneRuns(zone: DrawingDomaRun): DrawingDomaRun[] {
  const spec = domaZoneSpecOf(zone)
  const rect = domaZoneRect(zone)
  return (['tate', 'yoko'] as const)
    .filter((direction) => domaZoneHasDirection(zone, direction))
    .map((direction) => {
      const v = domaZoneRunValues(zone, direction)
      const alongY = direction === 'tate' ? spec.tateAlongY : !spec.tateAlongY
      const [lo, hi] = alongY ? [rect.minY, rect.maxY] : [rect.minX, rect.maxX]
      const k = v.sizeMm > 0 ? (hi - lo) / v.sizeMm : 0
      const start = lo - v.startExtendMm * k
      const end = hi + v.endExtendMm * k
      const mid = alongY ? (rect.minX + rect.maxX) / 2 : (rect.minY + rect.maxY) / 2
      const line = alongY
        ? { x1: mid, y1: start, x2: mid, y2: end }
        : { x1: start, y1: mid, x2: end, y2: mid }
      return {
        ...zone,
        id: `${zone.id}:${direction}`,
        direction,
        ...line,
        length_mm: v.lengthMm,
        span_mm: v.spanMm,
        bends: v.bends,
        pieces_override: v.override,
      }
    })
}

type DimLine = Pick<DrawingDomaDimension, 'id' | 'x1' | 'y1' | 'x2' | 'y2'>

/** 区域で切った標準筋の片側（区域の手前・先）。区域の中へははみ出しの分だけ入る（区域の辺が壁なら曲げで止める） */
export type DomaZoneCutPart = { lengthMm: number; bends: DomaBends }

/** 標準筋 1 セットのうち、区域にかかる本 */
export type DomaZoneCut = {
  zoneId: string
  /**
   * 区域にかかる本数。標準筋を配筋範囲の端（settings.countFrom の側）からピッチごとに並べ、
   * 区域の幅の中に来る本を数える（区域の幅 ÷ ピッチ の切り上げとは 1 本ずれることがある）
   */
  count: number
  /** 区域の位置（標準筋の始点からの mm） */
  fromMm: number
  toMm: number
  /** 区域の位置を手入力したか（input）、図面から測ったか（drawing） */
  positionSource: 'input' | 'drawing'
  /** 区域の手前（始点側）・先（終点側）の本。区域が端にかかっていてないときは null */
  before: DomaZoneCutPart | null
  after: DomaZoneCutPart | null
  /** 区域にかかる本の並ぶ範囲（図面 px。線と直交する向きの座標） */
  crossPx: [number, number]
}

function hasStartBend(bends: DomaBends) {
  return bends === 'both' || bends === 'start'
}

function hasEndBend(bends: DomaBends) {
  return bends === 'both' || bends === 'end'
}

/**
 * 標準筋 1 セットのうち、区域にかかって区域の中へはみ出しの分だけ入るところで切る本。
 *
 * 区域の位置（始点から区域の辺まで）は、標準筋に手入力（settings.zoneStarts）があればそれを使う。
 * なければ図面の線（L の長さで描いた線）の縮尺で測り、標準筋の端にかかっているとき（3% 以内）は端にそろえる。
 * 区域の長さは入力値を使う。
 * 標準筋が並ぶ幅は、配筋範囲に使った寸法線があればその位置、なければ描いた線を中心に配筋範囲の幅とする。
 * 同じ向きの土間筋を入れる区域だけが対象（ヨコだけの区域ではタテの標準筋は切らない）
 */
export function domaRunZoneCuts(
  run: DrawingDomaRun,
  runs: DrawingDomaRun[],
  dims: DimLine[] = [],
): DomaZoneCut[] {
  if (run.kind === 'special') return []
  const dx = run.x2 - run.x1
  const dy = run.y2 - run.y1
  const linePx = Math.hypot(dx, dy)
  const L = run.length_mm
  const total = countBars(run.span_mm, run.settings.pitchMm)
  if (!(linePx > 0) || !(L > 0) || total <= 0) return []
  const k = linePx / L
  const vertical = Math.abs(dy) >= Math.abs(dx)
  const sign = (vertical ? dy : dx) >= 0 ? 1 : -1
  const start = vertical ? run.y1 : run.x1
  const toMm = (p: number) => ((p - start) * sign) / k

  const spanDim = dims.find((d) => d.id === run.span_dim_id)
  const spanDimCrosses = spanDim && Math.abs(spanDim.y2 - spanDim.y1) < Math.abs(spanDim.x2 - spanDim.x1) === vertical
  const [rp0, rp1] = spanDimCrosses
    ? vertical
      ? [Math.min(spanDim.x1, spanDim.x2), Math.max(spanDim.x1, spanDim.x2)]
      : [Math.min(spanDim.y1, spanDim.y2), Math.max(spanDim.y1, spanDim.y2)]
    : (() => {
        const center = vertical ? (run.x1 + run.x2) / 2 : (run.y1 + run.y2) / 2
        const half = (run.span_mm * k) / 2
        return [center - half, center + half]
      })()

  // 標準筋が並ぶ向きの縮尺（配筋範囲の px ÷ mm）。寸法線があればその長さ、なければ線の縮尺と同じ
  const crossK = rp1 > rp0 && run.span_mm > 0 ? (rp1 - rp0) / run.span_mm : k
  const countFromHigh = run.settings.countFrom === 'high'

  const cuts: DomaZoneCut[] = []
  let remaining = total
  for (const zone of runs) {
    if (zone.kind !== 'special' || zone.drawing_id !== run.drawing_id || zone.page_no !== run.page_no) continue
    const spec = domaZoneSpecOf(zone)
    const direction: SlabBarDirection = vertical === spec.tateAlongY ? 'tate' : 'yoko'
    if (!domaZoneHasDirection(zone, direction)) continue
    const r = domaZoneRect(zone)
    const [zlo, zhi] = vertical ? [r.minY, r.maxY] : [r.minX, r.maxX]
    const [zp0, zp1] = vertical ? [r.minX, r.maxX] : [r.minY, r.maxY]
    // 1 ピッチに満たない重なりは、隣の標準筋の範囲に区域の線が少し掛かっただけとみなす
    const overlapPx = Math.min(zp1, rp1) - Math.max(zp0, rp0)
    if (overlapPx / k < run.settings.pitchMm) continue
    const values = domaZoneRunValues(zone, direction)
    const zoneMm = values.sizeMm
    const zoneWidthMm = values.spanMm
    const inputStart = run.settings.zoneStarts?.[zone.id]
    let a: number
    let b: number
    if (inputStart != null) {
      a = inputStart
      b = a + zoneMm
    } else {
      a = Math.min(toMm(zlo), toMm(zhi))
      b = Math.max(toMm(zlo), toMm(zhi))
      const snapMm = L * 0.03
      if (Math.min(b, L) - Math.max(a, 0) <= snapMm) continue
      if (Math.abs(a) <= snapMm) [a, b] = [0, zoneMm]
      else if (Math.abs(b - L) <= snapMm) [a, b] = [L - zoneMm, L]
      else {
        a = Math.round(a / 10) * 10
        b = a + zoneMm
      }
    }
    a = Math.max(0, a)
    b = Math.min(L, b)
    if (b - a <= 0) continue

    // 区域の幅が標準筋の並ぶ幅に収まっていれば入力値、はみ出していれば重なる部分を図面から測る
    const inside = zp0 >= rp0 - 1e-6 && zp1 <= rp1 + 1e-6
    const widthMm = inside ? zoneWidthMm : Math.round(overlapPx / crossK / 10) * 10
    // 数え始めの端から区域までの距離。端に近い（配筋範囲の 3% 以内）ときは端にそろえる
    let zoneFromMm = countFromHigh
      ? (rp1 - Math.min(zp1, rp1)) / crossK
      : (Math.max(zp0, rp0) - rp0) / crossK
    const spanSnapMm = run.span_mm * 0.03
    if (zoneFromMm <= spanSnapMm) zoneFromMm = 0
    else if (Math.abs(zoneFromMm + widthMm - run.span_mm) <= spanSnapMm) zoneFromMm = run.span_mm - widthMm
    else zoneFromMm = Math.round(zoneFromMm / 10) * 10
    const count = Math.min(
      countBarsInRange(zoneFromMm, zoneFromMm + widthMm, run.settings.pitchMm, total),
      remaining,
    )
    if (count <= 0) continue
    remaining -= count

    // 標準筋の始点側にある区域の辺（線を引いた向きで入れ替わる）
    const [nearEdge, farEdge]: DomaZoneEdge[] = vertical ? ['top', 'bottom'] : ['left', 'right']
    const [aEdge, bEdge] = sign > 0 ? [nearEdge!, farEdge!] : [farEdge!, nearEdge!]
    const extendMm = domaZoneExtendMm(zone)
    const aWall = spec.walls[aEdge]
    const bWall = spec.walls[bEdge]
    cuts.push({
      zoneId: zone.id,
      count,
      fromMm: a,
      toMm: b,
      positionSource: inputStart != null ? 'input' : 'drawing',
      crossPx: [Math.max(zp0, rp0), Math.min(zp1, rp1)],
      before:
        a > 0
          ? { lengthMm: a + (aWall ? 0 : extendMm), bends: bendsOf(hasStartBend(run.bends), aWall) }
          : null,
      after:
        b < L
          ? { lengthMm: L - b + (bWall ? 0 : extendMm), bends: bendsOf(bWall, hasEndBend(run.bends)) }
          : null,
    })
  }
  return cuts
}

/**
 * 端から 0, pitch, 2·pitch… と並べた total 本のうち、[fromMm, toMm) に来る本数。
 * 例: 9,555 を 200 で 48 本、区域 2,275〜5,915 → 2,400〜5,800 の 18 本
 */
export function countBarsInRange(fromMm: number, toMm: number, pitchMm: number, total: number): number {
  if (!(pitchMm > 0) || !(toMm > fromMm) || total <= 0) return 0
  const first = Math.max(0, Math.ceil(fromMm / pitchMm - 1e-9))
  const end = Math.min(total, Math.ceil(toMm / pitchMm - 1e-9))
  return Math.max(0, end - first)
}

/** 標準筋の線を区域の中で消す範囲（図面 px）。entries は区域の辺と、そこから重ね分入った位置（線の向きの座標） */
export type DomaZoneGap = {
  vertical: boolean
  minX: number
  maxX: number
  minY: number
  maxY: number
  entries: { edge: number; inner: number }[]
  lapMm: number
  /** 区域の手前（座標の小さい側）・先の本の区域側の端（線の向きの座標）と、そこが壁（曲げ）か */
  low: { end: number; wall: boolean } | null
  high: { end: number; wall: boolean } | null
  count: number
  crossPx: [number, number]
  /** 区域を描いた縮尺（線の向きの px / mm） */
  pxPerMm: number
}

/**
 * 区域で切った標準筋の線を、区域の辺から重ね（はみ出しと同じ長さ）入ったところまで残し、
 * その先の区域の中を消す範囲。重ねの長さは区域を描いた縮尺（区域の px ÷ 辺の長さ）で測る。
 * 区域の手前・先に標準筋がなければ（区域が L の端にかかる）その側は区域の外まで消す
 */
export function domaZoneCutGap(
  run: Pick<DrawingDomaRun, 'x1' | 'y1' | 'x2' | 'y2'>,
  zone: DrawingDomaRun,
  cut: DomaZoneCut,
): DomaZoneGap | null {
  const dx = run.x2 - run.x1
  const dy = run.y2 - run.y1
  const vertical = Math.abs(dy) >= Math.abs(dx)
  const startLow = (vertical ? dy : dx) >= 0
  const spec = domaZoneSpecOf(zone)
  const direction: SlabBarDirection = vertical === spec.tateAlongY ? 'tate' : 'yoko'
  const r = domaZoneRect(zone)
  const [lo, hi] = vertical ? [r.minY, r.maxY] : [r.minX, r.maxX]
  const sizeMm = domaZoneRunValues(zone, direction).sizeMm
  if (!(sizeMm > 0) || !(hi > lo)) return null
  const depthPx = (domaZoneExtendMm(zone) * (hi - lo)) / sizeMm
  const [lowEdge, highEdge]: DomaZoneEdge[] = vertical ? ['top', 'bottom'] : ['left', 'right']
  const [lowPart, highPart] = startLow ? [cut.before, cut.after] : [cut.after, cut.before]
  const far = 1e7
  const entries: DomaZoneGap['entries'] = []
  let from = -far
  let to = far
  const lowWall = spec.walls[lowEdge!]
  const highWall = spec.walls[highEdge!]
  if (lowPart) {
    from = lo + (lowWall ? 0 : depthPx)
    if (from > lo) entries.push({ edge: lo, inner: from })
  }
  if (highPart) {
    to = hi - (highWall ? 0 : depthPx)
    if (to < hi) entries.push({ edge: hi, inner: to })
  }
  if (!(to > from)) return null
  const rest = {
    entries,
    lapMm: domaZoneExtendMm(zone),
    low: lowPart ? { end: from, wall: lowWall } : null,
    high: highPart ? { end: to, wall: highWall } : null,
    count: cut.count,
    crossPx: cut.crossPx,
    pxPerMm: (hi - lo) / sizeMm,
  }
  return vertical
    ? { vertical, minX: r.minX, maxX: r.maxX, minY: from, maxY: to, ...rest }
    : { vertical, minX: from, maxX: to, minY: r.minY, maxY: r.maxY, ...rest }
}

/**
 * 区域で切った標準筋 1 セットを、区域にかからない本（元の L）と、区域の手前・先の本に分ける。
 * 本数は配筋範囲 ÷ ピッチ で数えるので、分けた行は 本数 × ピッチ を配筋範囲にする（集計・印刷用の行）
 */
export function splitDomaRunByZones(
  run: DrawingDomaRun,
  runs: DrawingDomaRun[],
  dims: DimLine[] = [],
): DrawingDomaRun[] {
  const cuts = domaRunZoneCuts(run, runs, dims)
  if (cuts.length === 0) return [run]
  const pitch = run.settings.pitchMm
  const rest = countBars(run.span_mm, pitch) - cuts.reduce((sum, c) => sum + c.count, 0)
  const out: DrawingDomaRun[] = rest > 0 ? [{ ...run, span_mm: rest * pitch }] : []
  for (const cut of cuts) {
    for (const [side, part] of [
      ['before', cut.before],
      ['after', cut.after],
    ] as const) {
      if (!part) continue
      out.push({
        ...run,
        id: `${run.id}:${cut.zoneId}:${side}`,
        length_mm: part.lengthMm,
        span_mm: cut.count * pitch,
        bends: part.bends,
        pieces_override: run.settings.zoneCutOverrides?.[`${cut.zoneId}:${side}`] ?? null,
      })
    }
  }
  return out
}

/**
 * 集計・印刷用の行: 標準の土間筋は区域で切ったところを分け、特殊の区域はタテ・ヨコの土間筋に展開する。
 * 区域の位置を測るのに、配筋範囲に使った寸法線を使う
 */
export function expandDomaRuns(runs: DrawingDomaRun[], dims: DimLine[] = []): DrawingDomaRun[] {
  return runs.flatMap((run) => (run.kind === 'special' ? domaZoneRuns(run) : splitDomaRunByZones(run, runs, dims)))
}

/** 範囲の辺が、表示回転（時計回り 90° 単位）後の画面でどちら側か */
export function domaZoneScreenSide(edge: DomaZoneEdge, viewRotationSteps: number): DomaZoneEdge {
  const order: DomaZoneEdge[] = ['top', 'right', 'bottom', 'left']
  const steps = ((Math.round(viewRotationSteps) % 4) + 4) % 4
  return order[(order.indexOf(edge) + steps) % 4]!
}

/** 画面で見た辺から、図面座標の辺へ */
export function domaZoneEdgeAtScreenSide(side: DomaZoneEdge, viewRotationSteps: number): DomaZoneEdge {
  return DOMA_ZONE_EDGES.find((edge) => domaZoneScreenSide(edge, viewRotationSteps) === side)!
}

export const DOMA_ZONE_SIDE_LABEL: Record<DomaZoneEdge, string> = {
  top: '上',
  bottom: '下',
  left: '左',
  right: '右',
}

/** 範囲の辺の線（図面座標） */
export function domaZoneEdgeLine(zone: Pick<DrawingDomaRun, 'x1' | 'y1' | 'x2' | 'y2'>, edge: DomaZoneEdge) {
  const r = domaZoneRect(zone)
  switch (edge) {
    case 'top':
      return { x1: r.minX, y1: r.minY, x2: r.maxX, y2: r.minY }
    case 'bottom':
      return { x1: r.minX, y1: r.maxY, x2: r.maxX, y2: r.maxY }
    case 'left':
      return { x1: r.minX, y1: r.minY, x2: r.minX, y2: r.maxY }
    case 'right':
      return { x1: r.maxX, y1: r.minY, x2: r.maxX, y2: r.maxY }
  }
}
