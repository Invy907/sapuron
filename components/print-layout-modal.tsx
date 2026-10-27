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

export type PrintCardId = 'bar-summary' | 'hook-summary' | 'corner-bars' | 'memo'

export type PrintCardPlacement = {
  /** 製作図リストの表の左上からの位置 (px) */
  x: number
  y: number
  /** カードの幅 (px) */
  w?: number
}

export type PrintCardPlacements = Partial<Record<PrintCardId, PrintCardPlacement>>

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

const PRINT_CARD_IDS: readonly PrintCardId[] = ['bar-summary', 'hook-summary', 'corner-bars', 'memo']
/** 2 ページ目の左列（材料取り）に入るカード。残りは右列 */
const LEFT_COLUMN_IDS: readonly PrintCardId[] = ['bar-summary', 'hook-summary']

/** A4 縦・左右余白 10mm の印刷幅 190mm (96dpi) */
const SHEET_WIDTH_PX = 718
/** A4 縦・上下余白 6mm の印刷高さ 285mm (96dpi) */
const SHEET_HEIGHT_PX = 1077
/** 1 ページ目の製作図リストは左右 10px の余白を持つ（globals.css） */
const SECTION_PADDING_X_PX = 10
/** 表の左端から見た用紙の右端 */
const SHEET_RIGHT_FROM_TABLE_PX = SHEET_WIDTH_PX - SECTION_PADDING_X_PX
const SHEET_GAP_PX = 32
const MIN_CARD_WIDTH_PX = 160
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
      const { x, y, w } = value as { x?: unknown; y?: unknown; w?: unknown }
      if (typeof x !== 'number' || !Number.isFinite(x)) continue
      if (typeof y !== 'number' || !Number.isFinite(y)) continue
      placements[id] = {
        x,
        y,
        ...(typeof w === 'number' && Number.isFinite(w) && w > 0 ? { w } : {}),
      }
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
  zooms,
  onZoomChange,
  onResetPlacements,
  renderPage1,
  cards,
}: {
  onClose: () => void
  onPrint: () => void
  placements: PrintCardPlacements
  onPlacementChange: (id: PrintCardId, placement: PrintCardPlacement | null) => void
  zooms: PrintCardZooms
  onZoomChange: (id: PrintCardId, zoom: number | null) => void
  /** 1 ページ目への配置と拡大率をすべて元に戻す */
  onResetPlacements: () => void
  /**
   * 1 ページ目の中身。overlay は表の左上に重ねる層（1 ページ目へ移したカード）。
   * layeredIds は層に描いているカード。メモが入っていれば元のメモは出さない
   */
  renderPage1: (overlay: ReactNode, layeredIds: ReadonlySet<PrintCardId>) => ReactNode
  /** 2 ページ目のカード。表示できるものだけ渡す */
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

  const handleDrop = useCallback(
    ({ id, cardRect, clientX, clientY }: DropInfo) => {
      const page1Only = cardsRef.current.some((c) => c.id === id && c.page1Only)
      const current = placements[id] ?? (page1Only ? defaultPlacements[id] : undefined)
      const s1 = sheet1Ref.current?.getBoundingClientRect()
      const s2 = sheet2Ref.current?.getBoundingClientRect()
      const layer = layerRef.current?.getBoundingClientRect()
      const inside = (r: DOMRect | undefined) =>
        r != null && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
      if (inside(s1) && s1 && layer) {
        // 画面の縮小率は実際の用紙の幅から求める
        const k = s1.width / SHEET_WIDTH_PX
        const w = current?.w ?? Math.round(cardRect.width / k)
        const h = cardRect.height / k
        const top = (layer.top - s1.top) / k
        const x = (cardRect.left - layer.left) / k
        const y = (cardRect.top - layer.top) / k
        onPlacementChange(id, {
          x: Math.round(
            Math.min(
              Math.max(-SECTION_PADDING_X_PX, SHEET_RIGHT_FROM_TABLE_PX - w),
              Math.max(-SECTION_PADDING_X_PX, x),
            ),
          ),
          y: Math.round(Math.min(Math.max(-top, SHEET_HEIGHT_PX - top - h), Math.max(-top, y))),
          w,
        })
        return
      }
      if (inside(s2) && placements[id] && !page1Only) onPlacementChange(id, null)
    },
    [defaultPlacements, onPlacementChange, placements],
  )

  /** 拡大率を変える。1 ページ目のカードは見た目の幅も一緒に変える */
  const handleZoom = (id: PrintCardId, zoom: number, width: number | null) => {
    onZoomChange(id, Math.abs(zoom - 1) < 0.005 ? null : zoom)
    const p = placementOf(id)
    if (p && width != null) onPlacementChange(id, { ...p, w: width })
  }

  const page1Cards = cards.filter((c) => placementOf(c.id))
  const page2Cards = cards.filter((c) => !c.page1Only && !placements[c.id])
  const page2Left = page2Cards.filter((c) => LEFT_COLUMN_IDS.includes(c.id))
  const page2Right = page2Cards.filter((c) => !LEFT_COLUMN_IDS.includes(c.id))
  const page2Empty = page2Left.length === 0 && page2Right.length === 0

  const overlay = (
    <div
      ref={layerRef}
      className="absolute left-0 top-0 z-10 h-0"
      style={{ width: SHEET_RIGHT_FROM_TABLE_PX }}
    >
      {page1Cards.map((card) => (
        <SheetCard
          key={card.id}
          card={card}
          placement={placementOf(card.id)}
          zoom={zooms[card.id] ?? 1}
          scale={scale}
          onDrop={handleDrop}
          onZoom={(z, w) => handleZoom(card.id, z, w)}
          onResize={(w) => {
            const p = placementOf(card.id)
            if (p) onPlacementChange(card.id, { ...p, w })
          }}
        />
      ))}
    </div>
  )

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
            カードをドラッグして 1 ページ目の空いているところへ置けます。2 ページ目の用紙へドラッグすると元に戻ります。カードに乗せると出る −／＋ か右下の角で拡大・縮小、1 ページ目のカードは右端で幅を変えられます。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onResetPlacements}
            disabled={Object.keys(placements).length === 0 && Object.keys(zooms).length === 0}
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
            <div ref={sheet2Ref} className="print-sheet" style={sheetStyle(scale)}>
              {page2Empty ? (
                <p className="print-sheet-ui flex h-[1077px] items-center justify-center text-sm text-muted">
                  すべて 1 ページ目に移しました（2 ページ目は印刷されません）
                </p>
              ) : (
                <div className="optimize-print-summary-layout">
                  {page2Left.length > 0 ? (
                    <section className="optimize-print-results space-y-4">
                      <h2 className="text-base font-semibold">材料取り</h2>
                      {page2Left.map((card) => (
                        <SheetCard
                          key={card.id}
                          card={card}
                          zoom={zooms[card.id] ?? 1}
                          scale={scale}
                          onDrop={handleDrop}
                          onZoom={(z, w) => handleZoom(card.id, z, w)}
                        />
                      ))}
                    </section>
                  ) : null}
                  {page2Right.length > 0 ? (
                    <section
                      className={`optimize-print-corner-bars space-y-4 ${
                        page2Left.length === 0 ? 'col-span-2' : ''
                      }`}
                    >
                      {page2Right.map((card) => (
                        <SheetCard
                          key={card.id}
                          card={card}
                          zoom={zooms[card.id] ?? 1}
                          scale={scale}
                          onDrop={handleDrop}
                          onZoom={(z, w) => handleZoom(card.id, z, w)}
                        />
                      ))}
                    </section>
                  ) : null}
                </div>
              )}
            </div>
          </SheetFrame>
        </div>
      </div>
    </div>,
    document.body,
  )
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

