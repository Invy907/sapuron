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

export type PrintCardId = 'bar-summary' | 'hook-summary' | 'corner-bars'

export type PrintCardPlacement = {
  /** 製作図リストの表の左上からの位置 (px) */
  x: number
  y: number
  /** カードの幅 (px) */
  w?: number
}

export type PrintCardPlacements = Partial<Record<PrintCardId, PrintCardPlacement>>

export type PrintCard = {
  id: PrintCardId
  label: string
  node: ReactNode
}

const PRINT_CARD_IDS: readonly PrintCardId[] = ['bar-summary', 'hook-summary', 'corner-bars']
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
  onResetPlacements,
  renderPage1,
  cards,
}: {
  onClose: () => void
  onPrint: () => void
  placements: PrintCardPlacements
  onPlacementChange: (id: PrintCardId, placement: PrintCardPlacement | null) => void
  onResetPlacements: () => void
  /** 1 ページ目の中身。overlay は表の左上に重ねる層（1 ページ目へ移したカード） */
  renderPage1: (overlay: ReactNode) => ReactNode
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
    const update = () => setSheetHeights([s1.offsetHeight, s2.offsetHeight])
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

  const handleDrop = useCallback(
    ({ id, cardRect, clientX, clientY }: DropInfo) => {
      const s1 = sheet1Ref.current?.getBoundingClientRect()
      const s2 = sheet2Ref.current?.getBoundingClientRect()
      const layer = layerRef.current?.getBoundingClientRect()
      const inside = (r: DOMRect | undefined) =>
        r != null && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
      if (inside(s1) && s1 && layer) {
        // 画面の縮小率は実際の用紙の幅から求める
        const k = s1.width / SHEET_WIDTH_PX
        const w = placements[id]?.w ?? Math.round(cardRect.width / k)
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
      if (inside(s2) && placements[id]) onPlacementChange(id, null)
    },
    [onPlacementChange, placements],
  )

  const page1Cards = cards.filter((c) => placements[c.id])
  const page2Left = cards.filter((c) => !placements[c.id] && LEFT_COLUMN_IDS.includes(c.id))
  const page2Right = cards.filter((c) => !placements[c.id] && !LEFT_COLUMN_IDS.includes(c.id))
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
          placement={placements[card.id]}
          scale={scale}
          onDrop={handleDrop}
          onResize={(w) => {
            const p = placements[card.id]
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
            カードをドラッグして 1 ページ目の空いているところへ置けます。2 ページ目の用紙へドラッグすると元に戻ります。右端をドラッグすると幅を変えられます。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onResetPlacements}
            disabled={page1Cards.length === 0}
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
              {renderPage1(overlay)}
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
                        <SheetCard key={card.id} card={card} scale={scale} onDrop={handleDrop} />
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
                        <SheetCard key={card.id} card={card} scale={scale} onDrop={handleDrop} />
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
  scale,
  onDrop,
  onResize,
}: {
  card: PrintCard
  placement?: PrintCardPlacement
  scale: number
  onDrop: (info: DropInfo) => void
  onResize?: (w: number) => void
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startY: number } | null>(null)
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)
  const [resizeW, setResizeW] = useState<number | null>(null)

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

  const width = resizeW ?? placement?.w
  return (
    <div
      ref={cardRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      title={`${card.label}：ドラッグで移動`}
      className={`${placement ? 'print-page1-card absolute' : 'relative'} cursor-move touch-none rounded-lg hover:outline hover:outline-2 hover:outline-offset-2 hover:outline-primary/40`}
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
      {card.node}
      {placement && onResize ? (
        <div
          data-no-card-drag
          aria-label={`${card.label}の幅を変える`}
          title="ドラッグで幅を変える"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
          className="print-sheet-ui absolute -right-1.5 bottom-2 top-2 w-3 cursor-ew-resize touch-none rounded bg-primary/0 hover:bg-primary/30"
        />
      ) : null}
    </div>
  )
}
