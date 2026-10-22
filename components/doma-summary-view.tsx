'use client'

import { useMemo } from 'react'
import type { DrawingDomaRun } from '@/lib/types/database'
import { aggregateSchedule, layoutDomaRun } from '@/lib/slab-rebar'

/**
 * 土間筋 集計結果。結果ページの材料取り（長さ表・フック付）の下に、同じカードで出す。
 * 径・形・長さごとに全部の土間筋（設置区間）を合算した本数（製作・発注に使う数）。
 */
export function DomaSummarySections({ runs }: { runs: DrawingDomaRun[] }) {
  const schedule = useMemo(
    () =>
      aggregateSchedule(
        runs
          .filter((r) => r.kind === 'standard')
          .map((run) => ({
            diameter: run.settings.diameter,
            runs: [layoutDomaRun(run.length_mm, run.span_mm, run.bends, run.settings, run.pieces_override)],
          })),
      ),
    [runs],
  )
  const total = schedule.reduce((sum, r) => sum + r.quantity, 0)

  if (schedule.length === 0) return null

  return (
    // 材料取りの長さ表と同じ見た目・印刷の詰め方（print-bar-summary）にそろえる
    <div className="print-bar-summary rounded-lg border-2 border-primary bg-white p-5">
      <p className="mb-3 text-xs text-muted">土間筋</p>
      <div className="overflow-x-auto">
        <table className="w-full text-lg">
          <thead>
            <tr className="border-b-2 border-border text-left">
              <th className="pb-2 pr-4 font-semibold">径</th>
              <th className="px-3 pb-2 font-semibold">形</th>
              <th className="px-3 pb-2 text-right font-semibold">長さ (mm)</th>
              <th className="px-3 pb-2 text-center font-semibold">本数</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {schedule.map((row) => (
              <tr key={`${row.diameter}-${row.kind}-${row.lengthMm}`}>
                <td className="py-2 pr-4 font-mono font-medium">{row.diameter}</td>
                <td className="px-3 py-2">{row.kind === 'BENT' ? '曲' : '直'}</td>
                <td className="px-3 py-2 text-right font-mono">{row.lengthMm.toLocaleString()}</td>
                <td className="px-3 py-2 text-center font-mono">{row.quantity}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="pr-4 pt-2" colSpan={3}>
                合計
              </td>
              <td className="px-3 pt-2 text-center font-mono">{total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
