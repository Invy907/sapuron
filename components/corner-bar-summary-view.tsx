'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  aggregateAdditionalRebars,
  type AdditionalRebarGroup,
  type AdditionalRebarPlacementLike,
  type AdditionalRebarSpecRow,
} from '@/lib/corner-bar-summary'
import {
  CORNER_BAR_DIAMETERS,
  cornerBarSegmentLabelAnchors,
  cornerBarLayerMark,
  cornerBarThumbPoints,
  measurementTypeLabel,
  resolveCornerBarShape,
  type CornerBarShapeDef,
} from '@/lib/corner-bar-presets'

/**
 * 手書きの拾い出し資料と同じ考え方で仕分ける。
 *
 * ・コーナー筋・添え筋 → 径・寸法と本数（加工長行は出さない）
 * ・特殊コーナー筋 → D13（加工長）と本数（辺寸法は形状図）
 *
 * 全ての行を 1 つの <table> に入れる。カテゴリーごとに別の <table> にすると、
 * 見出し文字列の幅が違うせいで列がガタガタになる（表の列幅は table ごとに
 * 別々に決まるため）。1 つの表にまとめれば列は必ず揃う。
 *
 * 径が違えば別の鉄筋なので、本数の合計（コーナー筋の D13 と D10 を足す、等）は出さない。
 */

const DIAMETER_ORDER = new Map<string, number>(CORNER_BAR_DIAMETERS.map((d, i) => [d, i]))

const EMPTY_OVERRIDES: Readonly<Record<string, number>> = {}
const EMPTY_LABEL_OVERRIDES: Readonly<Record<string, string>> = {}

function diameterRank(diameter: string): number {
  return DIAMETER_ORDER.get(diameter.trim().toUpperCase()) ?? DIAMETER_ORDER.size
}

/** 資料は太い径から先に書くので、この画面だけ D13 → D10 の並びにする */
function compareDiameterDesc(a: string, b: string): number {
  return diameterRank(b) - diameterRank(a) || b.localeCompare(a)
}

/** 径ごとの標準寸法を持つ筋種類か */
function hasStandardSizes(category: string): boolean {
  return category === 'CORNER' || category === 'SOE'
}


/**
 * 表の 1 行。資料の書き方に合わせて 3 つのかたまりだけを持つ。
 *
 *   筋種類          鉄筋径・寸法                    加工長・本数
   *   コーナー筋      D13（600 × 600）                76本
 *   大コーナー      D10（700 × 700）                1380mm × 1
 *   曲筋 ※芯々     D13（600 × 455 × 115 × 600）    1710mm × 2
 *
 * 径と寸法、加工長と本数をそれぞれ 1 セルにまとめるのは、資料が
 * 「D10（700 × 700）」「1380㎜ × 1」という単位で書かれているため。
 * 列に分けると読む順番が資料と変わってしまう。
 *
 * group が変わる最初の行に isGroupStart を立てて、行間にすき間を入れる
 * （見出し行を別に持たず、1 行目の label にまとめて出すため）。
 */
interface SheetRow {
  key: string
  label: ReactNode
  isGroupStart: boolean
  /** 「D13」または「D13（600芯々 × 455内々…）」。径は本数行と同じ通常の太さ */
  spec: ReactNode
  /** 「76本」または「1380mm × 1」 */
  result: ReactNode
  /**
   * inline  … 鉄筋径・寸法と「○本」を同じ行に並べる（コーナー筋・添え筋）
   * stacked … 寸法を 1 行で出しきり、加工長×本数はその下の行に置く（特殊コーナー筋など）
   *
   * 寸法に辺ごとの基準を書くと横に長くなるので、本数と同じ行に収めると
   * 寸法のほうが折り返してしまう。寸法を優先して 1 行に保つための切り替え。
   */
  layout: 'inline' | 'stacked'
  /**
   * 形状図のセル。寸法が異なる鉄筋を見分けられるよう、特殊コーナー筋は
   * 集計行ごとにその行専用の図を描く。寸法を書かない行は空のセルを置く。
   */
  figure: { node: ReactNode; rowSpan: number } | 'empty' | 'skip'
}

