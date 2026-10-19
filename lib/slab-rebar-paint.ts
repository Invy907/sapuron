// 土間筋タブのキャンバス描画とヒットテスト。
// 図面は模式図: 外形を size_px（bbox の長辺）に縮めて描き、寸法・本数は mm の計算値を文字で出す。

import {
  buildRuns,
  shapeOutline,
  type BarRun,
  type SlabBarDirection,
  type SlabPoint,
  type SlabRebarSettings,
  type SlabShape,
} from './slab-rebar'

export type SlabRegionPlacement = {
  shape: SlabShape
  settings: SlabRebarSettings
  x: number
  y: number
  size_px: number
}

export const SLAB_DIRECTION_COLORS: Record<SlabBarDirection, string> = {
  tate: '#dc2626',
  yoko: '#2563eb',
}

export function slabPxPerMm(r: SlabRegionPlacement): number {
  const longSide = Math.max(r.shape.widthMm, r.shape.heightMm)
  return longSide > 0 ? r.size_px / longSide : 0
}

function slabMapper(r: SlabRegionPlacement) {
  const k = slabPxPerMm(r)
  const ox = r.x - (r.shape.widthMm * k) / 2
  const oy = r.y - (r.shape.heightMm * k) / 2
  return { k, toCanvas: (p: SlabPoint) => ({ x: ox + p.x * k, y: oy + p.y * k }) }
}

