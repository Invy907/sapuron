import assert from 'node:assert'
import {
  applyCornerBarOrientation,
  buildCornerBarGeometry,
  cornerBarGeometryEdgeLength,
  cornerBarThumbPoints,
  DEFAULT_CORNER_BAR_PLACEMENT_SIZE_PX,
  DEFAULT_SOE_PLACEMENT_SIZE_PX,
  DEFAULT_SPECIAL_CORNER_PLACEMENT_SIZE_PX,
  defaultPlacementDraftForCategory,
  getCornerBarShape,
  getDefaultCornerBarSizePxForPlacement,
  getStandardSegmentLengthsMm,
  makeCornerBarDraft,
  makeCornerBarSegments,
  makeCornerBarBar,
  changeCornerBarBarDiameter,
  normalizeCornerBarSegments,
  patchCornerBarSegment,
  cornerBarStrokePieces,
  cornerBarStrokePathD,
  ZERO_MEASUREMENT_DEDUCTIONS,
  type CornerBarSegment,
} from './corner-bar-presets'
import { cornerBarKakouchouMm } from './corner-bar-kakouchou'

function thumbEdgeLen(points: Array<{ x: number; y: number }>, edgeIndex: number): number {
  const p1 = points[edgeIndex]
  const p2 = points[edgeIndex + 1]
  if (!p1 || !p2) return 0
  return Math.hypot(p2.x - p1.x, p2.y - p1.y)
}

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    console.error(`✗ ${name}`)
    throw e
  }
}

test('click placement uses default size_px by category', () => {
  assert.equal(getDefaultCornerBarSizePxForPlacement('CORNER'), DEFAULT_CORNER_BAR_PLACEMENT_SIZE_PX)
  assert.equal(getDefaultCornerBarSizePxForPlacement('CORNER'), 33)
  assert.equal(getDefaultCornerBarSizePxForPlacement('SOE'), DEFAULT_SOE_PLACEMENT_SIZE_PX)
  assert.equal(getDefaultCornerBarSizePxForPlacement('SOE'), 50)
  assert.equal(
    getDefaultCornerBarSizePxForPlacement('SPECIAL_CORNER'),
    DEFAULT_SPECIAL_CORNER_PLACEMENT_SIZE_PX,
  )
  assert.equal(getDefaultCornerBarSizePxForPlacement('SPECIAL_CORNER'), 66)
})

test('CORNER L D13 standard mm is 600 × 600', () => {
  assert.deepEqual(getStandardSegmentLengthsMm('CORNER', 'D13', 'L'), [600, 600])
})

test('CORNER L D22 / D25 standard mm', () => {
  assert.deepEqual(getStandardSegmentLengthsMm('CORNER', 'D22', 'L'), [1000, 1000])
  assert.deepEqual(getStandardSegmentLengthsMm('CORNER', 'D25', 'L'), [1150, 1150])
})

test('SOE STRAIGHT D13 standard mm is 1200 (2 × corner leg)', () => {
  assert.deepEqual(getStandardSegmentLengthsMm('SOE', 'D13', 'STRAIGHT'), [1200])
})

test('flip mirrors x before rotation', () => {
  assert.deepEqual(applyCornerBarOrientation({ x: 10, y: 0 }, 0, true), { x: -10, y: 0 })
  assert.deepEqual(applyCornerBarOrientation({ x: 10, y: 0 }, 1, true), { x: 0, y: -10 })
})

test('defaultPlacementDraftForCategory SPECIAL_CORNER uses first palette shape', () => {
  const draft = defaultPlacementDraftForCategory('SPECIAL_CORNER')
  assert.equal(draft.category, 'SPECIAL_CORNER')
  assert.equal(draft.shapeType, 'V_OFFSET')
})

test('makeCornerBarDraft L CORNER D13 fills 600 × 600 on segments', () => {
  const draft = makeCornerBarDraft('L', { category: 'CORNER' })
  assert.equal(draft.bars.length, 1)
  assert.equal(draft.bars[0]!.barType, 'D13')
  assert.deepEqual(
    draft.bars[0]!.segments.map((s) => s.lengthMm),
    [600, 600],
  )
})

test('buildCornerBarGeometry drawScale enlarges one edge on canvas', () => {
  const shape = getCornerBarShape('L')
  assert.ok(shape)
  const baseSegs: CornerBarSegment[] = [
    { lengthMm: 600, drawScale: 1 },
    { lengthMm: 600, drawScale: 1 },
  ]
  const scaledSegs: CornerBarSegment[] = [
    { lengthMm: 600, drawScale: 1.5 },
    { lengthMm: 600, drawScale: 1 },
  ]
  const base = buildCornerBarGeometry(shape, baseSegs, 100)
  const scaled = buildCornerBarGeometry(shape, scaledSegs, 100)
  const e0Base = cornerBarGeometryEdgeLength(base, 0)
  const e1Base = cornerBarGeometryEdgeLength(base, 1)
  const e0Scaled = cornerBarGeometryEdgeLength(scaled, 0)
  const e1Scaled = cornerBarGeometryEdgeLength(scaled, 1)
  assert.ok(Math.abs(e0Base - e1Base) < 0.01)
  assert.ok(e0Scaled > e0Base)
  assert.ok(Math.abs(e1Scaled - e1Base) < 0.02)
})

