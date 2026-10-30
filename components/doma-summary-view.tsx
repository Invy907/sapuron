'use client'

import { useMemo } from 'react'
import type { DrawingDomaRun } from '@/lib/types/database'
import { layoutDomaRun, type SlabBarDirection } from '@/lib/slab-rebar'
import { DOMA_DIRECTION_COLORS } from '@/lib/doma-paint'

const DOMA_DIRECTION_LABEL: Record<SlabBarDirection, string> = { tate: 'タテ', yoko: 'ヨコ' }

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 図面の印刷用の集計。方向・径・曲げの数（片側・両側・なし）・曲げ長さごとに、長さと本数を並べる */
export type DomaPrintGroup = {
  direction: SlabBarDirection
  diameter: string
  bends: 0 | 1 | 2
  bendMm: number
  rows: Array<{ lengthMm: number; quantity: number }>
}

const PRINT_BENDS_ORDER = { 1: 0, 2: 1, 0: 2 } as const
const PRINT_DIRECTION_ORDER: Record<SlabBarDirection, number> = { tate: 0, yoko: 1 }

export function domaPrintGroupsOf(bars: DrawingDomaRun[]): DomaPrintGroup[] {
  const groups = new Map<string, DomaPrintGroup & { byLength: Map<number, number> }>()
  for (const bar of bars) {
    const layout = layoutDomaRun(bar.length_mm, bar.span_mm, bar.bends, bar.settings, bar.pieces_override)
    if (layout.count <= 0) continue
    for (const piece of layout.pieces) {
      const bends = (Number(piece.bendStart) + Number(piece.bendEnd)) as 0 | 1 | 2
      const bendMm = bends > 0 ? bar.settings.bendMm : 0
      const key = `${bar.direction}|${bar.settings.diameter}|${bends}|${bendMm}`
      let group = groups.get(key)
      if (!group) {
        group = {
          direction: bar.direction,
          diameter: bar.settings.diameter,
          bends,
          bendMm,
          rows: [],
          byLength: new Map(),
        }
        groups.set(key, group)
      }
      group.byLength.set(piece.lengthMm, (group.byLength.get(piece.lengthMm) ?? 0) + layout.count)
    }
  }
  return Array.from(groups.values())
    .map(({ byLength, ...group }) => ({
      ...group,
      rows: Array.from(byLength, ([lengthMm, quantity]) => ({ lengthMm, quantity })).sort(
        (a, b) => b.lengthMm - a.lengthMm,
      ),
    }))
    .sort(
      (a, b) =>
        PRINT_DIRECTION_ORDER[a.direction] - PRINT_DIRECTION_ORDER[b.direction] ||
        PRINT_BENDS_ORDER[a.bends] - PRINT_BENDS_ORDER[b.bends] ||
        a.diameter.localeCompare(b.diameter) ||
        a.bendMm - b.bendMm,
    )
}

/** 印刷の文字の大きさ。印刷画面では --sum-scale で拡大縮小する（プレビューは箱ごと transform） */
function domaSumPx(px: number): string {
  return `calc(${px}px * var(--sum-scale, 1))`
}

/**
 * 土間筋の印刷の数値。手書きの発注メモの形（径と形の図 → 「長さ mm ― 本数」）。
 * 形の図は片側曲げ「150┌───」、両側曲げ「150┌───┐150」、曲げなしは「直」を丸で囲む。
 * タテ・ヨコは見出しを付けて分ける。プレビューと印刷で同じ HTML を使う
 */
export function buildDomaPrintSummaryInnerHtml(groups: DomaPrintGroup[]): string {
  const ink = '#0f172a'
  const figure = (group: DomaPrintGroup): string => {
    if (group.bends === 0) {
      return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${domaSumPx(26)};height:${domaSumPx(26)};border:1.5px solid ${ink};border-radius:50%;font-size:${domaSumPx(15)};">直</span>`
    }
    const bend = escapeHtml(String(group.bendMm))
    const label = (x: number, anchor: string) =>
      `<text x="${x}" y="17" font-size="11" text-anchor="${anchor}" fill="${ink}">${bend}</text>`
    const path =
      group.bends === 2 ? 'M30 22 L30 4 L102 4 L102 22' : 'M30 22 L30 4 L124 4'
    const svg = `<svg viewBox="0 0 132 26" width="132" height="26" style="width:${domaSumPx(132)};height:${domaSumPx(26)};overflow:visible;"><path d="${path}" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/>${label(26, 'end')}${group.bends === 2 ? label(106, 'start') : ''}</svg>`
    return svg
  }
  return groups
    .map((group, i) => {
      const rows = group.rows
        .map(
          (row) =>
            `<div style="display:flex;align-items:baseline;gap:${domaSumPx(8)};white-space:nowrap;"><span style="min-width:${domaSumPx(44)};text-align:right;font-variant-numeric:tabular-nums;">${row.lengthMm}</span><span style="font-size:${domaSumPx(11)};color:#475569;">mm</span><span style="color:#94a3b8;">―</span><span style="font-variant-numeric:tabular-nums;">${row.quantity}</span><span style="font-size:${domaSumPx(12)};">本</span></div>`,
        )
        .join('')
      const newDirection = i === 0 || groups[i - 1]!.direction !== group.direction
      const heading = newDirection
        ? `<div style="${i > 0 ? `margin-top:${domaSumPx(16)};padding-top:${domaSumPx(10)};border-top:1px solid #cbd5e1;` : ''}margin-bottom:${domaSumPx(6)};font-size:${domaSumPx(15)};font-weight:700;color:${DOMA_DIRECTION_COLORS[group.direction]};">${DOMA_DIRECTION_LABEL[group.direction]}</div>`
        : ''
      return `${heading}<div style="${!newDirection ? `margin-top:${domaSumPx(10)};` : ''}"><div style="display:flex;align-items:center;gap:${domaSumPx(10)};margin-bottom:${domaSumPx(3)};"><span style="font-size:${domaSumPx(16)};font-weight:700;">${escapeHtml(group.diameter)}</span>${figure(group)}</div><div style="padding-left:${domaSumPx(10)};font-size:${domaSumPx(15)};line-height:1.35;">${rows}</div></div>`
    })
    .join('')
}

/**
 * 土間筋 集計結果。結果ページの材料取り（長さ表・フック付）の下に、同じカードで出す。
 * 図面の印刷と同じ形（タテ筋・ヨコ筋ごとに、径と形の図 → 「長さ mm ― 本数」）。
 */
export function DomaSummarySections({ runs }: { runs: DrawingDomaRun[] }) {
  const html = useMemo(
    () => buildDomaPrintSummaryInnerHtml(domaPrintGroupsOf(runs.filter((r) => r.kind === 'standard'))),
    [runs],
  )

  if (!html) return null

  return (
    // 材料取りの長さ表と同じ見た目・印刷の詰め方（print-bar-summary）にそろえる
    <div className="print-bar-summary rounded-lg border-2 border-primary bg-white p-5">
      <h2 className="mb-3 text-base font-semibold">土間筋</h2>
      <div className="font-semibold text-slate-900" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
