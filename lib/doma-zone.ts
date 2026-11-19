// 特殊土間筋: 図面で指定した矩形の範囲（入隅など）に入れるタテ・ヨコの土間筋。
// 範囲 1 つを drawing_doma_runs の 1 行（kind = 'special'）に保存し、タテ・ヨコの土間筋は毎回ここで作る。
//   x1,y1,x2,y2 … 範囲の対角（図面座標）
//   length_mm   … タテ方向の範囲の長さ / span_mm … ヨコ方向の範囲の長さ
//   settings.zone … 壁の辺・はみ出し・手入力の加工本（DomaZoneSpec）
// 各辺は、壁なら土間筋を端部曲げで止め、壁でなければ範囲の外へ「はみ出し」（既定は重ね）だけ伸ばす。

import type { DrawingDomaDimension, DrawingDomaRun } from '@/lib/types/database'
import {
  DOMA_MIN_LAP_PROTRUSION_MM,
  countBars,
  layoutDomaRun,
  type DomaBarSettings,
  type DomaBends,
  type DomaRunLap,
  type DomaRunPiece,
  type SlabBarDirection,
} from './slab-rebar'

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
  /** 方向ごとの配筋条件。未設定の方向は従来の共通条件を使う。 */
  settingsByDirection?: Partial<Record<SlabBarDirection, DomaBarSettings>>
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

export type DomaZoneSettings = DomaBarSettings & { zone?: DomaZoneSpec }

export function domaZoneDirectionSettings(settings: DomaZoneSettings, direction: SlabBarDirection): DomaBarSettings {
  const { zone, ...base } = settings
  return { ...base, ...zone?.settingsByDirection?.[direction] }
}

export function domaZonePitchValid(settings: DomaZoneSettings, tateMm: number, yokoMm: number): boolean {
  return (['tate', 'yoko'] as const).every((direction) => {
    if (settings.zone?.directions?.[direction] === false) return true
    const pitch = domaZoneDirectionSettings(settings, direction).pitchMm
    const span = direction === 'tate' ? yokoMm : tateMm
    return Number.isSafeInteger(pitch) && pitch > 0 && Number.isSafeInteger(span) && span >= pitch
  })
}

export function domaZoneExtendMm(zone: Pick<DrawingDomaRun, 'settings'>, direction: SlabBarDirection = 'tate'): number {
  return domaZoneSpecOf(zone).extendMm ?? domaZoneDirectionSettings(zone.settings, direction).lapMm
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
  const extendMm = domaZoneExtendMm(zone, direction)
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
        settings: { ...zone.settings, ...domaZoneDirectionSettings(zone.settings, direction), includeRangeEnds: true },
        bends: v.bends,
        pieces_override: v.override,
      }
    })
}

type DimLine = Pick<DrawingDomaDimension, 'id' | 'x1' | 'y1' | 'x2' | 'y2'> & { length_mm?: number }

/** 寸法線をつないで測った長さ（入力した寸法値の合計）と、使った寸法線 */
export type DomaDimChain = { mm: number; dimIds: string[] }

/**
 * 図面座標の from から to まで、同じ向きの寸法線を端どうしつないだときの寸法値の合計（to が from より
 * 小さい側なら負）。長さは入力した寸法値だけから出し、図面の px はどの寸法線がつながるかを見るのにだけ使う。
 * from と to が同じ位置なら 0。つながらないとき、つなぎ方で合計が変わるときは null
 */
export function domaDimensionChain(
  from: number,
  to: number,
  dims: DimLine[],
  vertical: boolean,
  tol: number,
): DomaDimChain | null {
  if (Math.abs(to - from) <= tol) return { mm: 0, dimIds: [] }
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const parts = dims
    .filter((d) => d.length_mm != null && d.length_mm > 0)
    .filter((d) => Math.abs(d.y2 - d.y1) >= Math.abs(d.x2 - d.x1) === vertical)
    .map((d) => {
      const [a, b] = vertical ? [d.y1, d.y2] : [d.x1, d.x2]
      return { id: d.id, mm: d.length_mm!, p0: Math.min(a, b), p1: Math.max(a, b) }
    })
    .filter((d) => d.p1 - d.p0 > tol && d.p0 >= lo - tol && d.p1 <= hi + tol)
  let found: DomaDimChain | null = null
  let ambiguous = false
  let steps = 0
  const search = (pos: number, sum: number, ids: string[]) => {
    if (ambiguous || ++steps > 5000) return
    if (Math.abs(pos - hi) <= tol) {
      if (found && found.mm !== sum) ambiguous = true
      else if (!found) found = { mm: sum, dimIds: ids }
      return
    }
    if (ids.length >= 12) return
    for (const p of parts) {
      if (Math.abs(p.p0 - pos) <= tol && p.p1 > pos + tol) search(p.p1, sum + p.mm, [...ids, p.id])
    }
  }
  search(lo, 0, [])
  if (ambiguous || steps > 5000 || !found) return null
  const chain: DomaDimChain = found
  return { mm: to >= from ? chain.mm : -chain.mm, dimIds: chain.dimIds }
}

