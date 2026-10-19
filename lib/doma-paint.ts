// 土間筋タブのキャンバス描画: 各辺の寸法線と、タテ／ヨコの土間筋代表線。
// 座標は図面座標（drawing_segments と同じ）。線幅・文字は viewScale で割って画面上の大きさを一定にする。

import { computeDomaBar, type DomaBarSettings, type SlabBarDirection } from './slab-rebar'

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
  let angle = Math.atan2(u.y, u.x)
  if (angle > Math.PI / 2) angle -= Math.PI
  if (angle < -Math.PI / 2) angle += Math.PI
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

/** 土間筋の代表線を、加工本の分割・重ね・端部の曲げ付きで描く */
export function paintDomaBar(
  ctx: CanvasRenderingContext2D,
  bar: DomaLine & {
    direction: SlabBarDirection
    run_length_mm: number
    span_mm: number
    settings: DomaBarSettings
  },
  opts: { viewScale: number; selected?: boolean },
) {
  const s = opts.viewScale
  const f = frame(bar)
  const L = bar.run_length_mm
  if (f.len <= 0 || !(L > 0)) return
  const k = f.len / L
  const color = DOMA_DIRECTION_COLORS[bar.direction]
  const { count, pieces } = computeDomaBar(L, bar.span_mm, bar.settings)
  const { bendMm, lapMm } = bar.settings

  if (opts.selected) strokeHighlight(ctx, f.at(0, 0), f.at(f.len, 0), s)

  if (pieces.length === 0) {
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 2.5 / s
    ctx.beginPath()
    const a = f.at(0, 0)
    const b = f.at(f.len, 0)
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.restore()
    return
  }

  // 設置区間 [0, L] 上の各加工本の直線部。重ねは隣の本と lap だけ重なる
  const straight = pieces.map((p) => (p.kind === 'BENT' ? p.lengthMm - bendMm : p.lengthMm))
  const intervals: Array<[number, number]> = []
  let prevEnd = 0
  straight.forEach((len, i) => {
    const isLast = i === straight.length - 1
    const start = i === 0 ? 0 : isLast ? L - len : prevEnd - lapMm
    const end = i === 0 ? len : start + len
    intervals.push([Math.max(0, start), Math.min(L, end)])
    prevEnd = end
  })

  const gap = 3 / s
  const hookPx = Math.max(bendMm * k, 10 / s)
  const fontPx = 11 / s

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2.5 / s
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  intervals.forEach(([a, b], i) => {
    const off = i % 2 === 0 ? gap : -gap
    const p0 = f.at(a * k, off)
    const p1 = f.at(b * k, off)
    ctx.beginPath()
    if (i === 0 && pieces[i].kind === 'BENT') {
      const h = f.at(a * k, off - hookPx)
      ctx.moveTo(h.x, h.y)
      ctx.lineTo(p0.x, p0.y)
    } else {
      ctx.moveTo(p0.x, p0.y)
    }
    ctx.lineTo(p1.x, p1.y)
    if (i === intervals.length - 1 && pieces[i].kind === 'BENT') {
      const h = f.at(b * k, off - hookPx)
      ctx.lineTo(h.x, h.y)
    }
    ctx.stroke()
  })
  ctx.restore()

  // 寸法: 曲げ・各本の直線部・重ね（線の反対側に出す）
  const side = -16 / s
  drawText(ctx, String(bendMm), f.at(0, -hookPx - 10 / s), { fontPx, color, angle: f.angle })
  drawText(ctx, String(bendMm), f.at(f.len, -hookPx - 10 / s), { fontPx, color, angle: f.angle })
  intervals.forEach(([a, b], i) => {
    drawText(ctx, String(Math.round(straight[i])), f.at(((a + b) / 2) * k, side + (i % 2 === 0 ? 0 : -12 / s)), {
      fontPx,
      color,
      angle: f.angle,
    })
    if (i > 0) {
      const lapStart = a
      const lapEnd = Math.min(intervals[i - 1][1], L)
      drawText(ctx, String(lapMm), f.at(((lapStart + lapEnd) / 2) * k, 14 / s), {
        fontPx: 10 / s,
        color: '#475569',
        angle: f.angle,
      })
    }
  })

  // 本数と加工本の内訳
  const labelAt = f.at(f.len / 2, 32 / s)
  drawText(ctx, `${bar.settings.diameter} @${bar.settings.pitchMm} × ${count}本`, labelAt, {
    fontPx: 12 / s,
    color,
    angle: f.angle,
    bold: true,
  })
  drawText(ctx, pieces.map((p) => p.lengthMm).join(' + '), f.at(f.len / 2, 47 / s), {
    fontPx,
    color,
    angle: f.angle,
  })
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
