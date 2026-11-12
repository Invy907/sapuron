// components/manufacture-list-view.tsx
//
// 製作図（切断リスト）レイアウト。手書きフィードバックの様式に合わせた表。
// 列: 製作図 / 長さ 呼称(実寸) / 数量  ※せん断補強筋・高さ・幅・単重・重量計は対象外。
//
// 既存の計算ロジックは変更せず、結果の「見せ方」だけを写真の様式に寄せる表示コンポーネント。
// 数量は既存「種類別サマリ」と同じく線分（部材）本数を集計する。

'use client'

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { DrawingSegment, Unit } from '@/lib/types/database'
import {
  UnitShapeThumbnail,
  type UnitShapeLegendPosition,
  type UnitShapeLegendPositions,
} from '@/components/unit-client'
import { CustomerDatePicker } from '@/components/customer-date-picker'
import { CustomerDateTimePicker } from '@/components/customer-datetime-picker'
import {
  getSegmentColor,
  getSegmentEffectiveLengthMm,
  resolveLinkedUnit,
} from '@/lib/segment-meta'
import { getPitchBaseCount, getUnitPitchMm } from '@/lib/unit-calculations'

/** 1 データ行の高さ(px)。全行を均一にし、約 48 行/ページを目安に収める */
const ROW_HEIGHT = 21
/** 1 製作図あたりの最小行数（数量の合計行を含む）。データ行が少ない場合は空行で埋めて形状の高さを確保
 *  （8 行 × 6 製作図 = 48 行 / ページ。データ行 7 + 合計行 1 が上限で、
 *   それを超える製作図はその分高くなり 1 ページ 6 未満になる） */
const MIN_ROWS_PER_BLOCK = 8
/** 列幅(px)。データ列だけ詰める。
 *  製作図は手書きフィードバックで「2cm ほど右に広く」と指示があり 260 → 336 にした
 *  （2cm ＝ 96dpi でおよそ 76px） */
const COL_SHAPE = 336
const COL_LEN = 118
const COL_QTY = 46
const COL_TATE = 54
/** 印刷時に自由記入メモを置く、表の右外に残る余白の幅(px)。
 *  A4 縦・左右余白 10mm で使える幅は約 698px、表は 554px なので右に約 144px 残る */
const RIGHT_COL_WIDTH = 140
/** ヘッダー（会社名・現場名）と表のあいだに空ける距離。印刷で 5mm ほど空ける指示 */
const HEADER_TABLE_GAP_MM = 5
/** 自由記入メモを置く、ヘッダー上端からのオフセット(px)。
 *  絶対配置なので、日付ブロックの高さを変えたらここも合わせる */
export const MEMO_BOX_TOP = 96
/** 印刷メモの左端を表の右端から離す距離(px)。表にくっついて見えないようにする */
export const MEMO_TABLE_GAP_PX = 32
/** 自由記入メモの文字サイズ(px)。利用者が −/＋ で調整する */
export const MEMO_FONT_PX_MIN = 9
export const MEMO_FONT_PX_MAX = 24
export const MEMO_FONT_PX_DEFAULT = 13
import {
  compareSegmentColorOrder,
  getSegmentColorLabelJa,
  getSegmentStrokeHex,
  normalizeSegmentColor,
  type SegmentColor,
} from '@/lib/segment-colors'

/** 会社名・現場名の文字サイズ(px)の上限と下限。上限は手書きの「文字大きく」に合わせた値。
 *  下限は、長い名前が右上の日付に重ならないところまで縮めるための値 */
const HEADER_FONT_PX_MAX = 32
const HEADER_FONT_PX_MIN = 8
/** A4 縦・左右余白 10mm で使える幅(px)。日付ブロックを除く前の値 */
const PRINT_CONTENT_WIDTH_PX = 698
/** 会社名・顧客名・現場住所のあいだ（gap-x-4 × 2）と、日付ブロックとのあいだ（gap-4） */
const HEADER_NAME_GAPS_PX = 32
const HEADER_COLUMN_GAP_PX = 16
/** 印刷の日付・時刻。手書きの「多少小さくしてよい」に合わせ、以前の 20px より小さくする */
const DATE_PRINT_FONT_PX = 16

/** 全角を 1em、半角を 0.5em として文字列の概算幅を出す */
function estimateEmWidth(text: string): number {
  let em = 0
  for (const ch of text) {
    // ASCII と半角カナだけ半分の幅として数える
    em += /[\u0020-\u007e\uff61-\uff9f]/.test(ch) ? 0.5 : 1
  }
  return em
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const

/** カレンダーで選んだ日を、印刷で使っている「R8.11.15（月）」の形にする */
function formatPrintedDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return ''
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const weekday = WEEKDAYS_JA[new Date(y, m - 1, d).getDay()] ?? ''
  const reiwa = y > 2019 || (y === 2019 && m >= 5)
  const era = reiwa ? `R${y - 2018}` : `H${y - 1988}`
  return `${era}.${m}.${d}（${weekday}）`
}

