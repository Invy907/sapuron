// components/print-layout-modal.tsx
'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * 印刷レイアウト画面。A4 縦の用紙 2 枚（1 ページ目＝製作図リスト、2 ページ目＝材料取り・
 * フック付・付加筋）を並べて見せ、カードをドラッグで 1 ページ目の余白へ移せる。
 * 印刷するときはこのシートだけを出すので、見えている配置がそのまま印刷される。
 *
 * 1 ページ目に置いたカードは、製作図リストの表の左上を原点とした px 座標で保存する。
 */

export type PrintCardId =
  | 'bar-summary'
  | 'hook-summary'
  | 'corner-bars'
  | 'special-corner-bars'
  | 'opening-bars'
  | 'manufacture-continued'
  | 'memo'

export type PrintCardPlacement = {
  /** 製作図リストの表の左上からの位置 (px) */
  x: number
  y: number
  /** カードの幅 (px) */
  w?: number
  /** カードの高さ (px)。辺をドラッグして決めたときだけ入る */
  h?: number
}

/**
 * 1 ページ目: 製作図リストの表の左上が原点。
 * 2 ページ目: 用紙の左上が原点（2 ページ目の位置は別に保存する）。
 */
export type PrintCardPlacements = Partial<Record<PrintCardId, PrintCardPlacement>>

type CardSize = { w?: number; h?: number }

/**
 * 余白に引く横線。線の上に文字を書ける（空のままなら手書き用の線になる）。
 * 位置はどちらのページも用紙の左上を原点とした px
 */
export type PrintLine = {
  id: string
  page: 1 | 2
  x: number
  y: number
  /** 線の長さ (px) */
  w: number
  text: string
}

/** 位置・大きさを決められる範囲（カードの左端の最小値と、右端の最大値） */
type CardBounds = { minX: number; maxRight: number; minY: number }

/** カードの拡大率（1 = 等倍）。中の文字や図ごと拡大・縮小する */
export type PrintCardZooms = Partial<Record<PrintCardId, number>>

export type PrintCard = {
  id: PrintCardId
  label: string
  node: ReactNode
  /** 1 ページ目にしか置けないもの（メモ）。2 ページ目へは戻らない */
  page1Only?: boolean
  /** 1 ページ目にしか置けないものの、まだ動かしていないときの位置。層（表の左上）から測る */
  defaultPlacement?: (layer: HTMLDivElement) => PrintCardPlacement | null
}

const PRINT_CARD_IDS: readonly PrintCardId[] = [
  'bar-summary',
  'hook-summary',
  'corner-bars',
  'special-corner-bars',
  'opening-bars',
  'manufacture-continued',
  'memo',
]
/** 2 ページ目の既定の並び（左列＝材料取り、残りは右列）。最初の位置を測るときだけ使う */
const LEFT_COLUMN_IDS: readonly PrintCardId[] = ['bar-summary', 'hook-summary']

/** A4 縦・左右余白 10mm の印刷幅 190mm (96dpi) */
const SHEET_WIDTH_PX = 718
/** A4 縦・上下余白 6mm の印刷高さ 285mm (96dpi) */
const SHEET_HEIGHT_PX = 1077
/** 1 ページ目の製作図リストは左右 10px の余白を持つ（globals.css） */
const SECTION_PADDING_X_PX = 10
/** 表の左端から見た用紙の右端 */
const SHEET_RIGHT_FROM_TABLE_PX = SHEET_WIDTH_PX - SECTION_PADDING_X_PX
/** 1 ページ目（原点は表の左上）。上方向は見出しにも重ねられる */
const PAGE1_BOUNDS: CardBounds = {
  minX: -SECTION_PADDING_X_PX,
  maxRight: SHEET_RIGHT_FROM_TABLE_PX,
  minY: -Infinity,
}
/** 2 ページ目（原点は用紙の左上） */
const PAGE2_BOUNDS: CardBounds = { minX: 0, maxRight: SHEET_WIDTH_PX, minY: 0 }
const SHEET_GAP_PX = 32
/** 次のページへ送ったカードと、そのページにもとからあるカードの間 */
const CARD_STACK_GAP_PX = 16
const MIN_CARD_WIDTH_PX = 80
const MIN_CARD_HEIGHT_PX = 40
const MIN_CARD_ZOOM = 0.5
const MAX_CARD_ZOOM = 2
/** −/＋ ボタン 1 回で変える拡大率 */
const CARD_ZOOM_STEP = 0.1
const MIN_LINE_WIDTH_PX = 40
const DEFAULT_LINE_WIDTH_PX = 320
/** 線の要素の上端から線（入力欄の下線）までの高さ。クリックした所に線が来るよう、この分だけ上に置く */
const LINE_BASELINE_PX = 19

/**
 * 罫線の上に書いた文字。page は 0 = 1 ページ目、1 = 2 ページ目…、row は上から何本目の罫線か（1 始まり）。
 * x はその罫線の区間で書き始めた位置 (px)。カードを動かして区間が変わっても同じ所に残す
 */
export type PrintRuleText = {
  id: string
  page: number
  row: number
  x: number
  text: string
}

/**
 * 余白全体に引く罫線（ノートの罫線のように、すべてのページの空いているところに等間隔の横線を引く）。
 * enabled: 引くかどうか、spacingMm: 線と線の間隔、strokePx: 線の太さ、texts: 罫線の上に書いた文字
 */
export type PrintRuleSettings = {
  enabled: boolean
  spacingMm: number
  strokePx: number
  texts: PrintRuleText[]
}

export const DEFAULT_PRINT_RULE_SETTINGS: PrintRuleSettings = {
  enabled: false,
  spacingMm: 8,
  strokePx: 0.5,
  texts: [],
}
const RULE_SPACING_OPTIONS_MM = [5, 6, 7, 8, 10, 12] as const
const RULE_STROKE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.5, label: '細い' },
  { value: 1, label: '普通' },
  { value: 1.5, label: '太い' },
]
const RULE_COLOR = '#94a3b8'
/** 96dpi の 1mm */
const PX_PER_MM = 96 / 25.4
/** 罫線を避けるもの（見出し・表・メモ・カード・余白の線） */
const RULE_OCCUPIED_SELECTOR = [
  '.manufacture-list-header',
  '.manufacture-list-table-wrap > div > table',
  '.manufacture-memo-print',
  '[data-print-card]',
  '[data-print-line]',
].join(', ')
/** 罫線と中身とのすき間（横・縦） */
const RULE_CLEARANCE_X_PX = 6
const RULE_CLEARANCE_Y_PX = 4
/** これより短い切れ端の罫線は引かない */
const MIN_RULE_SEGMENT_PX = 24

/** 罫線の上の文字の大きさの上限と、罫線の間隔に対する比 */
const RULE_TEXT_MAX_FONT_PX = 13
const RULE_TEXT_FONT_RATIO = 0.55
/** 文字の入力欄の高さの上限 */
const RULE_TEXT_MAX_HEIGHT_PX = 22
/** 文字と区間の左端とのすき間 */
const RULE_TEXT_PADDING_PX = 2

/** row: 上から何本目の罫線か（1 始まり）。間隔を変えても同じ行の文字が同じ行に残る */
type RuleRow = { row: number; y: number; segments: Array<[number, number]> }

/** 製作図リストのブロックがページの下端ぎりぎりのときに、念のため次のページへ送る余裕 (px) */
const PAGE_BREAK_SAFETY_PX = 2

/**
 * 1 ページ目の製作図リストで、ページの下に収まらない最初のブロックが何番目か（groups の添字）。
 * 全部収まっていれば null。先頭のブロックは収まらなくても送らない
 */
function findManufactureOverflowIndex(sheet: HTMLElement): number | null {
  const table = sheet.querySelector<HTMLElement>('.manufacture-list-table-wrap > div > table')
  if (!table) return null
  const sheetRect = sheet.getBoundingClientRect()
  if (sheetRect.width <= 0) return null
  const k = sheetRect.width / SHEET_WIDTH_PX
  const groups = Array.from(table.querySelectorAll<HTMLElement>(':scope > tbody[data-group-key]'))
  const index = groups.findIndex(
    (group, i) =>
      i > 0 &&
      (group.getBoundingClientRect().bottom - sheetRect.top) / k >
        SHEET_HEIGHT_PX - PAGE_BREAK_SAFETY_PX,
  )
  return index > 0 ? index : null
}