export function isPointInSlabRegion(r: SlabRegionPlacement, pt: { x: number; y: number }): boolean {
  const { toCanvas } = slabMapper(r)
  const poly = shapeOutline(r.shape).map(toCanvas)
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

function fmt(mm: number): string {
  return String(Math.round(mm))
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { fontPx: number; color: string; angle?: number; bold?: boolean },
) {
  ctx.save()
  ctx.translate(x, y)
  if (opts.angle) ctx.rotate(opts.angle)
  ctx.font = `${opts.bold ? '700 ' : ''}${opts.fontPx}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = opts.fontPx * 0.3
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'
  ctx.strokeText(text, 0, 0)
  ctx.fillStyle = opts.color
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

/** 設置区間 [0, L] 上での各加工本の直線部の範囲。重ねは隣の本と lap だけ重なる */
function pieceIntervals(run: BarRun, settings: SlabRebarSettings): Array<[number, number]> {
  const L = run.band.runLengthMm
  const straight = run.pieces.map((p) => (p.kind === 'BENT' ? p.lengthMm - settings.bendMm : p.lengthMm))
  const out: Array<[number, number]> = []
  let prevEnd = 0
  straight.forEach((len, i) => {
    const isLast = i === straight.length - 1
    const start = i === 0 ? 0 : isLast ? L - len : prevEnd - settings.lapMm
    const end = i === 0 ? len : start + len
    out.push([Math.max(0, start), Math.min(L, end)])
    prevEnd = end
  })
  return out
}

export function paintSlabRegion(
  ctx: CanvasRenderingContext2D,
  r: SlabRegionPlacement,
  opts: { direction: SlabBarDirection; selected: boolean; viewScale: number; label?: string | null },
) {
  const { k, toCanvas } = slabMapper(r)
  if (k <= 0) return
  const s = opts.viewScale
  const outlineMm = shapeOutline(r.shape)
  const poly = outlineMm.map(toCanvas)
  const color = SLAB_DIRECTION_COLORS[opts.direction]

  const tracePoly = () => {
    ctx.beginPath()
    poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
  }

  ctx.save()
  tracePoly()
  ctx.fillStyle = 'rgba(148, 163, 184, 0.10)'
  ctx.fill()
  if (opts.selected) {
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)'
    ctx.lineWidth = 10 / s
    ctx.stroke()
  }
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = 2 / s
  ctx.stroke()
  ctx.restore()

  // 外形の各辺の寸法（外側に出す）。外形は画面上で時計回りなので外向き法線は (dy, -dx)
  for (let i = 0; i < outlineMm.length; i++) {
    const a = outlineMm[i]
    const b = outlineMm[(i + 1) % outlineMm.length]
    const lenMm = Math.hypot(b.x - a.x, b.y - a.y)
    if (lenMm <= 0) continue
    const pa = poly[i]
    const pb = poly[(i + 1) % poly.length]
    const dx = (pb.x - pa.x) / (lenMm * k)
    const dy = (pb.y - pa.y) / (lenMm * k)
    const off = 12 / s
    const vertical = Math.abs(dy) > Math.abs(dx)
    drawLabel(ctx, fmt(lenMm), (pa.x + pb.x) / 2 + dy * off, (pa.y + pb.y) / 2 - dx * off, {
      fontPx: 11 / s,
      color: '#334155',
      angle: vertical ? -Math.PI / 2 : 0,
    })
  }

  const runs = buildRuns(outlineMm, r.settings, [opts.direction])
  const isTate = opts.direction === 'tate'

  // 帯ごとの全鉄筋（薄く）
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.22
  ctx.lineWidth = 1 / s
  for (const run of runs) {
    if (run.count <= 0) continue
    const spacingPx = (run.band.spanMm / run.count) * k * s
    if (spacingPx < 2) continue
    for (let i = 0; i < run.count; i++) {
      const t = (i + 0.5) / run.count
      const p0 = isTate
        ? toCanvas({ x: run.band.x0 + run.band.spanMm * t, y: run.band.y0 })
        : toCanvas({ x: run.band.x0, y: run.band.y0 + run.band.spanMm * t })
      const p1 = isTate
        ? toCanvas({ x: run.band.x0 + run.band.spanMm * t, y: run.band.y1 })
        : toCanvas({ x: run.band.x1, y: run.band.y0 + run.band.spanMm * t })
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
    }
  }
  ctx.restore()

  // 帯ごとの代表 1 本: 加工本の分割・重ね・曲げを示す
  for (const run of runs) {
    if (run.pieces.length === 0) continue
    const intervals = pieceIntervals(run, r.settings)
    const center = run.band.spanMm / 2
    const at = (runPos: number, perpPx: number) => {
      const base = isTate
        ? toCanvas({ x: run.band.x0 + center, y: run.band.y0 + runPos })
        : toCanvas({ x: run.band.x0 + runPos, y: run.band.y0 + center })
      return isTate ? { x: base.x + perpPx, y: base.y } : { x: base.x, y: base.y + perpPx }
    }
    const hookPx = Math.max(r.settings.bendMm * k, 6 / s)

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 2.5 / s
    ctx.lineCap = 'round'
    intervals.forEach(([a, b], i) => {
      const perp = (i % 2 === 0 ? -3 : 3) / s
      const p0 = at(a, perp)
      const p1 = at(b, perp)
      ctx.beginPath()
      if (i === 0 && run.pieces[i].kind === 'BENT') {
        const h = at(a, perp - hookPx)
        ctx.moveTo(h.x, h.y)
        ctx.lineTo(p0.x, p0.y)
      } else {
        ctx.moveTo(p0.x, p0.y)
      }
      ctx.lineTo(p1.x, p1.y)
      if (i === intervals.length - 1 && run.pieces[i].kind === 'BENT') {
        const h = at(b, perp + hookPx)
        ctx.lineTo(h.x, h.y)
      }
      ctx.stroke()

      const straight = run.pieces[i].kind === 'BENT' ? run.pieces[i].lengthMm - r.settings.bendMm : run.pieces[i].lengthMm
      const mid = at((a + b) / 2, perp + (i % 2 === 0 ? -14 : 14) / s)
      drawLabel(ctx, fmt(straight), mid.x, mid.y, {
        fontPx: 10 / s,
        color,
        angle: isTate ? -Math.PI / 2 : 0,
      })
      if (i > 0) {
        const lapMid = at((a + Math.min(intervals[i - 1][1], run.band.runLengthMm)) / 2, 0)
        drawLabel(ctx, fmt(r.settings.lapMm), lapMid.x + (isTate ? 18 / s : 0), lapMid.y + (isTate ? 0 : 18 / s), {
          fontPx: 9 / s,
          color: '#64748b',
          angle: isTate ? -Math.PI / 2 : 0,
        })
      }
    })
    ctx.restore()

    const summaryPos = isTate
      ? toCanvas({ x: run.band.x0 + center, y: run.band.y0 + run.band.runLengthMm / 2 })
      : toCanvas({ x: run.band.x0 + run.band.runLengthMm / 2, y: run.band.y0 + center })
    const shift = 34 / s
    const sx = summaryPos.x + (isTate ? shift : 0)
    const sy = summaryPos.y + (isTate ? 0 : shift)
    const pieceText = run.pieces.map((p) => fmt(p.lengthMm)).join(' + ')
    drawLabel(ctx, `${r.settings.diameter} @${fmt(run.pitchMm)} × ${run.count}本`, sx, sy - 7 / s, {
      fontPx: 11 / s,
      color,
      bold: true,
    })
    drawLabel(ctx, pieceText, sx, sy + 7 / s, { fontPx: 10 / s, color })
  }

  if (opts.label) {
    const top = Math.min(...poly.map((p) => p.y))
    const left = Math.min(...poly.map((p) => p.x))
    ctx.save()
    ctx.font = `700 ${12 / s}px sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = '#0f172a'
    ctx.fillText(opts.label, left, top - 24 / s)
    ctx.restore()
  }
}