/** 印刷用の日付文字列（または旧データの ISO）から、カレンダーに渡す ISO を取り出す */
function isoFromPrintedDate(text: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.trim())
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const printed = /^(R|H)(\d+)\.(\d+)\.(\d+)/.exec(text.trim())
  if (!printed) return ''
  const year = (printed[1] === 'R' ? 2018 : 1988) + Number(printed[2])
  const month = Number(printed[3])
  const day = Number(printed[4])
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 到着日は 1 行目が日付、2 行目が時刻。空の行は印刷に出さない */
function joinArrival(dateLine: string, timeLine: string): string {
  const date = dateLine.trim()
  const time = timeLine.trim()
  if (date && time) return `${date}\n${time}`
  return date || time
}

/** 印刷の「R8.11.16（火） / 8:00予定」を、カレンダーモーダルの日時にする */
function dateTimeFromPrinted(value: string): string {
  const [dateLine = '', timeLine = ''] = value.split('\n')
  const iso = isoFromPrintedDate(dateLine)
  if (!iso) return ''
  const time = /^(\d{1,2}):(\d{2})/.exec(timeLine.trim())
  const hh = time ? time[1]!.padStart(2, '0') : '00'
  const mm = time ? time[2] : '00'
  return `${iso}T${hh}:${mm}`
}

/** カレンダーモーダルの日時を、印刷の日付と「8:00予定」の 2 行にする */
function printedFromDateTime(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return ''
  return joinArrival(formatPrintedDate(match[1]!), `${Number(match[2])}:${match[3]}予定`)
}

/** 画面の日付入力欄の幅(px)。入力欄はこの幅に固定し、名前の文字サイズもこの幅を空けて決める */
const SCREEN_DATE_FORM_PX = 240

/** 右上の日付ブロックの幅(px)。いちばん長い行に合わせ、名前がこの幅へ重ならないようにする */
function dateBlockWidthPx(
  date: string,
  arrival: string,
  showTsumikomi: boolean,
  reserveScreenForm: boolean,
): number {
  const lines = [
    ...(showTsumikomi ? [date.trim(), 'つみ込み'] : []),
    ...arrival.split('\n').map((line) => line.trim()),
  ].filter(Boolean)
  const em = lines.reduce((max, line) => Math.max(max, estimateEmWidth(line)), 6)
  const textWidth = Math.ceil(em * DATE_PRINT_FONT_PX)
  // 画面の入力欄は印刷の日付より広い。画面用の文字サイズだけ、その幅も空ける
  return reserveScreenForm ? Math.max(SCREEN_DATE_FORM_PX, textWidth) : textWidth
}

/**
 * 会社名・顧客名・現場住所を 1 行に収め、右上の日付と重ならない文字サイズ(px)。
 *
 * 長い名前だと 2 行目に折り返してしまうため、幅から逆算して必要なぶんだけ縮める
 * （手書き指示：2 行目にならない様に。もう少し字が小さくても可）。
 * 画面と印刷でずれないよう、実測ではなく印刷幅を基準にした固定計算にしている。
 */
function manufactureHeaderFontPx(
  company: string,
  name: string,
  address: string,
  date: string,
  arrival: string,
  showTsumikomi: boolean,
  reserveScreenForm: boolean,
): number {
  const em =
    estimateEmWidth(company || '会社名') +
    1 + // 様
    estimateEmWidth(name || '顧客名') +
    2 + // 様邸
    estimateEmWidth(address || '現場住所') +
    0.45 // 入力 3 つぶんの右パディング
  if (em <= 0) return HEADER_FONT_PX_MAX
  const available =
    PRINT_CONTENT_WIDTH_PX -
    HEADER_NAME_GAPS_PX -
    HEADER_COLUMN_GAP_PX -
    dateBlockWidthPx(date, arrival, showTsumikomi, reserveScreenForm)
  return Math.max(HEADER_FONT_PX_MIN, Math.min(HEADER_FONT_PX_MAX, Math.floor(available / em)))
}

