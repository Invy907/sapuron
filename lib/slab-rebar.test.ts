import assert from 'node:assert'
import {
  DEFAULT_DOMA_BAR_SETTINGS,
  domaDiameterOptionLabel,
  domaSettingsWithDiameter,
  DEFAULT_SLAB_REBAR_SETTINGS,
  aggregateSchedule,
  computeDomaPiece,
  defaultDomaStraightMm,
  buildSchedule,
  countBars,
  decomposeBands,
  shapeOutline,
  splitRun,
  type SlabShape,
} from './slab-rebar'

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    console.error(`✗ ${name}`)
    throw e
  }
}

const settings = DEFAULT_SLAB_REBAR_SETTINGS

const lengths = (L: number) => splitRun(L, settings).pieces.map((p) => `${p.kind}:${p.lengthMm}`)

test('splitRun: 資料A の各区間', () => {
  assert.deepStrictEqual(lengths(5460), ['BENT:6000', 'BENT:360'])
  assert.deepStrictEqual(lengths(8190), ['BENT:6000', 'BENT:3090'])
  assert.deepStrictEqual(lengths(6370), ['BENT:6000', 'BENT:1270'])
  assert.deepStrictEqual(lengths(12740), ['BENT:6000', 'STRAIGHT:6000', 'BENT:2240'])
})

test('splitRun: 曲げ長さを変えると端部本の長さが変わる', () => {
  const pieces = splitRun(8190, { ...settings, bendMm: 100 }).pieces
  assert.deepStrictEqual(
    pieces.map((p) => p.lengthMm),
    [6000, 2990]
  )
})

test('splitRun: 最後の本の直線部が重ね長さ未満なら警告', () => {
  assert.ok(splitRun(5460, settings).warnings.includes('LAST_PIECE_SHORTER_THAN_LAP'))
  assert.deepStrictEqual(splitRun(8190, settings).warnings, [])
})

test('countBars: 切り上げ', () => {
  assert.strictEqual(countBars(6370, 200), 32)
  assert.strictEqual(countBars(2730, 200), 14)
  assert.strictEqual(countBars(5460, 200), 28)
  assert.strictEqual(countBars(6000, 200), 30)
})

const shapeA: SlabShape = {
  type: 'l',
  widthMm: 12740,
  heightMm: 8190,
  cutCorner: 'tl',
  cutWidthMm: 6370,
  cutHeightMm: 2730,
}

test('decomposeBands: 資料A の L 字は方向ごとに 2 帯', () => {
  const outline = shapeOutline(shapeA)
  const tate = decomposeBands(outline, 'tate').map((b) => [b.spanMm, b.runLengthMm])
  const yoko = decomposeBands(outline, 'yoko').map((b) => [b.spanMm, b.runLengthMm])
  assert.deepStrictEqual(tate, [
    [6370, 5460],
    [6370, 8190],
  ])
  assert.deepStrictEqual(yoko, [
    [2730, 6370],
    [5460, 12740],
  ])
})

test('decomposeBands: 長方形は 1 帯', () => {
  const outline = shapeOutline({ type: 'rect', widthMm: 3000, heightMm: 2000 })
  assert.strictEqual(decomposeBands(outline, 'tate').length, 1)
  assert.strictEqual(decomposeBands(outline, 'yoko').length, 1)
})

test('buildSchedule: 資料A の集計を再現', () => {
  const rows = buildSchedule(shapeA, settings).schedule.map((r) => [r.kind, r.lengthMm, r.quantity])
  assert.deepStrictEqual(rows, [
    ['BENT', 6000, 106],
    ['STRAIGHT', 6000, 28],
    ['BENT', 3090, 32],
    ['BENT', 2240, 28],
    ['BENT', 1270, 14],
    ['BENT', 360, 32],
  ])
})

test('domaDiameterOptionLabel: 径ごとの標準重ね', () => {
  assert.strictEqual(domaDiameterOptionLabel('D13'), 'D13(600)')
  assert.strictEqual(domaDiameterOptionLabel('D10'), 'D10(450)')
  assert.strictEqual(domaSettingsWithDiameter('D16').lapMm, 750)
})

test('defaultDomaStraightMm: 定尺 6000 − 端部曲げ 150 = 5850', () => {
  assert.strictEqual(defaultDomaStraightMm(DEFAULT_DOMA_BAR_SETTINGS, 'start'), 5850)
  assert.strictEqual(defaultDomaStraightMm(DEFAULT_DOMA_BAR_SETTINGS, 'none'), 6000)
})

test('computeDomaPiece: 資料A を加工本ごとに描いた場合の集計', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  const pieces: Array<{ straight: number; span: number; bend: 'start' | 'end' | 'none' }> = [
    // タテ左（5460）: 150+5850 / 210+150
    { straight: 5850, span: 6370, bend: 'start' },
    { straight: 210, span: 6370, bend: 'end' },
    // タテ右（8190）: 150+5850 / 2940+150
    { straight: 5850, span: 6370, bend: 'start' },
    { straight: 2940, span: 6370, bend: 'end' },
    // ヨコ上（6370）: 150+5850 / 1120+150
    { straight: 5850, span: 2730, bend: 'start' },
    { straight: 1120, span: 2730, bend: 'end' },
    // ヨコ下（12740）: 150+5850 / 6000 / 2090+150
    { straight: 5850, span: 5460, bend: 'start' },
    { straight: 6000, span: 5460, bend: 'none' },
    { straight: 2090, span: 5460, bend: 'end' },
  ]
  const rows = aggregateSchedule(
    pieces.map((p) => {
      const { count, piece } = computeDomaPiece(p.straight, p.span, p.bend, s)
      return { diameter: s.diameter, runs: [{ count, pieces: [piece] }] }
    }),
  ).map((r) => [r.kind, r.lengthMm, r.quantity])
  assert.deepStrictEqual(rows, [
    ['BENT', 6000, 106],
    ['STRAIGHT', 6000, 28],
    ['BENT', 3090, 32],
    ['BENT', 2240, 28],
    ['BENT', 1270, 14],
    ['BENT', 360, 32],
  ])
})

console.log('\nAll slab-rebar tests passed.')