/**
 * 寸法線から読む、端から区域までの長さ（向きの正は端から奥へ）。次の順に、つながる寸法線があるもので決める。
 * 1. 端 → 区域の手前の辺　2. 端 → 区域の奥の辺 − 区域の大きさ　3. 全体 − 区域の大きさ − 区域の奥の辺 → 反対の端
 */
function distanceFromDims(
  startPos: number,
  endPos: number,
  nearPos: number,
  farPos: number,
  totalMm: number,
  zoneMm: number,
  dims: DimLine[],
  vertical: boolean,
  tol: number,
  refDimId: string | null,
): DomaDimChain | null {
  const sign = endPos >= startPos ? 1 : -1
  // 端の位置と全体の長さは L（配筋範囲）に使った寸法線で決まるので、区域の辺が端にそろうときや
  // 全体から引くときは、その寸法線を使ったものとして強調する
  const withRef = (ids: string[]) => (refDimId && !ids.includes(refDimId) ? [...ids, refDimId] : ids)
  const direct = domaDimensionChain(startPos, nearPos, dims, vertical, tol)
  if (direct) return { mm: direct.mm * sign, dimIds: direct.dimIds.length > 0 ? direct.dimIds : withRef([]) }
  const toFar = domaDimensionChain(startPos, farPos, dims, vertical, tol)
  if (toFar) return { mm: toFar.mm * sign - zoneMm, dimIds: toFar.dimIds.length > 0 ? toFar.dimIds : withRef([]) }
  const fromFar = domaDimensionChain(farPos, endPos, dims, vertical, tol)
  if (fromFar) return { mm: totalMm - zoneMm - fromFar.mm * sign, dimIds: withRef(fromFar.dimIds) }
  return null
}

/** 区域で切った標準筋の片側（区域の手前・先）。区域の中へははみ出しの分だけ入る（区域の辺が壁なら曲げで止める） */
export type DomaZoneCutPart = { lengthMm: number; bends: DomaBends }

export type DomaZoneDistanceSource = 'input' | 'dimension' | 'edge'

