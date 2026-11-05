// 土間筋タブのキャンバス描画: 各辺の寸法線と、タテ／ヨコの土間筋（設置区間 1 つ = 1 セット）。
// 座標は図面座標（drawing_segments と同じ）。線幅・文字は viewScale で割って画面上の大きさを一定にする。

import {
  countBars,
  layoutDomaRun,
  type DomaBarSettings,
  type DomaBends,
  type DomaRunLayout,
  type SlabBarDirection,
} from './slab-rebar'
import type { DrawingDomaRun } from './types/database'
import {
  DOMA_ZONE_COLOR,
  DOMA_ZONE_EDGES,
  domaZoneEdgeLine,
  domaZoneExtendMm,
  domaZoneRect,
  domaZoneRuns,
  domaZoneSpecOf,
  type DomaZoneEdge,
  type DomaZoneGap,
} from './doma-zone'

type Pt = { x: number; y: number }

export type DomaLine = { x1: number; y1: number; x2: number; y2: number }

export const DOMA_DIRECTION_COLORS: Record<SlabBarDirection, string> = {
  tate: '#dc2626',
  yoko: '#2563eb',
}

const DIMENSION_COLOR = '#0f172a'

function frame(line: DomaLine) {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const len = Math.hypot(dx, dy)
  const u = len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 }
  // 画面上で「上／左」側を向く法線（ラベルを置く側）
  let n = { x: u.y, y: -u.x }
  if (n.y > 0 || (n.y === 0 && n.x > 0)) n = { x: -n.x, y: -n.y }
  const at = (t: number, off: number): Pt => ({
    x: line.x1 + u.x * t + n.x * off,
    y: line.y1 + u.y * t + n.y * off,
  })
  // 文字は [-90°, 90°) に収める。縦線は線を引いた向きに関係なく下から上へ読む向き（-90°）
  let angle = Math.atan2(u.y, u.x)
  if (angle >= Math.PI / 2 - 1e-9) angle -= Math.PI
  if (angle < -Math.PI / 2 - 1e-9) angle += Math.PI
  return { len, u, n, at, angle }
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  p: Pt,
  opts: { fontPx: number; color: string; angle: number; bold?: boolean },
) {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(opts.angle)
  ctx.font = `${opts.bold ? '700' : '600'} ${opts.fontPx}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = opts.fontPx * 0.35
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.strokeText(text, 0, 0)
  ctx.fillStyle = opts.color
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

function strokeHighlight(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, s: number) {
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)'
  ctx.lineWidth = 12 / s
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.restore()
}

/** 寸法線: 本線 + 両端の 90° の短い線 + 寸法値 */
export function paintDomaDimension(
  ctx: CanvasRenderingContext2D,
  dim: DomaLine & { length_mm: number | null },
  opts: {
    viewScale: number
    selected?: boolean
    preview?: boolean
    viewRotationSteps?: number
    /** 寸法値が重なったら反対側へ逃がすための、他の線（土間筋・他の寸法線） */
    obstacles?: DomaLine[]
    /** 図面に置いた文字の枠（drawUprightLabel の placed）。図面全体で共有する */
    labelBoxes?: DomaLine[]
  },
) {
  const s = opts.viewScale
  const f = frame(dim)
  if (f.len <= 0) return
  const a = f.at(0, 0)
  const b = f.at(f.len, 0)
  if (opts.selected) strokeHighlight(ctx, a, b, s)

  const tick = 7 / s
  ctx.save()
  ctx.strokeStyle = DIMENSION_COLOR
  ctx.lineWidth = 1.5 / s
  ctx.lineCap = 'butt'
  if (opts.preview) ctx.setLineDash([6 / s, 4 / s])
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  for (const t of [0, f.len]) {
    const p0 = f.at(t, -tick)
    const p1 = f.at(t, tick)
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
  }
  ctx.stroke()
  ctx.restore()

  if (dim.length_mm != null) {
    const viewRotationSteps = opts.viewRotationSteps ?? 0
    const left = screenLeftNormal(f.n, viewRotationSteps)
    // 画面上で線の左（横向きなら上）。そこに他の線がかかるときは反対側
    drawUprightLabel(ctx, String(dim.length_mm), f.at(f.len / 2, 0), [left, negate(left)], {
      fontPx: 13 / s,
      color: DIMENSION_COLOR,
      bold: true,
      viewScale: s,
      viewRotationSteps,
      obstacles: opts.obstacles,
      placed: opts.labelBoxes,
      // 端の短い線（tick）より外に出す
      minDistance: 7 / s,
    })
  }
}

/** 表示回転（時計回り 90° 単位）後の画面上の向き */
function toScreenDirection(v: Pt, viewRotationSteps: number): Pt {
  const steps = ((Math.round(viewRotationSteps) % 4) + 4) % 4
  if (steps === 1) return { x: -v.y, y: v.x }
  if (steps === 2) return { x: -v.x, y: -v.y }
  if (steps === 3) return { x: v.y, y: -v.x }
  return v
}

function negate(v: Pt): Pt {
  return { x: -v.x, y: -v.y }
}

/** 線分 a-b が、中心 c・半幅 hx・半高 hy の軸平行な矩形にかかるか（Liang–Barsky） */
function segmentHitsBox(a: Pt, b: Pt, c: Pt, hx: number, hy: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const clips: Array<[number, number]> = [
    [-dx, a.x - (c.x - hx)],
    [dx, c.x + hx - a.x],
    [-dy, a.y - (c.y - hy)],
    [dy, c.y + hy - a.y],
  ]
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return false
  }
  return true
}

/**
 * 画面上で正立させた文字を、線上の点 anchor から outward の向きへ、
 * 文字の枠が線にかからない距離だけ離して置く。
 *
 * outward を複数渡すと順に試し、obstacles のどの線も文字の枠にかからない最初の向きに置く。
 * どの向きでも重なるときは、線にそってずらす・離す位置も試す。それでも線にかかるなら、
 * せめて置いた文字（placed）には重ならない位置。どこも重なるときは最初の向き。
 */
function drawUprightLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  anchor: Pt,
  outwards: Pt[],
  opts: {
    fontPx: number
    color: string
    bold?: boolean
    viewScale: number
    viewRotationSteps: number
    obstacles?: DomaLine[]
    /** 線からの最小距離（寸法線の端の短い線をよけるときなど） */
    minDistance?: number
    /**
     * これまでに置いた文字の枠（4 辺）。線と同じくよけ、置いた文字の枠もここに足す。
     * 土間筋の名前と長さの文字が同じ側に重なるのを防ぐ
     */
    placed?: DomaLine[]
  },
) {
  const s = opts.viewScale
  ctx.save()
  ctx.font = `${opts.bold ? '700' : '600'} ${opts.fontPx}px sans-serif`
  const halfWidth = ctx.measureText(text).width / 2
  ctx.restore()
  const halfHeight = opts.fontPx / 2
  // 正立した文字の枠は画面の縦横に沿うので、図面座標では表示回転が奇数のとき縦横が入れ替わる
  const odd = ((Math.round(opts.viewRotationSteps) % 2) + 2) % 2 === 1
  const boxHalfX = odd ? halfHeight : halfWidth
  const boxHalfY = odd ? halfWidth : halfHeight
  const margin = 2 / s

  // 画面で測った、向き v に沿った文字の枠の半分の長さ
  const halfAlong = (v: Pt) => {
    const screen = toScreenDirection(v, opts.viewRotationSteps)
    return Math.abs(screen.x) * halfWidth + Math.abs(screen.y) * halfHeight
  }
  const centerFor = (outward: Pt, slide = 0, farther = 0): Pt => {
    // 文字の枠を外向きに測った半分の長さ + 線の太さの半分 + すき間
    const halfExtent = halfAlong(outward)
    const distance =
      Math.max(halfExtent + 1.25 / s + 3 / s, (opts.minDistance ?? 0) + halfExtent) + farther * (halfExtent * 2 + 2 / s)
    const tangent = { x: -outward.y, y: outward.x }
    const along = slide * (halfAlong(tangent) * 2 + 4 / s)
    return {
      x: anchor.x + outward.x * distance + tangent.x * along,
      y: anchor.y + outward.y * distance + tangent.y * along,
    }
  }
  const hits = (lines: DomaLine[]) => (center: Pt) =>
    lines.some((line) =>
      segmentHitsBox(
        { x: line.x1, y: line.y1 },
        { x: line.x2, y: line.y2 },
        center,
        boxHalfX + margin,
        boxHalfY + margin,
      ),
    )
  const hitsPlaced = hits(opts.placed ?? [])
  const hitsLine = hits(opts.obstacles ?? [])
  const isClear = (center: Pt) => !hitsPlaced(center) && !hitsLine(center)

  const centers = outwards.map((o) => centerFor(o))
  const fallbacks = () =>
    [0, 1].flatMap((farther) =>
      [0, 1, -1, 2, -2, 3, -3].flatMap((slide) => outwards.map((o) => centerFor(o, slide, farther))),
    )
  let center = centers.find(isClear)
  if (!center) {
    const more = fallbacks()
    center = more.find(isClear) ?? more.find((c) => !hitsPlaced(c)) ?? centers[0]
  }
  if (!center) return
  drawText(ctx, text, center, {
    fontPx: opts.fontPx,
    color: opts.color,
    bold: opts.bold,
    // 図面の表示回転を打ち消して、画面上で常に横書きの向きにする
    angle: (-opts.viewRotationSteps * Math.PI) / 2,
  })
  if (opts.placed) {
    const [x0, x1, y0, y1] = [center.x - boxHalfX, center.x + boxHalfX, center.y - boxHalfY, center.y + boxHalfY]
    opts.placed.push(
      { x1: x0, y1: y0, x2: x1, y2: y0 },
      { x1: x1, y1: y0, x2: x1, y2: y1 },
      { x1: x1, y1: y1, x2: x0, y2: y1 },
      { x1: x0, y1: y1, x2: x0, y2: y0 },
    )
  }
}

/**
 * 線の法線のうち、画面上で左（横向きの線なら上）を向くほう。
 * 図面を回して表示していても、画面で見た向きで決める。
 */
function screenLeftNormal(n: Pt, viewRotationSteps: number): Pt {
  const screen = toScreenDirection(n, viewRotationSteps)
  const flip =
    Math.abs(screen.x) >= Math.abs(screen.y) ? screen.x > 0 : screen.y > 0
  return flip ? { x: -n.x, y: -n.y } : n
}

export type DomaRunShape = DomaLine & {
  direction: SlabBarDirection
  length_mm: number
  span_mm: number
  bends: DomaBends
  settings: DomaBarSettings
  pieces_override: number[] | null
}

const WARNING_COLOR = '#b45309'

/**
 * 設置区間 1 つを図面に描くための形。描いた線を L として、加工本ごとの直線部・端部曲げの位置を出す。
 * 重ねが見えるよう、加工本を 1 本おきに画面上の右（横向きなら下）へ少しずらす。
 * 端部曲げも同じ側に出し、寸法の文字を置く左（上）側を空けておく。
 */
function runGeometry(run: DomaRunShape, viewScale: number, viewRotationSteps: number) {
  const s = viewScale
  const f = frame(run)
  const layout = layoutDomaRun(run.length_mm, run.span_mm, run.bends, run.settings, run.pieces_override)
  const k = run.length_mm > 0 ? f.len / run.length_mm : 0
  const left = screenLeftNormal(f.n, viewRotationSteps)
  const right = negate(left)
  const lane = 4 / s
  const hookPx = Math.max(run.settings.bendMm * k, 10 / s)
  const along = (mm: number, off: number): Pt => ({
    x: run.x1 + f.u.x * mm * k + right.x * off,
    y: run.y1 + f.u.y * mm * k + right.y * off,
  })
  // 規則が未確定の組み合わせ（5460 → 6000 + 360 など）では直線部が区間からはみ出す計算になる。
  // 図面では区間の中に収めて描き、ずれは警告（色・右パネル）で知らせる
  const clamp = (mm: number) => Math.min(Math.max(mm, 0), run.length_mm)
  const pieces = layout.pieces.map((piece) => {
    const off = piece.index % 2 === 1 ? lane : 0
    const a = along(clamp(piece.fromMm), off)
    const b = along(clamp(piece.toMm), off)
    const hook = (p: Pt): [Pt, Pt] => [p, { x: p.x + right.x * hookPx, y: p.y + right.y * hookPx }]
    return {
      piece,
      off,
      a,
      b,
      hookStart: piece.bendStart ? hook(a) : null,
      hookEnd: piece.bendEnd ? hook(b) : null,
    }
  })
  return { f, k, layout, left, right, lane, along, clamp, pieces }
}

/** 設置区間の図面上の線（加工本の直線部と端部曲げ）。文字の重なり判定に使う */
export function domaRunLines(run: DomaRunShape, viewScale: number, viewRotationSteps = 0): DomaLine[] {
  const { pieces } = runGeometry(run, viewScale, viewRotationSteps)
  const lines: DomaLine[] = []
  for (const p of pieces) {
    lines.push({ x1: p.a.x, y1: p.a.y, x2: p.b.x, y2: p.b.y })
    for (const hook of [p.hookStart, p.hookEnd]) {
      if (hook)
        lines.push({
          x1: hook[0].x,
          y1: hook[0].y,
          x2: hook[1].x,
          y2: hook[1].y,
        })
    }
  }
  return lines
}

/**
 * 設置区間 1 つ（土間筋 1 セット）: 加工本ごとの線・端部曲げ・重ねと、
 * 加工本の長さ・端部曲げ・重ねの値。径・本数は右パネルで見る。
 */
export function paintDomaRun(
  ctx: CanvasRenderingContext2D,
  run: DomaRunShape,
  opts: {
    viewScale: number
    selected?: boolean
    viewRotationSteps?: number
    /** 文字が重なったら反対側へ逃がすための、他の線（他の土間筋・寸法線） */
    obstacles?: DomaLine[]
    /** 右パネルの一覧と同じ名前（「タテ1」など） */
    name?: string
    /** 線・文字の色。未指定なら向きの色（タテ赤・ヨコ青） */
    color?: string
    /** 図面に置いた文字の枠（drawUprightLabel の placed）。図面全体で共有する */
    labelBoxes?: DomaLine[]
    /** この土間筋を切る区域で、線を消す範囲（domaZoneCutGap） */
    zoneGaps?: DomaZoneGap[]
    /** 区域に入ったところの短い直交線と「重ね」の文字。筋を 1 本ずつ描くとき（paintDomaZoneCutBars）は出さない */
    zoneGapMarks?: boolean
  },
): DomaRunLayout | null {
  const s = opts.viewScale
  const viewRotationSteps = opts.viewRotationSteps ?? 0
  const g = runGeometry(run, s, viewRotationSteps)
  if (g.f.len <= 0 || g.pieces.length === 0) return null
  const color = g.layout.warnings.length > 0 ? WARNING_COLOR : (opts.color ?? DOMA_DIRECTION_COLORS[run.direction])
  const fontPx = 11 / s
  // この土間筋の文字どうしも重ならないよう、共有の枠がなければこの土間筋だけで持つ
  const placed = opts.labelBoxes ?? []
  const labelOpts = {
    fontPx,
    color,
    viewScale: s,
    viewRotationSteps,
    obstacles: opts.obstacles,
    placed,
  }

  if (opts.selected) strokeHighlight(ctx, g.along(0, 0), g.along(run.length_mm, 0), s)

  const zoneGaps = opts.zoneGaps ?? []
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2.5 / s
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (zoneGaps.length > 0) {
    // 区域の中（重ねで入ったところより先）は線を描かない
    const far = 1e7
    ctx.beginPath()
    ctx.rect(-far, -far, far * 2, far * 2)
    for (const gap of zoneGaps) ctx.rect(gap.minX, gap.minY, gap.maxX - gap.minX, gap.maxY - gap.minY)
    ctx.clip('evenodd')
  }
  for (const p of g.pieces) {
    ctx.beginPath()
    if (p.hookStart) {
      ctx.moveTo(p.hookStart[1].x, p.hookStart[1].y)
      ctx.lineTo(p.a.x, p.a.y)
    } else {
      ctx.moveTo(p.a.x, p.a.y)
    }
    ctx.lineTo(p.b.x, p.b.y)
    if (p.hookEnd) ctx.lineTo(p.hookEnd[1].x, p.hookEnd[1].y)
    ctx.stroke()
  }
  ctx.restore()

  // 区域に重ねで入ったところ: 線の端に短い直交線、最初の 1 か所に区域へ入る長さ
  let lapLabeled = false
  for (const gap of opts.zoneGapMarks === false ? [] : zoneGaps) {
    const d = gap.vertical ? run.y2 - run.y1 : run.x2 - run.x1
    if (d === 0) continue
    const pointAt = (c: number): Pt | null => {
      const t = (c - (gap.vertical ? run.y1 : run.x1)) / d
      if (t < 0 || t > 1) return null
      const p = {
        x: run.x1 + (run.x2 - run.x1) * t,
        y: run.y1 + (run.y2 - run.y1) * t,
      }
      const cross = gap.vertical ? p.x : p.y
      const [c0, c1] = gap.vertical ? [gap.minX, gap.maxX] : [gap.minY, gap.maxY]
      return cross >= c0 && cross <= c1 ? p : null
    }
    for (const entry of gap.entries) {
      const end = pointAt(entry.inner)
      if (!end) continue
      const tick = 5 / s
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = 2 / s
      ctx.beginPath()
      ctx.moveTo(end.x - g.right.x * tick, end.y - g.right.y * tick)
      ctx.lineTo(end.x + g.right.x * tick, end.y + g.right.y * tick)
      ctx.stroke()
      ctx.restore()
      const mid = pointAt((entry.edge + entry.inner) / 2)
      if (!lapLabeled && mid) {
        lapLabeled = true
        const at = {
          x: mid.x + g.right.x * g.lane,
          y: mid.y + g.right.y * g.lane,
        }
        drawUprightLabel(ctx, String(Math.round(gap.lapMm)), at, [g.right, g.left], { ...labelOpts, fontPx: 10 / s })
      }
    }
  }

  // 端部曲げ: 曲げ辺をはさんで直線部と反対側（上端の曲げなら上、下端なら下）
  for (const p of g.pieces) {
    for (const [hook, outward] of [
      [p.hookStart, negate(g.f.u)],
      [p.hookEnd, g.f.u],
    ] as const) {
      if (!hook) continue
      const mid = {
        x: (hook[0].x + hook[1].x) / 2,
        y: (hook[0].y + hook[1].y) / 2,
      }
      drawUprightLabel(ctx, String(run.settings.bendMm), mid, [outward], {
        ...labelOpts,
        obstacles: undefined,
      })
    }
  }

  // 直線部の長さ: 加工本の長さから、その本の端部曲げを除いたもの（6000 の曲げ付きなら 5850）。
  // 線もこの長さで描いているので、図面の線と数字が一致する。加工本の長さ（曲げ込み）は右パネル・集計で見る。
  // 重なっていない部分の中ほど、画面上で線の左（横向きなら上）に置く
  const laps = g.layout.laps
  g.pieces.forEach((p, i) => {
    const from = g.clamp(i > 0 ? laps[i - 1]!.toMm : p.piece.fromMm)
    const to = g.clamp(i < laps.length ? laps[i]!.fromMm : p.piece.toMm)
    const straightMm = Math.round(p.piece.toMm - p.piece.fromMm)
    // 長さは常に線のすぐ左（横向きなら上）。図面の線にかかっても離さず、他の文字と重なるときだけ線にそってずらす
    drawUprightLabel(ctx, String(straightMm), g.along((from + to) / 2, p.off), [g.left], {
      ...labelOpts,
      obstacles: undefined,
    })
  })

  // 名前: 一覧のどれか分かるよう、加工本の長さとは反対側の右（横向きなら下）。
  // 同じ側に「重ね」の文字があるので、重ねのない区間のうち一番長いところの中ほどに置く
  if (opts.name) {
    const edges = [0, ...laps.flatMap((lap) => [g.clamp(lap.fromMm), g.clamp(lap.toMm)]), run.length_mm]
    let best = { from: 0, to: run.length_mm }
    for (let i = 0; i + 1 < edges.length; i += 2) {
      const from = edges[i]!
      const to = edges[i + 1]!
      if (to - from > best.to - best.from || i === 0) best = { from, to }
    }
    drawUprightLabel(ctx, opts.name, g.along((best.from + best.to) / 2, g.lane), [g.right], {
      ...labelOpts,
      obstacles: undefined,
      fontPx: 13 / s,
      bold: true,
    })
  }

  // 重ね: 重なっている 2 本の外側（右・下）
  for (const lap of laps) {
    const mid = (g.clamp(lap.fromMm) + g.clamp(lap.toMm)) / 2
    drawUprightLabel(ctx, `重ね${Math.round(lap.mm)}`, g.along(mid, g.lane), [g.right], {
      ...labelOpts,
      obstacles: undefined,
      fontPx: 10 / s,
    })
  }
  return g.layout
}

/**
 * 描いている途中の土間筋の横に、寸法線から読み取れた値を出す（決まらない値は「?」）。
 * 画面上で正立させ、線の右（横向きなら下）に置く。
 */
export function paintDomaDraftInfo(
  ctx: CanvasRenderingContext2D,
  line: DomaLine,
  texts: string[],
  opts: { viewScale: number; viewRotationSteps: number },
) {
  const s = opts.viewScale
  const f = frame(line)
  if (f.len <= 0) return
  const right = negate(screenLeftNormal(f.n, opts.viewRotationSteps))
  const fontPx = 12 / s
  const lineGap = fontPx * 1.35
  const anchor = f.at(f.len / 2, 0)
  // 文字の枠を、外向きに測った半分の長さ（行の最大幅・行数の高さ）
  ctx.save()
  ctx.font = `700 ${fontPx}px sans-serif`
  const halfWidth = Math.max(...texts.map((t) => ctx.measureText(t).width)) / 2
  ctx.restore()
  const halfHeight = (lineGap * texts.length) / 2
  const screen = toScreenDirection(right, opts.viewRotationSteps)
  const distance = Math.abs(screen.x) * halfWidth + Math.abs(screen.y) * halfHeight + 10 / s
  const center = {
    x: anchor.x + right.x * distance,
    y: anchor.y + right.y * distance,
  }
  ctx.save()
  ctx.translate(center.x, center.y)
  ctx.rotate((-opts.viewRotationSteps * Math.PI) / 2)
  texts.forEach((text, i) => {
    const y = (i - (texts.length - 1) / 2) * lineGap
    drawText(ctx, text, { x: 0, y }, {
      fontPx,
      color: text.includes('?') ? WARNING_COLOR : DIMENSION_COLOR,
      angle: 0,
      bold: true,
    })
  })
  ctx.restore()
}

export function paintDomaDraftLine(
  ctx: CanvasRenderingContext2D,
  line: DomaLine,
  color: string,
  viewScale: number,
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2 / viewScale
  ctx.setLineDash([6 / viewScale, 4 / viewScale])
  ctx.beginPath()
  ctx.moveTo(line.x1, line.y1)
  ctx.lineTo(line.x2, line.y2)
  ctx.stroke()
  ctx.restore()
}

const ZONE_EDGE_OUTWARD: Record<DomaZoneEdge, Pt> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/**
 * 特殊土間筋の範囲 1 つ: 範囲の枠（壁の辺は太線と外側の斜線）と、タテ・ヨコの代表線。
 * 代表線は範囲の中央を通り、壁でない辺は範囲の外へはみ出しの分だけ伸ばして描く（標準の土間筋と同じ描き方）
 */
export function paintDomaZone(
  ctx: CanvasRenderingContext2D,
  zone: DrawingDomaRun,
  opts: {
    viewScale: number
    selected?: boolean
    viewRotationSteps?: number
    /** 描く向き（印刷でタテだけ・ヨコだけを出すとき） */
    directions?: SlabBarDirection[]
    obstacles?: DomaLine[]
    name?: string
    /** 図面に置いた文字の枠（drawUprightLabel の placed）。図面全体で共有する */
    labelBoxes?: DomaLine[]
    /** 区域の筋を代表線でなく、ピッチごとに 1 本ずつ描く（特殊を描いているとき） */
    detailed?: boolean
  },
) {
  const s = opts.viewScale
  const viewRotationSteps = opts.viewRotationSteps ?? 0
  const r = domaZoneRect(zone)
  const spec = domaZoneSpecOf(zone)
  ctx.save()
  ctx.fillStyle = opts.selected ? 'rgba(250, 204, 21, 0.18)' : 'rgba(22, 163, 74, 0.07)'
  ctx.fillRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY)
  ctx.strokeStyle = DOMA_ZONE_COLOR
  ctx.lineWidth = (opts.selected ? 2.5 : 1.5) / s
  ctx.setLineDash([8 / s, 4 / s])
  ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY)
  ctx.setLineDash([])
  // 壁: 太線 + 外側に斜線
  ctx.strokeStyle = '#334155'
  for (const edge of DOMA_ZONE_EDGES) {
    if (!spec.walls[edge]) continue
    const line = domaZoneEdgeLine(zone, edge)
    const out = ZONE_EDGE_OUTWARD[edge]
    const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1)
    const u = len > 0 ? { x: (line.x2 - line.x1) / len, y: (line.y2 - line.y1) / len } : { x: 1, y: 0 }
    ctx.lineWidth = 4 / s
    ctx.beginPath()
    ctx.moveTo(line.x1, line.y1)
    ctx.lineTo(line.x2, line.y2)
    ctx.stroke()
    ctx.lineWidth = 1.2 / s
    ctx.beginPath()
    const gap = 8 / s
    const tick = 7 / s
    for (let t = gap / 2; t < len; t += gap) {
      const p = { x: line.x1 + u.x * t, y: line.y1 + u.y * t }
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x + out.x * tick + u.x * tick * 0.6, p.y + out.y * tick + u.y * tick * 0.6)
    }
    ctx.stroke()
  }
  ctx.restore()

  const directions = opts.directions ?? ['tate', 'yoko']
  for (const run of domaZoneRuns(zone)) {
    if (!directions.includes(run.direction)) continue
    if (opts.detailed) {
      paintZoneRunBars(ctx, zone, run, r, {
        viewScale: s,
        viewRotationSteps,
        obstacles: opts.obstacles,
        labelBoxes: opts.labelBoxes,
      })
      continue
    }
    // 区域の中はタテ・ヨコとも区域の色（標準の赤・青と見分ける。向きは線の向きで分かる）
    paintDomaRun(ctx, run, {
      viewScale: s,
      viewRotationSteps,
      obstacles: opts.obstacles,
      color: DOMA_ZONE_COLOR,
      labelBoxes: opts.labelBoxes,
    })
  }

  if (opts.name) {
    // 範囲の画面上の左上の角の内側に置く
    const corners: Pt[] = [
      { x: r.minX, y: r.minY },
      { x: r.maxX, y: r.minY },
      { x: r.maxX, y: r.maxY },
      { x: r.minX, y: r.maxY },
    ]
    const screenOf = (p: Pt) => toScreenDirection(p, viewRotationSteps)
    const corner = corners.reduce((best, p) => {
      const a = screenOf(p)
      const b = screenOf(best)
      return a.x + a.y < b.x + b.y ? p : best
    })
    const fontPx = 13 / s
    ctx.save()
    ctx.font = `700 ${fontPx}px sans-serif`
    const halfWidth = ctx.measureText(opts.name).width / 2
    ctx.restore()
    // 画面で右下へ (文字の半幅, 半高) + すき間 ずらし、図面座標へ戻す
    const offset = toScreenDirection(
      { x: halfWidth + 5 / s, y: fontPx / 2 + 5 / s },
      -viewRotationSteps,
    )
    drawText(ctx, opts.name, { x: corner.x + offset.x, y: corner.y + offset.y }, {
      fontPx,
      color: DOMA_ZONE_COLOR,
      angle: (-viewRotationSteps * Math.PI) / 2,
      bold: true,
    })
  }
}

type BarSetLabelOpts = {
  viewScale: number
  viewRotationSteps: number
  obstacles?: DomaLine[]
  labelBoxes?: DomaLine[]
}

/** 筋を 1 本ずつ描くときの文字に付ける向き（右パネルの一覧と同じ） */
const DIRECTION_TEXT: Record<SlabBarDirection, string> = { tate: 'タテ', yoko: 'ヨコ' }

/** 筋を 1 本ずつ描くときの 1 セットの最大本数。多いと図面が線で埋まるので、範囲全体から何本か選んで見せる */
const MAX_DETAIL_BARS = 6

/**
 * 図面の縦（vertical）か横にそった筋を、直交する範囲 cross に描く。筋の位置は実際のピッチ（pitchPx）の並びで、
 * 多ければそのうち両端を含めて MAX_DETAIL_BARS 本を範囲全体から等間隔に選ぶ
 * （区域の筋と標準筋はピッチが違うので、図面でも同じ位置に重ならない）。
 * along は筋の両端（線の向きの座標）、hooks はその端の曲げ（直交する向きの短い線）。
 * 文字を置くため、真ん中の 1 本の座標を返す
 */
function strokeBarSet(
  ctx: CanvasRenderingContext2D,
  bar: {
    vertical: boolean
    along: [number, number]
    hooks: [boolean, boolean]
    hookPx: number
  },
  cross: [number, number],
  count: number,
  pitchPx: number,
  color: string,
  s: number,
): ((along: number) => Pt) | null {
  if (count <= 0 || !(cross[1] > cross[0]) || !(pitchPx > 0) || bar.along[0] === bar.along[1]) return null
  const pt = (along: number, c: number): Pt => (bar.vertical ? { x: c, y: along } : { x: along, y: c })
  const hookDir: Pt = bar.vertical ? { x: 1, y: 0 } : { x: 0, y: 1 }
  const shown = Math.min(count, MAX_DETAIL_BARS)
  const positions = Array.from({ length: shown }, (_, j) => {
    const i = shown > 1 ? Math.round((j * (count - 1)) / (shown - 1)) : 0
    return Math.min(cross[0] + pitchPx * (i + 0.5), cross[1])
  })
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.4 / s
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (const c of positions) {
    const a = pt(bar.along[0], c)
    const b = pt(bar.along[1], c)
    if (bar.hooks[0]) {
      ctx.moveTo(a.x + hookDir.x * bar.hookPx, a.y + hookDir.y * bar.hookPx)
      ctx.lineTo(a.x, a.y)
    } else {
      ctx.moveTo(a.x, a.y)
    }
    ctx.lineTo(b.x, b.y)
    if (bar.hooks[1]) ctx.lineTo(b.x + hookDir.x * bar.hookPx, b.y + hookDir.y * bar.hookPx)
  }
  ctx.stroke()
  ctx.restore()
  const middle = positions[Math.floor((shown - 1) / 2)]!
  return (along) => pt(along, middle)
}

/** 筋の真ん中の 1 本の横に文字を置く（画面で左右のあいている側） */
function labelBarSet(
  ctx: CanvasRenderingContext2D,
  text: string,
  at: Pt,
  vertical: boolean,
  color: string,
  opts: BarSetLabelOpts,
) {
  const s = opts.viewScale
  const f = frame({ x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: vertical ? 1 : 0 })
  const left = screenLeftNormal(f.n, opts.viewRotationSteps)
  drawUprightLabel(ctx, text, at, [negate(left), left], {
    fontPx: 10 / s,
    color,
    viewScale: s,
    viewRotationSteps: opts.viewRotationSteps,
    obstacles: opts.obstacles,
    placed: opts.labelBoxes,
  })
}

/** 区域の 1 方向の筋を、区域の幅いっぱいにピッチごとに描く（壁の辺は曲げ、ほかははみ出し） */
function paintZoneRunBars(
  ctx: CanvasRenderingContext2D,
  zone: DrawingDomaRun,
  run: DrawingDomaRun,
  r: ReturnType<typeof domaZoneRect>,
  opts: BarSetLabelOpts,
) {
  const s = opts.viewScale
  const vertical = Math.abs(run.y2 - run.y1) >= Math.abs(run.x2 - run.x1)
  const linePx = Math.hypot(run.x2 - run.x1, run.y2 - run.y1)
  if (!(run.length_mm > 0) || !(linePx > 0)) return
  const pitch = run.settings.pitchMm
  const count = countBars(run.span_mm, pitch)
  const cross: [number, number] = vertical ? [r.minX, r.maxX] : [r.minY, r.maxY]
  const middleAt = strokeBarSet(
    ctx,
    {
      vertical,
      along: vertical ? [run.y1, run.y2] : [run.x1, run.x2],
      hooks: [run.bends === 'both' || run.bends === 'start', run.bends === 'both' || run.bends === 'end'],
      hookPx: Math.max((run.settings.bendMm * linePx) / run.length_mm, 6 / s),
    },
    cross,
    count,
    run.span_mm > 0 ? (pitch * (cross[1] - cross[0])) / run.span_mm : 0,
    DOMA_ZONE_COLOR,
    s,
  )
  if (!middleAt) return
  // 区域の中は辺の長さ、区域の外へはみ出した部分はその長さを、それぞれの部分に書く（筋 1 本の長さは右パネル・集計）
  const [zoneLo, zoneHi] = vertical ? [r.minY, r.maxY] : [r.minX, r.maxX]
  const sizeMm = run.direction === 'tate' ? zone.length_mm : zone.span_mm
  labelBarSet(
    ctx,
    `${DIRECTION_TEXT[run.direction]} ${Math.round(sizeMm)} @${pitch} ${count}本`,
    middleAt((zoneLo + zoneHi) / 2),
    vertical,
    DOMA_ZONE_COLOR,
    opts,
  )
  const [lo, hi] = vertical
    ? [Math.min(run.y1, run.y2), Math.max(run.y1, run.y2)]
    : [Math.min(run.x1, run.x2), Math.max(run.x1, run.x2)]
  const extendText = String(Math.round(domaZoneExtendMm(zone)))
  const eps = 1e-6
  if (lo < zoneLo - eps) labelBarSet(ctx, extendText, middleAt((lo + zoneLo) / 2), vertical, DOMA_ZONE_COLOR, opts)
  if (hi > zoneHi + eps) labelBarSet(ctx, extendText, middleAt((zoneHi + hi) / 2), vertical, DOMA_ZONE_COLOR, opts)
}

/**
 * 区域にかかる標準筋を、標準筋のピッチで何本か描く。区域の辺の外から重ね分の長さだけ見せ、
 * 区域の辺から重ね分入ったところ（壁の辺なら辺で曲げ）で止める。
 */
export function paintDomaZoneCutBars(
  ctx: CanvasRenderingContext2D,
  run: DomaRunShape,
  gaps: DomaZoneGap[],
  opts: BarSetLabelOpts,
) {
  const s = opts.viewScale
  const color = DOMA_DIRECTION_COLORS[run.direction]
  const linePx = Math.hypot(run.x2 - run.x1, run.y2 - run.y1)
  if (!(run.length_mm > 0) || !(linePx > 0)) return
  const hookPx = Math.max((run.settings.bendMm * linePx) / run.length_mm, 6 / s)
  const startBend = run.bends === 'both' || run.bends === 'start'
  const endBend = run.bends === 'both' || run.bends === 'end'
  for (const gap of gaps) {
    const [p1, p2] = gap.vertical ? [run.y1, run.y2] : [run.x1, run.x2]
    const startLow = p2 >= p1
    const runLo = Math.min(p1, p2)
    const runHi = Math.max(p1, p2)
    const [loBend, hiBend] = startLow ? [startBend, endBend] : [endBend, startBend]
    // 区域の外は重ね分だけ（筋の端がそれより近ければ端まで、端の曲げも描く）
    const outsidePx = gap.lapMm * gap.pxPerMm
    const edgeOf = (end: number) => gap.entries.find((e) => e.inner === end)?.edge ?? end
    const parts: { along: [number, number]; hooks: [boolean, boolean] }[] = []
    if (gap.low && gap.low.end > runLo) {
      const outer = Math.max(runLo, edgeOf(gap.low.end) - outsidePx)
      parts.push({
        along: [outer, gap.low.end],
        hooks: [outer === runLo && loBend, gap.low.wall],
      })
    }
    if (gap.high && runHi > gap.high.end) {
      const outer = Math.min(runHi, edgeOf(gap.high.end) + outsidePx)
      parts.push({
        along: [gap.high.end, outer],
        hooks: [gap.high.wall, outer === runHi && hiBend],
      })
    }
    let labeled = false
    for (const part of parts) {
      const middleAt = strokeBarSet(
        ctx,
        {
          vertical: gap.vertical,
          along: part.along,
          hooks: part.hooks,
          hookPx,
        },
        gap.crossPx,
        gap.count,
        run.settings.pitchMm * gap.pxPerMm,
        color,
        s,
      )
      if (!middleAt || labeled) continue
      labeled = true
      // 区域の外の中ほどにピッチ、区域に入った部分に重ね
      const lowSide = gap.low != null && part.along[1] === gap.low.end
      const zoneEnd = lowSide ? part.along[1] : part.along[0]
      const entry = gap.entries.find((e) => e.inner === zoneEnd)
      const outer = entry ? entry.edge : zoneEnd
      const far = lowSide ? part.along[0] : part.along[1]
      labelBarSet(
        ctx,
        `${DIRECTION_TEXT[run.direction]} @${run.settings.pitchMm} ${gap.count}本`,
        middleAt((outer + far) / 2),
        gap.vertical,
        color,
        opts,
      )
      if (entry) {
        labelBarSet(
          ctx,
          String(Math.round(gap.lapMm)),
          middleAt((entry.edge + entry.inner) / 2),
          gap.vertical,
          color,
          opts,
        )
      }
    }
  }
}

/** 範囲の線（枠と代表線）。文字の重なり判定に使う */
export function domaZoneLines(zone: DrawingDomaRun, viewScale: number, viewRotationSteps = 0): DomaLine[] {
  return [
    ...DOMA_ZONE_EDGES.map((edge) => domaZoneEdgeLine(zone, edge)),
    ...domaZoneRuns(zone).flatMap((run) => domaRunLines(run, viewScale, viewRotationSteps)),
  ]
}

/** 範囲の中か（枠の外 tol まで含む） */
export function isPointInDomaZone(pt: Pt, zone: DomaLine, tol: number): boolean {
  const r = domaZoneRect(zone)
  return pt.x >= r.minX - tol && pt.x <= r.maxX + tol && pt.y >= r.minY - tol && pt.y <= r.maxY + tol
}

/** 点に近い範囲の辺（tol 以内）。なければ null */
export function domaZoneEdgeAt(pt: Pt, zone: DomaLine, tol: number): DomaZoneEdge | null {
  let best: { edge: DomaZoneEdge; d: number } | null = null
  for (const edge of DOMA_ZONE_EDGES) {
    const d = distanceToDomaLine(pt, domaZoneEdgeLine(zone, edge))
    if (d < tol && (!best || d < best.d)) best = { edge, d }
  }
  return best?.edge ?? null
}

/** 範囲を描いている途中の枠 */
export function paintDomaZoneDraft(ctx: CanvasRenderingContext2D, rect: DomaLine, viewScale: number) {
  const r = domaZoneRect(rect)
  ctx.save()
  ctx.fillStyle = 'rgba(22, 163, 74, 0.08)'
  ctx.fillRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY)
  ctx.strokeStyle = DOMA_ZONE_COLOR
  ctx.lineWidth = 2 / viewScale
  ctx.setLineDash([6 / viewScale, 4 / viewScale])
  ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY)
  ctx.restore()
}

export function distanceToDomaLine(pt: Pt, line: DomaLine): number {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(pt.x - line.x1, pt.y - line.y1)
  const t = Math.max(0, Math.min(1, ((pt.x - line.x1) * dx + (pt.y - line.y1) * dy) / len2))
  return Math.hypot(pt.x - (line.x1 + t * dx), pt.y - (line.y1 + t * dy))
}

export type DomaDimensionLike = DomaLine & { id: string; length_mm: number }

function isVerticalLine(l: DomaLine): boolean {
  return Math.abs(l.y2 - l.y1) >= Math.abs(l.x2 - l.x1)
}

/** 線の向きの軸で見た範囲 [小, 大] */
function axisRange(l: DomaLine, vertical: boolean): [number, number] {
  const [a, b] = vertical ? [l.y1, l.y2] : [l.x1, l.x2]
  return [Math.min(a, b), Math.max(a, b)]
}

/**
 * 全体寸法か（6370 + 6370 = 12740 の 12740 のように、同じ向きの短い寸法線を
 * 端から端までつなぐと埋まり、値の合計も一致する）。区画寸法と見分けるために使う。
 */
function isAggregateDimension(d: DomaDimensionLike, dims: DomaDimensionLike[], tol: number): boolean {
  const vertical = isVerticalLine(d)
  const [lo, hi] = axisRange(d, vertical)
  // 寸法線は手で引くので端どうしが数十 px ずれる（実データで 15 px）。画面の倍率ではなく
  // 寸法線の長さに対する割合で許す。値の合計が一致することは厳密に見るので、誤って外すことはない
  tol = Math.max(tol, (hi - lo) * 0.03)
  const parts = dims
    .filter((o) => o.id !== d.id && isVerticalLine(o) === vertical && o.length_mm < d.length_mm)
    .map((o) => ({ mm: o.length_mm, range: axisRange(o, vertical) }))
    .filter(({ range }) => range[0] >= lo - tol && range[1] <= hi + tol)
  const search = (pos: number, sum: number, depth: number): boolean => {
    if (Math.abs(pos - hi) <= tol) return sum === d.length_mm
    if (depth > 12) return false
    return parts.some(
      (p) => Math.abs(p.range[0] - pos) <= tol && p.range[1] > pos + tol && search(p.range[1], sum + p.mm, depth + 1),
    )
  }
  return search(lo, 0, 0)
}

/**
 * 配筋範囲の候補: 土間筋と直交し、その本の位置を範囲に含む寸法線。
 * 全体寸法（区画寸法の合計）は外す。部分寸法（開口部の幅など）は外せないので、
 * 候補が複数残ったら自動では決めずに選んでもらう。
 */
export function findDomaSpanCandidates<T extends DomaDimensionLike>(
  bar: DomaLine,
  dims: T[],
  tol: number,
): T[] {
  const barVertical = isVerticalLine(bar)
  const pos = barVertical ? (bar.x1 + bar.x2) / 2 : (bar.y1 + bar.y2) / 2
  const crossing = dims.filter((d) => {
    if (isVerticalLine(d) === barVertical) return false
    const [lo, hi] = axisRange(d, !barVertical)
    return pos >= lo - tol && pos <= hi + tol
  })
  return crossing.filter((d) => !isAggregateDimension(d, dims, tol))
}

/**
 * L の候補: 描いた土間筋と同じ向きで、両端が描いた線の両端とほぼ同じ位置にある寸法線。
 * 画素の長さを mm に換算するのではなく、すでに入力された寸法値を使う。
 */
export function findDomaRunLengthCandidates<T extends DomaDimensionLike>(
  bar: DomaLine,
  dims: T[],
  tol: number,
): T[] {
  const barVertical = isVerticalLine(bar)
  const [b0, b1] = axisRange(bar, barVertical)
  return dims.filter((d) => {
    if (isVerticalLine(d) !== barVertical) return false
    const [d0, d1] = axisRange(d, barVertical)
    return Math.abs(d0 - b0) <= tol && Math.abs(d1 - b1) <= tol
  })
}

/** 候補が 1 つの値に決まるときだけその寸法線（同じ値の重複は 1 つとみなす）。決まらなければ null */
export function pickDomaDimension<T extends DomaDimensionLike>(candidates: T[]): T | null {
  if (candidates.length === 0) return null
  return candidates.every((d) => d.length_mm === candidates[0]!.length_mm) ? candidates[0]! : null
}

// 寸法線の長さの自動推定は使わない（寸法値は毎回手で入力する）。
// 戻すときはこの関数と drawing-viewer.tsx の呼び出し 2 か所のコメントを外す。
//
// /**
//  * 寸法線から図面の縮尺（px/mm）を推定し、描いた長さを mm に換算する。
//  * 既存の寸法値に 3% 以内で近ければその値に合わせる。寸法線がなければ null。
//  */
// export function estimateLengthMm(pxLength: number, dims: Array<DomaLine & { length_mm: number }>): number | null {
//   const ratios = dims
//     .map((d) => Math.hypot(d.x2 - d.x1, d.y2 - d.y1) / d.length_mm)
//     .filter((r) => Number.isFinite(r) && r > 0)
//     .sort((a, b) => a - b)
//   if (ratios.length === 0) return null
//   const ratio = ratios[Math.floor(ratios.length / 2)]
//   const raw = pxLength / ratio
//   const near = dims
//     .map((d) => d.length_mm)
//     .find((mm) => Math.abs(mm - raw) / mm <= 0.03)
//   return near ?? Math.round(raw / 10) * 10
// }
