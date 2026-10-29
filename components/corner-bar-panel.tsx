// components/corner-bar-panel.tsx

'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { DrawingCornerBar } from '@/lib/types/database'
import {
  buildCornerBarPrintSummary,
  clampCornerBarSizePx,
  CORNER_BAR_CATEGORIES,
  CORNER_BAR_DIAMETERS,
  CORNER_BAR_LAYERS,
  cornerBarSupportsLayer,
  cornerBarLayerMark,
  cornerBarCategoryLabel,
  cornerBarDiameterOptionLabel,
  cornerBarFixedVertexForEdge,
  cornerBarLegacyFieldsFromBars,
  cornerBarBendAngles,
  cornerBarDeductionTotal,
  ZERO_MEASUREMENT_DEDUCTIONS,
  cornerBarFlipLabel,
  cornerBarRotationLabel,
  normalizeCornerBarFlip,
  toggleCornerBarFlip,
  cornerBarSegmentLabel,
  cornerBarSegmentLabelAnchors,
  cornerBarSegmentSumMm,
  cornerBarStrokePathD,
  cornerBarStrokePieceD,
  cornerBarStrokePieces,
  cornerBarThumbPath,
  cornerBarThumbPoints,
  isFreeShapeCategory,
  linkedSegmentIndices,
  linkedSegmentLeader,
  patchCornerBarSegment,
  changeCornerBarBarDiameter,
  DEFAULT_CORNER_BAR_COLORS,
  DEFAULT_CORNER_BAR_DIAMETER,
  DEFAULT_CORNER_BAR_SIZE_PX,
  getCornerBarShape,
  getCornerBarShapeOptionsForCategory,
  getNextCornerBarDiameter,
  isCornerBarBarsFullyDimensioned,
  isPerEdgeVisualDrawCategory,
  makeCornerBarBar,
  scaleCornerBarDrawScale,
  defaultPlacementDraftForCategory,
  makeCornerBarDraft,
  MEASUREMENT_TYPES,
  nextCornerBarBarId,
  nextCornerBarRotation,
  normalizeCornerBarBars,
  normalizeCornerBarRotation,
  resolveCategoryShape,
  resolveCornerBarShape,
  setCornerBarBendAngle,
  setCornerBarDeductionTotal,
  setCornerBarHeightMm,
  cornerBarHeightMm,
  MAX_CORNER_BAR_BEND_ANGLE_DEG,
  MIN_CORNER_BAR_BEND_ANGLE_DEG,
  clampCornerBarBendAngle,
  type CornerBarBarItem,
  type CornerBarCategory,
  type CornerBarLayer,
  type CornerBarPlacementDraft,
  type CornerBarSegment,
  type CornerBarShapeDef,
  type MeasurementType,
} from '@/lib/corner-bar-presets'
import { cornerBarKakouchouMm } from '@/lib/corner-bar-kakouchou'
import {
  getSegmentStrokeHex,
  normalizeSegmentColor,
  SEGMENT_COLOR_DEFINITIONS,
  type SegmentColor,
} from '@/lib/segment-colors'

const THUMB_W = 56
const THUMB_H = 42

/** − ＋ 1 回あたりの拡大縮小率 */
const SIZE_STEP = 1.25