/** 標準筋 1 セットのうち、区域にかかる本 */
export type DomaZoneCut = {
  zoneId: string
  /**
   * 区域にかかる本数。標準筋を配筋範囲の端（settings.countFrom の側）からピッチごとに並べ、
   * 区域の幅の中に来る本を数える（区域の幅 ÷ ピッチ の切り上げとは 1 本ずれることがある）
   */
  count: number
  /** 区域の位置（標準筋の始点からの mm）。入力がなければ 0 */
  fromMm: number
  toMm: number
  /**
   * 区域までの長さ（L の向き・配筋範囲の向き）が両方決まっているか。手入力（zoneStarts・zoneCrossStarts）、
   * なければ寸法線の値の合計で決める。長さは図面の px からは決めないので、決まらない区域では切らない
   * （本数 0、手前・先の本なし）
   */
  complete: boolean
  /** 始点から区域まで（L の向き）。手入力、なければ寸法線から読んだ値。どちらもなければ null */
  startMm: number | null
  /** 配筋範囲の数え始めの端から区域まで。手入力、なければ寸法線から読んだ値。どちらもなければ null */
  crossMm: number | null
  /**
   * startMm・crossMm をどこから決めたか。input = 手入力、dimension = 寸法線の値（区域の辺が L・配筋範囲の
   * 寸法線の端にそろうときも含む）、edge = 寸法線のない標準筋の描いた端に区域の辺がそろっている、null = 決まらない
   */
  startSource: DomaZoneDistanceSource | null
  crossSource: DomaZoneDistanceSource | null
  /** 寸法線から読んだときに使った寸法線（図面で強調する） */
  dimIds: string[]
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

/** 標準筋を区域と比べるための図面上の位置（線の向き・始点の側・L と配筋範囲の端の位置） */
function domaRunFrame(run: DrawingDomaRun, dims: DimLine[]) {
  if (run.kind === 'special') return null
  const dx = run.x2 - run.x1
  const dy = run.y2 - run.y1
  const linePx = Math.hypot(dx, dy)
  const L = run.length_mm
  const total = countBars(run.span_mm, run.settings.pitchMm)
  if (!(linePx > 0) || !(L > 0) || total <= 0) return null
  const k = linePx / L
  const vertical = Math.abs(dy) >= Math.abs(dx)
  const sign = (vertical ? dy : dx) >= 0 ? 1 : -1
  const [lineLo, lineHi] = vertical
    ? [Math.min(run.y1, run.y2), Math.max(run.y1, run.y2)]
    : [Math.min(run.x1, run.x2), Math.max(run.x1, run.x2)]

  const spanDim = dims.find((d) => d.id === run.span_dim_id)
  const spanDimCrosses =
    spanDim != null && Math.abs(spanDim.y2 - spanDim.y1) < Math.abs(spanDim.x2 - spanDim.x1) === vertical
  const [rp0, rp1] = spanDimCrosses
    ? vertical
      ? [Math.min(spanDim.x1, spanDim.x2), Math.max(spanDim.x1, spanDim.x2)]
      : [Math.min(spanDim.y1, spanDim.y2), Math.max(spanDim.y1, spanDim.y2)]
    : (() => {
        const center = vertical ? (run.x1 + run.x2) / 2 : (run.y1 + run.y2) / 2
        const half = (run.span_mm * k) / 2
        return [center - half, center + half]
      })()
  // 寸法線から区域までの長さを読むときの L の向きの端: L に使った寸法線の両端（なければ描いた線の両端）
  const lengthDim = dims.find((d) => d.id === run.length_dim_id)
  const lengthDimAlong =
    lengthDim != null && Math.abs(lengthDim.y2 - lengthDim.y1) >= Math.abs(lengthDim.x2 - lengthDim.x1) === vertical
  const [alongLo, alongHi] = lengthDimAlong
    ? vertical
      ? [Math.min(lengthDim.y1, lengthDim.y2), Math.max(lengthDim.y1, lengthDim.y2)]
      : [Math.min(lengthDim.x1, lengthDim.x2), Math.max(lengthDim.x1, lengthDim.x2)]
    : [lineLo, lineHi]
  return {
    L,
    total,
    vertical,
    sign,
    lineLo,
    lineHi,
    rp0,
    rp1,
    spanDimCrosses,
    alongLo,
    alongHi,
    lengthDimId: lengthDimAlong ? lengthDim.id : null,
    spanDimId: spanDimCrosses ? spanDim.id : null,
  }
}

type DomaRunFrame = NonNullable<ReturnType<typeof domaRunFrame>>

/**
 * 標準筋が区域にかかるか（同じ向きの土間筋を入れる区域で、図面で重なっているか）。かかるなら区域の辺の位置。
 * どの区域にかかるかだけは図面の重なりで決める（長さは図面の px からは決めない）。
 * 区域の幅の 5% に満たない重なりは、隣の標準筋の範囲に区域の線が少し掛かっただけとみなす
 */
function domaRunZoneHit(run: DrawingDomaRun, f: DomaRunFrame, zone: DrawingDomaRun) {
  if (zone.kind !== 'special' || zone.drawing_id !== run.drawing_id || zone.page_no !== run.page_no) return null
  const spec = domaZoneSpecOf(zone)
  const direction: SlabBarDirection = f.vertical === spec.tateAlongY ? 'tate' : 'yoko'
  if (!domaZoneHasDirection(zone, direction)) return null
  const r = domaZoneRect(zone)
  const [zlo, zhi] = f.vertical ? [r.minY, r.maxY] : [r.minX, r.maxX]
  const [zp0, zp1] = f.vertical ? [r.minX, r.maxX] : [r.minY, r.maxY]
  const overlapPx = Math.min(zp1, f.rp1) - Math.max(zp0, f.rp0)
  if (overlapPx <= (zp1 - zp0) * 0.05) return null
  if (Math.min(zhi, f.lineHi) - Math.max(zlo, f.lineLo) <= (f.lineHi - f.lineLo) * 0.03) return null
  return { spec, direction, zlo, zhi, zp0, zp1 }
}

/**
 * 手入力がないときに寸法線から読む、区域までの長さ。L の向きは L の端から、配筋範囲の向きは
 * 配筋範囲に使った寸法線の数え始めの端から（その寸法線がないと端の位置が決まらないので読まない）
 */
function domaZoneDistancesFromDims(
  run: DrawingDomaRun,
  f: DomaRunFrame,
  hit: NonNullable<ReturnType<typeof domaRunZoneHit>>,
  zoneMm: number,
  zoneWidthMm: number,
  dims: DimLine[],
  skipStart: boolean,
  skipCross: boolean,
) {
  const { sign } = f
  const autoStart = skipStart
    ? null
    : distanceFromDims(
        sign > 0 ? f.alongLo : f.alongHi,
        sign > 0 ? f.alongHi : f.alongLo,
        sign > 0 ? hit.zlo : hit.zhi,
        sign > 0 ? hit.zhi : hit.zlo,
        f.L,
        zoneMm,
        dims,
        f.vertical,
        Math.max(4, (f.alongHi - f.alongLo) * 0.025),
        f.lengthDimId,
      )
  const highFirst = run.settings.countFrom === 'high'
  const autoCross =
    skipCross || !f.spanDimCrosses
      ? null
      : distanceFromDims(
          highFirst ? f.rp1 : f.rp0,
          highFirst ? f.rp0 : f.rp1,
          highFirst ? hit.zp1 : hit.zp0,
          highFirst ? hit.zp0 : hit.zp1,
          run.span_mm,
          zoneWidthMm,
          dims,
          !f.vertical,
          Math.max(4, (f.rp1 - f.rp0) * 0.025),
          f.spanDimId,
        )
  return { autoStart, autoCross }
}

/**
 * 区域にかかる標準筋の、区域までの長さを読むのに使う寸法線（区域を囲んでいる途中に図面で強調する）。
 * 手入力のある長さには寸法線を使わないので含めない
 */
export function domaZoneDistanceDimIds(zone: DrawingDomaRun, runs: DrawingDomaRun[], dims: DimLine[]): string[] {
  const ids = new Set<string>()
  for (const run of runs) {
    const f = domaRunFrame(run, dims)
    if (!f) continue
    const hit = domaRunZoneHit(run, f, zone)
    if (!hit) continue
    const values = domaZoneRunValues(zone, hit.direction)
    const { autoStart, autoCross } = domaZoneDistancesFromDims(
      run,
      f,
      hit,
      values.sizeMm,
      values.spanMm,
      dims,
      run.settings.zoneStarts?.[zone.id] != null,
      run.settings.zoneCrossStarts?.[zone.id] != null,
    )
    for (const id of [...(autoStart?.dimIds ?? []), ...(autoCross?.dimIds ?? [])]) ids.add(id)
  }
  return [...ids]
}

/**
 * 標準筋 1 セットのうち、区域にかかって区域の中へはみ出しの分だけ入るところで切る本。
 *
 * 区域までの長さ（始点から区域の辺まで・配筋範囲の端から区域の辺まで）は、標準筋に手入力
 * （settings.zoneStarts・zoneCrossStarts）があればそれを使う。なければ、端から区域の辺までをつなぐ寸法線の
 * 値の合計を使う（domaDimensionChain）。図面の px を mm に換算することはしない。
 * 区域の長さは入力値を使う。
 * 標準筋が並ぶ幅は、配筋範囲に使った寸法線があればその位置、なければ描いた線を中心に配筋範囲の幅とする。
 * 同じ向きの土間筋を入れる区域だけが対象（ヨコだけの区域ではタテの標準筋は切らない）
 */
export function domaRunZoneCuts(
  run: DrawingDomaRun,
  runs: DrawingDomaRun[],
  dims: DimLine[] = [],
): DomaZoneCut[] {
  const f = domaRunFrame(run, dims)
  if (!f) return []
  const { L, total, vertical, sign, rp0, rp1 } = f

  const cuts: DomaZoneCut[] = []
  let remaining = total
  for (const zone of runs) {
    const hit = domaRunZoneHit(run, f, zone)
    if (!hit) continue
    const { spec, direction, zp0, zp1 } = hit
    const values = domaZoneRunValues(zone, direction)
    const zoneMm = values.sizeMm
    const zoneWidthMm = values.spanMm
    // 標準筋の始点側にある区域の辺（線を引いた向きで入れ替わる）
    const [nearEdge, farEdge]: DomaZoneEdge[] = vertical ? ['top', 'bottom'] : ['left', 'right']
    const [aEdge, bEdge] = sign > 0 ? [nearEdge!, farEdge!] : [farEdge!, nearEdge!]
    const aWall = spec.walls[aEdge]
    const bWall = spec.walls[bEdge]
    const typedStart = run.settings.zoneStarts?.[zone.id]
    const typedCross = run.settings.zoneCrossStarts?.[zone.id]
    const { autoStart, autoCross } = domaZoneDistancesFromDims(
      run,
      f,
      hit,
      zoneMm,
      zoneWidthMm,
      dims,
      typedStart != null,
      typedCross != null,
    )
    const inputStart = typedStart ?? autoStart?.mm ?? null
    const inputCross = typedCross ?? autoCross?.mm ?? null
    const sourceOf = (typed: number | undefined, auto: DomaDimChain | null): DomaZoneDistanceSource | null =>
      typed != null ? 'input' : auto == null ? null : auto.dimIds.length > 0 ? 'dimension' : 'edge'
    const source = {
      startMm: inputStart,
      crossMm: inputCross,
      startSource: sourceOf(typedStart, autoStart),
      crossSource: sourceOf(typedCross, autoCross),
      dimIds: [...(autoStart?.dimIds ?? []), ...(autoCross?.dimIds ?? [])],
    }
    const crossPx: [number, number] = [Math.max(zp0, rp0), Math.min(zp1, rp1)]
    if (inputStart == null || inputCross == null) {
      cuts.push({
        zoneId: zone.id,
        count: 0,
        fromMm: 0,
        toMm: 0,
        complete: false,
        ...source,
        before: null,
        after: null,
        crossPx,
      })
      continue
    }
    const a = Math.max(0, inputStart)
    const b = Math.min(L, inputStart + zoneMm)
    if (b - a <= 0) continue

    // 配筋範囲の数え始めの端から、入力した長さの所から区域の幅（辺の長さ）の中に来る本を数える
    const crossFrom = Math.max(0, inputCross)
    const crossTo = Math.min(run.span_mm, inputCross + zoneWidthMm)
    const count = Math.min(countBarsInRange(crossFrom, crossTo, run.settings.pitchMm, total), remaining)
    if (count <= 0) continue
    remaining -= count

    const extendMm = domaZoneExtendMm(zone, direction)
    cuts.push({
      zoneId: zone.id,
      count,
      fromMm: a,
      toMm: b,
      complete: true,
      ...source,
      crossPx,
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

/**
 * 区域で切った手前・先の本の、図面に描くための並び。mm は標準筋の向きに測り、0 は
 * 手前（before）なら標準筋の始点、先（after）なら区域の側の端
 */
export type DomaZoneGapPart = {
  side: 'before' | 'after'
  lengthMm: number
  pieces: Pick<DomaRunPiece, 'index' | 'lengthMm' | 'fromMm' | 'toMm' | 'bendStart' | 'bendEnd'>[]
  laps: DomaRunLap[]
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
  /**
   * 区域の手前（座標の小さい側）・先の本の区域側の端（線の向きの座標）と、そこが壁（曲げ）か。
   * part はその本の長さと加工本の並び（図面に書く。手入力があればそれ）
   */
  low: { end: number; wall: boolean; part: DomaZoneGapPart } | null
  high: { end: number; wall: boolean; part: DomaZoneGapPart } | null
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
  run: Pick<DrawingDomaRun, 'x1' | 'y1' | 'x2' | 'y2' | 'settings' | 'length_mm' | 'span_mm' | 'bends' | 'pieces_override'>,
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
  const depthPx = (domaZoneExtendMm(zone, direction) * (hi - lo)) / sizeMm
  const [lowEdge, highEdge]: DomaZoneEdge[] = vertical ? ['top', 'bottom'] : ['left', 'right']
  const [lowPart, highPart] = startLow ? [cut.before, cut.after] : [cut.after, cut.before]
  const [lowSide, highSide] = startLow ? (['before', 'after'] as const) : (['after', 'before'] as const)
  const piecesOf = (part: DomaZoneCutPart, side: 'before' | 'after'): DomaZoneGapPart => {
    const layout = layoutDomaRun(
      part.lengthMm,
      cut.count * run.settings.pitchMm,
      part.bends,
      run.settings,
      domaZoneCutPieces(run, cut, part, side),
    )
    return {
      side,
      lengthMm: part.lengthMm,
      pieces: layout.pieces.map(({ index, lengthMm, fromMm, toMm, bendStart, bendEnd }) => ({
        index,
        lengthMm,
        fromMm,
        toMm,
        bendStart,
        bendEnd,
      })),
      laps: layout.laps,
    }
  }
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
    lapMm: domaZoneExtendMm(zone, direction),
    low: lowPart ? { end: from, wall: lowWall, part: piecesOf(lowPart, lowSide) } : null,
    high: highPart ? { end: to, wall: highWall, part: piecesOf(highPart, highSide) } : null,
    count: cut.count,
    crossPx: cut.crossPx,
    pxPerMm: (hi - lo) / sizeMm,
  }
  return vertical
    ? { vertical, minX: r.minX, maxX: r.maxX, minY: from, maxY: to, ...rest }
    : { vertical, minX: from, maxX: to, minY: r.minY, maxY: r.maxY, ...rest }
}

/**
 * 区域で切った手前・先の本の加工長さ。同じセット（標準筋）の継手の位置をそのまま使い、区域の側の 1 本だけを
 * 残りの長さにする（区域の先なら終点側の 2740 などは区域にかからない本と同じ）。
 * 1 本で収まる本、継手のない標準筋、そう分けると定尺・重ねに合わないときは null（自動で分ける）
 */
export function domaZoneCutSetPieces(
  run: Pick<DrawingDomaRun, 'length_mm' | 'span_mm' | 'bends' | 'settings' | 'pieces_override'>,
  part: DomaZoneCutPart,
  side: 'before' | 'after',
  count: number,
): number[] | null {
  // 1 本で収まる短い本は継手を作らない（そのまま 1 本）
  const single = layoutDomaRun(part.lengthMm, count * run.settings.pitchMm, part.bends, run.settings, null)
  if (single.pieces.length < 2) return null
  const layout = layoutDomaRun(run.length_mm, run.span_mm, run.bends, run.settings, run.pieces_override)
  const pieces = layout.pieces
  if (pieces.length < 2 || layout.warnings.length > 0) return null
  const { bendMm, lapMm } = run.settings
  const minStraight = lapMm + DOMA_MIN_LAP_PROTRUSION_MM
  const L = run.length_mm
  const valid = (lengths: number[]) =>
    lengths.every((mm) => mm > 0 && mm <= 6000) &&
    layoutDomaRun(part.lengthMm, count * run.settings.pitchMm, part.bends, run.settings, lengths).warnings
      .length === 0
  if (side === 'after') {
    // 標準筋の始点から測った、先の本の始まり（区域の中へ入ったところ）
    const from = L - part.lengthMm
    const zoneBend = hasStartBend(part.bends) ? bendMm : 0
    const first = pieces.findLastIndex((p) => p.fromMm < from)
    for (let j = Math.max(first, 0); j < pieces.length; j++) {
      const kept = pieces.slice(j + 1).map((p) => p.lengthMm)
      const straight = pieces[j]!.toMm - from
      if (kept.length > 0 && straight < minStraight) continue
      const endBend = j === pieces.length - 1 && hasEndBend(part.bends) ? bendMm : 0
      const lengths = [Math.round(straight + zoneBend + endBend), ...kept]
      if (valid(lengths)) return lengths
    }
    return null
  }
  // 手前の本は、標準筋の始点から区域の中へ入ったところまで
  const to = part.lengthMm
  const zoneBend = hasEndBend(part.bends) ? bendMm : 0
  const last = pieces.findIndex((p) => p.toMm > to)
  for (let j = last < 0 ? pieces.length - 1 : last; j >= 0; j--) {
    const kept = pieces.slice(0, j).map((p) => p.lengthMm)
    const straight = to - pieces[j]!.fromMm
    if (kept.length > 0 && straight < minStraight) continue
    const startBend = j === 0 && hasStartBend(part.bends) ? bendMm : 0
    const lengths = [...kept, Math.round(straight + zoneBend + startBend)]
    if (valid(lengths)) return lengths
  }
  return null
}

/** 区域で切った手前・先の本の加工長さ: 手入力があればそれ、なければ同じセットに合わせたもの（domaZoneCutSetPieces） */
export function domaZoneCutPieces(
  run: Pick<DrawingDomaRun, 'length_mm' | 'span_mm' | 'bends' | 'settings' | 'pieces_override'>,
  cut: Pick<DomaZoneCut, 'zoneId' | 'count'>,
  part: DomaZoneCutPart,
  side: 'before' | 'after',
): number[] | null {
  return run.settings.zoneCutOverrides?.[`${cut.zoneId}:${side}`] ?? domaZoneCutSetPieces(run, part, side, cut.count)
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
  const cuts = domaRunZoneCuts(run, runs, dims).filter((c) => c.complete)
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
        pieces_override: domaZoneCutPieces(run, cut, part, side),
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