type FreeRect = { page: number; x: number; y: number; w: number; h: number }

/**
 * 2 ページ目以降で、置いてあるカードに重ならずに w × h のカードを置ける最初の場所
 * （上のページから、上から順・左から順に探す）。どこにも無ければ最後のカードの次のページの左上
 */
function findFreeCardSpot(rects: FreeRect[], w: number, h: number): { x: number; y: number } {
  const step = 8
  const lastPage = rects.reduce((max, r) => Math.max(max, r.page), 0)
  if (h <= SHEET_HEIGHT_PX && w <= SHEET_WIDTH_PX) {
    for (let page = 0; page <= lastPage; page++) {
      const onPage = rects.filter((r) => r.page === page)
      for (let y = 0; y + h <= SHEET_HEIGHT_PX; y += step) {
        for (let x = 0; x + w <= SHEET_WIDTH_PX; x += step) {
          const hit = onPage.some(
            (r) =>
              x < r.x + r.w + CARD_STACK_GAP_PX &&
              r.x < x + w + CARD_STACK_GAP_PX &&
              y < r.y + r.h + CARD_STACK_GAP_PX &&
              r.y < y + h + CARD_STACK_GAP_PX,
          )
          if (!hit) return { x, y: page * SHEET_HEIGHT_PX + y }
        }
      }
    }
  }
  return { x: 0, y: (lastPage + 1) * SHEET_HEIGHT_PX }
}

export function parsePrintCardPlacements(raw: string | null): PrintCardPlacements {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const placements: PrintCardPlacements = {}
    for (const id of PRINT_CARD_IDS) {
      const value = (parsed as Record<string, unknown>)[id]
      if (!value || typeof value !== 'object') continue
      const { x, y, w, h } = value as { x?: unknown; y?: unknown; w?: unknown; h?: unknown }
      if (typeof x !== 'number' || !Number.isFinite(x)) continue
      if (typeof y !== 'number' || !Number.isFinite(y)) continue
      placements[id] = { x, y, ...parseCardSize(w, h) }
    }
    return placements
  } catch {
    return {}
  }
}

export function parsePrintCardZooms(raw: string | null): PrintCardZooms {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const zooms: PrintCardZooms = {}
    for (const id of PRINT_CARD_IDS) {
      const value = (parsed as Record<string, unknown>)[id]
      if (typeof value === 'number' && Number.isFinite(value)) {
        zooms[id] = Math.min(MAX_CARD_ZOOM, Math.max(MIN_CARD_ZOOM, value))
      }
    }
    return zooms
  } catch {
    return {}
  }
}

export function parsePrintLines(raw: string | null): PrintLine[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
    return parsed.flatMap((value): PrintLine[] => {
      if (!value || typeof value !== 'object') return []
      const { id, page, x, y, w, text } = value as Record<string, unknown>
      if (typeof id !== 'string' || (page !== 1 && page !== 2)) return []
      if (!finite(x) || !finite(y) || !finite(w) || w <= 0) return []
      return [{ id, page, x, y, w, text: typeof text === 'string' ? text : '' }]
    })
  } catch {
    return []
  }
}

export function parsePrintRuleSettings(raw: string | null): PrintRuleSettings {
  if (!raw) return DEFAULT_PRINT_RULE_SETTINGS
  try {
    const parsed = JSON.parse(raw) as
      | (Partial<Record<keyof PrintRuleSettings, unknown>> & { pages?: unknown })
      | null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PRINT_RULE_SETTINGS
    // 以前はページを選んでいた（pages: 'none' 以外なら引く）
    const enabled =
      typeof parsed.enabled === 'boolean'
        ? parsed.enabled
        : typeof parsed.pages === 'string' && parsed.pages !== 'none'
    const spacingMm = RULE_SPACING_OPTIONS_MM.find((v) => v === parsed.spacingMm)
    const strokePx = RULE_STROKE_OPTIONS.find((o) => o.value === parsed.strokePx)?.value
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
    const texts = Array.isArray(parsed.texts)
      ? parsed.texts.flatMap((value): PrintRuleText[] => {
          if (!value || typeof value !== 'object') return []
          const { id, page, row, x, text } = value as Record<string, unknown>
          if (typeof id !== 'string' || typeof text !== 'string' || !text) return []
          if (!finite(page) || !finite(row) || !finite(x)) return []
          return [{ id, page, row, x, text }]
        })
      : []
    return {
      enabled,
      spacingMm: spacingMm ?? DEFAULT_PRINT_RULE_SETTINGS.spacingMm,
      strokePx: strokePx ?? DEFAULT_PRINT_RULE_SETTINGS.strokePx,
      texts,
    }
  } catch {
    return DEFAULT_PRINT_RULE_SETTINGS
  }
}

/**
 * 用紙の上の空いているところに引く罫線を求める。
 * 上から spacing ごとに横線を引き、見出し・表・カードなどにかかる区間だけ抜く
 */
function computeRuleRows(sheet: HTMLElement, spacing: number): RuleRow[] {
  const sheetRect = sheet.getBoundingClientRect()
  if (sheetRect.width <= 0) return []
  // 画面では用紙ごと縮小しているので、用紙の実寸 (px) に戻す
  const k = sheetRect.width / SHEET_WIDTH_PX
  const blocks = Array.from(sheet.querySelectorAll<HTMLElement>(RULE_OCCUPIED_SELECTOR))
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      left: (r.left - sheetRect.left) / k - RULE_CLEARANCE_X_PX,
      right: (r.right - sheetRect.left) / k + RULE_CLEARANCE_X_PX,
      top: (r.top - sheetRect.top) / k - RULE_CLEARANCE_Y_PX,
      bottom: (r.bottom - sheetRect.top) / k + RULE_CLEARANCE_Y_PX,
    }))
  const rows: RuleRow[] = []
  for (let row = 1; row * spacing <= SHEET_HEIGHT_PX - RULE_CLEARANCE_Y_PX; row += 1) {
    const y = row * spacing
    const covering = blocks
      .filter((b) => b.top < y && b.bottom > y)
      .sort((a, b) => a.left - b.left)
    const segments: Array<[number, number]> = []
    let start = 0
    for (const b of covering) {
      if (b.left - start >= MIN_RULE_SEGMENT_PX) segments.push([start, b.left])
      start = Math.max(start, b.right)
    }
    if (SHEET_WIDTH_PX - start >= MIN_RULE_SEGMENT_PX) segments.push([start, SHEET_WIDTH_PX])
    if (segments.length > 0) rows.push({ row, y: Math.round(y * 10) / 10, segments })
  }
  return rows
}

function parseCardSize(w: unknown, h: unknown): CardSize {
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
  return { ...(valid(w) ? { w } : {}), ...(valid(h) ? { h } : {}) }
}

type DropInfo = {
  id: PrintCardId
  cardRect: DOMRect
  clientX: number
  clientY: number
}

