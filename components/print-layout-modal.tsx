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
const MIN_CARD_WIDTH_PX = 80
const MIN_CARD_HEIGHT_PX = 40
const MIN_CARD_ZOOM = 0.5
const MAX_CARD_ZOOM = 2
/** −/＋ ボタン 1 回で変える拡大率 */
const CARD_ZOOM_STEP = 0.1

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
  renderPage1,
  cards,
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
  /**
   * 1 ページ目の中身。overlay は表の左上に重ねる層（1 ページ目へ移したカード）。
   * layeredIds は層に描いているカード。メモが入っていれば元のメモは出さない
   */
  renderPage1: (overlay: ReactNode, layeredIds: ReadonlySet<PrintCardId>) => ReactNode
  /** 印刷するカード。表示できるものだけ渡す */
  cards: PrintCard[]
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sheet1Ref = useRef<HTMLDivElement | null>(null)
  const sheet2Ref = useRef<HTMLDivElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [sheetHeights, setSheetHeights] = useState<[number, number]>([
    SHEET_HEIGHT_PX,
    SHEET_HEIGHT_PX,
  ])
  const [defaultPlacements, setDefaultPlacements] = useState<PrintCardPlacements>({})
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
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const page1OnlyIds = new Set(cards.filter((c) => c.page1Only).map((c) => c.id))
  const placementOf = (id: PrintCardId): PrintCardPlacement | undefined =>
    placements[id] ?? (page1OnlyIds.has(id) ? defaultPlacements[id] : undefined)

  const page1Cards = cards.filter((c) => placementOf(c.id))
  const page2Cards = cards.filter((c) => !c.page1Only && !placements[c.id])
  const page2Empty = page2Cards.length === 0
  // 2 ページ目に位置が決まっていないカードがあれば、いったん従来の 2 列の並びで描いて位置を測る
  const measuringPage2 = page2Cards.some((c) => !page2Placements[c.id])
  const page2CardIdsKey = page2Cards.map((c) => c.id).join(',')

  useEffect(() => {
    if (!measuringPage2) return
    const sheet = sheet2Ref.current
    if (!sheet) return
    // カードの offsetParent は用紙（position: relative）なので、offset* がそのまま用紙上の位置になる
    for (const el of Array.from(sheet.querySelectorAll<HTMLElement>('[data-print-card]'))) {
      const id = el.dataset.printCard as PrintCardId
      if (page2Placements[id]) continue
      onPage2PlacementChange(id, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth })
    }
  }, [measuringPage2, onPage2PlacementChange, page2CardIdsKey, page2Placements])

  const handleDrop = useCallback(
    ({ id, cardRect, clientX, clientY }: DropInfo) => {
      const page1Only = cardsRef.current.some((c) => c.id === id && c.page1Only)
      const current = placements[id] ?? (page1Only ? defaultPlacements[id] : undefined)
      const s1 = sheet1Ref.current?.getBoundingClientRect()
      const s2 = sheet2Ref.current?.getBoundingClientRect()
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
      if (inside(s2) && s2 && !page1Only) {
        const prev = page2Placements[id]
        const w = prev?.w ?? Math.round(cardRect.width / k)
        const fixedH = current?.h ?? prev?.h
        const x = (cardRect.left - s2.left) / k
        const y = (cardRect.top - s2.top) / k
        onPage2PlacementChange(id, {
          x: Math.round(clampX(x, w, PAGE2_BOUNDS)),
          y: Math.round(Math.max(0, y)),
          w,
          ...(fixedH != null ? { h: fixedH } : {}),
        })
        if (placements[id]) onPlacementChange(id, null)
      }
    },
    [defaultPlacements, onPage2PlacementChange, onPlacementChange, page2Placements, placements],
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

  const renderCard = (card: PrintCard, box: PrintCardPlacement | undefined, bounds: CardBounds) => (
    <SheetCard
      key={card.id}
      card={card}
      box={box}
      bounds={bounds}
      zoom={zooms[card.id] ?? 1}
      scale={scale}
      onDrop={handleDrop}
      onZoom={(z, size) => handleZoom(card.id, z, size)}
      onBoxChange={(next) => handleBoxChange(card.id, next)}
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
          <p className="text-xs text-muted">
            カードはドラッグで自由に動かせます（1 ページ目の空いているところにも置けます）。カードに乗せると出る −／＋ か右下の角で拡大・縮小、辺をドラッグすると形を変えられます。ほかのカードは動きません。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onResetPlacements}
            disabled={
              Object.keys(placements).length === 0 &&
              Object.keys(zooms).length === 0 &&
              Object.keys(page2Placements).length === 0
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
          className="print-layout-pages flex items-start justify-center p-6"
          style={{ gap: SHEET_GAP_PX }}
        >
          <SheetFrame label="1ページ目" scale={scale} height={sheetHeights[0]}>
            <div ref={sheet1Ref} className="print-sheet" style={sheetStyle(scale)}>
              {renderPage1(overlay, new Set(page1Cards.map((c) => c.id)))}
              {sheetHeights[0] > SHEET_HEIGHT_PX + 1 ? (
                <div
                  aria-hidden
                  className="print-sheet-ui pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-red-400"
                  style={{ top: SHEET_HEIGHT_PX }}
                >
                  <span className="absolute right-2 top-1 text-[11px] text-red-500">
                    ここで改ページ
                  </span>
                </div>
              ) : null}
            </div>
          </SheetFrame>

          <SheetFrame
            label="2ページ目"
            scale={scale}
            height={sheetHeights[1]}
            className={page2Empty ? 'print-sheet-empty' : ''}
          >
            <div
              ref={sheet2Ref}
              className={`print-sheet ${!page2Empty && !measuringPage2 ? 'print-sheet-free' : ''}`}
              style={sheetStyle(scale)}
            >
              {page2Empty ? (
                <p className="print-sheet-ui flex h-[1077px] items-center justify-center text-sm text-muted">
                  すべて 1 ページ目に移しました（2 ページ目は印刷されません）
                </p>
              ) : measuringPage2 ? (
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
                page2Cards.map((card) => renderCard(card, page2Placements[card.id], PAGE2_BOUNDS))
              )}
            </div>
          </SheetFrame>
        </div>
      </div>
    </div>,
    document.body,
  )
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
      <div className="print-card-body" style={{ zoom: shownZoom }}>
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