test('cornerBarThumbPoints anchor keeps active edge length stable', () => {
  const shape = getCornerBarShape('L')
  assert.ok(shape)
  const FIG_W = 120
  const FIG_H = 90
  const PAD = 8
  const baselineSegs: CornerBarSegment[] = [
    { lengthMm: 600, drawScale: 1 },
    { lengthMm: 600, drawScale: 1 },
  ]
  const scaledSegs: CornerBarSegment[] = [
    { lengthMm: 600, drawScale: 1.5 },
    { lengthMm: 600, drawScale: 1 },
  ]
  const basePts = cornerBarThumbPoints(
    shape,
    FIG_W,
    FIG_H,
    PAD,
    0,
    false,
    baselineSegs,
    0,
  )
  const scaledPts = cornerBarThumbPoints(
    shape,
    FIG_W,
    FIG_H,
    PAD,
    0,
    false,
    scaledSegs,
    0,
  )
  const e0Base = thumbEdgeLen(basePts, 0)
  const e1Base = thumbEdgeLen(basePts, 1)
  const e0Scaled = thumbEdgeLen(scaledPts, 0)
  const e1Scaled = thumbEdgeLen(scaledPts, 1)
  assert.ok(Math.abs(e0Scaled - e0Base) / e0Base < 0.02)
  assert.ok(e1Scaled < e1Base * 0.95)
})

test('panel thumb does not shrink non-anchor edge below quarter of anchor', () => {
  const shape = getCornerBarShape('L')
  assert.ok(shape)
  const FIG_W = 120
  const FIG_H = 90
  const PAD = 8
  const extremeSegs: CornerBarSegment[] = [
    { lengthMm: 600, drawScale: 12 },
    { lengthMm: 600, drawScale: 1 },
  ]
  const pts = cornerBarThumbPoints(shape, FIG_W, FIG_H, PAD, 0, false, extremeSegs, 0)
  const e0 = thumbEdgeLen(pts, 0)
  const e1 = thumbEdgeLen(pts, 1)
  assert.ok(e1 / e0 >= 0.24)
})

test('OPENING draft starts with the ring and is flippable', () => {
  const draft = defaultPlacementDraftForCategory('OPENING')
  assert.equal(draft.category, 'OPENING')
  assert.equal(draft.shapeType, 'OPENING_RING')
  assert.equal(getDefaultCornerBarSizePxForPlacement('OPENING'), 66)
  assert.equal(makeCornerBarDraft('OPENING_CRANK', { category: 'OPENING', flipped: true }).flipped, true)
})

test('OPENING shapes start with the values from the customer sheet', () => {
  const hook = makeCornerBarDraft('OPENING_HOOK_L', { category: 'OPENING' })
  const bar = hook.bars[0]!
  assert.equal(bar.barType, 'D10')
  assert.deepEqual(bar.segments.map((s) => s.lengthMm), [100, 620, 100])
  assert.deepEqual(bar.segments.map((s) => s.measurementType), [null, 'SOTO_SOTO', null])
  assert.equal(bar.deductionTotalMm, 20)
  const hookShape = getCornerBarShape('OPENING_HOOK_L')!
  const hookD13 = changeCornerBarBarDiameter(hookShape, 'OPENING', bar, 'D13')
  assert.deepEqual(hookD13.segments.map((s) => s.lengthMm), [100, 380, 100])
  assert.deepEqual(hookD13.segments.map((s) => s.measurementType), [null, 'SOTO_SOTO', null])
  const hookD16 = changeCornerBarBarDiameter(hookShape, 'OPENING', bar, 'D16')
  assert.ok(hookD16.segments.every((s) => s.lengthMm == null))
  const lShape = getCornerBarShape('OPENING_L')!
  const lD13 = makeCornerBarBar(lShape, 'OPENING', 'D13', { id: 'b1' })
  assert.deepEqual(lD13.segments.map((s) => s.lengthMm), [380, 100])
  assert.deepEqual(lD13.segments.map((s) => s.measurementType), ['SOTO_SOTO', null])

  // 別の形状に変えたら、その形状の標準の径・寸法に入れ替わる
  const crank = makeCornerBarDraft('OPENING_CRANK', hook)
  assert.equal(crank.bars[0]!.barType, 'D13')
  assert.deepEqual(crank.bars[0]!.segments.map((s) => s.lengthMm), [150, 450, 650])
  assert.equal(crank.bars[0]!.heightMm, 320)
  assert.equal(crank.bars[0]!.deductionTotalMm, undefined)

  const ring = defaultPlacementDraftForCategory('OPENING').bars[0]!
  assert.deepEqual(ring.segments.map((s) => s.lengthMm), [100, 350, 350, 350, 350, 100])
  assert.equal(ring.deductionTotalMm, 80)
  assert.equal(cornerBarKakouchouMm(ring.segments, ZERO_MEASUREMENT_DEDUCTIONS, ring.deductionTotalMm), 1520)

  // 資料の値は D13 のときだけ。ほかの径に変えたら空にし、D13 に戻したらまた入る
  const ringShape = getCornerBarShape('OPENING_RING')!
  const d10 = changeCornerBarBarDiameter(ringShape, 'OPENING', ring, 'D10')
  assert.deepEqual(d10.segments.map((s) => s.lengthMm), [null, null, null, null, null, null])
  assert.ok(d10.segments.every((s) => s.measurementType == null))
  const back = changeCornerBarBarDiameter(ringShape, 'OPENING', d10, 'D13')
  assert.deepEqual(back.segments.map((s) => s.lengthMm), [100, 350, 350, 350, 350, 100])

  // 追加した別の径の鉄筋も空から始まる
  const added = makeCornerBarBar(ringShape, 'OPENING', 'D10', { id: 'b2' })
  assert.ok(added.segments.every((s) => s.lengthMm == null))
})