export function CornerBarPanel({
  cornerBars,
  summaryHref,
  selectedCornerBarId,
  placementModeActive,
  placementDraft,
  activePlacementCategory,
  onActivePlacementCategoryChange,
  placementColor,
  onPlacementColorChange,
  onChangePlacementDraft,
  onSelectCornerBar,
  onUpdate,
  onPatchCornerBarBars,
  onGoToSummary,
  onDelete,
  onDuplicate,
  canUndo,
  onUndo,
}: {
  cornerBars: DrawingCornerBar[]
  /** 結果ページへのリンク先。末尾に付加筋 集計結果が付く */
  summaryHref: string
  selectedCornerBarId: string | null
  /** 配置ツールが有効なときだけ配置設定を表示 */
  placementModeActive: boolean
  placementDraft: CornerBarPlacementDraft | null
  /** 配置 draft が null でもプルダウン表示用の筋種類 */
  activePlacementCategory: CornerBarCategory
  onActivePlacementCategoryChange: (category: CornerBarCategory) => void
  placementColor: SegmentColor
  onPlacementColorChange: (color: SegmentColor) => void
  onChangePlacementDraft: (draft: CornerBarPlacementDraft | null) => void
  onSelectCornerBar: (id: string | null) => void
  onUpdate: (id: string, updates: Partial<DrawingCornerBar>) => void
  /** 保存時は常に最新の bars から patch を当てる（入力競合対策） */
  onPatchCornerBarBars: (
    id: string,
    patch: (bars: CornerBarBarItem[]) => CornerBarBarItem[],
    /** keepVertexIndex: 図面上で動かさない頂点。辺の長さを変えるときに渡す */
    options?: { keepVertexIndex?: number },
  ) => void
  onGoToSummary: (href: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  canUndo?: boolean
  onUndo?: () => void
}) {
  const selected = useMemo(
    () => cornerBars.find((cb) => cb.id === selectedCornerBarId) ?? null,
    [cornerBars, selectedCornerBarId],
  )
  // くの字は配置ごとの角度で辺の向きが変わるので、角度を反映した形状を使う
  const selectedShape = useMemo(
    () => (selected ? resolveCornerBarShape(selected.shape_type, selected.bars) : null),
    [selected],
  )
  const selectedBars = useMemo(
    () => (selected && selectedShape ? normalizeCornerBarBars(selectedShape, selected) : null),
    [selected, selectedShape],
  )
  const currentSizePx = clampCornerBarSizePx(selected?.size_px ?? DEFAULT_CORNER_BAR_SIZE_PX)

  /** 形状図で強調する辺。辺の入力欄と図を相互に対応づけるためだけの表示状態。
      選択編集と配置設定は同時に出ないので 1 つで足りる */
  const [activeSegIndex, setActiveSegIndex] = useState<number | null>(null)
  // 別の配置を選んだら強調を外す。effect で外すと 1 回前の強調で描いてから描き直すので、描く前に外す
  const [activeSegOwnerId, setActiveSegOwnerId] = useState(selected?.id)
  if (activeSegOwnerId !== selected?.id) {
    setActiveSegOwnerId(selected?.id)
    setActiveSegIndex(null)
  }

  const printSummary = useMemo(
    () => buildCornerBarPrintSummary(cornerBars, normalizeSegmentColor),
    [cornerBars],
  )

  /** 筋種類ごとの配置設定。別の筋種類に鉄筋を引き継がないようにしつつ、
      戻ってきたときだけ前の設定を出す。画面を開いている間だけ覚える */
  const draftByCategoryRef = useRef(
    new Map<CornerBarCategory, CornerBarPlacementDraft | null>(),
  )

  function patchDraft(patch: Partial<CornerBarPlacementDraft>) {
    if (!placementDraft) return
    onChangePlacementDraft({ ...placementDraft, ...patch })
  }

  function handlePlacementCategoryChange(category: CornerBarCategory) {
    onActivePlacementCategoryChange(category)

    const cacheKey = (placementDraft?.category ?? activePlacementCategory) as CornerBarCategory
    draftByCategoryRef.current.set(cacheKey, placementDraft)

    const saved = draftByCategoryRef.current.get(category)
    if (saved) {
      onChangePlacementDraft(
        makeCornerBarDraft(resolveCategoryShape(category, saved.shapeType), saved),
      )
      return
    }

    const rotation = placementDraft?.rotation ?? 0
    onChangePlacementDraft(defaultPlacementDraftForCategory(category, rotation))
  }

  /** 鉄筋リストを保存する。patch は DB 直前の最新 bars に適用される */
  function commitSelectedBars(
    patch: (bars: CornerBarBarItem[]) => CornerBarBarItem[],
    options?: { keepVertexIndex?: number },
  ) {
    if (!selected) return
    onPatchCornerBarBars(selected.id, patch, options)
  }

  function adjustSelectedDrawScale(factor: number) {
    if (
      !selected ||
      !selectedShape ||
      activeSegIndex == null ||
      !isPerEdgeVisualDrawCategory(selected.category)
    ) {
      return
    }
    const segIndex = activeSegIndex
    const shape = selectedShape
    commitSelectedBars(
      (bars) =>
        bars.map((bar) => ({
          ...bar,
          segments: patchCornerBarSegment(shape, bar.segments, segIndex, {
            drawScale: scaleCornerBarDrawScale(bar.segments[segIndex]?.drawScale, factor),
          }),
        })),
      // 選んだ辺の付け根を止め、図面上の他の部分がずれないようにする
      { keepVertexIndex: cornerBarFixedVertexForEdge(segIndex) },
    )
  }

  function handleSelectedSizeDecrease() {
    if (
      selected &&
      activeSegIndex != null &&
      isPerEdgeVisualDrawCategory(selected.category)
    ) {
      adjustSelectedDrawScale(1 / SIZE_STEP)
      return
    }
    if (!selected) return
    onUpdate(selected.id, {
      size_px: clampCornerBarSizePx(currentSizePx / SIZE_STEP),
    })
  }

  function handleSelectedSizeIncrease() {
    if (
      selected &&
      activeSegIndex != null &&
      isPerEdgeVisualDrawCategory(selected.category)
    ) {
      adjustSelectedDrawScale(SIZE_STEP)
      return
    }
    if (!selected) return
    onUpdate(selected.id, {
      size_px: clampCornerBarSizePx(currentSizePx * SIZE_STEP),
    })
  }

  const selectedSizeTitle =
    selected &&
    activeSegIndex != null &&
    isPerEdgeVisualDrawCategory(selected.category)
      ? `辺${selectedShape ? cornerBarSegmentLabel(selectedShape, activeSegIndex) : activeSegIndex + 1}を選択中: 図面上の長さのみ変更（mm は変わりません）`
      : '図面上の全体の大きさを変更'

  function handleSelectedCategoryChange(category: CornerBarCategory) {
    if (!selected || !selectedBars) return
    const shapeType = resolveCategoryShape(category, selected.shape_type)
    const shape = getCornerBarShape(shapeType)
    if (!shape) return
    // 形状が変わると辺の意味も変わるので、そのときだけ寸法を作り直す
    const shapeChanged = shapeType !== selected.shape_type
    const bars = selectedBars.map((bar) =>
      makeCornerBarBar(shape, category, bar.barType, {
        id: bar.id,
        quantity: bar.quantity,
        segments: shapeChanged ? undefined : bar.segments,
        measurementDeductionsMm: bar.measurementDeductionsMm,
      }),
    )
    const updates: Partial<DrawingCornerBar> = {
      category,
      shape_type: shapeType,
      bars,
      ...cornerBarLegacyFieldsFromBars(bars),
      flipped: isFreeShapeCategory(category) ? normalizeCornerBarFlip(selected.flipped) : false,
    }
    onUpdate(selected.id, updates)
  }

  /** 径を変えたら、その径の標準寸法を辺に入れ直す（標準が無い径は空にする） */
  function handleSelectedBarTypeChange(index: number, barType: string) {
    if (!selected || !selectedShape || !selectedBars) return
    const bar = selectedBars[index]
    if (!bar) return
    const next = changeCornerBarBarDiameter(
      selectedShape,
      selected.category as CornerBarCategory,
      bar,
      barType,
    )
    commitSelectedBars((bars) => bars.map((b, i) => (i === index ? next : b)))
  }

  function handleSelectedQuantityChange(index: number, quantity: number) {
    if (!selectedBars) return
    commitSelectedBars((bars) => bars.map((b, i) => (i === index ? { ...b, quantity } : b)))
  }

  function handleSelectedLayerChange(index: number, layer: CornerBarLayer | null) {
    if (!selectedBars) return
    commitSelectedBars((bars) => bars.map((b, i) => (i === index ? withBarLayer(b, layer) : b)))
  }

  /** 鉄筋 1 件の辺の寸法・基準を 1 つだけ差し替える。順序は必ず保つ */
  function handleSelectedSegmentChange(
    barIndex: number,
    segIndex: number,
    patch: Partial<CornerBarSegment>,
  ) {
    if (!selectedShape) return
    const shape = selectedShape
    commitSelectedBars((bars) =>
      bars.map((bar, i) =>
        i === barIndex
          ? { ...bar, segments: patchCornerBarSegment(shape, bar.segments, segIndex, patch) }
          : bar,
      ),
    )
  }

  function handleAddSelectedBar() {
    if (!selected || !selectedShape || !selectedBars) return
    const barType = getNextCornerBarDiameter(selectedBars.map((b) => b.barType))
    commitSelectedBars((bars) => [
      ...bars,
      makeCornerBarBar(selectedShape, selected.category as CornerBarCategory, barType, {
        id: nextCornerBarBarId(bars),
        // 減り・角度は配置で 1 組なので、追加した鉄筋にも同じ値を入れる
        measurementDeductionsMm: bars[0]?.measurementDeductionsMm,
        deductionTotalMm: bars[0]?.deductionTotalMm,
        bendAnglesDeg: bars[0]?.bendAnglesDeg,
        heightMm: bars[0]?.heightMm,
      }),
    ])
  }

  function handleSelectedHeightChange(heightMm: number | null) {
    commitSelectedBars((bars) => setCornerBarHeightMm(bars, heightMm))
  }

  function handleSelectedDeductionsChange(totalMm: number) {
    commitSelectedBars((bars) => setCornerBarDeductionTotal(bars, totalMm))
  }

  function handleSelectedBendAngleChange(joint: number, angleDeg: number) {
    if (!selectedShape) return
    const shape = selectedShape
    commitSelectedBars((bars) => setCornerBarBendAngle(shape, bars, joint, angleDeg))
  }

  function handleRemoveSelectedBar(index: number) {
    if (!selectedBars || selectedBars.length <= 1) return
    commitSelectedBars((bars) => bars.filter((_, i) => i !== index))
  }

  const placementCategory = activePlacementCategory
  const placementShapeOptions = getCornerBarShapeOptionsForCategory(placementCategory)
  const placementShape = placementDraft
    ? resolveCornerBarShape(placementDraft.shapeType, placementDraft.bars)
    : null
  /** 形状未選択のうちは編集できないので、見た目だけ既定の 1 件を出す */
  const placementBars: CornerBarBarItem[] = placementDraft?.bars?.length
    ? placementDraft.bars
    : [{ id: 'b1', barType: DEFAULT_CORNER_BAR_DIAMETER, quantity: 1, segments: [] }]

  function commitPlacementBars(bars: CornerBarBarItem[]) {
    if (!placementDraft) return
    onChangePlacementDraft({ ...placementDraft, bars })
  }

  function handlePlacementBarTypeChange(index: number, barType: string) {
    if (!placementDraft || !placementShape) return
    const bar = placementDraft.bars[index]
    if (!bar) return
    const next = changeCornerBarBarDiameter(
      placementShape,
      placementDraft.category,
      bar,
      barType,
    )
    commitPlacementBars(placementDraft.bars.map((b, i) => (i === index ? next : b)))
  }

  function handlePlacementQuantityChange(index: number, quantity: number) {
    if (!placementDraft) return
    commitPlacementBars(
      placementDraft.bars.map((b, i) => (i === index ? { ...b, quantity } : b)),
    )
  }

  function handlePlacementLayerChange(index: number, layer: CornerBarLayer | null) {
    if (!placementDraft) return
    commitPlacementBars(
      placementDraft.bars.map((b, i) => (i === index ? withBarLayer(b, layer) : b)),
    )
  }

  /** 配置前でも辺の寸法・基準を直せる。配置したらそのまま保存される */
  function handlePlacementSegmentChange(
    barIndex: number,
    segIndex: number,
    patch: Partial<CornerBarSegment>,
  ) {
    if (!placementDraft || !placementShape) return
    const shape = placementShape
    commitPlacementBars(
      placementDraft.bars.map((bar, i) =>
        i === barIndex
          ? { ...bar, segments: patchCornerBarSegment(shape, bar.segments, segIndex, patch) }
          : bar,
      ),
    )
  }

  function handleAddPlacementBar() {
    if (!placementDraft || !placementShape) return
    const barType = getNextCornerBarDiameter(placementDraft.bars.map((b) => b.barType))
    commitPlacementBars([
      ...placementDraft.bars,
      makeCornerBarBar(placementShape, placementDraft.category, barType, {
        id: nextCornerBarBarId(placementDraft.bars),
        measurementDeductionsMm: placementDraft.bars[0]?.measurementDeductionsMm,
        deductionTotalMm: placementDraft.bars[0]?.deductionTotalMm,
        bendAnglesDeg: placementDraft.bars[0]?.bendAnglesDeg,
        heightMm: placementDraft.bars[0]?.heightMm,
      }),
    ])
  }

  function handlePlacementHeightChange(heightMm: number | null) {
    if (!placementDraft) return
    commitPlacementBars(setCornerBarHeightMm(placementDraft.bars, heightMm))
  }

  function handlePlacementDeductionsChange(totalMm: number) {
    if (!placementDraft) return
    commitPlacementBars(setCornerBarDeductionTotal(placementDraft.bars, totalMm))
  }

  function handlePlacementBendAngleChange(joint: number, angleDeg: number) {
    if (!placementDraft || !placementShape) return
    commitPlacementBars(setCornerBarBendAngle(placementShape, placementDraft.bars, joint, angleDeg))
  }

  function handleRemovePlacementBar(index: number) {
    if (!placementDraft || placementDraft.bars.length <= 1) return
    commitPlacementBars(placementDraft.bars.filter((_, i) => i !== index))
  }

  return (
    <div className="w-72 shrink-0 flex flex-col rounded-lg border border-border bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">付加筋一覧 ({cornerBars.length})</h3>
          {onUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="text-[11px] text-muted hover:text-foreground disabled:opacity-40"
            >
              元に戻す
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Selected corner bar editor */}
        {selected && selectedShape && selectedBars && (
          <div className="border-b border-border p-4 space-y-3 bg-blue-50/50">
            <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onSelectCornerBar(null)}
                  className="text-[11px] text-muted hover:text-foreground transition-colors"
                >
                  閉じる
                </button>
                <button
                  type="button"
                  onClick={() => onDuplicate(selected.id)}
                  className="text-xs text-primary hover:underline"
                >
                  複製
                </button>
                <button
                  onClick={() => onDelete(selected.id)}
                  className="text-xs text-danger hover:underline"
                >
                  削除
                </button>
            </div>

            <label className="block text-[10px] text-muted">
              筋種類
              <select
                value={selected.category}
                onChange={(e) => handleSelectedCategoryChange(e.target.value as CornerBarCategory)}
                className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
              >
                {CORNER_BAR_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            {/* 向き・反転（特殊コーナー）・図面上の大きさ */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted">向き</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdate(selected.id, { rotation: nextCornerBarRotation(selected.rotation) })
                  }
                  className="rounded border border-border bg-white px-2 py-1 text-xs hover:bg-gray-50"
                  title="90度ずつ回します"
                >
                  ↻ {cornerBarRotationLabel(selected.rotation)}
                </button>
              </div>
              {isFreeShapeCategory(selected.category) ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted">反転</span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate(selected.id, {
                        flipped: toggleCornerBarFlip(selected.flipped ?? false),
                      })
                    }
                    className="rounded border border-border bg-white px-2 py-1 text-xs hover:bg-gray-50"
                    title="左右反転します"
                  >
                    ⇄ {cornerBarFlipLabel(selected.flipped ?? false)}
                  </button>
                </div>
              ) : null}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted">大きさ</span>
                <button
                  type="button"
                  onClick={handleSelectedSizeDecrease}
                  className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-gray-50"
                  title={selectedSizeTitle}
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={handleSelectedSizeIncrease}
                  className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-gray-50"
                  title={selectedSizeTitle}
                >
                  ＋
                </button>
              </div>
            </div>

            {/* 「辺1」がどの辺かを図で示す。辺の入力欄と相互に強調し合う */}
            <CornerBarSegmentFigure
              shape={selectedShape}
              rotation={selected.rotation}
              flipped={normalizeCornerBarFlip(selected.flipped)}
              segments={
                isPerEdgeVisualDrawCategory(selected.category)
                  ? selectedBars[0]?.segments
                  : undefined
              }
              activeIndex={activeSegIndex}
              onActiveIndexChange={setActiveSegIndex}
              heightMm={cornerBarHeightMm(selectedBars)}
              heightInputId="corner-bar-selected-height"
            />

            {selectedShape.adjustableAngle ? (
              <BendAnglesField
                key={selected.id}
                shape={selectedShape}
                anglesDeg={cornerBarBendAngles(selectedShape, selectedBars)}
                onChange={handleSelectedBendAngleChange}
              />
            ) : null}

            {selectedShape.hasHeight ? (
              <HeightField
                id="corner-bar-selected-height"
                heightMm={cornerBarHeightMm(selectedBars)}
                onChange={handleSelectedHeightChange}
              />
            ) : null}

            {/* 径ごとの本数と辺の寸法。同じ位置でも径によって実寸が違うため個別に持つ */}
            <CornerBarBarsField
              shape={selectedShape}
              category={selected.category as CornerBarCategory}
              showLayer={cornerBarSupportsLayer(selected.category, selected.shape_type)}
              bars={selectedBars}
              showSegments
              activeSegIndex={activeSegIndex}
              onActiveSegIndexChange={setActiveSegIndex}
              onChangeBarType={handleSelectedBarTypeChange}
              onChangeQuantity={handleSelectedQuantityChange}
              onChangeLayer={handleSelectedLayerChange}
              onChangeSegment={handleSelectedSegmentChange}
              onAdd={handleAddSelectedBar}
              onRemove={handleRemoveSelectedBar}
            />
            {!isCornerBarBarsFullyDimensioned(selectedBars) && (
              <p className="text-[10px] text-amber-700">寸法が未入力の辺があります。</p>
            )}

            {isFreeShapeCategory(selected.category) ? (
              <MeasurementDeductionsField
                bars={selectedBars}
                onChange={handleSelectedDeductionsChange}
              />
            ) : null}

            <label className="text-[10px] text-muted">
              色
              <ColorSelect
                value={normalizeSegmentColor(selected.color)}
                onChange={(color) => onUpdate(selected.id, { color })}
              />
            </label>
          </div>
        )}

        {/* 配置設定: 配置ツール中のみ（選択モードでは一覧・要約だけ） */}
        {!selected && placementModeActive && (
        <div className="border-b border-border p-3 space-y-2">
            <label className="block text-[10px] text-muted">
              筋種類
              <select
                value={placementCategory}
                onChange={(e) => handlePlacementCategoryChange(e.target.value as CornerBarCategory)}
                className="mt-0.5 w-full rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
              >
                {CORNER_BAR_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            {/* 添え筋＝ストレート、コーナー筋＝L形 4 向き。それ以外は全形状 */}
            <div>
              <span className="text-[10px] text-muted">形状</span>
              <div
                className={`mt-1 grid gap-1.5 ${
                  placementCategory === 'CORNER'
                    ? 'grid-cols-4'
                    : placementCategory === 'SOE' || placementCategory === 'SPECIAL_CORNER'
                      ? 'grid-cols-2'
                      : 'grid-cols-3'
                }`}
              >
                {placementShapeOptions.map((option) => {
                  const isActive =
                    placementDraft?.shapeType === option.shapeType &&
                    normalizeCornerBarRotation(placementDraft.rotation) === option.rotation
                  return (
                    <button
                      key={option.key}
                      type="button"
                      title={option.label}
                      aria-label={option.label}
                      aria-pressed={isActive}
                      onClick={() => {
                        onChangePlacementDraft(
                          isActive
                            ? null
                            : makeCornerBarDraft(option.shapeType, {
                                ...(placementDraft ?? {
                                  category: placementCategory,
                                }),
                                category: placementCategory,
                                rotation: option.rotation,
                              }),
                        )
                        // 形状を選び直したら、色は筋種類の既定の色に戻す
                        onPlacementColorChange(DEFAULT_CORNER_BAR_COLORS[placementCategory])
                      }}
                      className={`flex items-center justify-center rounded border p-0.5 transition-colors ${
                        isActive
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-white hover:border-primary hover:bg-primary/5'
                      }`}
                    >
                      <svg
                        width={THUMB_W}
                        height={THUMB_H}
                        viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}
                        aria-hidden="true"
                      >
                        <path
                          d={cornerBarThumbPath(option.shape, THUMB_W, THUMB_H, 7, option.rotation)}
                          fill="none"
                          stroke={isActive ? '#2563eb' : '#0f172a'}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 配置する向き・反転（特殊コーナー）。これから置くものにだけ効く */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted">向き</span>
                <button
                  type="button"
                  onClick={() =>
                    patchDraft({ rotation: nextCornerBarRotation(placementDraft?.rotation ?? 0) })
                  }
                  disabled={!placementDraft}
                  className="rounded border border-border bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
                  title="90度ずつ回します"
                >
                  ↻ {cornerBarRotationLabel(placementDraft?.rotation ?? 0)}
                </button>
              </div>
              {isFreeShapeCategory(placementCategory) ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted">反転</span>
                  <button
                    type="button"
                    onClick={() =>
                      patchDraft({
                        flipped: toggleCornerBarFlip(placementDraft?.flipped ?? false),
                      })
                    }
                    disabled={!placementDraft}
                    className="rounded border border-border bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
                    title="左右反転します"
                  >
                    ⇄ {cornerBarFlipLabel(placementDraft?.flipped ?? false)}
                  </button>
                </div>
              ) : null}
            </div>

            {/* 配置前でも「辺1」がどの辺かを図で確かめられるようにする */}
            {placementShape && placementDraft ? (
              <CornerBarSegmentFigure
                shape={placementShape}
                rotation={placementDraft.rotation}
                flipped={normalizeCornerBarFlip(placementDraft.flipped)}
                activeIndex={activeSegIndex}
                onActiveIndexChange={setActiveSegIndex}
                heightMm={cornerBarHeightMm(placementDraft.bars)}
                heightInputId="corner-bar-placement-height"
              />
            ) : null}

            {placementShape?.adjustableAngle && placementDraft ? (
              <BendAnglesField
                key={placementDraft.shapeType}
                shape={placementShape}
                anglesDeg={cornerBarBendAngles(placementShape, placementDraft.bars)}
                onChange={handlePlacementBendAngleChange}
              />
            ) : null}

            {placementShape?.hasHeight && placementDraft ? (
              <HeightField
                id="corner-bar-placement-height"
                heightMm={cornerBarHeightMm(placementDraft.bars)}
                onChange={handlePlacementHeightChange}
              />
            ) : null}

            {/* 径と本数に加えて辺の寸法もここで決める。配置後も右パネルで直せる */}
            <CornerBarBarsField
              shape={placementShape}
              category={placementCategory}
              showLayer={cornerBarSupportsLayer(placementCategory, placementDraft?.shapeType ?? '')}
              bars={placementBars}
              showSegments
              disabled={!placementDraft}
              activeSegIndex={activeSegIndex}
              onActiveSegIndexChange={setActiveSegIndex}
              onChangeBarType={handlePlacementBarTypeChange}
              onChangeQuantity={handlePlacementQuantityChange}
              onChangeLayer={handlePlacementLayerChange}
              onChangeSegment={handlePlacementSegmentChange}
              onAdd={handleAddPlacementBar}
              onRemove={handleRemovePlacementBar}
            />
            {!placementDraft ? (
              <p className="text-[10px] text-muted">
                先に形状を選ぶと鉄筋を設定できます。
              </p>
            ) : (
              !isCornerBarBarsFullyDimensioned(placementDraft.bars) && (
                <p className="text-[10px] text-amber-700">寸法が未入力の辺があります。</p>
              )
            )}

            {isFreeShapeCategory(placementCategory) && placementDraft ? (
              <MeasurementDeductionsField
                bars={placementDraft.bars}
                onChange={handlePlacementDeductionsChange}
              />
            ) : null}

            <label className="text-[10px] text-muted">
              色
              <ColorSelect value={placementColor} onChange={onPlacementColorChange} />
            </label>
        </div>
        )}

        {/* Summary */}
        {cornerBars.length === 0 ? (
          <p className="px-3 pb-3 text-[11px] leading-relaxed text-muted">
            まだ配置されていません。
          </p>
        ) : (
          <div className="border-t border-border px-4 py-3 space-y-2">
            <Link
              href={summaryHref}
              onClick={(e) => {
                e.preventDefault()
                onGoToSummary(summaryHref)
              }}
              className="block rounded-md bg-primary px-2 py-1.5 text-center text-[11px] font-medium text-white hover:bg-primary-hover"
            >
              結果ページを見る
            </Link>
            <div className="flex flex-wrap gap-1">
              {printSummary.categoryCounts.map((c) => (
                <span
                  key={c.category}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    c.count > 0 ? 'bg-primary/10 text-foreground' : 'bg-gray-100 text-muted'
                  }`}
                >
                  {c.label} <span className="font-semibold">{c.count}</span>
                </span>
              ))}
            </div>
            <div className="space-y-0.5 border-t border-border pt-1.5">
              {printSummary.detailRows.map((row) => (
                <div
                  key={`${row.category}/${row.diameter}/${row.layer ?? ''}/${row.color}`}
                  className="flex items-center justify-between gap-2 text-[10px] text-muted"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{
                        backgroundColor: getSegmentStrokeHex(
                          normalizeSegmentColor(row.color),
                          false,
                        ),
                      }}
                    />
                    <span className="truncate">
                      {cornerBarCategoryLabel(row.category)} {cornerBarLayerMark(row.layer)}
                      {row.diameter}
                    </span>
                  </span>
                  <span className="shrink-0 text-foreground">{row.qty} 本</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 1 配置に入る鉄筋の一覧。径と本数は常に、辺の寸法は showSegments のときだけ編集する。
 * 配置設定では形状未選択のあいだ disabled になる。
 */
function CornerBarBarsField({
  shape,
  category,
  showLayer,
  bars,
  showSegments,
  disabled = false,
  activeSegIndex,
  onActiveSegIndexChange,
  onChangeBarType,
  onChangeQuantity,
  onChangeLayer,
  onChangeSegment,
  onAdd,
  onRemove,
}: {
  category: CornerBarCategory
  /** 上・下を選ぶ欄を出すか（特殊コーナー筋の L 形・ストレートだけ） */
  showLayer: boolean
  bars: CornerBarBarItem[]
  showSegments: boolean
  disabled?: boolean
  /** 形状図と対応づけて強調する辺。辺の番号は鉄筋によらず同じ意味なので全カードで共有する */
  activeSegIndex: number | null
  onActiveSegIndexChange: (index: number | null) => void
  onChangeBarType: (index: number, barType: string) => void
  onChangeQuantity: (index: number, quantity: number) => void
  /** 特殊コーナー筋の上・下（null = なし） */
  onChangeLayer?: (index: number, layer: CornerBarLayer | null) => void
  onChangeSegment?: (
    barIndex: number,
    segIndex: number,
    patch: Partial<CornerBarSegment>,
  ) => void
  onAdd: () => void
  onRemove: (index: number) => void
  /** 辺の名前と、同じ寸法になる辺の組を知るため。形状未選択のときは null */
  shape: CornerBarShapeDef | null
}) {
  const activeLeader =
    activeSegIndex != null && shape ? linkedSegmentLeader(shape, activeSegIndex) : activeSegIndex
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-foreground">鉄筋（径と本数）</span>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="text-[11px] text-primary hover:underline disabled:opacity-40"
        >
          ＋ 追加
        </button>
      </div>

      {bars.map((bar, barIdx) => (
        <div key={bar.id} className="space-y-1.5 rounded border border-border bg-white p-1.5">
          <div className="flex items-center gap-1.5">
            {showLayer && onChangeLayer ? (
              <select
                value={bar.layer ?? ''}
                disabled={disabled}
                onChange={(e) =>
                  onChangeLayer(barIdx, (e.target.value || null) as CornerBarLayer | null)
                }
                aria-label="上・下"
                title="上筋・下筋"
                className="w-14 shrink-0 rounded border border-border bg-white px-1 py-1 text-xs outline-none focus:border-primary disabled:opacity-50"
              >
                <option value="">なし</option>
                {CORNER_BAR_LAYERS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.mark}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={bar.barType}
              disabled={disabled}
              onChange={(e) => onChangeBarType(barIdx, e.target.value)}
              className="min-w-0 flex-1 rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary disabled:opacity-50"
            >
              {CORNER_BAR_DIAMETERS.map((d) => (
                <option key={d} value={d}>
                  {cornerBarDiameterOptionLabel(
                    category,
                    d,
                    d === bar.barType ? bar.segments : undefined,
                  )}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={bar.quantity}
              disabled={disabled}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10)
                onChangeQuantity(barIdx, Number.isFinite(n) && n >= 0 ? n : 0)
              }}
              className="w-12 shrink-0 rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary disabled:opacity-50"
            />
            <span className="shrink-0 text-[10px] text-muted">本</span>
            <button
              type="button"
              onClick={() => onRemove(barIdx)}
              disabled={disabled || bars.length <= 1}
              className="shrink-0 text-[11px] text-danger hover:underline disabled:opacity-30"
              title={bars.length <= 1 ? '最後の1件は削除できません' : '削除'}
            >
              削除
            </button>
          </div>

          {showSegments && onChangeSegment && bar.segments.length > 0 ? (
            <div className="space-y-1 border-t border-border pt-1.5">
              {(shape?.inputOrder ?? bar.segments.map((_, i) => i)).map((segIdx) => {
                const seg = bar.segments[segIdx]
                if (!seg) return null
                // 組になった辺（四角の 4 辺など）は先頭の辺の欄だけで入力する
                if (shape && linkedSegmentLeader(shape, segIdx) !== segIdx) return null
                const isActiveSeg = segIdx === activeLeader
                const segLabel = shape ? cornerBarSegmentLabel(shape, segIdx) : String(segIdx + 1)
                const linkedCount = shape ? linkedSegmentIndices(shape, segIdx).length : 1
                return (
                <div
                  key={seg.id}
                  className={`flex items-center gap-1.5 rounded px-0.5 ${
                    isActiveSeg ? 'bg-primary/10' : ''
                  }`}
                >
                  <button
                    type="button"
                    aria-label={`辺${segLabel}を選択`}
                    title={`辺${segLabel}を選択（大きさ±で図面上の長さを変更）${
                      linkedCount > 1 ? `。${linkedCount} 辺とも同じ寸法` : ''
                    }`}
                    onClick={() =>
                      onActiveSegIndexChange(isActiveSeg ? null : segIdx)
                    }
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[10px] font-semibold leading-none outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                      isActiveSeg
                        ? 'border-primary bg-primary text-white'
                        : 'border-slate-400 bg-white text-slate-600 hover:border-primary/60'
                    }`}
                  >
                    {segLabel}
                  </button>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="mm"
                    value={seg.lengthMm ?? ''}
                    onFocus={() => onActiveSegIndexChange(segIdx)}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        onChangeSegment(barIdx, segIdx, { lengthMm: null })
                        return
                      }
                      const n = Number.parseFloat(raw)
                      if (!Number.isFinite(n) || n <= 0) return
                      onChangeSegment(barIdx, segIdx, { lengthMm: n })
                    }}
                    className="min-w-0 flex-1 rounded border border-border bg-white px-1.5 py-1 text-xs outline-none focus:border-primary"
                  />
                  <select
                    value={seg.measurementType ?? ''}
                    onChange={(e) =>
                      onChangeSegment(barIdx, segIdx, {
                        measurementType: (e.target.value || null) as MeasurementType | null,
                      })
                    }
                    className="w-[68px] shrink-0 rounded border border-border bg-white px-1 py-1 text-xs outline-none focus:border-primary"
                  >
                    <option value="">標準</option>
                    {MEASUREMENT_TYPES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                )
              })}
              <div className="text-right text-[10px] text-muted">
                合計 {cornerBarSegmentSumMm(bar.segments).toLocaleString('ja-JP')} mm
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** −/＋ ボタン 1 回で変える角度 */
const BEND_ANGLE_STEP_DEG = 5

