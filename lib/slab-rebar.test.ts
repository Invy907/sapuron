import assert from 'node:assert'
import {
  DEFAULT_DOMA_BAR_SETTINGS,
  domaDiameterOptionLabel,
  domaSettingsWithDiameter,
  DEFAULT_SLAB_REBAR_SETTINGS,
  aggregateSchedule,
  buildSchedule,
  countBars,
  decomposeBands,
  shapeOutline,
  splitRun,
  layoutDomaRun,
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
  // 仕様 v0.2 §7.1 の表
  assert.strictEqual(countBars(6370, 150), 43)
  assert.strictEqual(countBars(7280, 200), 37)
})

test('countBars: 0 以下・整数でない値は 0 本', () => {
  assert.strictEqual(countBars(0, 200), 0)
  assert.strictEqual(countBars(6370, 0), 0)
  assert.strictEqual(countBars(-100, 200), 0)
  assert.strictEqual(countBars(6370.5, 200), 0)
  assert.strictEqual(countBars(Number.NaN, 200), 0)
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

test('layoutDomaRun: 資料A を設置区間 4 つで描いた集計（1 本で作れる区間は分けない）', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  const runs = [
    { L: 5460, span: 6370 }, // タテ左: 5460 + 300 = 5760 ≤ 6000 → 1 本（資料のメモは 6000 + 360）
    { L: 8190, span: 6370 }, // タテ右
    { L: 6370, span: 2730 }, // ヨコ上
    { L: 12740, span: 5460 }, // ヨコ下
  ]
  const rows = aggregateSchedule(
    runs.map(({ L, span }) => ({ diameter: s.diameter, runs: [layoutDomaRun(L, span, 'both', s)] })),
  ).map((r) => [r.kind, r.lengthMm, r.quantity])
  assert.deepStrictEqual(rows, [
    ['BENT', 6000, 74],
    ['STRAIGHT', 6000, 28],
    ['BENT', 5760, 32],
    ['BENT', 3090, 32],
    ['BENT', 2240, 28],
    ['BENT', 1270, 14],
  ])
})

test('layoutDomaRun: 1 本で作れるときは分けない（両端曲げ）', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  const r = layoutDomaRun(5460, 6370, 'both', s)
  assert.deepStrictEqual(
    r.pieces.map((p) => [p.lengthMm, p.bendStart, p.bendEnd, p.fromMm, p.toMm]),
    [[5760, true, true, 0, 5460]],
  )
  assert.deepStrictEqual(r.laps, [])
  assert.deepStrictEqual(r.warnings, [])
  assert.deepStrictEqual(layoutDomaRun(2730, 1000, 'both', s).pieces.map((p) => p.lengthMm), [3030])
  // ちょうど定尺: 5700 + 300 = 6000
  assert.deepStrictEqual(layoutDomaRun(5700, 1000, 'both', s).pieces.map((p) => p.lengthMm), [6000])
})

test('layoutDomaRun: 加工本の位置と重ね（6370 → 6000 + 1270）', () => {
  const r = layoutDomaRun(6370, 6370, 'both', DEFAULT_DOMA_BAR_SETTINGS)
  assert.deepStrictEqual(
    r.pieces.map((p) => [p.lengthMm, p.bendStart, p.bendEnd, p.fromMm, p.toMm, p.lapShort]),
    [
      [6000, true, false, 0, 5850, false],
      [1270, false, true, 5250, 6370, false],
    ],
  )
  assert.deepStrictEqual(r.laps, [{ fromMm: 5250, toMm: 5850, mm: 600 }])
  assert.strictEqual(r.count, 32)
  assert.strictEqual(r.requiredTotalMm, 7270)
  assert.strictEqual(r.source, 'auto')
})

test('layoutDomaRun: 12740 は 3 本、中間は直', () => {
  const r = layoutDomaRun(12740, 5460, 'both', DEFAULT_DOMA_BAR_SETTINGS)
  assert.deepStrictEqual(
    r.pieces.map((p) => [p.kind, p.lengthMm]),
    [
      ['BENT', 6000],
      ['STRAIGHT', 6000],
      ['BENT', 2240],
    ],
  )
  assert.strictEqual(r.laps.length, 2)
  assert.strictEqual(r.pieces[2]!.toMm, 12740)
  assert.deepStrictEqual(r.warnings, [])
})