/** 「600芯々 × 455内々 × …」。寸法基準は辺ごとに数字へ直結 */
function DimsText({ row }: { row: AdditionalRebarSpecRow }) {
  return <>{row.dimsDetailText || row.dimsText || '—'}</>
}

function SpecWithDiameter({ row }: { row: AdditionalRebarSpecRow }) {
  return (
    <>
      {cornerBarLayerMark(row.layer)}
      {row.diameter}
      <span className="text-muted">（</span>
      <DimsText row={row} />
      <span className="text-muted">）</span>
    </>
  )
}

function autoKakouchouOf(row: AdditionalRebarSpecRow): number | null {
  return row.kakouchouMm ?? row.segmentSumMm
}

/**
 * 加工長の手入力欄。入力中に空欄を挟んでも自動値へ戻らないよう、
 * 確定（フォーカスを外す / Enter）まではローカルの文字列で持つ。
 * 空欄または自動値と同じ値で確定すると手入力を解除する。
 */
function KakouchouInput({
  autoMm,
  overrideMm,
  onChange,
  label,
}: {
  autoMm: number | null
  overrideMm: number | undefined
  onChange: (value: number | null) => void
  label: string
}) {
  const shown = overrideMm ?? autoMm
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? (shown == null ? '' : String(shown))

  const commit = () => {
    if (draft == null) return
    setDraft(null)
    const raw = draft.trim()
    if (raw === '') {
      onChange(null)
      return
    }
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n <= 0) return
    onChange(n === autoMm ? null : n)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      title={autoMm != null ? `自動: ${autoMm}（空欄で自動に戻す）` : undefined}
      placeholder="—"
      value={text}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
      style={{ width: `${Math.max(text.length, 1) + 0.5}ch` }}
      className={`border-0 bg-transparent p-0 text-center font-mono outline-none focus:underline focus:decoration-primary/40 ${
        overrideMm != null ? 'text-primary print:text-inherit' : ''
      }`}
    />
  )
}

/**
 * 本数の手入力欄。加工長と同じく確定まではローカルの文字列で持ち、
 * 空欄または集計値と同じ値で確定すると手入力を解除する。
 */
function QuantityInput({
  autoQuantity,
  overrideQuantity,
  onChange,
  label,
}: {
  autoQuantity: number
  overrideQuantity: number | undefined
  onChange: (value: number | null) => void
  label: string
}) {
  const shown = overrideQuantity ?? autoQuantity
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? String(shown)

  const commit = () => {
    if (draft == null) return
    setDraft(null)
    const raw = draft.trim()
    if (raw === '') {
      onChange(null)
      return
    }
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 0) return
    onChange(n === autoQuantity ? null : n)
  }

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        title={`集計: ${autoQuantity}（空欄で集計値に戻す）`}
        value={text}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
        style={{ width: `${Math.max(text.length, 1) + 0.5}ch` }}
        className={`border-0 bg-transparent p-0 text-center font-semibold outline-none focus:underline focus:decoration-primary/40 ${
          overrideQuantity != null ? 'text-primary print:text-inherit' : ''
        }`}
      />
      <span className="ml-1 text-sm font-normal text-muted">本</span>
    </>
  )
}

/**
 * 筋種類名（「コーナー筋」など）の手入力欄。加工長と同じく確定までは
 * ローカルの文字列で持ち、空欄または元の名前で確定すると手入力を解除する。
 * 全角文字は ch で幅を決められないので、同じ文字列を見えない span に置いて
 * 入力欄の幅をそれに合わせる。
 */