/** 辺のあいだごとの角度。辺のあいだが 1 つ（くの字）なら「角度」、複数なら「①-②」のように辺の番号で示す */
function BendAnglesField({
  shape,
  anglesDeg,
  onChange,
}: {
  shape: CornerBarShapeDef
  anglesDeg: number[]
  onChange: (joint: number, angleDeg: number) => void
}) {
  if (anglesDeg.length === 0) return null
  return (
    <div className="space-y-1">
      {anglesDeg.length > 1 ? (
        <div className="text-[10px] font-medium text-foreground">
          角度
          <span className="ml-1 font-normal text-muted">
            （{MIN_CORNER_BAR_BEND_ANGLE_DEG}〜{MAX_CORNER_BAR_BEND_ANGLE_DEG}°）
          </span>
        </div>
      ) : null}
      {anglesDeg.map((angleDeg, joint) => (
        <BendAngleField
          key={joint}
          label={
            anglesDeg.length > 1
              ? `${cornerBarSegmentLabel(shape, joint)}-${cornerBarSegmentLabel(shape, joint + 1)}`
              : '角度'
          }
          showRange={anglesDeg.length === 1}
          angleDeg={angleDeg}
          onChange={(deg) => onChange(joint, deg)}
        />
      ))}
    </div>
  )
}