function InputModeToggle({
  mode,
  onChange,
  label,
}: {
  mode: 'text' | 'calendar'
  onChange: (mode: 'text' | 'calendar') => void
  label: string
}) {
  const buttonClass = (active: boolean) =>
    `px-1.5 py-0.5 ${active ? 'bg-primary text-white' : 'bg-white text-muted hover:text-foreground'}`
  return (
    <span className="inline-flex overflow-hidden rounded border border-slate-300" role="group" aria-label={label}>
      <button type="button" className={buttonClass(mode === 'text')} aria-pressed={mode === 'text'} onClick={() => onChange('text')}>
        手打ち
      </button>
      <button
        type="button"
        className={buttonClass(mode === 'calendar')}
        aria-pressed={mode === 'calendar'}
        onClick={() => onChange('calendar')}
      >
        カレンダー
      </button>
    </span>
  )
}

export function clampMemoFontPx(value: number): number {
  if (!Number.isFinite(value)) return MEMO_FONT_PX_DEFAULT
  return Math.min(MEMO_FONT_PX_MAX, Math.max(MEMO_FONT_PX_MIN, Math.round(value)))
}

type ManufactureRow = {
  key: string
  /** 呼称（図面上の実効長さ, mm） */
  nominalMm: number
  /** 実寸（呼称 + 補正値, mm） */
  actualMm: number
  /** 数量（この長さの部材本数） */
  qty: number
  /** タテ筋本数（呼称 ÷ ピッチ、手入力で上書き可）。ピッチ未設定は null */
  tateCount: number | null
  /** 自動計算値（手入力リセット用） */
  autoTateCount: number | null
}

type ManufactureGroup = {
  key: string
  unit: Unit | null
  unitName: string
  color: SegmentColor
  colorHex: string
  /** ユニットのピッチ(mm)。タテ筋本数の計算に使う */
  pitchMm: number | null
  rows: ManufactureRow[]
  /** 数量の合計 = Σ 数量 */
  qtyTotal: number
  /** タテ筋の合計 = Σ (数量 × タテ筋)。ピッチ未設定の行は 0 として扱う */
  tateTotal: number
}

export type ManufactureLegendPositions = Record<string, UnitShapeLegendPositions>

function isPersistedUnitId(id: string): boolean {
  return !id.startsWith('mock-') && !id.startsWith('local-')
}

/**
 * 計算用のユニット解決（入力サマリと同じ挙動）。
 * 1. 線分に unit_id が付いていればそれ
 * 2. 未リンクなら同色・アクティブな永続化済みユニット
 */
function resolveUnitForSegment(
  seg: DrawingSegment,
  units: Unit[],
  color: SegmentColor,
): Unit | null {
  const linked = resolveLinkedUnit(seg, units)
  if (linked) return linked
  return (
    units.find(
      (u) =>
        u.is_active !== false &&
        isPersistedUnitId(u.id) &&
        normalizeSegmentColor(u.color) === color,
    ) ?? null
  )
}

export function buildManufactureGroups(
  segments: DrawingSegment[],
  units: Unit[],
  adjustmentMm: number,
): ManufactureGroup[] {
  const rebarSegments = segments.filter((s) => s.bar_type !== 'SPACING')

  type Acc = {
    group: ManufactureGroup
    byLength: Map<number, ManufactureRow>
  }
  const groups = new Map<string, Acc>()

  for (const seg of rebarSegments) {
    const color = getSegmentColor(seg, units)
    const unit = resolveUnitForSegment(seg, units, color)
    const nominalMm = getSegmentEffectiveLengthMm(seg, units)
    const groupKey = unit?.id
      ? `unit:${unit.id}`
      : `color:${color}:${seg.unit_name ?? seg.label ?? ''}`

    let acc = groups.get(groupKey)
    if (!acc) {
      acc = {
        group: {
          key: groupKey,
          unit,
          unitName:
            unit?.name?.trim() ||
            seg.unit_name?.trim() ||
            seg.label?.trim() ||
            getSegmentColorLabelJa(color),
          color,
          colorHex: getSegmentStrokeHex(color, false),
          pitchMm: getUnitPitchMm(unit),
          rows: [],
          qtyTotal: 0,
          tateTotal: 0,
        },
        byLength: new Map(),
      }
      groups.set(groupKey, acc)
    }

    const existing = acc.byLength.get(nominalMm)
    if (existing) {
      existing.qty += 1
    } else {
      const pitch = acc.group.pitchMm
      const actualMm = nominalMm + (adjustmentMm || 0)
      const autoTateCount =
        pitch != null && pitch > 0 ? getPitchBaseCount(nominalMm, pitch) : null
      acc.byLength.set(nominalMm, {
        key: `${groupKey}:${nominalMm}`,
        nominalMm,
        actualMm,
        qty: 1,
        tateCount: autoTateCount,
        autoTateCount,
      })
    }
  }

  return Array.from(groups.values())
    .map((acc) => {
      acc.group.rows = Array.from(acc.byLength.values()).sort(
        (a, b) => b.nominalMm - a.nominalMm,
      )
      acc.group.qtyTotal = acc.group.rows.reduce((sum, r) => sum + r.qty, 0)
      // 例: 7×12 + 1×11 + 3×9 = 122（材料取りの「× 122」と同じ値）
      acc.group.tateTotal = acc.group.rows.reduce(
        (sum, r) => sum + r.qty * (r.tateCount ?? 0),
        0,
      )
      return acc.group
    })
    .sort((a, b) => compareSegmentColorOrder(a.color, b.color))
}