export function PrintLayoutModal({
  onClose,
  onPrint,
  placements,
  onPlacementChange,
  page2Placements,
  onPage2PlacementChange,
  zooms,
  onZoomChange,
  onResetPlacements,
  hasOtherLayoutChanges = false,
  renderPage1,
  cards,
  lines,
  onLinesChange,
  ruleSettings,
  onRuleSettingsChange,
  onManufactureOverflow,
}: {
  onClose: () => void
  onPrint: () => void
  /** 1 ページ目へ移したカードの位置・大きさ */
  placements: PrintCardPlacements
  onPlacementChange: (id: PrintCardId, placement: PrintCardPlacement | null) => void
  /** 2 ページ目のカードの位置・大きさ。カードごとに独立していて、ほかのカードを押しのけない */
  page2Placements: PrintCardPlacements
  onPage2PlacementChange: (id: PrintCardId, placement: PrintCardPlacement | null) => void
  zooms: PrintCardZooms
  onZoomChange: (id: PrintCardId, zoom: number | null) => void
  /** 1・2 ページ目の配置・拡大率・大きさをすべて元に戻す */
  onResetPlacements: () => void
  /** カードの中で変えたもの（付加筋の行の高さなど）があるか。あればリセットを押せる */
  hasOtherLayoutChanges?: boolean
  /**
   * 1 ページ目の中身。overlay は表の左上に重ねる層（1 ページ目へ移したカード）。
   * layeredIds は層に描いているカード。メモが入っていれば元のメモは出さない
   */
  renderPage1: (overlay: ReactNode, layeredIds: ReadonlySet<PrintCardId>) => ReactNode
  /**
   * 1 ページ目の製作図リストで、ページに収まらない最初のブロックの添字を知らせる。
   * 受け取った側はそこから後ろを「続き」のカード（manufacture-continued）にして 1 ページ目から外す。
   * 印刷レイアウトを閉じると null に戻す
   */
  onManufactureOverflow?: (index: number | null) => void
  /** 印刷するカード。表示できるものだけ渡す */
  cards: PrintCard[]
  /** 余白に引いた横線（配置のリセットでは消さない） */
  lines: PrintLine[]
  onLinesChange: (lines: PrintLine[]) => void
  /** 余白全体に引く罫線の設定 */
  ruleSettings: PrintRuleSettings
  onRuleSettingsChange: (settings: PrintRuleSettings) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sheet1Ref = useRef<HTMLDivElement | null>(null)
  const sheet2Ref = useRef<HTMLDivElement | null>(null)
  /**
   * 2 ページ目以降の用紙（[0] が 2 ページ目）。2 ページ目以降の配置は縦に続いた 1 つの座標で持ち、
   * y が SHEET_HEIGHT_PX ごとに次の用紙になる（y = 1100 なら 3 ページ目の上から 23px）
   */
  const freeSheetRefs = useRef<Array<HTMLDivElement | null>>([])
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [sheetHeights, setSheetHeights] = useState<[number, number]>([
    SHEET_HEIGHT_PX,
    SHEET_HEIGHT_PX,
  ])
  const [defaultPlacements, setDefaultPlacements] = useState<PrintCardPlacements>({})
  /** 「線を追加」を押して、線を置く場所のクリックを待っている */
  const [placingLine, setPlacingLine] = useState(false)
  const placingLineRef = useRef(false)
  useEffect(() => {
    placingLineRef.current = placingLine
  }, [placingLine])
  const cardsRef = useRef(cards)
  useEffect(() => {
    cardsRef.current = cards
  })

  // 2 枚の用紙が画面に収まる倍率にする（ドラッグ中にスクロールしなくて済むように）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const availW = el.clientWidth - 48
      // 上下の余白と「1ページ目」の見出しの分を引く
      const availH = el.clientHeight - 48 - 24
      setScale(
        Math.min(
          1,
          (availW - SHEET_GAP_PX) / (SHEET_WIDTH_PX * 2),
          availH / SHEET_HEIGHT_PX,
        ),
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 製作図リストが 1 ページに収まらないとき、ページの境目にかかるブロックから後ろを
  // 「続き」のカードにして次のページへ送る。送ったあとは 1 ページ目に収まるので、
  // 送る位置は前に戻らない（印刷レイアウトを開くたびに全部描いて測り直す）
  useEffect(() => {
    const sheet = sheet1Ref.current
    if (!sheet || !onManufactureOverflow) return
    const update = () => {
      const index = findManufactureOverflowIndex(sheet)
      if (index != null) onManufactureOverflow(index)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(sheet)
    return () => observer.disconnect()
  }, [onManufactureOverflow, scale])
  useEffect(() => () => onManufactureOverflow?.(null), [onManufactureOverflow])

  // 縮小表示の枠の高さに使うため、用紙の実際の高さ（中身が 1 ページを超えると伸びる）を測る
  useEffect(() => {
    const s1 = sheet1Ref.current
    const s2 = sheet2Ref.current
    if (!s1 || !s2) return
    const update = () => {
      setSheetHeights([s1.offsetHeight, s2.offsetHeight])
      // メモのように最初から 1 ページ目にあるものは、表の大きさが変わるたびに既定の位置を測り直す
      const layer = layerRef.current
      if (!layer) return
      const next: PrintCardPlacements = {}
      for (const card of cardsRef.current) {
        const placement = card.page1Only ? card.defaultPlacement?.(layer) : null
        if (placement) next[card.id] = placement
      }
      setDefaultPlacements((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(s1)
    observer.observe(s2)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 線を置く場所を選んでいるときは、それだけやめる
      if (placingLineRef.current) setPlacingLine(false)
      else onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  /** 1 ページ目の用紙が何ページ分か（製作図リストが長いと次のページへ続く） */
  const page1PageCount = Math.max(1, Math.ceil((sheetHeights[0] - 1) / SHEET_HEIGHT_PX))
  const page1OnlyIds = new Set(cards.filter((c) => c.page1Only).map((c) => c.id))
  const placementOf = (id: PrintCardId): PrintCardPlacement | undefined =>
    placements[id] ?? (page1OnlyIds.has(id) ? defaultPlacements[id] : undefined)

  const page1Cards = cards.filter((c) => placementOf(c.id))
  const page2Cards = cards.filter((c) => !c.page1Only && !placements[c.id])
  const page1Lines = lines.filter((l) => l.page === 1)
  const page2Lines = lines.filter((l) => l.page === 2)
  // 2 ページ目に線だけが残っていれば、線を印刷するために 2 ページ目も出す
  const page2Empty = page2Cards.length === 0 && page2Lines.length === 0
  // 2 ページ目に位置が決まっていないカードがあれば、いったん従来の 2 列の並びで描いて位置を測る
  const measuringPage2 = page2Cards.some((c) => !page2Placements[c.id])
  const page2CardIdsKey = page2Cards.map((c) => c.id).join(',')

  useEffect(() => {
    if (!measuringPage2) return
    const sheet = sheet2Ref.current
    if (!sheet) return
    // カードの offsetParent は用紙（position: relative）なので、offset* がそのまま用紙上の位置になる
    const els = Array.from(sheet.querySelectorAll<HTMLElement>('[data-print-card]'))
    // 置き場所の決まっているカードがあれば（あとから増えたカード）、それらに重ならない空いた所へ置く
    const placed: FreeRect[] = els.flatMap((el) => {
      const p = page2Placements[el.dataset.printCard as PrintCardId]
      if (!p) return []
      const page = pageIndexOf(p.y)
      const y = p.y - page * SHEET_HEIGHT_PX
      return [{ page, x: p.x, y, w: p.w ?? el.offsetWidth, h: p.h ?? el.offsetHeight }]
    })
    const anyPlaced = placed.length > 0
    for (const el of els) {
      const id = el.dataset.printCard as PrintCardId
      if (page2Placements[id]) continue
      const w = el.offsetWidth
      if (!anyPlaced) {
        onPage2PlacementChange(id, { x: el.offsetLeft, y: el.offsetTop, w })
        continue
      }
      const spot = findFreeCardSpot(placed, w, el.offsetHeight)
      onPage2PlacementChange(id, { ...spot, w })
      const page = pageIndexOf(spot.y)
      placed.push({ page, x: spot.x, y: spot.y - page * SHEET_HEIGHT_PX, w, h: el.offsetHeight })
    }
  }, [measuringPage2, onPage2PlacementChange, page2CardIdsKey, page2Placements])

  // 2 ページ目以降は、カードがあるいちばん後ろのページか、「ページを追加」で足したページまで用紙を出す
  const [addedFreePageCount, setAddedFreePageCount] = useState(1)
  const freePageCount = measuringPage2
    ? 1
    : Math.max(
        addedFreePageCount,
        ...page2Cards.map((c) => pageIndexOf(page2Placements[c.id]?.y ?? 0) + 1),
      )

  // 用紙の下からはみ出したカードは、次のページ（なければ作る）の上へ送る。
  // 次のページにカードがあれば、横が重なるカードの下に置く。ページより高いカードは動かさない
  useEffect(() => {
    if (measuringPage2) return
    const heights = new Map<PrintCardId, number>()
    for (const sheet of freeSheetRefs.current.slice(0, freePageCount)) {
      if (!sheet) continue
      for (const el of Array.from(sheet.querySelectorAll<HTMLElement>('[data-print-card]'))) {
        heights.set(el.dataset.printCard as PrintCardId, el.offsetHeight)
      }
    }
    for (const card of page2Cards) {
      const p = page2Placements[card.id]
      const h = heights.get(card.id)
      if (!p || h == null) continue
      const page = pageIndexOf(p.y)
      const localY = p.y - page * SHEET_HEIGHT_PX
      if (localY <= 0 || localY + h <= SHEET_HEIGHT_PX + 1) continue
      const w = p.w ?? 0
      for (let next = page + 1; next < page + 50; next++) {
        let top = 0
        for (const other of page2Cards) {
          const q = page2Placements[other.id]
          const qh = heights.get(other.id)
          if (other.id === card.id || !q || qh == null || pageIndexOf(q.y) !== next) continue
          const overlapsX = q.x < p.x + w && p.x < q.x + (q.w ?? 0)
          if (overlapsX) top = Math.max(top, q.y - next * SHEET_HEIGHT_PX + qh + CARD_STACK_GAP_PX)
        }
        if (top === 0 || top + h <= SHEET_HEIGHT_PX) {
          onPage2PlacementChange(card.id, { ...p, y: next * SHEET_HEIGHT_PX + top })
          return
        }
      }
    }
  }, [cards, freePageCount, measuringPage2, onPage2PlacementChange, page2Cards, page2Placements, zooms])

  // 罫線は空いているところにだけ引くので、カードや線を動かすたび・大きさが変わるたびに測り直す。
  // 印刷しない空のページには引かない
  const rulePage1 = ruleSettings.enabled
  const ruleRest = ruleSettings.enabled
  const ruledFreePages = Array.from({ length: freePageCount }, (_, page) =>
    ruleRest &&
    (page === 0
      ? !page2Empty
      : page2Cards.some((c) => pageIndexOf(page2Placements[c.id]?.y ?? 0) === page)),
  )
  const ruledFreePagesKey = ruledFreePages.join(',')
  const [ruleRows, setRuleRows] = useState<{ page1: RuleRow[]; free: RuleRow[][] }>({
    page1: [],
    free: [],
  })
  useEffect(() => {
    const ruled = ruledFreePagesKey.split(',').map((v) => v === 'true')
    const s1 = rulePage1 ? sheet1Ref.current : null
    const free = freeSheetRefs.current.map((el, page) => (ruled[page] ? el : null))
    const spacing = ruleSettings.spacingMm * PX_PER_MM
    const update = () => {
      setRuleRows({
        page1: s1 ? computeRuleRows(s1, spacing) : [],
        free: free.map((el) => (el ? computeRuleRows(el, spacing) : [])),
      })
    }
    update()
    const observer = new ResizeObserver(update)
    for (const sheet of [s1, ...free]) {
      if (!sheet) continue
      observer.observe(sheet)
      for (const el of Array.from(sheet.querySelectorAll(RULE_OCCUPIED_SELECTOR))) {
        observer.observe(el)
      }
    }
    return () => observer.disconnect()
  }, [
    rulePage1,
    ruledFreePagesKey,
    ruleSettings.spacingMm,
    placements,
    page2Placements,
    zooms,
    lines,
    measuringPage2,
    scale,
  ])

  /** 罫線の上の文字を書き換える。空にしたら消し、まだ無ければその区間の左端から書き始める */
  const setRuleText = (
    page: number,
    row: number,
    entry: PrintRuleText | undefined,
    x: number,
    text: string,
  ) => {
    const others = ruleSettings.texts.filter((t) => t.id !== entry?.id)
    onRuleSettingsChange({
      ...ruleSettings,
      texts: text
        ? [...others, { id: entry?.id ?? crypto.randomUUID(), page, row, x: entry?.x ?? x, text }]
        : others,
    })
  }

  /**
   * 罫線と、その上に文字を書く入力欄。罫線の区間ごとに 1 つ入力欄を置き、クリックすればそのまま書ける。
   * 区間が変わって（カードを動かすなど）どの区間にも入らなくなった文字も、消さずに元の位置に出す
   */
  const renderRules = (rows: RuleRow[] | undefined, page: number) => {
    if (!rows || rows.length === 0) return null
    const spacing = ruleSettings.spacingMm * PX_PER_MM
    const fontSize = Math.min(RULE_TEXT_MAX_FONT_PX, Math.round(spacing * RULE_TEXT_FONT_RATIO))
    const height = Math.min(RULE_TEXT_MAX_HEIGHT_PX, spacing - 2)
    const pageTexts = ruleSettings.texts.filter((t) => t.page === page)
    const placed = new Set<string>()
    const input = (
      key: string,
      left: number,
      width: number,
      y: number,
      entry: PrintRuleText | undefined,
      onText: (text: string) => void,
    ) => (
      <input
        key={key}
        type="text"
        value={entry?.text ?? ''}
        onChange={(e) => onText(e.target.value)}
        aria-label="罫線の上の文字"
        // 製作図リストの外枠（relative で用紙の幅いっぱい）より上に置く。下だと表の右の罫線をクリックできない。
        // 1 ページ目へ移したカード（z-10）・余白の線（z-20）よりは下
        className="absolute z-[5] border-0 bg-transparent p-0 leading-none text-[#0f172a] outline-none focus:bg-primary/5"
        style={{
          left,
          top: y - height,
          width,
          height,
          fontSize,
          paddingLeft: (entry ? entry.x - left : 0) + RULE_TEXT_PADDING_PX,
        }}
      />
    )
    const segmentInputs = rows.flatMap((row) =>
      row.segments.map(([a, b]) => {
        const entry = pageTexts.find((t) => t.row === row.row && t.x >= a - 1 && t.x < b)
        if (entry) placed.add(entry.id)
        return input(`${row.row}:${Math.round(a)}`, a, b - a, row.y, entry, (text) =>
          setRuleText(page, row.row, entry, a, text),
        )
      }),
    )
    const strayInputs = pageTexts
      .filter((t) => !placed.has(t.id) && t.row * spacing <= SHEET_HEIGHT_PX)
      .map((t) => {
        const width = Math.max(MIN_RULE_SEGMENT_PX, SHEET_WIDTH_PX - t.x)
        return input(t.id, t.x, width, t.row * spacing, t, (text) =>
          setRuleText(page, t.row, t, t.x, text),
        )
      })
    return (
      <>
        <svg
          aria-hidden
          className="pointer-events-none absolute left-0 top-0"
          width={SHEET_WIDTH_PX}
          height={SHEET_HEIGHT_PX}
        >
          <path
            d={rows
              .flatMap((row) =>
                row.segments.map(([a, b]) => `M${a.toFixed(1)} ${row.y}H${b.toFixed(1)}`),
              )
              .join('')}
            fill="none"
            stroke={RULE_COLOR}
            strokeWidth={ruleSettings.strokePx}
          />
        </svg>
        {segmentInputs}
        {strayInputs}
      </>
    )
  }

  const handleDrop = useCallback(
    ({ id, cardRect, clientX, clientY }: DropInfo) => {
      const page1Only = cardsRef.current.some((c) => c.id === id && c.page1Only)
      const current = placements[id] ?? (page1Only ? defaultPlacements[id] : undefined)
      const s1 = sheet1Ref.current?.getBoundingClientRect()
      const s2 = sheet2Ref.current?.getBoundingClientRect()
      const freeRects = freeSheetRefs.current
        .slice(0, freePageCount)
        .map((el) => el?.getBoundingClientRect())
      const layer = layerRef.current?.getBoundingClientRect()
      const inside = (r: DOMRect | undefined) =>
        r != null && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
      // 画面の縮小率は実際の用紙の幅から求める
      const k = (s1 ?? s2)?.width ? (s1 ?? s2)!.width / SHEET_WIDTH_PX : 1
      const h = cardRect.height / k
      if (inside(s1) && s1 && layer) {
        const w = current?.w ?? Math.round(cardRect.width / k)
        // 2 ページ目で高さを決めていたカードは、その高さのまま移す
        const fixedH = current?.h ?? page2Placements[id]?.h
        const top = (layer.top - s1.top) / k
        const x = (cardRect.left - layer.left) / k
        const y = (cardRect.top - layer.top) / k
        onPlacementChange(id, {
          x: Math.round(clampX(x, w, PAGE1_BOUNDS)),
          y: Math.round(Math.min(Math.max(-top, SHEET_HEIGHT_PX - top - h), Math.max(-top, y))),
          w,
          ...(fixedH != null ? { h: fixedH } : {}),
        })
        return
      }
      const page = freeRects.findIndex((r) => inside(r))
      const sheet = freeRects[page]
      if (page >= 0 && sheet && !page1Only) {
        const prev = page2Placements[id]
        const w = prev?.w ?? Math.round(cardRect.width / k)
        const fixedH = current?.h ?? prev?.h
        const x = (cardRect.left - sheet.left) / k
        const y = (cardRect.top - sheet.top) / k
        // 置いた用紙の中に収める（下にはみ出す位置には置かない）
        const localY = Math.min(Math.max(0, y), Math.max(0, SHEET_HEIGHT_PX - h))
        onPage2PlacementChange(id, {
          x: Math.round(clampX(x, w, PAGE2_BOUNDS)),
          y: Math.round(page * SHEET_HEIGHT_PX + localY),
          w,
          ...(fixedH != null ? { h: fixedH } : {}),
        })
        if (placements[id]) onPlacementChange(id, null)
      }
    },
    [
      defaultPlacements,
      freePageCount,
      onPage2PlacementChange,
      onPlacementChange,
      page2Placements,
      placements,
    ],
  )

  const updateLine = (id: string, patch: Partial<PrintLine>) => {
    onLinesChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  /** 1 ページ目の左下の余白に線を足す。続けて足すと前の線の上に並べる */
  /**
   * 「線を追加」のあと用紙をクリックした所に線を引く（線の左端・線の高さがクリックした点）。
   * カードの上でもカードは動かさずに線を置く
   */
  const placeLineAt = (page: 1 | 2, e: ReactPointerEvent<HTMLDivElement>) => {
    if (!placingLine || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const sheet = e.currentTarget.getBoundingClientRect()
    const k = sheet.width / SHEET_WIDTH_PX
    const w = DEFAULT_LINE_WIDTH_PX
    const x = (e.clientX - sheet.left) / k
    const y = (e.clientY - sheet.top) / k - LINE_BASELINE_PX
    onLinesChange([
      ...lines,
      {
        id: crypto.randomUUID(),
        page,
        x: Math.round(Math.min(SHEET_WIDTH_PX - w, Math.max(0, x))),
        y: Math.round(Math.min(SHEET_HEIGHT_PX - LINE_BASELINE_PX, Math.max(0, y))),
        w,
        text: '',
      },
    ])
    setPlacingLine(false)
  }

  /** 線を離した場所の用紙へ移す。用紙の外（または印刷しない 2 ページ目）なら元に戻す */
  const handleLineDrop = (id: string, lineRect: DOMRect, clientX: number, clientY: number) => {
    const line = lines.find((l) => l.id === id)
    if (!line) return
    const s1 = sheet1Ref.current?.getBoundingClientRect()
    const s2 = sheet2Ref.current?.getBoundingClientRect()
    const inside = (r: DOMRect | undefined) =>
      r != null && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
    const page: 1 | 2 | null = inside(s1)
      ? 1
      : inside(s2) && (!page2Empty || line.page === 2)
        ? 2
        : null
    const sheet = page === 1 ? s1 : page === 2 ? s2 : null
    if (!page || !sheet) return
    const k = sheet.width / SHEET_WIDTH_PX
    const w = Math.min(line.w, SHEET_WIDTH_PX)
    const x = (lineRect.left - sheet.left) / k
    const y = (lineRect.top - sheet.top) / k
    updateLine(id, {
      page,
      x: Math.round(Math.min(SHEET_WIDTH_PX - w, Math.max(0, x))),
      y: Math.round(Math.min(SHEET_HEIGHT_PX - lineRect.height / k, Math.max(0, y))),
      w,
    })
  }

  const renderLine = (line: PrintLine) => (
    <SheetLine
      key={line.id}
      line={line}
      scale={scale}
      onDrop={(rect, clientX, clientY) => handleLineDrop(line.id, rect, clientX, clientY)}
      onChange={(patch) => updateLine(line.id, patch)}
      onDelete={() => onLinesChange(lines.filter((l) => l.id !== line.id))}
    />
  )

  /** 拡大率を変える。幅・高さを決めてあるカードはそれも同じ比率で変える */
  const handleZoom = (id: PrintCardId, zoom: number, box: CardSize | null) => {
    onZoomChange(id, Math.abs(zoom - 1) < 0.005 ? null : zoom)
    if (box) handleBoxChange(id, box)
  }

  /** 辺のドラッグなどで決めた位置・大きさを、カードのいるページの配置に保存する */
  const handleBoxChange = (id: PrintCardId, box: Partial<PrintCardPlacement>) => {
    const p1 = placementOf(id)
    if (p1) {
      onPlacementChange(id, { ...p1, ...box })
      return
    }
    const p2 = page2Placements[id]
    if (p2) onPage2PlacementChange(id, { ...p2, ...box })
  }

  /** pageTop: 2 ページ目以降の続いた座標で、その用紙の上端の y。カードには用紙の中の位置で渡す */
  const renderCard = (
    card: PrintCard,
    box: PrintCardPlacement | undefined,
    bounds: CardBounds,
    pageTop = 0,
  ) => (
    <SheetCard
      key={card.id}
      card={card}
      box={box && pageTop ? { ...box, y: box.y - pageTop } : box}
      bounds={bounds}
      zoom={zooms[card.id] ?? 1}
      scale={scale}
      onDrop={handleDrop}
      onZoom={(z, size) => handleZoom(card.id, z, size)}
      onBoxChange={(next) =>
        handleBoxChange(card.id, next.y != null && pageTop ? { ...next, y: next.y + pageTop } : next)
      }
    />
  )

  const overlay = (
    <div
      ref={layerRef}
      className="absolute left-0 top-0 z-10 h-0"
      style={{ width: SHEET_RIGHT_FROM_TABLE_PX }}
    >
      {page1Cards.map((card) => renderCard(card, placementOf(card.id), PAGE1_BOUNDS))}
    </div>
  )

  const page2Left = page2Cards.filter((c) => LEFT_COLUMN_IDS.includes(c.id))
  const page2Right = page2Cards.filter((c) => !LEFT_COLUMN_IDS.includes(c.id))

  return createPortal(
    <div
      className="print-layout-portal fixed inset-0 z-[100] flex flex-col bg-slate-600"
      role="dialog"
      aria-modal="true"
      aria-label="印刷レイアウト"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-5 py-3 print:hidden">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">印刷レイアウト</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() =>
                onRuleSettingsChange({ ...ruleSettings, enabled: !ruleSettings.enabled })
              }
              aria-pressed={ruleSettings.enabled}
              title="すべてのページの余白に罫線を引く"
              className={`rounded-md border px-3 py-1.5 text-sm ${
                ruleSettings.enabled
                  ? 'border-primary bg-primary text-white hover:bg-primary-hover'
                  : 'border-border hover:bg-gray-50'
              }`}
            >
              {ruleSettings.enabled ? '罫線あり' : '罫線なし'}
            </button>
            <select
              value={ruleSettings.spacingMm}
              onChange={(e) =>
                onRuleSettingsChange({ ...ruleSettings, spacingMm: Number(e.target.value) })
              }
              disabled={!ruleSettings.enabled}
              aria-label="罫線の間隔"
              title="線と線の間隔"
              className="rounded-md border border-border px-1.5 py-1.5 disabled:opacity-40"
            >
              {RULE_SPACING_OPTIONS_MM.map((mm) => (
                <option key={mm} value={mm}>
                  間隔 {mm}mm
                </option>
              ))}
            </select>
            <select
              value={ruleSettings.strokePx}
              onChange={(e) =>
                onRuleSettingsChange({ ...ruleSettings, strokePx: Number(e.target.value) })
              }
              disabled={!ruleSettings.enabled}
              aria-label="罫線の太さ"
              title="線の太さ"
              className="rounded-md border border-border px-1.5 py-1.5 disabled:opacity-40"
            >
              {RULE_STROKE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setAddedFreePageCount(freePageCount + 1)}
            disabled={measuringPage2}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40"
          >
            ページを追加
          </button>
          {/* 罫線の上に直接書けるようになったので、「線を追加」はいったん出さない
          <button
            type="button"
            onClick={() => setPlacingLine((v) => !v)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              placingLine
                ? 'border-primary bg-primary text-white hover:bg-primary-hover'
                : 'border-border hover:bg-gray-50'
            }`}
          >
            {placingLine ? '用紙をクリックして線を置く（Esc でやめる）' : '線を追加'}
          </button>
          */}
          <button
            type="button"
            onClick={() => {
              setAddedFreePageCount(1)
              onResetPlacements()
            }}
            disabled={
              Object.keys(placements).length === 0 &&
              Object.keys(zooms).length === 0 &&
              Object.keys(page2Placements).length === 0 &&
              !hasOtherLayoutChanges
            }
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-gray-50 disabled:opacity-40"
          >
            配置をリセット
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={onPrint}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
          >
            印刷
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="print-layout-scroll min-h-0 flex-1 overflow-auto">
        <div
          className="print-layout-pages flex items-start p-6"
          // 3 ページ以上で横にはみ出したときも左端までスクロールできるように safe center
          style={{ gap: SHEET_GAP_PX, justifyContent: 'safe center' }}
        >
          <SheetFrame
            label={page1PageCount > 1 ? `1〜${page1PageCount}ページ目` : '1ページ目'}
            scale={scale}
            height={sheetHeights[0]}
          >
            <div
              ref={sheet1Ref}
              className={`print-sheet ${
                page1Lines.length > 0 || rulePage1 ? 'print-sheet-free' : ''
              } ${
                placingLine ? 'cursor-crosshair' : ''
              }`}
              style={sheetStyle(scale)}
              onPointerDownCapture={(e) => placeLineAt(1, e)}
            >
              {rulePage1 ? renderRules(ruleRows.page1, 0) : null}
              {renderPage1(overlay, new Set(page1Cards.map((c) => c.id)))}
              {page1Lines.map(renderLine)}
              {Array.from({ length: page1PageCount - 1 }, (_, i) => (
                <div
                  key={i}
                  aria-hidden
                  className="print-sheet-ui pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-red-400"
                  style={{ top: SHEET_HEIGHT_PX * (i + 1) }}
                >
                  <span className="absolute right-2 top-1 text-[11px] text-red-500">
                    ここで改ページ
                  </span>
                </div>
              ))}
            </div>
          </SheetFrame>

          <SheetFrame
            label={`${page1PageCount + 1}ページ目`}
            scale={scale}
            height={sheetHeights[1]}
            className={page2Empty ? 'print-sheet-empty' : ''}
          >
            <div
              ref={(el) => {
                sheet2Ref.current = el
                freeSheetRefs.current[0] = el
              }}
              className={`print-sheet ${!page2Empty && !measuringPage2 ? 'print-sheet-free' : ''} ${
                placingLine && !page2Empty ? 'cursor-crosshair' : ''
              }`}
              style={sheetStyle(scale)}
              onPointerDownCapture={(e) => {
                // 印刷しない（空の）2 ページ目には置かない
                if (!page2Empty) placeLineAt(2, e)
              }}
            >
              {ruledFreePages[0] ? renderRules(ruleRows.free[0], 1) : null}
              {page2Empty ? (
                <p className="print-sheet-ui flex h-[1077px] items-center justify-center text-sm text-muted">
                  すべて 1 ページ目に移しました（2 ページ目は印刷されません）
                </p>
              ) : page2Cards.length === 0 ? null : measuringPage2 ? (
                // 最初の位置を測るための従来の 2 列の並び。Ctrl+P で直接印刷したときもこの並びで出る
                <div className="optimize-print-summary-layout">
                  {page2Left.length > 0 ? (
                    <section className="optimize-print-results space-y-4">
                      {page2Left.map((card) => renderCard(card, undefined, PAGE2_BOUNDS))}
                    </section>
                  ) : null}
                  {page2Right.length > 0 ? (
                    <section
                      className={`optimize-print-corner-bars space-y-4 ${
                        page2Left.length === 0 ? 'col-span-2' : ''
                      }`}
                    >
                      {page2Right.map((card) => renderCard(card, undefined, PAGE2_BOUNDS))}
                    </section>
                  ) : null}
                </div>
              ) : (
                page2Cards
                  .filter((card) => pageIndexOf(page2Placements[card.id]?.y ?? 0) === 0)
                  .map((card) => renderCard(card, page2Placements[card.id], PAGE2_BOUNDS))
              )}
              {page2Lines.map(renderLine)}
            </div>
          </SheetFrame>

          {/* 2 ページ目に収まらなかったカードのページ（3 ページ目以降） */}
          {Array.from({ length: freePageCount - 1 }, (_, i) => i + 1).map((page) => {
            const pageCards = page2Cards.filter((card) => pageIndexOf(page2Placements[card.id]?.y ?? 0) === page)
            // 「ページを追加」で足した空のページは印刷しない。いちばん後ろなら消せる
            const empty = pageCards.length === 0
            return (
              <SheetFrame
                key={page}
                label={`${page + page1PageCount + 1}ページ目`}
                scale={scale}
                height={SHEET_HEIGHT_PX}
                className={empty ? 'print-sheet-empty' : ''}
              >
                <div
                  ref={(el) => {
                    freeSheetRefs.current[page] = el
                  }}
                  className="print-sheet print-sheet-free"
                  style={sheetStyle(scale)}
                >
                  {ruledFreePages[page] ? renderRules(ruleRows.free[page], page + 1) : null}
                  {empty ? (
                    <div className="print-sheet-ui flex h-[1077px] flex-col items-center justify-center gap-3 text-sm text-muted">
                      <p>カードをここへドラッグしてください（空のままなら印刷されません）</p>
                      {page === freePageCount - 1 ? (
                        <button
                          type="button"
                          onClick={() => setAddedFreePageCount(page)}
                          className="rounded-md border border-border bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
                        >
                          このページを削除
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    pageCards.map((card) =>
                      renderCard(card, page2Placements[card.id], PAGE2_BOUNDS, page * SHEET_HEIGHT_PX),
                    )
                  )}
                </div>
              </SheetFrame>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 2 ページ目以降の続いた座標の y が、何枚目の用紙か（0 = 2 ページ目） */
function pageIndexOf(y: number): number {
  return Math.max(0, Math.floor(y / SHEET_HEIGHT_PX))
}

function clampX(x: number, w: number, bounds: CardBounds): number {
  return Math.min(Math.max(bounds.minX, bounds.maxRight - w), Math.max(bounds.minX, x))
}

function sheetStyle(scale: number) {
  return { transform: `scale(${scale})`, transformOrigin: 'top left' }
}

/** 縮小した用紙の見た目の大きさを持つ枠（transform は場所を取らないので枠で確保する） */
function SheetFrame({
  label,
  scale,
  height,
  className = '',
  children,
}: {
  label: string
  scale: number
  height: number
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`print-sheet-frame shrink-0 ${className}`}>
      <div className="print-sheet-ui mb-1.5 text-xs font-medium text-white/90">{label}</div>
      <div style={{ width: SHEET_WIDTH_PX * scale, height: height * scale }}>{children}</div>
    </div>
  )
}

type CardEdge = 'left' | 'right' | 'top' | 'bottom'

const EDGE_CURSOR: Record<CardEdge, string> = {
  left: 'ew-resize',
  right: 'ew-resize',
  top: 'ns-resize',
  bottom: 'ns-resize',
}

/** 辺をつかむ帯の太さ（画面上の px） */
const EDGE_GRAB_PX = 8

/**
 * 用紙の上のカード。入力欄やボタン以外のどこを掴んでもドラッグできる。
 * box があればその位置に絶対配置し、4 辺をドラッグして形（幅・高さ）を変えられる。
 * 絶対配置なので、形を変えてもほかのカードは動かない。
 */
function SheetCard({
  card,
  box,
  bounds,
  zoom,
  scale,
  onDrop,
  onZoom,
  onBoxChange,
}: {
  card: PrintCard
  /** 位置・大きさ。無いときは並びの中に置く（2 ページ目の最初の位置を測るときだけ） */
  box?: PrintCardPlacement
  bounds: CardBounds
  zoom: number
  scale: number
  onDrop: (info: DropInfo) => void
  /** 拡大率と、幅・高さを決めてあるカードなら同じ比率で変えた幅・高さ */
  onZoom: (zoom: number, size: CardSize | null) => void
  onBoxChange: (box: Partial<PrintCardPlacement>) => void
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  /**
   * 高さを決めたカードで、中身がその高さに収まらないときの縮小率（1 = そのまま）。
   * 中身を切らずに、文字・図・行の間隔をまとめて縮めて収める
   */
  const [fitScale, setFitScale] = useState(1)
  const fitScaleRef = useRef(1)
  const dragRef = useRef<{ startX: number; startY: number } | null>(null)
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null)
  const edgeRef = useRef<{
    edge: CardEdge
    startX: number
    startY: number
    box: { x: number; y: number; w: number; h: number }
  } | null>(null)
  const [liveBox, setLiveBox] = useState<Partial<PrintCardPlacement> | null>(null)
  const zoomRef = useRef<{ startX: number; startW: number; startZoom: number } | null>(null)
  const [liveZoom, setLiveZoom] = useState<{ zoom: number; box: CardSize | null } | null>(null)

  const positioned = box != null
  const boxW = box?.w
  const boxH = box?.h

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, button, a, [contenteditable="true"], [data-no-card-drag]')) {
      return
    }
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY }
    setOffset({ dx: 0, dy: 0 })
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    setOffset({ dx: (e.clientX - d.startX) / scale, dy: (e.clientY - d.startY) / scale })
  }

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    const cardRect = cardRef.current?.getBoundingClientRect()
    setOffset(null)
    if (cardRect) onDrop({ id: card.id, cardRect, clientX: e.clientX, clientY: e.clientY })
  }

  const handlePointerCancel = () => {
    dragRef.current = null
    setOffset(null)
  }

  // --- 辺のドラッグ（形を変える）
  const handleEdgePointerDown = (edge: CardEdge) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !cardRef.current) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    edgeRef.current = {
      edge,
      startX: e.clientX,
      startY: e.clientY,
      box: {
        x: box?.x ?? 0,
        y: box?.y ?? 0,
        // offset* は用紙の縮小（transform）の影響を受けない実寸
        w: cardRef.current.offsetWidth,
        h: cardRef.current.offsetHeight,
      },
    }
    setLiveBox({})
  }

  const handleEdgePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = edgeRef.current
    if (!r) return
    const dx = (e.clientX - r.startX) / scale
    const dy = (e.clientY - r.startY) / scale
    const { x, y, w, h } = r.box
    if (r.edge === 'right') {
      const maxW = bounds.maxRight - x
      setLiveBox({ w: Math.round(Math.min(maxW, Math.max(MIN_CARD_WIDTH_PX, w + dx))) })
    } else if (r.edge === 'left') {
      const nextX = Math.min(x + w - MIN_CARD_WIDTH_PX, Math.max(bounds.minX, x + dx))
      setLiveBox({ x: Math.round(nextX), w: Math.round(w + x - nextX) })
    } else if (r.edge === 'bottom') {
      setLiveBox({ h: Math.round(Math.max(MIN_CARD_HEIGHT_PX, h + dy)) })
    } else {
      const nextY = Math.min(y + h - MIN_CARD_HEIGHT_PX, Math.max(bounds.minY, y + dy))
      setLiveBox({ y: Math.round(nextY), h: Math.round(h + y - nextY) })
    }
  }

  const handleEdgePointerUp = () => {
    const r = edgeRef.current
    if (!r) return
    edgeRef.current = null
    const el = cardRef.current
    if (liveBox && Object.keys(liveBox).length > 0 && el) {
      // 中身より小さくはならないので、実際に描かれた大きさで保存する（左辺・上辺は反対側の辺を固定）
      const box = { ...liveBox }
      if (box.w != null) box.w = el.offsetWidth
      if (box.h != null) box.h = el.offsetHeight
      if (r.edge === 'left' && box.w != null) box.x = r.box.x + r.box.w - box.w
      if (r.edge === 'top' && box.h != null) box.y = r.box.y + r.box.h - box.h
      onBoxChange(box)
    }
    setLiveBox(null)
  }

  /** fromZoom のときの大きさを基準に、拡大率 target での幅・高さを求める（用紙の右端は越えない） */
  const sizeFor = (target: number, fromZoom: number) => {
    let next = Math.min(MAX_CARD_ZOOM, Math.max(MIN_CARD_ZOOM, target))
    if (box && boxW != null) {
      const maxW = bounds.maxRight - box.x
      if ((boxW * next) / fromZoom > maxW) next = (fromZoom * maxW) / boxW
    }
    const ratio = next / fromZoom
    const size: CardSize = {}
    if (boxW != null) size.w = Math.round(boxW * ratio)
    if (boxH != null) size.h = Math.round(boxH * ratio)
    return {
      zoom: Math.round(next * 100) / 100,
      box: size.w != null || size.h != null ? size : null,
    }
  }

  const zoomFromPointer = (clientX: number) => {
    const r = zoomRef.current
    if (!r) return null
    const ratio = (r.startW + (clientX - r.startX) / scale) / r.startW
    return sizeFor(r.startZoom * ratio, r.startZoom)
  }

  /** −/＋ ボタン。10% 刻みの目盛りにそろえる */
  const stepZoom = (direction: 1 | -1) => {
    const target = Math.round((zoom + direction * CARD_ZOOM_STEP) * 10) / 10
    const next = sizeFor(target, zoom)
    if (next.zoom !== zoom) onZoom(next.zoom, next.box)
  }

  const resetZoom = () => {
    const next = sizeFor(1, zoom)
    onZoom(1, next.box)
  }

  const handleZoomPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !cardRef.current) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    zoomRef.current = { startX: e.clientX, startW: cardRef.current.offsetWidth, startZoom: zoom }
    setLiveZoom({ zoom, box: null })
  }

  const handleZoomPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const next = zoomFromPointer(e.clientX)
    if (next) setLiveZoom(next)
  }

  const handleZoomPointerUp = () => {
    if (!zoomRef.current) return
    zoomRef.current = null
    if (liveZoom) onZoom(liveZoom.zoom, liveZoom.box)
    setLiveZoom(null)
  }

  const left = liveBox?.x ?? box?.x
  const top = liveBox?.y ?? box?.y
  const width = liveBox?.w ?? liveZoom?.box?.w ?? boxW
  const height = liveBox?.h ?? liveZoom?.box?.h ?? boxH
  const shownZoom = liveZoom?.zoom ?? zoom
  const appliedFit = height != null ? fitScale : 1

  // 中身の本来の高さを測り、カードの高さより大きければ縮小率を下げる。
  // カードや中身の大きさが変わるたびに測り直す
  useEffect(() => {
    if (height == null) return
    const card = cardRef.current
    const body = bodyRef.current
    if (!card || !body) return
    const measure = () => {
      const content = body.firstElementChild as HTMLElement | null
      if (!content) return
      // 行を引き伸ばす指定（height: 100%）を一時的に外して、詰めたときの高さを測る。
      // CSS の読み込みに頼らないよう、測る間だけ要素に直接 height: auto を当てる
      const stretched = [
        body,
        ...Array.from(
          body.querySelectorAll<HTMLElement>(
            ':scope > *, :scope > * > .print-hook-summary, :scope > * > .corner-summary-section, :scope > * > .corner-summary-section > table',
          ),
        ),
      ]
      const saved = stretched.map((el) => el.style.height)
      stretched.forEach((el) => {
        el.style.height = 'auto'
      })
      const naturalNow = content.getBoundingClientRect().height
      stretched.forEach((el, i) => {
        el.style.height = saved[i] ?? ''
      })
      const boxNow = card.getBoundingClientRect().height
      if (naturalNow <= 0 || boxNow <= 0) return
      // 測った高さは今の縮小率が掛かった値なので、縮小なしの高さに戻してから比べる
      const natural = naturalNow / fitScaleRef.current
      const next = Math.min(1, boxNow / natural)
      if (Math.abs(next - fitScaleRef.current) > 0.005) {
        fitScaleRef.current = next
        setFitScale(next)
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    if (body.firstElementChild) observer.observe(body.firstElementChild)
    return () => observer.disconnect()
  }, [height, shownZoom])
  const edges: CardEdge[] = positioned ? ['left', 'right', 'top', 'bottom'] : []
  const grab = EDGE_GRAB_PX / scale

  return (
    <div
      ref={cardRef}
      data-print-card={card.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      title={`${card.label}：ドラッグで移動`}
      className={`group ${positioned ? 'print-free-card absolute' : 'relative'} ${
        height != null ? 'print-card-fill' : ''
      } cursor-move touch-none rounded-lg hover:outline hover:outline-2 hover:outline-offset-2 hover:outline-primary/40`}
      style={{
        ...(positioned ? { left, top } : {}),
        width: width ?? undefined,
        height: height ?? undefined,
        // 幅を決めても中身（表）より狭くはしない（切れて印刷されないように）
        minWidth: width != null ? 'min-content' : undefined,
        ...(offset
          ? {
              transform: `translate(${offset.dx}px, ${offset.dy}px)`,
              zIndex: 50,
              opacity: 0.85,
              boxShadow: '0 12px 28px rgba(15, 23, 42, 0.25)',
            }
          : {}),
      }}
    >
      <div ref={bodyRef} className="print-card-body" style={{ zoom: shownZoom * appliedFit }}>
        {card.node}
      </div>

      {/* 辺をつかむ帯。用紙ごと縮小表示しているので、太さは画面上で一定にする */}
      {edges.map((edge) => {
        const horizontal = edge === 'left' || edge === 'right'
        return (
          <div
            key={edge}
            data-no-card-drag
            aria-label={`${card.label}の${{ left: '左', right: '右', top: '上', bottom: '下' }[edge]}辺を動かす`}
            onPointerDown={handleEdgePointerDown(edge)}
            onPointerMove={handleEdgePointerMove}
            onPointerUp={handleEdgePointerUp}
            onPointerCancel={handleEdgePointerUp}
            className="print-sheet-ui absolute z-10 touch-none rounded bg-primary/0 transition-colors hover:bg-primary/30"
            style={{
              cursor: EDGE_CURSOR[edge],
              ...(horizontal
                ? { top: grab * 2, bottom: grab * 2, width: grab, [edge]: -grab / 2 }
                : { left: grab * 2, right: grab * 2, height: grab, [edge]: -grab / 2 }),
            }}
          />
        )
      })}

      {/* 用紙ごと縮小表示しているので、操作部品は逆に拡大して画面上の大きさを保つ。
          上辺の帯と重ならないよう、カードの上の外側に置く */}
      <div
        className={`print-sheet-ui absolute bottom-full right-0 z-20 flex items-center overflow-hidden rounded-full border border-primary/40 bg-white text-xs text-primary shadow-sm transition-opacity group-hover:opacity-100 ${
          liveZoom || liveBox ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transform: `scale(${1 / scale})`, transformOrigin: 'right bottom' }}
      >
        <button
          type="button"
          onClick={() => stepZoom(-1)}
          disabled={shownZoom <= MIN_CARD_ZOOM}
          aria-label={`${card.label}を小さくする`}
          className="px-2 py-0.5 leading-none hover:bg-primary/10 disabled:opacity-30"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetZoom}
          title="クリックで 100% に戻す"
          className="min-w-[3.25rem] border-x border-primary/20 px-1 py-0.5 text-center tabular-nums leading-none hover:bg-primary/10"
        >
          {Math.round(shownZoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => stepZoom(1)}
          disabled={shownZoom >= MAX_CARD_ZOOM}
          aria-label={`${card.label}を大きくする`}
          className="px-2 py-0.5 leading-none hover:bg-primary/10 disabled:opacity-30"
        >
          ＋
        </button>
      </div>
      <div
        data-no-card-drag
        aria-label={`${card.label}を拡大・縮小する`}
        title={`ドラッグで拡大・縮小（いま ${Math.round(shownZoom * 100)}%）。ダブルクリックで 100% に戻す`}
        onPointerDown={handleZoomPointerDown}
        onPointerMove={handleZoomPointerMove}
        onPointerUp={handleZoomPointerUp}
        onPointerCancel={handleZoomPointerUp}
        onDoubleClick={resetZoom}
        style={{ transform: `scale(${1 / scale})` }}
        className={`print-sheet-ui absolute -bottom-2 -right-2 z-20 h-4 w-4 cursor-nwse-resize touch-none rounded-sm border-2 border-primary bg-white shadow-sm transition-opacity group-hover:opacity-100 ${
          liveZoom ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  )
}

/**
 * 用紙の余白に引いた横線。線の上の入力欄にそのまま文字を書ける。
 * 左のつまみで移動（ほかのページへも移せる）、右端で長さを変え、× で消す。
 * つまみ・× は画面だけに出し、印刷には線と文字だけが出る。
 */
function SheetLine({
  line,
  scale,
  onDrop,
  onChange,
  onDelete,
}: {
  line: PrintLine
  scale: number
  onDrop: (lineRect: DOMRect, clientX: number, clientY: number) => void
  onChange: (patch: Partial<PrintLine>) => void
  onDelete: () => void
}) {
  const lineRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startY: number } | null>(null)
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)
  const [liveW, setLiveW] = useState<number | null>(null)

  const handleGripPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY }
    setOffset({ dx: 0, dy: 0 })
  }

  const handleGripPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    setOffset({ dx: (e.clientX - d.startX) / scale, dy: (e.clientY - d.startY) / scale })
  }

  const handleGripPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    const rect = lineRef.current?.getBoundingClientRect()
    setOffset(null)
    if (rect) onDrop(rect, e.clientX, e.clientY)
  }

  const handleGripPointerCancel = () => {
    dragRef.current = null
    setOffset(null)
  }

  const handleResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeRef.current = { startX: e.clientX, startW: line.w }
    setLiveW(line.w)
  }

  const handleResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current
    if (!r) return
    const maxW = SHEET_WIDTH_PX - line.x
    setLiveW(
      Math.round(Math.min(maxW, Math.max(MIN_LINE_WIDTH_PX, r.startW + (e.clientX - r.startX) / scale))),
    )
  }

  const handleResizePointerUp = () => {
    if (!resizeRef.current) return
    resizeRef.current = null
    if (liveW != null && liveW !== line.w) onChange({ w: liveW })
    setLiveW(null)
  }

  const active = offset != null || liveW != null

  return (
    <div
      ref={lineRef}
      data-print-line
      className="group absolute z-20"
      style={{
        left: line.x,
        top: line.y,
        width: liveW ?? line.w,
        ...(offset
          ? { transform: `translate(${offset.dx}px, ${offset.dy}px)`, zIndex: 50, opacity: 0.85 }
          : {}),
      }}
    >
      <input
        type="text"
        value={line.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="ここに記入"
        aria-label="線の上の文字"
        className="print-line-input block w-full border-0 border-b border-solid border-[#0f172a] bg-transparent px-1 pb-0.5 text-[13px] leading-tight text-[#0f172a] outline-none placeholder:text-slate-300 focus:bg-primary/5"
      />

      {/* 用紙ごと縮小表示しているので、操作部品は逆に拡大して画面上の大きさを保つ */}
      <div
        aria-label="線を動かす"
        title="ドラッグで移動"
        onPointerDown={handleGripPointerDown}
        onPointerMove={handleGripPointerMove}
        onPointerUp={handleGripPointerUp}
        onPointerCancel={handleGripPointerCancel}
        style={{ transform: `scale(${1 / scale})`, transformOrigin: 'right center' }}
        className={`print-sheet-ui absolute right-full top-1/2 mr-1 flex h-5 w-3 -translate-y-1/2 cursor-move touch-none items-center justify-center rounded-sm border border-primary/40 bg-white text-[10px] leading-none text-primary shadow-sm transition-opacity group-hover:opacity-100 ${
          active ? 'opacity-100' : 'opacity-0'
        }`}
      >
        ⋮
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label="線を消す"
        title="線を消す"
        style={{ transform: `scale(${1 / scale})`, transformOrigin: 'right bottom' }}
        className="print-sheet-ui absolute bottom-full right-0 mb-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-primary/40 bg-white text-[10px] leading-none text-primary opacity-0 shadow-sm transition-opacity hover:bg-primary/10 group-hover:opacity-100"
      >
        ×
      </button>
      <div
        aria-label="線の長さを変える"
        title="ドラッグで長さを変える"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
        style={{ width: EDGE_GRAB_PX / scale, right: -EDGE_GRAB_PX / scale / 2 }}
        className="print-sheet-ui absolute inset-y-0 cursor-ew-resize touch-none rounded bg-primary/0 transition-colors hover:bg-primary/30"
      />
    </div>
  )
}