function LabelInput({
  defaultLabel,
  overrideLabel,
  onChange,
}: {
  defaultLabel: string
  overrideLabel: string | undefined
  onChange: (value: string | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? overrideLabel ?? defaultLabel

  const commit = () => {
    if (draft == null) return
    setDraft(null)
    const value = draft.trim()
    onChange(value === '' || value === defaultLabel ? null : value)
  }

  return (
    <span className="inline-grid align-baseline">
      <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">
        {text || defaultLabel}
      </span>
      <input
        type="text"
        aria-label={`${defaultLabel}の表示名`}
        title={`元の名前: ${defaultLabel}（空欄で元に戻す）`}
        placeholder={defaultLabel}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
        className={`col-start-1 row-start-1 w-full min-w-0 border-0 bg-transparent p-0 outline-none focus:underline focus:decoration-primary/40 ${
          overrideLabel != null ? 'text-primary print:text-inherit' : ''
        }`}
      />
    </span>
  )
}

/** 特殊コーナー筋: 括弧内は加工長のみ（辺寸法は形状図） */
function SpecWithKakouchou({
  row,
  overrideMm,
  onOverrideChange,
}: {
  row: AdditionalRebarSpecRow
  overrideMm?: number
  onOverrideChange?: (rowKey: string, value: number | null) => void
}) {
  const autoMm = autoKakouchouOf(row)
  const shown = overrideMm ?? autoMm
  return (
    <>
      {cornerBarLayerMark(row.layer)}
      {row.diameter}
      <span className="text-muted">（</span>
      {onOverrideChange ? (
        <KakouchouInput
          autoMm={autoMm}
          overrideMm={overrideMm}
          onChange={(value) => onOverrideChange(row.key, value)}
          label={`${row.categoryLabel} ${row.diameter} ${row.shapeLabel} の加工長`}
        />
      ) : (
        (shown ?? '—')
      )}
      <span className="text-muted">）</span>
    </>
  )
}

function buildSheetRows(
  groups: AdditionalRebarGroup[],
  kakouchouOverrides: Readonly<Record<string, number>>,
  onKakouchouOverrideChange: ((rowKey: string, value: number | null) => void) | undefined,
  labelOverrides: Readonly<Record<string, string>>,
  onLabelOverrideChange: ((rowKey: string, value: string | null) => void) | undefined,
  quantityOverrides: Readonly<Record<string, number>>,
  onQuantityOverrideChange: ((rowKey: string, value: number | null) => void) | undefined,
): SheetRow[] {
  const rows: SheetRow[] = []

  /** 本数。手入力できるときは入力欄、できないときは手入力した本数か集計値 */
  const quantityFor = (row: AdditionalRebarSpecRow): ReactNode =>
    onQuantityOverrideChange ? (
      <QuantityInput
        autoQuantity={row.quantity}
        overrideQuantity={quantityOverrides[row.key]}
        onChange={(value) => onQuantityOverrideChange(row.key, value)}
        label={`${row.categoryLabel} ${row.diameter} の本数`}
      />
    ) : (
      <QuantityText quantity={quantityOverrides[row.key] ?? row.quantity} />
    )

  /** 筋種類名。手入力できるときは入力欄、できないときは手入力した名前か元の名前 */
  const labelFor = (rowKey: string, defaultLabel: string): ReactNode =>
    onLabelOverrideChange ? (
      <LabelInput
        defaultLabel={defaultLabel}
        overrideLabel={labelOverrides[rowKey]}
        onChange={(value) => onLabelOverrideChange(rowKey, value)}
      />
    ) : (
      (labelOverrides[rowKey] ?? defaultLabel)
    )

  for (const group of groups) {
    if (hasStandardSizes(group.category)) {
      const sorted = [...group.specRows].sort(
        (a, b) =>
          compareDiameterDesc(a.diameter, b.diameter) ||
          a.dimsText.localeCompare(b.dimsText),
      )
      sorted.forEach((row, i) => {
        rows.push({
          key: row.key,
          label: labelFor(row.key, group.label),
          isGroupStart: i === 0,
          spec: <SpecWithDiameter row={row} />,
          result: quantityFor(row),
          layout: 'inline',
          figure: 'empty',
        })
      })
      continue
    }

    const dimsRows = [...group.specRows].sort(
      (a, b) =>
        compareDiameterDesc(a.diameter, b.diameter) ||
        (b.kakouchouMm ?? -1) - (a.kakouchouMm ?? -1) ||
        a.dimsText.localeCompare(b.dimsText),
    )
    if (dimsRows.length === 0) continue

    const blocks: Array<{ heading: string; rows: AdditionalRebarSpecRow[] }> = []
    const byShape = new Map<string, AdditionalRebarSpecRow[]>()
    for (const row of dimsRows) {
      const list = byShape.get(row.shapeType)
      if (list) list.push(row)
      else byShape.set(row.shapeType, [row])
    }
    for (const list of byShape.values()) {
      blocks.push({ heading: group.label, rows: list })
    }

    const showShapeFigure = group.category === 'SPECIAL_CORNER'

    for (const block of blocks) {
      block.rows.forEach((row, i) => {
        rows.push({
          key: row.key,
          label: labelFor(row.key, block.heading),
          isGroupStart: i === 0,
          spec: (
            <SpecWithKakouchou
              row={row}
              overrideMm={kakouchouOverrides[row.key]}
              onOverrideChange={onKakouchouOverrideChange}
            />
          ),
          result: quantityFor(row),
          layout: 'inline',
          figure:
            showShapeFigure
              ? {
                  node: <ShapeFigure row={row} />,
                  rowSpan: 1,
                }
              : 'empty',
        })
      })
    }
  }

  return rows
}

/**
 * 資料の手書きスケッチに当たる形状図。集計行ごとに 1 つ描き、各辺に寸法と寸法基準を書く。
 */
/** 形状図の viewBox・文字・余白の寸法（viewBox 単位） */
type FigureMetrics = {
  width: number
  height: number
  /** ラベルは path の外側に置くので、その分の余白を確保する。
   *  広げると形状が縮んで辺の中点どうしが近づくため、必要最小限にとどめる */
  pad: number
  /** ラベルの縁と自分の辺とのすき間 */
  labelGap: number
  /** 寸法の文字サイズ / 寸法基準の文字サイズ / 2 行目のずれ（倍率 1 のとき） */
  dimFont: number
  measurementFont: number
  lineDy: number
  /** ラベルが重なるときに試す文字の倍率。印刷は文字を小さくしない */
  labelScales: readonly number[]
}

/** 結果表の形状図は横長ボックスに収め、行の縦幅を抑える */
const SCREEN_FIGURE_METRICS: FigureMetrics = {
  width: 280,
  height: 120,
  pad: 27,
  labelGap: 3,
  dimFont: 14,
  measurementFont: 11,
  lineDy: 14,
  labelScales: [1, 0.85, 0.7, 0.6, 0.5],
}

/**
 * 印刷の形状図。幅は実際に置かれる幅（測った値）にして viewBox と 1:1 にし、
 * 寸法・寸法基準の文字を表の文字（14px、括弧内の加工長と同じ）と同じ大きさで印刷する。
 * 文字は小さくしない（重なりそうなときは外側へずらすだけ）。
 */
const PRINT_FIGURE_METRICS: FigureMetrics = {
  width: 280,
  height: 180,
  pad: 30,
  labelGap: 4,
  dimFont: 14,
  measurementFont: 14,
  lineDy: 16,
  labelScales: [1],
}
/**
 * 曲げの多い形状（2段階段・欠き込みなど）は文字を 14px にすると重なるので、
 * これまでどおり大きめの viewBox で描いて列の幅まで縮める（文字が重なるときは小さくする）
 */
const COMPACT_PRINT_FIGURE_METRICS: FigureMetrics = {
  width: 280,
  height: 180,
  pad: 30,
  labelGap: 4,
  dimFont: 20,
  measurementFont: 15,
  lineDy: 19,
  labelScales: [1, 0.85, 0.7, 0.6, 0.5],
}
const COMPACT_PRINT_SHAPE_TYPES: ReadonlySet<string> = new Set([
  'V_STEP2',
  'V_NOTCH',
  'V_STEP2_END',
  'V_NOTCH_SIDE',
])
/** 印刷の形状図の幅の範囲。広いカードでも図が大きくなりすぎないようにする */
const PRINT_FIGURE_MIN_WIDTH = 120
const PRINT_FIGURE_MAX_WIDTH = 320

/** 形状の線の太さ（viewBox 単位） */
const FIGURE_STROKE_WIDTH = 2.5

/** 文字幅の概算（em 比）。寸法は数字、寸法基準は「内々」などの全角 */
const DIGIT_WIDTH_EM = 0.6
const FULL_WIDTH_EM = 1
/** 字面の高さ（em 比）。上下の余白を除いたぶんだけ線に寄せられる */
const DIGIT_HEIGHT_EM = 0.72
const FULL_WIDTH_HEIGHT_EM = 0.88

function segmentLabelFor(row: AdditionalRebarSpecRow, index: number): string {
  const length = row.segments[index]?.lengthMm
  return length == null ? '—' : String(length)
}

function segmentMeasurementLabelFor(row: AdditionalRebarSpecRow, index: number): string {
  const measurementType = row.segments[index]?.measurementType
  return measurementType ? measurementTypeLabel(measurementType) : ''
}

/** 特殊コーナー等の縦長形状を、結果表では横長になる向きに回転する */
function pickSummaryFigureRotation(shape: CornerBarShapeDef, pad: number): number {
  let best = 0
  let bestScore = -1
  const probeSize = 160
  for (let rotation = 0; rotation < 4; rotation += 1) {
    const pts = cornerBarThumbPoints(
      shape,
      probeSize,
      probeSize,
      pad,
      rotation,
      false,
    )
    if (pts.length < 2) continue
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    const score = w / Math.max(h, 1)
    if (score > bestScore) {
      bestScore = score
      best = rotation
    }
  }
  return best
}

type LabelAnchor = { index: number; x: number; y: number; mx: number; my: number }

function bitCount(value: number): number {
  let count = 0
  for (let v = value; v > 0; v >>= 1) count += v & 1
  return count
}

/** 倍率 scale のときの各ラベルの縦横の半分の大きさ */
function labelHalfSizes(
  textLines: string[][],
  metrics: FigureMetrics,
  scale: number,
): { halfWidth: number[]; halfHeight: number[] } {
  const halfWidth = textLines.map((lines) => {
    const dimWidth = (lines[0]?.length ?? 1) * metrics.dimFont * DIGIT_WIDTH_EM
    const measurementWidth =
      (lines[1]?.length ?? 0) * metrics.measurementFont * FULL_WIDTH_EM
    return (Math.max(dimWidth, measurementWidth) * scale) / 2 + 1
  })
  // 2 行のときは 1 行目と 2 行目の中心が lineDy 離れ、その上下に字面の半分ずつ載る
  const digitHeight = metrics.dimFont * DIGIT_HEIGHT_EM
  const measurementHeight = metrics.measurementFont * FULL_WIDTH_HEIGHT_EM
  const halfHeight = textLines.map((lines) =>
    lines.length > 1
      ? ((metrics.lineDy + (digitHeight + measurementHeight) / 2) / 2) * scale
      : (digitHeight / 2) * scale,
  )
  return { halfWidth, halfHeight }
}

/**
 * 辺の中点から外向きへ、ラベルの枠が自分の辺にかからない距離だけずらす。
 * 横の辺ならラベルの高さの半分、縦の辺なら幅の半分に gap を足した距離になる。
 */
function offsetAnchors(
  anchors: LabelAnchor[],
  halfWidth: number[],
  halfHeight: number[],
  gap: number,
): LabelAnchor[] {
  return anchors.map((anchor, i) => {
    const dx = anchor.x - anchor.mx
    const dy = anchor.y - anchor.my
    const len = Math.hypot(dx, dy) || 1
    const nx = dx / len
    const ny = dy / len
    const distance = Math.abs(nx) * halfWidth[i]! + Math.abs(ny) * halfHeight[i]! + gap
    return { ...anchor, x: anchor.mx + nx * distance, y: anchor.my + ny * distance }
  })
}

/**
 * 寸法ラベルが互いに重ならず、他の辺にもかからない置き方を探す。
 *
 * まず全ラベルを形状の外側に置き、重なるときは内側へ回すラベルが少ない順に試す。
 * 2段階段のように隣り合う短い辺のラベルが同じ角へ寄る形状でも、
 * 片方を反対側へ回せば数字で書ける。どの組み合わせでも収まらなければ null。
 */
function resolveLabelAnchors(
  anchors: LabelAnchor[],
  textLines: string[][],
  points: Array<{ x: number; y: number }>,
  metrics: FigureMetrics,
  scale = 1,
): LabelAnchor[] | null {
  const { halfWidth, halfHeight } = labelHalfSizes(textLines, metrics, scale)
  const gap = metrics.labelGap * scale
  const outside = offsetAnchors(anchors, halfWidth, halfHeight, gap)

  const fits = (candidate: LabelAnchor[]): boolean => {
    for (let i = 0; i < candidate.length; i += 1) {
      const a = candidate[i]!
      for (let j = i + 1; j < candidate.length; j += 1) {
        const b = candidate[j]!
        if (
          Math.abs(a.x - b.x) < halfWidth[i]! + halfWidth[j]! &&
          Math.abs(a.y - b.y) < halfHeight[i]! + halfHeight[j]!
        ) {
          return false
        }
      }
      // 自分の辺からはラベルの大きさ分だけ離しているので判定しない。
      // 他の辺は線の太さの半分だけ外側まで判定し、文字が線に触れて見えないようにする
      const clearance = FIGURE_STROKE_WIDTH / 2
      for (let k = 0; k < points.length - 1; k += 1) {
        if (k === a.index) continue
        const p1 = points[k]!
        const p2 = points[k + 1]!
        if (
          Math.max(p1.x, p2.x) > a.x - halfWidth[i]! - clearance &&
          Math.min(p1.x, p2.x) < a.x + halfWidth[i]! + clearance &&
          Math.max(p1.y, p2.y) > a.y - halfHeight[i]! - clearance &&
          Math.min(p1.y, p2.y) < a.y + halfHeight[i]! + clearance
        ) {
          return false
        }
      }
    }
    return true
  }

  const masks = Array.from({ length: 1 << outside.length }, (_, mask) => mask).sort(
    (a, b) => bitCount(a) - bitCount(b) || a - b,
  )
  for (const mask of masks) {
    const candidate = outside.map((anchor, i) =>
      (mask >> i) & 1
        ? { ...anchor, x: 2 * anchor.mx - anchor.x, y: 2 * anchor.my - anchor.y }
        : anchor,
    )
    if (fits(candidate)) return candidate
  }
  return null
}

/**
 * 重ならない置き方が見つかる最大の文字倍率を選ぶ。
 * 最小倍率でも収まらない場合も、最小倍率・外側配置で寸法を書く。
 */
function layoutLabels(
  anchors: LabelAnchor[],
  textLines: string[][],
  points: Array<{ x: number; y: number }>,
  metrics: FigureMetrics,
): { anchors: LabelAnchor[]; scale: number } {
  for (const scale of metrics.labelScales) {
    const placed = resolveLabelAnchors(anchors, textLines, points, metrics, scale)
    if (placed) return { anchors: placed, scale }
  }
  const scale = metrics.labelScales[metrics.labelScales.length - 1] ?? 1
  const { halfWidth, halfHeight } = labelHalfSizes(textLines, metrics, scale)
  return {
    anchors: offsetAnchors(anchors, halfWidth, halfHeight, metrics.labelGap * scale),
    scale,
  }
}

/** 画面用と印刷用の形状図を両方描き、媒体に応じて片方だけ見せる */
function ShapeFigure({ row }: { row: AdditionalRebarSpecRow }) {
  // 印刷用は置かれた幅を測り、その幅で描いて文字が縮まないようにする。
  // 印刷レイアウト画面のシートの中で測れる（測る前は既定の幅で描き、CSS で縮める）
  const [printWidth, setPrintWidth] = useState<number | null>(null)
  const observePrintBox = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w <= 0) return
      setPrintWidth(
        Math.round(Math.min(PRINT_FIGURE_MAX_WIDTH, Math.max(PRINT_FIGURE_MIN_WIDTH, w))),
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const compact = COMPACT_PRINT_SHAPE_TYPES.has(row.shapeType)
  const printMetrics = compact
    ? COMPACT_PRINT_FIGURE_METRICS
    : printWidth
      ? {
          ...PRINT_FIGURE_METRICS,
          width: printWidth,
          // 高さも幅に合わせて縮め、曲げの多い形状（列の幅まで縮める図）と行の高さを揃える
          height: Math.round(
            (printWidth * COMPACT_PRINT_FIGURE_METRICS.height) / COMPACT_PRINT_FIGURE_METRICS.width,
          ),
        }
      : PRINT_FIGURE_METRICS

  return (
    <>
      <div className="print:hidden">
        <ShapeFigureSvg row={row} metrics={SCREEN_FIGURE_METRICS} />
      </div>
      <div
        ref={compact ? undefined : observePrintBox}
        className={`hidden print:block ${compact ? 'corner-summary-figure-fit' : ''}`}
      >
        <ShapeFigureSvg row={row} metrics={printMetrics} />
      </div>
    </>
  )
}

function ShapeFigureSvg({
  row,
  metrics,
}: {
  row: AdditionalRebarSpecRow
  metrics: FigureMetrics
}) {
  // くの字は行ごとの角度で描く
  const shape = resolveCornerBarShape(
    row.shapeType,
    row.bendAngleDeg != null ? [{ bendAngleDeg: row.bendAngleDeg }] : undefined,
  )
  if (!shape) return null

  const rotation = pickSummaryFigureRotation(shape, metrics.pad)
  const points = cornerBarThumbPoints(
    shape,
    metrics.width,
    metrics.height,
    metrics.pad,
    rotation,
    false,
  )
  if (points.length < 2) return null

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  // 外向きの向きだけ受け取り、中点からの距離は layoutLabels がラベルの大きさで決める
  const anchors = cornerBarSegmentLabelAnchors(points, 1)
  const dimTexts = anchors.map((anchor) => segmentLabelFor(row, anchor.index))
  const measurementTexts = anchors.map((anchor) =>
    segmentMeasurementLabelFor(row, anchor.index),
  )
  const labelLines = dimTexts.map((dimension, index) =>
    measurementTexts[index] ? [dimension, measurementTexts[index]!] : [dimension],
  )
  const { anchors: drawnAnchors, scale } = layoutLabels(
    anchors,
    labelLines,
    points,
    metrics,
  )
  const lineDy = metrics.lineDy * scale

  return (
    <div className="corner-summary-figure flex flex-col items-start">
      <svg
        width={metrics.width}
        height={metrics.height}
        viewBox={`0 0 ${metrics.width} ${metrics.height}`}
        // 余白を詰めているので、端の寸法ラベルが切れないように外へはみ出させる
        overflow="visible"
        role="img"
        aria-label={`${shape.label}の形状`}
      >
        <path
          d={path}
          fill="none"
          stroke="#0f172a"
          strokeWidth={FIGURE_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 曲げの位置が分かるように節点に小さな印を打つ */}
        {points.slice(1, -1).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#0f172a" />
        ))}
        {drawnAnchors.map((anchor, i) => (
          <text
            key={anchor.index}
            x={anchor.x}
            y={measurementTexts[i] ? anchor.y - lineDy / 2 : anchor.y}
            textAnchor="middle"
            // middle だと数字が上に寄るので、数字も漢字も字面の中心が揃う central にする
            dominantBaseline="central"
            fontSize={metrics.dimFont * scale}
            fill="#0f172a"
          >
            <tspan x={anchor.x}>{dimTexts[i]}</tspan>
            {measurementTexts[i] ? (
              <tspan
                x={anchor.x}
                dy={lineDy}
                fontSize={metrics.measurementFont * scale}
                fontWeight={400}
                fill="#0f172a"
              >
                {measurementTexts[i]}
              </tspan>
            ) : null}
          </text>
        ))}
      </svg>
    </div>
  )
}