/**
 * ユニット別の合計（数量 / タテ筋）。製作図リストの「計」行と材料取りで
 * 同じ値を使うため、集計は buildManufactureGroups の 1 か所に集約する。
 * タテ筋は実寸（呼称 + 補正値）で数えるので、呼び出し側と同じ adjustmentMm を
 * 渡さないと「計」と材料取りの本数が食い違う。
 */
/** 製作図リストの行 key に対するタテ筋手入力を反映し、計行を再計算する */
export function applyManufactureTateCountOverrides(
  groups: ManufactureGroup[],
  overrides: Readonly<Record<string, number>>,
): ManufactureGroup[] {
  if (Object.keys(overrides).length === 0) return groups
  return groups.map((group) => {
    const rows = group.rows.map((row) => {
      const raw = overrides[row.key]
      if (raw == null || !Number.isFinite(raw)) return row
      const n = Math.max(0, Math.floor(raw))
      return { ...row, tateCount: n }
    })
    const tateTotal = rows.reduce((sum, r) => sum + r.qty * (r.tateCount ?? 0), 0)
    return { ...group, rows, tateTotal }
  })
}

export function buildManufactureUnitTotals(
  segments: DrawingSegment[],
  units: Unit[],
  adjustmentMm: number,
  tateCountOverrides: Readonly<Record<string, number>> = {},
): Map<string, { qtyTotal: number; tateTotal: number }> {
  const totals = new Map<string, { qtyTotal: number; tateTotal: number }>()
  const groups = applyManufactureTateCountOverrides(
    buildManufactureGroups(segments, units, adjustmentMm),
    tateCountOverrides,
  )
  for (const group of groups) {
    if (!group.unit) continue
    totals.set(group.unit.id, {
      qtyTotal: group.qtyTotal,
      tateTotal: group.tateTotal,
    })
  }
  return totals
}