/**
 * 辺のあいだの角度 1 つ。入力中は文字列で持ち、確定（フォーカスを外す / Enter）で反映する。
 * 1 文字ごとに反映すると、10 未満を打った途中で下限に丸められてしまうため。
 */
function BendAngleField({
  label,
  showRange,
  angleDeg,
  onChange,
}: {
  label: string
  showRange: boolean
  angleDeg: number
  onChange: (angleDeg: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft == null) return
    setDraft(null)
    const n = Number.parseFloat(draft)
    if (Number.isFinite(n)) onChange(clampCornerBarBendAngle(Math.round(n)))
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="min-w-8 text-[10px] font-medium text-foreground">{label}</span>
      <button
        type="button"
        onClick={() => onChange(clampCornerBarBendAngle(angleDeg - BEND_ANGLE_STEP_DEG))}
        disabled={angleDeg <= MIN_CORNER_BAR_BEND_ANGLE_DEG}
        className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-gray-50 disabled:opacity-40"
        aria-label="角度を小さくする"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={draft ?? String(angleDeg)}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
        aria-label={`${label} の角度（度）`}
        className="w-14 rounded border border-border bg-white px-1 py-0.5 text-right text-xs outline-none focus:border-primary"
      />
      <span className="text-xs text-muted">°</span>
      <button
        type="button"
        onClick={() => onChange(clampCornerBarBendAngle(angleDeg + BEND_ANGLE_STEP_DEG))}
        disabled={angleDeg >= MAX_CORNER_BAR_BEND_ANGLE_DEG}
        className="rounded border border-border bg-white px-2 py-0.5 text-xs hover:bg-gray-50 disabled:opacity-40"
        aria-label="角度を大きくする"
      >
        ＋
      </button>
      {showRange ? (
        <span className="text-[10px] text-muted">
          （{MIN_CORNER_BAR_BEND_ANGLE_DEG}〜{MAX_CORNER_BAR_BEND_ANGLE_DEG}°）
        </span>
      ) : null}
    </div>
  )
}