/** 寸法を書かない行の「76本」 */
function QuantityText({ quantity }: { quantity: number }) {
  return (
    <>
      <span className="font-semibold">{quantity.toLocaleString('ja-JP')}</span>
      <span className="ml-1 text-sm font-normal text-muted">本</span>
    </>
  )
}

const labelCell = 'py-2 pr-4 align-baseline whitespace-nowrap'
/** 径・寸法と本数の間は詰め、形状図列に余白を逃がす */
const specCell = 'py-2 pr-2 align-baseline whitespace-nowrap font-mono'
const qtyCell = 'py-2 pl-1 pr-6 align-baseline whitespace-nowrap font-mono text-left'
const dataCell = 'py-2 pr-6 align-baseline whitespace-nowrap'
/**
 * table-layout: auto の古典的なトリック。幅を「1%」にすると、その列は
 * 中身がぴったり収まる最小幅まで縮む（nowrap と組み合わせたときだけ効く）。
 * 鉄筋径・本数も 1% にし、余った幅は形状図列へ流す。
 */
const shrinkCell = { width: '1%' }

/**
 * 全筋種類・全行を 1 つの表に入れる。列幅は表全体で共有されるので、
 * 「コーナー筋」「添え筋」のように見出しの長さが違っても鉄筋径・本数は必ず縦に揃う。
 *
 * 筋種類名は 〃 に省略せず、行ごとに毎回そのまま出す。グループの最初の行だけ
 * 上の余白を広くして、見た目の区切りをつける。
 */