test('OPENING_RING keeps the 4 sides equal and sums 4 sides + laps', () => {
  const shape = getCornerBarShape('OPENING_RING')
  assert.ok(shape)
  const segments = makeCornerBarSegments(shape)
  const edited = patchCornerBarSegment(shape, segments, 2, { lengthMm: 800 })
  assert.deepEqual(
    edited.map((s) => s.lengthMm),
    [null, 800, 800, 800, 800, null],
  )
  // 保存値が揃っていなくても、読み込むと先頭の辺に揃える
  const normalized = normalizeCornerBarSegments(shape, [
    { lengthMm: 200 },
    { lengthMm: 700 },
    { lengthMm: 1 },
    { lengthMm: 2 },
    { lengthMm: 3 },
    { lengthMm: 250 },
  ])
  assert.deepEqual(
    normalized.map((s) => s.lengthMm),
    [200, 700, 700, 700, 700, 250],
  )
  assert.equal(cornerBarKakouchouMm(normalized, ZERO_MEASUREMENT_DEDUCTIONS), 700 * 4 + 200 + 250)
})

test('OPENING_HOOK_L draws the hook as an arc bulging away from the leg', () => {
  const shape = getCornerBarShape('OPENING_HOOK_L')
  assert.ok(shape)
  // フックの先 (20,0) → 縦の上端 (0,0) → 下 (0,100) → 右 (80,100)
  const points = [
    { x: 20, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 80, y: 100 },
  ]
  const pieces = cornerBarStrokePieces(shape, points, 0)
  assert.equal(pieces[0]!.kind, 'arc')
  // 右 → 左へ進む円弧が上（縦の辺と反対側）へふくらむのは sweep=0
  assert.equal(pieces[0]!.kind === 'arc' && pieces[0]!.sweep, 0)
  assert.equal(pieces[1]!.kind, 'line')
  // 半円が箱からはみ出さない
  const thumb = cornerBarThumbPoints(shape, 56, 42, 7)
  assert.ok(Math.min(...thumb.map((p) => p.y)) >= 7)
})

test('OPENING_BRACKET is drawn as a closed double-line outline', () => {
  const shape = getCornerBarShape('OPENING_BRACKET')
  assert.ok(shape)
  // 左 → 下 → 右 のコの字を幅 2（片側 1）で囲む
  const d = cornerBarStrokePathD(
    shape,
    [
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ],
    1,
  )
  assert.equal(
    d,
    'M10.0 -1.0 L-1.0 -1.0 L-1.0 11.0 L10.0 11.0 L10.0 9.0 L1.0 9.0 L1.0 1.0 L10.0 1.0 Z',
  )
})

test('OPENING_RING laps are drawn inside the square', () => {
  const shape = getCornerBarShape('OPENING_RING')
  assert.ok(shape)
  const points = [
    { x: 80, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 20 },
  ]
  const pieces = cornerBarStrokePieces(shape, points, 4)
  // a は上の辺の内側、右の辺も内側に寄り、右上の角が 2 つに分かれる
  assert.deepEqual(pieces[0]!.p1, { x: 80, y: 4 })
  assert.deepEqual(pieces[0]!.p2, { x: 96, y: 4 })
  assert.deepEqual(pieces[1]!.p2, { x: 96, y: 100 })
  // 上の辺は外の角まで行き、b は右の辺の外側を下りる
  assert.deepEqual(pieces[4]!.p2, { x: 100, y: 0 })
  assert.deepEqual(pieces[5]!.p2, { x: 100, y: 20 })
})