/**
 * 用紙の上のカード。入力欄やボタン以外のどこを掴んでもドラッグできる。
 * placement があれば 1 ページ目の層に絶対配置、無ければ 2 ページ目の流れの中に置く。
 */
function SheetCard({
  card,
  placement,
  zoom,
  scale,
  onDrop,
  onResize,
  onZoom,
}: {
  card: PrintCard
  placement?: PrintCardPlacement
  zoom: number
  scale: number
  onDrop: (info: DropInfo) => void
  onResize?: (w: number) => void
  /** 拡大率と、1 ページ目のカードなら新しい幅 */
  onZoom: (zoom: number, width: number | null) => void
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startY: number } | null>(null)
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)
  const [resizeW, setResizeW] = useState<number | null>(null)
  const zoomRef = useRef<{ startX: number; startW: number; startZoom: number } | null>(null)
  const [liveZoom, setLiveZoom] = useState<{ zoom: number; width: number | null } | null>(null)

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

  const handleResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !cardRef.current) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeRef.current = { startX: e.clientX, startW: cardRef.current.offsetWidth }
    setResizeW(resizeRef.current.startW)
  }

  const handleResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current
    if (!r || !placement) return
    const maxW = SHEET_RIGHT_FROM_TABLE_PX - placement.x
    setResizeW(
      Math.min(maxW, Math.max(MIN_CARD_WIDTH_PX, r.startW + (e.clientX - r.startX) / scale)),
    )
  }

  const handleResizePointerUp = () => {
    if (!resizeRef.current) return
    resizeRef.current = null
    if (resizeW != null) onResize?.(Math.round(resizeW))
    setResizeW(null)
  }

  // 右下の角: カードを中身ごと拡大・縮小する。横方向に動かした分の比率で決める
  /** fromZoom のときの幅を基準に、拡大率 target での幅を求める（用紙の右端は越えない） */
  const sizeFor = (target: number, fromZoom: number) => {
    let next = Math.min(MAX_CARD_ZOOM, Math.max(MIN_CARD_ZOOM, target))
    let width: number | null = null
    if (placement?.w != null) {
      const maxW = SHEET_RIGHT_FROM_TABLE_PX - placement.x
      width = (placement.w * next) / fromZoom
      if (width > maxW) {
        width = maxW
        next = (fromZoom * maxW) / placement.w
      }
      width = Math.round(width)
    }
    return { zoom: Math.round(next * 100) / 100, width }
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
    if (next.zoom !== zoom) onZoom(next.zoom, next.width)
  }

  const handleZoomPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !cardRef.current) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    zoomRef.current = { startX: e.clientX, startW: cardRef.current.offsetWidth, startZoom: zoom }
    setLiveZoom({ zoom, width: placement?.w ?? null })
  }

  const handleZoomPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const next = zoomFromPointer(e.clientX)
    if (next) setLiveZoom(next)
  }

  const handleZoomPointerUp = () => {
    if (!zoomRef.current) return
    zoomRef.current = null
    if (liveZoom) onZoom(liveZoom.zoom, liveZoom.width)
    setLiveZoom(null)
  }

  const width = resizeW ?? liveZoom?.width ?? placement?.w
  const shownZoom = liveZoom?.zoom ?? zoom
  return (
    <div
      ref={cardRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      title={`${card.label}：ドラッグで移動`}
      className={`group ${placement ? 'print-page1-card absolute' : 'relative'} cursor-move touch-none rounded-lg hover:outline hover:outline-2 hover:outline-offset-2 hover:outline-primary/40`}
      style={{
        ...(placement ? { left: placement.x, top: placement.y } : {}),
        width: width ?? undefined,
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
      <div style={{ zoom: shownZoom }}>{card.node}</div>
      {/* 用紙ごと縮小表示しているので、操作部品は逆に拡大して画面上の大きさを保つ */}
      <div
        className={`print-sheet-ui absolute right-3 top-0 z-20 flex items-center overflow-hidden rounded-full border border-primary/40 bg-white text-xs text-primary shadow-sm transition-opacity group-hover:opacity-100 ${
          liveZoom ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transform: `translateY(-50%) scale(${1 / scale})`, transformOrigin: 'right center' }}
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
          onClick={() => onZoom(1, placement?.w != null ? Math.round(placement.w / zoom) : null)}
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
        onDoubleClick={() => onZoom(1, placement?.w != null ? Math.round(placement.w / zoom) : null)}
        style={{ transform: `scale(${1 / scale})` }}
        className={`print-sheet-ui absolute -bottom-2 -right-2 z-10 h-4 w-4 cursor-nwse-resize touch-none rounded-sm border-2 border-primary bg-white shadow-sm transition-opacity group-hover:opacity-100 ${
          liveZoom ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {placement && onResize ? (
        <div
          data-no-card-drag
          aria-label={`${card.label}の幅を変える`}
          title="ドラッグで幅を変える"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
          className="print-sheet-ui absolute -right-1.5 bottom-4 top-2 w-3 cursor-ew-resize touch-none rounded bg-primary/0 hover:bg-primary/30"
        />
      ) : null}
    </div>
  )
}