function SheetTable({ rows }: { rows: SheetRow[] }) {
  const hasAnyFigure = rows.some((r) => typeof r.figure === 'object')

  return (
    <table className="w-auto max-w-full border-collapse text-lg">
      <tbody className="divide-y divide-border">
        {rows.map((row) => {
          const pad = row.isGroupStart ? 'pt-4' : 'pt-2'
          return (
            <tr key={row.key}>
              <td style={shrinkCell} className={`${labelCell} ${pad}`}>
                {row.label}
              </td>
              {row.layout === 'stacked' ? (
                // 寸法を 1 行で出しきるため、本数の列まで使って縦に積む
                <td colSpan={2} className={`${dataCell} font-mono ${pad}`}>
                  <div className="corner-summary-dims">{row.spec}</div>
                  <div>{row.result}</div>
                </td>
              ) : (
                <>
                  <td style={shrinkCell} className={`${specCell} ${pad}`}>
                    {row.spec}
                  </td>
                  <td style={shrinkCell} className={`${qtyCell} ${pad}`}>
                    {row.result}
                  </td>
                </>
              )}
              {hasAnyFigure && typeof row.figure === 'object' && (
                <td
                  rowSpan={row.figure.rowSpan}
                  className="py-2 pl-4 align-top"
                >
                  {row.figure.node}
                </td>
              )}
              {hasAnyFigure && row.figure === 'empty' && (
                <td className={`${pad} py-2`} aria-hidden />
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * 付加筋 集計結果の本体。
 *
 * 切断最適化の結果ページの末尾に差し込んで使うので、戻るリンクや印刷ボタンは
 * 持たない（ページ側のものをそのまま使う）。
 */
export function CornerBarSummarySections({
  placements,
  kakouchouOverrides = EMPTY_OVERRIDES,
  onKakouchouOverrideChange,
  labelOverrides = EMPTY_LABEL_OVERRIDES,
  onLabelOverrideChange,
  quantityOverrides = EMPTY_OVERRIDES,
  onQuantityOverrideChange,
}: {
  placements: AdditionalRebarPlacementLike[]
  /** 集計行 key → 手入力した加工長(mm)。無い行は自動計算の値 */
  kakouchouOverrides?: Readonly<Record<string, number>>
  onKakouchouOverrideChange?: (rowKey: string, value: number | null) => void
  /** 集計行 key → 手入力した筋種類名。無い行は「コーナー筋」などの元の名前 */
  labelOverrides?: Readonly<Record<string, string>>
  onLabelOverrideChange?: (rowKey: string, value: string | null) => void
  /** 集計行 key → 手入力した本数。無い行は集計した本数 */
  quantityOverrides?: Readonly<Record<string, number>>
  onQuantityOverrideChange?: (rowKey: string, value: number | null) => void
}) {
  const summary = useMemo(() => aggregateAdditionalRebars(placements), [placements])
  const rows = useMemo(
    () =>
      buildSheetRows(
        summary.groups,
        kakouchouOverrides,
        onKakouchouOverrideChange,
        labelOverrides,
        onLabelOverrideChange,
        quantityOverrides,
        onQuantityOverrideChange,
      ),
    [
      summary,
      kakouchouOverrides,
      onKakouchouOverrideChange,
      labelOverrides,
      onLabelOverrideChange,
      quantityOverrides,
      onQuantityOverrideChange,
    ],
  )

  if (rows.length === 0) {
    return <p className="text-sm text-muted">付加筋がまだ配置されていません。</p>
  }

  return (
    <div className="corner-summary-print-root">
      <div className="corner-summary-section overflow-x-auto rounded-lg border-2 border-primary bg-white p-5">
        <SheetTable rows={rows} />
      </div>
    </div>
  )
}