test('layoutDomaRun: 片側曲げ・曲げなしは 1 本に収まれば 1 本', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  assert.deepStrictEqual(layoutDomaRun(5000, 1000, 'start', s).pieces.map((p) => p.lengthMm), [5150])
  assert.deepStrictEqual(layoutDomaRun(6000, 1000, 'none', s).pieces.map((p) => p.lengthMm), [6000])
  // 8000 + 150 + 600 = 8750 → 6000 + 2750（終点側の曲げは最後の本）
  const r = layoutDomaRun(8000, 1000, 'end', s)
  assert.deepStrictEqual(
    r.pieces.map((p) => [p.lengthMm, p.bendStart, p.bendEnd]),
    [
      [6000, false, false],
      [2750, false, true],
    ],
  )
  assert.strictEqual(r.pieces[1]!.toMm, 8000)
})

test('layoutDomaRun: 自動の分割は重ねが取れない本を作らない', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  // 5750 + 300 + 600 = 6650。6000 + 650 だと 650 の直線部 500 < 重ね 600
  // → 足りない 100 を前の本から移して 5900 + 750（直線部 600）
  const two = layoutDomaRun(5750, 1000, 'both', s)
  assert.deepStrictEqual(two.pieces.map((p) => [p.lengthMm, p.lapShort]), [
    [5900, false],
    [750, false],
  ])
  assert.deepStrictEqual(two.warnings, [])
  assert.strictEqual(two.pieces[1]!.toMm, 5750)
  assert.deepStrictEqual(two.laps.map((l) => l.mm), [600])
  // 3 本: 11200 + 300 + 1200 = 12700 → 6000 + 6000 + 700 → 6000 + 5950 + 750
  const three = layoutDomaRun(11200, 1000, 'both', s)
  assert.deepStrictEqual(three.pieces.map((p) => p.lengthMm), [6000, 5950, 750])
  assert.deepStrictEqual(three.warnings, [])
  // 資料 A の 6370 / 8190 / 12740 は残りの本が十分長いので変わらない
  assert.deepStrictEqual(layoutDomaRun(6370, 1, 'both', s).pieces.map((p) => p.lengthMm), [6000, 1270])
})

test('layoutDomaRun: 手入力で重ねが取れない本は警告（合計は合っていても）', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  // 資料 A のメモどおり 5460 を 6000 + 360 に手入力: 合計は合うが 360 の直線部 210 < 600
  const memo = layoutDomaRun(5460, 6370, 'both', s, [6000, 360])
  assert.deepStrictEqual(memo.warnings, ['LAP_TOO_SHORT'])
  assert.deepStrictEqual(memo.pieces.map((p) => p.lapShort), [false, true])
})

test('aggregateSchedule: 別のグループの同じ長さは合算する', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  const rows = aggregateSchedule([
    { diameter: 'D13', runs: [layoutDomaRun(6370, 6370, 'both', s)] }, // 6000 + 1270 × 32
    { diameter: 'D13', runs: [layoutDomaRun(8190, 2730, 'both', s)] }, // 6000 + 3090 × 14
  ]).map((r) => [r.lengthMm, r.quantity])
  assert.deepStrictEqual(rows, [
    [6000, 46],
    [3090, 14],
    [1270, 32],
  ])
})

test('layoutDomaRun: 手入力の加工本は合計が合わなければ警告', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  const ok = layoutDomaRun(5460, 6370, 'both', s, [5000, 1360])
  assert.strictEqual(ok.source, 'manual')
  assert.deepStrictEqual(ok.warnings, [])
  const ng = layoutDomaRun(5460, 6370, 'both', s, [5000, 1300])
  assert.deepStrictEqual(ng.warnings, ['MANUAL_SUM_MISMATCH'])
})

test('layoutDomaRun: 50 m を超える値は警告', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  assert.ok(layoutDomaRun(60000, 1000, 'both', s).warnings.includes('VALUE_TOO_LARGE'))
  assert.ok(layoutDomaRun(5000, 60000, 'both', s).warnings.includes('VALUE_TOO_LARGE'))
  assert.ok(!layoutDomaRun(12740, 5460, 'both', s).warnings.includes('VALUE_TOO_LARGE'))
})

console.log('\nAll slab-rebar tests passed.')
