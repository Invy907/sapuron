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
  type CornerBarSegment,
} from './corner-bar-presets'

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