export function ManufactureListView({
  segments,
  units,
  adjustmentMm,
  customerCompany,
  onCustomerCompanyChange,
  customerName,
  onCustomerNameChange,
  customerAddress,
  onCustomerAddressChange,
  customerDate,
  onCustomerDateChange,
  showTsumikomi,
  onShowTsumikomiChange,
  customerArrival,
  onCustomerArrivalChange,
  customerMemo,
  onCustomerMemoChange,
  memoFontPx,
  onMemoFontPxChange,
  legendPositions = {},
  onLegendPositionChange,
  tateCountOverrides = {},
  onTateCountOverrideChange,
  tableOverlay,
  hidePrintMemo = false,
  groupRange,
  tableOnly = false,
}: {
  segments: DrawingSegment[]
  units: Unit[]
  adjustmentMm: number
  /** 行 key → 手入力タテ筋本数 */
  tateCountOverrides?: Record<string, number>
  onTateCountOverrideChange?: (rowKey: string, value: number | null) => void
  customerCompany: string
  onCustomerCompanyChange: (value: string) => void
  customerName: string
  onCustomerNameChange: (value: string) => void
  customerAddress: string
  onCustomerAddressChange: (value: string) => void
  customerDate: string
  onCustomerDateChange: (value: string) => void
  /** 印刷に積み込み日と「つみ込み」を出す。積み込みのときだけ必要 */
  showTsumikomi: boolean
  onShowTsumikomiChange: (value: boolean) => void
  customerArrival: string
  onCustomerArrivalChange: (value: string) => void
  customerMemo: string
  onCustomerMemoChange: (value: string) => void
  memoFontPx: number
  onMemoFontPxChange: (value: number) => void
  legendPositions?: ManufactureLegendPositions
  onLegendPositionChange?: (
    groupKey: string,
    diameter: string,
    position: UnitShapeLegendPosition,
  ) => void
  /** 表の左上に重ねて描くもの（印刷 1 ページ目へ移したカードの層） */
  tableOverlay?: ReactNode
  /** 印刷レイアウト画面ではメモを自由に動かせるカードとして別に描くので、ここでは出さない */
  hidePrintMemo?: boolean
  /**
   * 描くブロックの範囲（groups の添字。end は含まない）。印刷レイアウトで 1 ページ目に収まらない
   * ブロックを「続き」のカードへ分けるときに使う
   */
  groupRange?: { start: number; end?: number }
  /** 表だけを描く（見出しの会社名・メモなどは出さない）。「続き」のカード用 */
  tableOnly?: boolean
}) {
  const groups = useMemo(
    () =>
      applyManufactureTateCountOverrides(
        buildManufactureGroups(segments, units, adjustmentMm),
        tateCountOverrides,
      ),
    [segments, units, adjustmentMm, tateCountOverrides],
  )
  const shownGroups = groupRange ? groups.slice(groupRange.start, groupRange.end) : groups

  // 印刷メモを「表の右端〜用紙の右端」の余白の中央に置くため、表の幅を測る
  const [tableWidthPx, setTableWidthPx] = useState<number | null>(null)
  const observeTableWidth = useCallback((el: HTMLTableElement | null) => {
    if (!el) return
    const observer = new ResizeObserver(() => setTableWidthPx(el.offsetWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 文字サイズは行全体に inline style で当てる（Tailwind の text-* だと画面と印刷で
  // 別々の値になってしまい、1 行に収まる保証ができない）
  const headerFontArgs = [
    customerCompany,
    customerName,
    customerAddress,
    customerDate,
    customerArrival,
    showTsumikomi,
  ] as const
  const screenHeaderFontPx = manufactureHeaderFontPx(...headerFontArgs, true)
  const printHeaderFontPx = manufactureHeaderFontPx(...headerFontArgs, false)
  const [loadingDateMode, setLoadingDateMode] = useState<'text' | 'calendar'>('text')
  const [arrivalDateMode, setArrivalDateMode] = useState<'text' | 'calendar'>('text')
  const plainTextInputClass =
    'min-w-0 border-0 bg-transparent px-0 py-0 outline-none placeholder:text-muted/50 focus:underline focus:decoration-primary/40 print:border-transparent print:bg-transparent'
  const headerLabelClass = 'shrink-0 font-semibold text-foreground'

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted">
        製作図リストの対象となる線分がありません。
      </p>
    )
  }

  const headCell =
    'border border-slate-400 px-1 py-1 text-center text-sm font-semibold bg-slate-50'
  const dataCell =
    'border border-slate-400 px-1 font-mono text-[15px] leading-none tabular-nums'

  const table = (
    <table
      ref={observeTableWidth}
      className="border-collapse text-sm"
      style={{ tableLayout: 'fixed' }}
    >
      <colgroup>
        <col style={{ width: COL_SHAPE }} />
        <col style={{ width: COL_LEN }} />
        <col style={{ width: COL_QTY }} />
        <col style={{ width: COL_TATE }} />
      </colgroup>
      <thead>
        <tr>
          <th className={headCell}>製作図</th>
          <th className={headCell}>長さ 呼称(実寸)</th>
          <th className={headCell}>数量</th>
          <th className={headCell}>タテ筋</th>
        </tr>
      </thead>
      {shownGroups.map((g) => {
        // 合計行はデータ行の直後に 1 行入れる（残りは空行で埋める）
        const totalRowIndex = g.rows.length
        const rowSlots = Math.max(totalRowIndex + 1, MIN_ROWS_PER_BLOCK)
        const shapeCellHeight = rowSlots * ROW_HEIGHT
        return (
          <tbody key={g.key} data-group-key={g.key} className="break-inside-avoid">
            {Array.from({ length: rowSlots }, (_, idx) => {
              const r = g.rows[idx] ?? null
              const isTotalRow = idx === totalRowIndex
              return (
                <tr key={`${g.key}:${idx}`}>
                  {idx === 0 && (
                    <td
                      className="border border-slate-400 p-0 text-center align-middle"
                      rowSpan={rowSlots}
                    >
                      <div
                        className="flex flex-col items-center justify-center gap-0.5 px-1"
                        style={{ height: shapeCellHeight }}
                      >
                        {g.unit ? (
                          <div className="min-h-0 w-full flex-1">
                            <UnitShapeThumbnail
                              unit={g.unit}
                              large
                              containerClassName="relative h-full w-full"
                              legendPositions={legendPositions[g.key]}
                              onLegendPositionChange={
                                onLegendPositionChange
                                  ? (diameter, position) =>
                                      onLegendPositionChange(g.key, diameter, position)
                                  : undefined
                              }
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-muted">
                            （形状なし）
                          </span>
                        )}
                        <span className="shrink-0 text-[11px] font-semibold leading-none text-slate-700">
                          {g.unitName}
                        </span>
                      </div>
                    </td>
                  )}
                  <td
                    className={`${dataCell} text-right`}
                    style={{ height: ROW_HEIGHT }}
                  >
                    {r ? (
                      <>
                        <span
                          className="font-semibold"
                          style={{ color: g.colorHex }}
                        >
                          {r.nominalMm.toLocaleString('ja-JP')}
                        </span>
                        <span className="text-muted">
                          ({r.actualMm.toLocaleString('ja-JP')})
                        </span>
                      </>
                    ) : isTotalRow ? (
                      // 数量列の合計値と近づきすぎないよう右に少し余白を取る
                      <span className="pr-2 font-semibold text-slate-700">計</span>
                    ) : null}
                  </td>
                  <td
                    className={`${dataCell} text-center`}
                    style={{ height: ROW_HEIGHT }}
                  >
                    {r ? (
                      r.qty
                    ) : isTotalRow ? (
                      <span className="font-semibold">
                        {g.qtyTotal.toLocaleString('ja-JP')}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`${dataCell} text-center`}
                    style={{ height: ROW_HEIGHT }}
                  >
                    {r ? (
                      r.tateCount != null && onTateCountOverrideChange ? (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          aria-label={`${g.unitName} 呼称${r.nominalMm} のタテ筋本数`}
                          title={
                            r.autoTateCount != null
                              ? `自動: ${r.autoTateCount} 本`
                              : undefined
                          }
                          value={r.tateCount}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') {
                              onTateCountOverrideChange(r.key, null)
                              return
                            }
                            const n = Number.parseInt(raw, 10)
                            if (!Number.isFinite(n) || n < 0) return
                            onTateCountOverrideChange(r.key, n)
                          }}
                          className="w-full min-w-[2.5rem] border-0 bg-transparent px-0 py-0 text-center outline-none focus:underline focus:decoration-primary/40 print:border-transparent print:bg-transparent"
                        />
                      ) : (
                        (r.tateCount ?? '-')
                      )
                    ) : isTotalRow ? (
                      <span className="font-semibold">
                        {g.pitchMm != null && g.pitchMm > 0
                          ? g.tateTotal.toLocaleString('ja-JP')
                          : '-'}
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        )
      })}
    </table>
  )

  // 印刷レイアウトで次のページへ送った「続き」は、表だけをカードとして描く
  if (tableOnly) return <div className="manufacture-list-continued">{table}</div>

  return (
    <div className="manufacture-list-root relative space-y-3 print:space-y-0.5">
      <div className="manufacture-list-header relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 折り返すと 2 行目ができてしまうので nowrap にし、幅は文字サイズ側で合わせる */}
          <div
            className="manufacture-list-names flex max-w-full flex-nowrap items-center gap-x-4 whitespace-nowrap print:overflow-hidden"
            style={
              {
                fontSize: screenHeaderFontPx,
                '--manufacture-header-print-font': `${printHeaderFontPx}px`,
              } as CSSProperties
            }
          >
            <label className="inline-flex items-center gap-0.5">
              <AutoWidthInput
                value={customerCompany}
                onChange={onCustomerCompanyChange}
                placeholder="会社名"
                ariaLabel="会社名"
                minCh={3}
                maxCh={56}
                className={`${plainTextInputClass} font-semibold text-foreground`}
              />
              <span className={headerLabelClass}>様</span>
            </label>
            <label className="inline-flex items-center gap-0.5">
              <AutoWidthInput
                value={customerName}
                onChange={onCustomerNameChange}
                placeholder="顧客名"
                ariaLabel="顧客名"
                minCh={3}
                maxCh={48}
                className={`${plainTextInputClass} font-semibold text-foreground`}
              />
              <span className={headerLabelClass}>様邸</span>
            </label>
            <label className="inline-flex items-center gap-0.5">
              <AutoWidthInput
                value={customerAddress}
                onChange={onCustomerAddressChange}
                placeholder="現場住所"
                ariaLabel="現場住所"
                minCh={3}
                maxCh={64}
                className={`${plainTextInputClass} text-foreground`}
              />
            </label>
          </div>
        </div>
        {/* 画面では自由入力し、印刷時は入力したとおりに出す。
            幅は固定にする。中身に合わせて広がると、左の会社名・現場住所の上に重なって入力できなくなる */}
        <div
          className="flex shrink-0 flex-col items-end gap-1 text-sm print:hidden"
          style={{ width: SCREEN_DATE_FORM_PX }}
        >
          <label className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-foreground">
            <input
              type="checkbox"
              checked={showTsumikomi}
              onChange={(e) => onShowTsumikomiChange(e.target.checked)}
            />
            つみ込み（積み込み日を印刷）
          </label>
          {showTsumikomi ? (
            <div className="inline-flex items-center gap-1">
              <span className="whitespace-nowrap text-muted">積み込み日:</span>
              <InputModeToggle mode={loadingDateMode} onChange={setLoadingDateMode} label="積み込み日の入力方法" />
            </div>
          ) : null}
          {!showTsumikomi ? null : loadingDateMode === 'text' ? (
            <input
              type="text"
              value={customerDate}
              onChange={(e) => onCustomerDateChange(e.target.value)}
              aria-label="積み込み日"
              placeholder="R8.11.15（月）"
              className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-foreground outline-none placeholder:text-muted/50 focus:border-primary/60"
            />
          ) : (
            <div className="flex flex-col items-end gap-0.5">
              <CustomerDatePicker
                plain
                labelPrefix="積み込み日"
                value={isoFromPrintedDate(customerDate)}
                onChange={(iso) => onCustomerDateChange(formatPrintedDate(iso))}
              />
              {customerDate.trim() ? (
                <span className="text-xs text-foreground">{customerDate.trim()}</span>
              ) : null}
            </div>
          )}
          <div className="inline-flex items-center gap-1">
            <span className="whitespace-nowrap text-muted">到着日:</span>
            <InputModeToggle mode={arrivalDateMode} onChange={setArrivalDateMode} label="到着日の入力方法" />
          </div>
          {arrivalDateMode === 'text' ? (
            // 印刷では入力した改行の位置でそのまま改行する（自動では折り返さない）。
            // 画面でも折り返さずに見せ、長い行は横にスクロールする
            <textarea
              value={customerArrival}
              onChange={(e) => onCustomerArrivalChange(e.target.value)}
              aria-label="到着日"
              rows={Math.max(2, customerArrival.split('\n').length)}
              wrap="off"
              placeholder={'R8.11.9（月）\n8:00予定'}
              title="Enter で改行すると、印刷も同じ所で改行します"
              className="w-full resize-none overflow-x-auto rounded border border-slate-300 bg-white px-1.5 py-0.5 leading-snug text-foreground outline-none placeholder:text-muted/50 focus:border-primary/60"
            />
          ) : (
            <div className="flex flex-col items-end gap-0.5">
              <CustomerDateTimePicker
                plain
                labelPrefix="到着日"
                value={dateTimeFromPrinted(customerArrival)}
                onChange={(value) => onCustomerArrivalChange(printedFromDateTime(value))}
              />
              {customerArrival.trim() ? (
                <span className="whitespace-pre text-right text-xs text-foreground">
                  {customerArrival.trim()}
                </span>
              ) : null}
            </div>
          )}
        </div>
        <div className="hidden shrink-0 items-start leading-tight print:flex">
          {/* 手書き指示：予定（到着日）も積み込み日の左端にそろえる。
              改行は入力したところだけで行い、自動では折り返さない */}
          <div className="flex flex-col items-start">
            {/* 積み込み日・到着日は書式を変えず、入力したとおりに印刷する。
                「つみ込み」は日付の右に詰めず、次の行に置く（改行してよい、との指示） */}
            {showTsumikomi && customerDate.trim() ? (
              <div
                className="whitespace-nowrap font-bold leading-none"
                style={{ fontSize: DATE_PRINT_FONT_PX }}
              >
                {customerDate.trim()}
              </div>
            ) : null}
            {showTsumikomi ? (
              <div className="mt-0.5 whitespace-nowrap leading-none" style={{ fontSize: DATE_PRINT_FONT_PX }}>
                つみ込み
              </div>
            ) : null}
            {customerArrival.trim() ? (
              <div className="whitespace-pre font-bold" style={{ fontSize: DATE_PRINT_FONT_PX }}>
                {customerArrival.trim()}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* メモは結果ページから外した（予定は積み込み日の下にそろえて書く）。戻すときはここを外す
      {/- 予定・注意事項などを自由に書き込む欄。md 以上の幅は RIGHT_COL_WIDTH (140px) と揃える。
          絶対配置にしてヘッダーや表の高さに影響させない。
          画面が狭いと表に重なるので、md 未満では絶対配置を外してヘッダーの下に流す -/}
      <div
        className="rounded-md border border-dashed border-slate-300 bg-slate-50/80 px-2 py-1.5 shadow-sm focus-within:border-primary/50 focus-within:bg-primary/5 md:absolute md:right-0 md:w-[140px] print:hidden"
        style={{ top: MEMO_BOX_TOP }}
      >
        <div className="mb-1 flex items-center justify-between gap-1 text-xs text-muted">
          <span className="whitespace-nowrap">メモ</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onMemoFontPxChange(clampMemoFontPx(memoFontPx - 1))}
              disabled={memoFontPx <= MEMO_FONT_PX_MIN}
              aria-label="メモの文字を小さくする"
              className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white leading-none text-foreground disabled:opacity-40"
            >
              −
            </button>
            <span className="w-9 text-center tabular-nums">{memoFontPx}px</span>
            <button
              type="button"
              onClick={() => onMemoFontPxChange(clampMemoFontPx(memoFontPx + 1))}
              disabled={memoFontPx >= MEMO_FONT_PX_MAX}
              aria-label="メモの文字を大きくする"
              className="flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white leading-none text-foreground disabled:opacity-40"
            >
              ＋
            </button>
          </div>
        </div>
        <AutoGrowTextarea
          value={customerMemo}
          onChange={onCustomerMemoChange}
          ariaLabel="メモ"
          placeholder="予定・注意事項など"
          className="w-full text-foreground"
          textClass="leading-snug"
          style={{ fontSize: memoFontPx }}
        />
      </div>

      {/- 印刷では画面と同じ位置・同じ文字サイズでメモ本文だけを出す -/}
      {customerMemo.trim() && !hidePrintMemo ? (
        <div
          className="manufacture-memo-print absolute right-0 hidden whitespace-pre-wrap break-words text-center leading-snug print:block"
          style={{
            ...(tableWidthPx != null ? { left: tableWidthPx + MEMO_TABLE_GAP_PX } : { width: RIGHT_COL_WIDTH }),
            top: MEMO_BOX_TOP,
            fontSize: memoFontPx,
          }}
        >
          {customerMemo}
        </div>
      ) : null}
      */}

      {/* 会社名のヘッダーと表のあいだを空ける（手書き指示：5mm ぐらい）。
          margin だと親の space-y と競合するので padding で取る */}
      <div
        className="manufacture-list-table-wrap relative w-fit max-w-full"
        style={{ paddingTop: `${HEADER_TABLE_GAP_MM}mm` }}
      >
        {tableOverlay}
        {/* スクロールは付けない（overflow を付けると表の横に縦のスクロールバーが出る） */}
        <div>
        {table}
        </div>
      </div>
    </div>
  )
}

/**
 * 入力内容に合わせて高さが伸びる複数行入力。
 * 1 行入力だと長い文字が見えなくなるため、
 * 画面では折り返して全文を表示する（幅は className の w-* で指定）。
 * 高さは非表示のミラー要素に合わせるので JS でのリサイズは不要。
 */
function AutoGrowTextarea({
  value,
  onChange,
  ariaLabel,
  className,
  placeholder,
  textClass = 'text-sm leading-5',
  style,
}: {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  className: string
  placeholder?: string
  /** 文字サイズ・行送り。style で fontSize を渡すときは leading も合わせる */
  textClass?: string
  style?: CSSProperties
}) {
  const sharedTextClass = `whitespace-pre-wrap break-all ${textClass}`
  return (
    <span className={`inline-grid min-w-0 ${className}`} style={style}>
      {/* 末尾の改行や空文字でも 1 行分の高さを確保するため zero-width space を足す */}
      <span
        aria-hidden
        className={`invisible col-start-1 row-start-1 ${sharedTextClass}`}
      >
        {`${value}\u200b`}
      </span>
      <textarea
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={`col-start-1 row-start-1 w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-muted/50 ${sharedTextClass}`}
      />
    </span>
  )
}

function AutoWidthInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  minCh,
  maxCh,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
  minCh: number
  maxCh: number
  className: string
}) {
  const mirrorText = value || placeholder
  // 幅は「文字数 × ch」では日本語・韓国語などの全角文字に足りず、
  // 隣の「様」「様邸」と重なってしまう。実際に描画した文字幅（下の mirror）で
  // グリッド幅が決まるようにし、ch は最小・最大の目安だけに使う。
  return (
    <span
      className="auto-width-field inline-grid max-w-full"
      style={{ minWidth: `${minCh}ch`, maxWidth: `${maxCh}ch` }}
    >
      {/* 右パディングはキャレットが「様」に触れない最小限だけ。
          広いと名前と「様」のあいだが空きすぎる */}
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 whitespace-pre py-0 pl-0 pr-[0.15em] text-inherit font-semibold"
      >
        {mirrorText}
      </span>
      <input
        type="text"
        size={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`col-start-1 row-start-1 w-full min-w-0 overflow-x-auto ${className}`}
      />
    </span>
  )
}