/** 段違い・斜めの高さ(mm)。図に書くだけで加工長には使わない */
function HeightField({
  id,
  heightMm,
  onChange,
}: {
  id: string
  heightMm: number | null
  onChange: (heightMm: number | null) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-muted">
      <span className="shrink-0 font-medium text-foreground">高さ</span>
      <input
        id={id}
        type="number"
        min={0}
        step="any"
        placeholder="mm"
        value={heightMm ?? ''}
        onChange={(e) => {
          const n = Number.parseFloat(e.target.value)
          onChange(Number.isFinite(n) && n > 0 ? n : null)
        }}
        aria-label="高さ(mm)"
        className="w-20 rounded border border-border bg-white px-1 py-1 text-xs text-foreground outline-none [appearance:textfield] focus:border-primary [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="shrink-0">mm（加工長には入りません）</span>
    </label>
  )
}

/**
 * 特殊コーナー筋の加工長で、辺の合計から引く長さ（全体で何 mm 引くか）を入れる欄。
 * 配置ごとに 1 つ（全ての鉄筋に同じ値を書く）。下に径ごとの加工長を出して確かめられるようにする。
 */
function MeasurementDeductionsField({
  bars,
  onChange,
}: {
  bars: CornerBarBarItem[]
  onChange: (totalMm: number) => void
}) {
  const totalMm = cornerBarDeductionTotal(bars)

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-[10px] text-muted">
        <span className="shrink-0 font-medium text-foreground">寸法の減り（全体）</span>
        <span className="shrink-0">−</span>
        <input
          type="number"
          min={0}
          step="any"
          value={totalMm}
          onChange={(e) => {
            const n = Number.parseFloat(e.target.value)
            onChange(Number.isFinite(n) && n >= 0 ? n : 0)
          }}
          aria-label="辺の合計から引く長さ(mm)"
          // 数値入力の上下ボタンは出さない（ほかの寸法欄と揃える）
          className="w-20 rounded border border-border bg-white px-1 py-1 text-xs text-foreground outline-none [appearance:textfield] focus:border-primary [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="shrink-0">mm</span>
      </label>
      <div className="space-y-0.5 text-right text-[10px] text-muted">
        {bars.map((bar) => {
          // 特殊コーナー筋は既定の −20 ルールを使わない（未入力は 0）
          const kakouchou = cornerBarKakouchouMm(
            bar.segments,
            bar.measurementDeductionsMm ?? ZERO_MEASUREMENT_DEDUCTIONS,
            bar.deductionTotalMm,
          )
          return (
            <div key={bar.id}>
              {bars.length > 1 ? `${bar.barType} ` : ''}寸法{' '}
              {kakouchou == null ? '—' : `${kakouchou.toLocaleString('ja-JP')} mm`}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const FIG_W = 220
/** 縦長の階段形でも形が潰れない高さ。低くすると辺が詰まって番号バッジ同士が重なる
 *  （H=132 では 2段階段のバッジ間が 8px しかなく、直径 16px のバッジが重なった） */
const FIG_H = 200
/** 番号バッジ（半径 8）と法線方向のずれ（13）が収まる余白 */
const FIG_PAD = 24
const FIG_LABEL_GAP = 13
const FIG_BADGE_R = 8
/** 継手の辺（四角の a・b）を元の辺から内側へずらす幅 */
const FIG_LAP_INSET = 6
/** 高さの寸法線と数字のために右に空ける幅 */
const FIG_HEIGHT_ROOM = 30

/**
 * 辺の番号を書き込んだ形状図。「辺1」がどの辺なのかを目で確かめるためのもの。
 *
 * 配置の向き（rotation）と反転（flipped）を反映するので、図面上の見た目と同じ向きで出る。
 * 辺が 1 本しかない形状（添え筋のストレート）は取り違えようがないので描かない。
 */
function CornerBarSegmentFigure({
  shape,
  rotation,
  flipped = false,
  segments,
  activeIndex,
  onActiveIndexChange,
  heightMm,
  heightInputId,
}: {
  shape: CornerBarShapeDef
  rotation: number
  flipped?: boolean
  segments?: CornerBarSegment[]
  activeIndex: number | null
  onActiveIndexChange: (index: number | null) => void
  /** 高さを入れられる形状のときの入力値（未入力は null） */
  heightMm?: number | null
  /** 高さの寸法線を押したときにフォーカスする入力欄 */
  heightInputId?: string
}) {
  // 高さの寸法線と数字を形の右に置くので、その分だけ形を左に寄せる
  const points = cornerBarThumbPoints(
    shape,
    shape.hasHeight ? FIG_W - FIG_HEIGHT_ROOM : FIG_W,
    FIG_H,
    FIG_PAD,
    rotation,
    flipped,
    segments,
    activeIndex,
  )
  if (points.length < 3) return null

  const pieces = cornerBarStrokePieces(shape, points, FIG_LAP_INSET)
  // 継手の辺は内側へずらして描くので、番号もずらした線に合わせる
  const anchors = cornerBarSegmentLabelAnchors(points, FIG_LABEL_GAP).map((anchor) => {
    const piece = pieces[anchor.index]
    if (piece?.kind === 'arc') {
      // フックの半円の外へ出す（中点からの向きはそのまま、半径の分だけ遠くする）
      const k = (FIG_LABEL_GAP + piece.radius) / FIG_LABEL_GAP
      return {
        ...anchor,
        x: anchor.mx + (anchor.x - anchor.mx) * k,
        y: anchor.my + (anchor.y - anchor.my) * k,
      }
    }
    if (!piece || !shape.lapSegments?.includes(anchor.index)) return anchor
    const mx = (piece.p1.x + piece.p2.x) / 2
    const my = (piece.p1.y + piece.p2.y) / 2
    // anchor は中点から外向きに FIG_LABEL_GAP 離れている
    const ox = (anchor.x - anchor.mx) / FIG_LABEL_GAP
    const oy = (anchor.y - anchor.my) / FIG_LABEL_GAP
    // 継手（四角の a）は外に出すと重なっている辺の番号とぶつかるので内側へ置く
    const side = linkedSegmentIndices(shape, anchor.index).length > 1 ? 1 : -1
    return {
      ...anchor,
      x: mx + ox * FIG_LABEL_GAP * side,
      y: my + oy * FIG_LABEL_GAP * side,
      mx,
      my,
    }
  })
  const activeIndices = activeIndex != null ? linkedSegmentIndices(shape, activeIndex) : []

  // 高さは資料と同じく形の右に縦の寸法線で示す（未入力のうちは「高さ」と出す）
  const heightMark = (() => {
    if (!shape.hasHeight) return null
    const ys = points.map((p) => p.y)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    if (bottom - top < 1) return null
    return { x: Math.max(...points.map((p) => p.x)) + 8, top, bottom }
  })()

  return (
    <div className="rounded border border-border bg-white p-1">
      <svg
        width="100%"
        viewBox={`0 0 ${FIG_W} ${FIG_H}`}
        role="img"
        aria-label={`${shape.label}の辺の並び`}
      >
        {heightMark ? (
          <g
            role="button"
            tabIndex={0}
            aria-label="高さを入力"
            className="cursor-pointer outline-none"
            onClick={() => heightInputId && document.getElementById(heightInputId)?.focus()}
          >
            <path
              d={`M${heightMark.x} ${heightMark.top} V${heightMark.bottom} M${heightMark.x - 4} ${heightMark.top} H${heightMark.x + 4} M${heightMark.x - 4} ${heightMark.bottom} H${heightMark.x + 4}`}
              fill="none"
              stroke={heightMm != null ? '#0f172a' : '#94a3b8'}
              strokeWidth={1.2}
            />
            <text
              x={heightMark.x + 6}
              y={(heightMark.top + heightMark.bottom) / 2}
              dominantBaseline="central"
              fontSize={10}
              fontWeight={600}
              fill={heightMm != null ? '#0f172a' : '#94a3b8'}
            >
              {heightMm ?? '高さ'}
            </text>
          </g>
        ) : null}
        {shape.doubleLine ? (
          <path
            d={cornerBarStrokePathD(shape, points, FIG_LAP_INSET)}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={2}
            strokeLinejoin="round"
            pointerEvents="none"
          />
        ) : null}
        {pieces.map((piece) => {
          const isActive = activeIndices.includes(piece.index)
          // 二重線の形状は輪郭を上で描いたので、選んだ辺だけ中心線で示す
          if (shape.doubleLine && !isActive) return null
          return (
            <path
              key={piece.index}
              d={cornerBarStrokePieceD(piece)}
              fill="none"
              stroke={isActive ? '#2563eb' : '#94a3b8'}
              strokeWidth={isActive ? 3.5 : 2.5}
              strokeLinecap="round"
              pointerEvents="none"
            />
          )
        })}
        {/* 曲げの位置が分かるように節点に小さな印を打つ */}
        {points.slice(1, -1).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#0f172a" />
        ))}
        {/* 番号と当たり判定は最後に重ねる。細い線のままでは狙いにくいので判定だけ太くする */}
        {anchors.map((anchor) => {
          const piece = pieces[anchor.index]
          if (!piece) return null
          const isActive = activeIndices.includes(anchor.index)
          const label = cornerBarSegmentLabel(shape, anchor.index)
          return (
            <g
              key={anchor.index}
              role="button"
              tabIndex={0}
              aria-label={`辺${label}を選択`}
              aria-pressed={isActive}
              className="cursor-pointer outline-none"
              onClick={() =>
                onActiveIndexChange(isActive ? null : anchor.index)
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onActiveIndexChange(isActive ? null : anchor.index)
                }
              }}
            >
              <path
                d={cornerBarStrokePieceD(piece)}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                strokeLinecap="round"
              />
              <circle
                cx={anchor.x}
                cy={anchor.y}
                r={FIG_BADGE_R}
                fill={isActive ? '#2563eb' : '#ffffff'}
                stroke={isActive ? '#2563eb' : '#94a3b8'}
                strokeWidth={1.5}
              />
              <text
                x={anchor.x}
                y={anchor.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10}
                fontWeight={600}
                fill={isActive ? '#ffffff' : '#475569'}
              >
                {label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function ColorSelect({
  value,
  onChange,
}: {
  value: SegmentColor
  onChange: (color: SegmentColor) => void
}) {
  const [open, setOpen] = useState(false)
  const current =
    SEGMENT_COLOR_DEFINITIONS.find((d) => d.id === value) ?? SEGMENT_COLOR_DEFINITIONS[0]!

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-0.5 flex w-full items-center gap-2 rounded border border-border bg-white px-2 py-1.5 text-xs outline-none hover:bg-gray-50 focus:border-primary"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/10"
          style={{ backgroundColor: current.stroke }}
          aria-hidden
        />
        <span className="flex-1 text-left text-foreground">{current.labelJa}</span>
        <span className="text-muted" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            aria-label="閉じる"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded border border-border bg-white py-1 shadow-md"
            role="listbox"
          >
            {SEGMENT_COLOR_DEFINITIONS.map((d) => {
              const active = d.id === value
              return (
                <button
                  key={d.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(d.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-gray-50 ${
                    active ? 'bg-primary/5 font-medium' : ''
                  }`}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/10"
                    style={{ backgroundColor: d.stroke }}
                    aria-hidden
                  />
                  <span className="text-foreground">{d.labelJa}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

/** 鉄筋 1 件の上・下を差し替える。なし（null）のときは項目ごと外す */
function withBarLayer(bar: CornerBarBarItem, layer: CornerBarLayer | null): CornerBarBarItem {
  const next = { ...bar }
  if (layer) next.layer = layer
  else delete next.layer
  return next
}
