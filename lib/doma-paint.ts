// 土間筋タブのキャンバス描画: 各辺の寸法線と、タテ／ヨコの土間筋代表線。
// 座標は図面座標（drawing_segments と同じ）。線幅・文字は viewScale で割って画面上の大きさを一定にする。

import {
  computeDomaPiece,
  type DomaBarSettings,
  type DomaBendEnd,
  type SlabBarDirection,
} from './slab-rebar'

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
  opts: { viewScale: number; selected?: boolean; preview?: boolean },
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
    drawText(ctx, String(dim.length_mm), f.at(f.len / 2, 11 / s), {
      fontPx: 13 / s,
      color: DIMENSION_COLOR,
      angle: f.angle,
      bold: true,
    })
  }
}

export type DomaBarShape = DomaLine & {
  direction: SlabBarDirection
  straight_mm: number
  bend_end: DomaBendEnd
  span_mm: number
  settings: DomaBarSettings
}

/** 図面上の px / mm（描いた線の長さ ÷ 直線部の mm） */
function barPxPerMm(bar: DomaBarShape): number {
  const len = Math.hypot(bar.x2 - bar.x1, bar.y2 - bar.y1)
  return bar.straight_mm > 0 ? len / bar.straight_mm : 0
}

/** 加工本 1 本: 直線部 + 片側の端部曲げ + 寸法・本数 */
export function paintDomaBar(
  ctx: CanvasRenderingContext2D,
  bar: DomaBarShape,
  opts: { viewScale: number; selected?: boolean },
) {
  const s = opts.viewScale
  const f = frame(bar)
  if (f.len <= 0) return
  const k = barPxPerMm(bar)
  const color = DOMA_DIRECTION_COLORS[bar.direction]
  const { count, piece, warnings } = computeDomaPiece(bar.straight_mm, bar.span_mm, bar.bend_end, bar.settings)
  const { bendMm } = bar.settings
  const hookPx = Math.max(bendMm * k, 10 / s)
  const fontPx = 11 / s

  if (opts.selected) strokeHighlight(ctx, f.at(0, 0), f.at(f.len, 0), s)

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2.5 / s
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  const a = f.at(0, 0)
  const b = f.at(f.len, 0)
  if (bar.bend_end === 'start') {
    const h = f.at(0, -hookPx)
    ctx.moveTo(h.x, h.y)
    ctx.lineTo(a.x, a.y)
  } else {
    ctx.moveTo(a.x, a.y)
  }
  ctx.lineTo(b.x, b.y)
  if (bar.bend_end === 'end') {
    const h = f.at(f.len, -hookPx)
    ctx.lineTo(h.x, h.y)
  }
  ctx.stroke()
  ctx.restore()

  if (bar.bend_end !== 'none') {
    const t = bar.bend_end === 'start' ? 0 : f.len
    drawText(ctx, String(bendMm), f.at(t, -hookPx - 10 / s), { fontPx, color, angle: f.angle })
  }
  drawText(ctx, String(bar.straight_mm), f.at(f.len / 2, -14 / s), { fontPx, color, angle: f.angle })

  const warn = warnings.includes('EXCEEDS_STOCK') ? ' ⚠定尺超え' : ''
  drawText(ctx, `${bar.settings.diameter} @${bar.settings.pitchMm} × ${count}本`, f.at(f.len / 2, 16 / s), {
    fontPx: 12 / s,
    color,
    angle: f.angle,
    bold: true,
  })
  drawText(ctx, `${piece.kind === 'BENT' ? '曲' : '直'} ${piece.lengthMm}${warn}`, f.at(f.len / 2, 31 / s), {
    fontPx,
    color: warn ? '#b45309' : color,
    angle: f.angle,
  })
}

/**
 * 同じ方向で同じ線上に重なっている加工本どうしの重ね長さ(mm)を表示する。
 * 長さは重なっている 2 本の縮尺の平均で換算する。
 */
export function paintDomaLaps(ctx: CanvasRenderingContext2D, bars: DomaBarShape[], viewScale: number) {
  const s = viewScale
  const tol = 6 / s
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      const a = bars[i]
      const b = bars[j]
      if (a.direction !== b.direction) continue
      const horizontal = Math.abs(a.y2 - a.y1) < Math.abs(a.x2 - a.x1)
      const bHorizontal = Math.abs(b.y2 - b.y1) < Math.abs(b.x2 - b.x1)
      if (horizontal !== bHorizontal) continue
      const perpA = horizontal ? a.y1 : a.x1
      const perpB = horizontal ? b.y1 : b.x1
      if (Math.abs(perpA - perpB) > tol) continue
      const [a0, a1] = horizontal ? [a.x1, a.x2] : [a.y1, a.y2]
      const [b0, b1] = horizontal ? [b.x1, b.x2] : [b.y1, b.y2]
      const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1))
      const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1))
      if (hi - lo <= 1 / s) continue
      const k = (barPxPerMm(a) + barPxPerMm(b)) / 2
      if (!(k > 0)) continue
      const mm = Math.round((hi - lo) / k / 10) * 10
      const mid = (lo + hi) / 2
      const offset = 14 / s
      const p = horizontal ? { x: mid, y: (perpA + perpB) / 2 + offset } : { x: (perpA + perpB) / 2 + offset, y: mid }
      drawText(ctx, `重ね${mm}`, p, {
        fontPx: 10 / s,
        color: '#475569',
        angle: horizontal ? 0 : -Math.PI / 2,
      })
    }
  }
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

export function distanceToDomaLine(pt: Pt, line: DomaLine): number {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(pt.x - line.x1, pt.y - line.y1)
  const t = Math.max(0, Math.min(1, ((pt.x - line.x1) * dx + (pt.y - line.y1) * dy) / len2))
  return Math.hypot(pt.x - (line.x1 + t * dx), pt.y - (line.y1 + t * dy))
}

/**
 * 寸法線から図面の縮尺（px/mm）を推定し、描いた長さを mm に換算する。
 * 既存の寸法値に 3% 以内で近ければその値に合わせる。寸法線がなければ null。
 */
export function estimateLengthMm(pxLength: number, dims: Array<DomaLine & { length_mm: number }>): number | null {
  const ratios = dims
    .map((d) => Math.hypot(d.x2 - d.x1, d.y2 - d.y1) / d.length_mm)
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b)
  if (ratios.length === 0) return null
  const ratio = ratios[Math.floor(ratios.length / 2)]
  const raw = pxLength / ratio
  const near = dims
    .map((d) => d.length_mm)
    .find((mm) => Math.abs(mm - raw) / mm <= 0.03)
  return near ?? Math.round(raw / 10) * 10
}
