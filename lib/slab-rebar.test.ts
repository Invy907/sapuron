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
  rebalanceDomaPieces,
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

test('layoutDomaRun: 定尺候補から差1000以上の最も近い2本を自動選択', () => {
  for (const stockMm of [2500, 6000]) {
    const s = { ...DEFAULT_DOMA_BAR_SETTINGS, stockMm }
    for (const [length, expected] of [
      [5460, [4000, 2360]],
      [4100, [3000, 2000]], // 総加工長5000
      [8190, [5500, 3590]],
      [6370, [4500, 2770]],
      [12740, [6000, 6000, 2240]],
    ] as Array<[number, number[]]>) {
      const r = layoutDomaRun(length, 6370, 'both', s)
      assert.deepStrictEqual(r.pieces.map((p) => p.lengthMm), expected)
      assert.strictEqual(r.pieces.at(-1)!.toMm, length)
      assert.strictEqual(r.requiredTotalMm, expected.reduce((a, b) => a + b, 0))
      assert.ok(r.laps.every((l) => l.mm === 600))
      assert.deepStrictEqual(r.warnings, [])
      assert.strictEqual(r.count, 32)
    }
  }
})

test('layoutDomaRun: 短い区間・片側曲げ・曲げなし', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  // 短い区間も差の条件なしで 2 本に分ける（総加工長 1900 → 1000 + 900。直線部 850・750 ≥ 重ね 600 + 150）
  assert.deepStrictEqual(layoutDomaRun(1000, 1000, 'both', s).pieces.map((p) => p.lengthMm), [1000, 900])
  assert.deepStrictEqual(layoutDomaRun(5000, 1000, 'start', s).pieces.map((p) => p.lengthMm), [5150])
  assert.deepStrictEqual(layoutDomaRun(6000, 1000, 'none', s).pieces.map((p) => p.lengthMm), [6000])
  const r = layoutDomaRun(8000, 1000, 'end', s)
  assert.deepStrictEqual(r.pieces.map((p) => p.lengthMm), [5000, 3750])
  assert.strictEqual(r.pieces[1]!.bendEnd, true)
  assert.strictEqual(r.pieces[1]!.toMm, 8000)
})

test('layoutDomaRun: 短い区間は短い長さの候補で 2 本に分け、重ねが取れないときだけ一本両曲げ', () => {
  const d13 = DEFAULT_DOMA_BAR_SETTINGS
  const lengths = (length: number, s = d13) =>
    layoutDomaRun(length, 1000, 'both', s).pieces.map((p) => p.lengthMm)
  // 総加工長 2800: 2000 + 800 は 800 の直線部 650 < 重ね 600 + 150 で不可 → 1800 + 1000
  assert.deepStrictEqual(lengths(1900), [1800, 1000])
  // 総加工長 2720: 1970 + 750 は 750 の直線部 600 がまるごと重ねになるので使わない → 1800 + 920
  assert.deepStrictEqual(lengths(1820), [1800, 920])
  // 総加工長 2400: 差 1000 以上は作れない → 差の条件なしで、差のいちばん大きい 1500 + 900
  assert.deepStrictEqual(lengths(1500), [1500, 900])
  // 総加工長 1500: 750 + 750 は直線部 600 ＝ 重ねで、重ねより長く出ない → 一本両曲げ
  assert.deepStrictEqual(lengths(600), [900])
  // D10（重ね 450）: 総加工長 2570 → 1800 + 770（直線部 620）
  const d10 = domaSettingsWithDiameter('D10', d13)
  assert.deepStrictEqual(lengths(1820, d10), [1800, 770])
  // 455 は曲げのない端で D10 の重ね 450 が取れるときだけ使える
  assert.ok(layoutDomaRun(1820, 1000, 'both', d13).pieces.every((p) => p.lengthMm !== 455))
})

test('layoutDomaRun: 長い区間の3本分割と重ね不足の補正を維持', () => {
  const r = layoutDomaRun(11200, 1000, 'both', DEFAULT_DOMA_BAR_SETTINGS)
  assert.deepStrictEqual(r.pieces.map((p) => p.lengthMm), [6000, 5950, 750])
  assert.deepStrictEqual(r.pieces.map((p) => p.kind), ['BENT', 'STRAIGHT', 'BENT'])
  assert.strictEqual(r.pieces[2]!.toMm, 11200)
  assert.deepStrictEqual(r.warnings, [])
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
    [5500, 14],
    [4500, 32],
    [3590, 14],
    [2770, 32],
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

test('rebalanceDomaPieces: 定尺変更で残りを調整し重ねを維持', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  const layout = layoutDomaRun(8190, 6370, 'both', s)
  const next = rebalanceDomaPieces(layout, 0, 6000, 150, 600)
  assert.deepStrictEqual(next, [6000, 3090])
  const adjusted = layoutDomaRun(8190, 6370, 'both', s, next)
  assert.strictEqual(adjusted.pieces.at(-1)!.toMm, 8190)
  assert.deepStrictEqual(adjusted.warnings, [])
  assert.deepStrictEqual(rebalanceDomaPieces(layout, 1, 3090, 150, 600), [6000, 3090])
  assert.strictEqual(rebalanceDomaPieces(layout, 0, 4500, 150, 600), null)
  assert.strictEqual(rebalanceDomaPieces(layout, 0, 7000, 150, 600), null)
  assert.strictEqual(rebalanceDomaPieces(layout, 1, 500, 150, 600), null)
  const long = layoutDomaRun(12740, 6370, 'both', s)
  assert.deepStrictEqual(rebalanceDomaPieces(long, 0, 5500, 150, 600), [5500, 6000, 2740])
})

console.log('\nAll slab-rebar tests passed.')

test('rebalanceDomaPieces: 差 1000 mm 以上が作れない短い区間では差の条件なし', () => {
  const s = DEFAULT_DOMA_BAR_SETTINGS
  // 総加工長 2400 は 750 + 750 + 1000 = 2500 に届かない → 1400 + 1000 も選べる
  const short = layoutDomaRun(1500, 1000, 'both', s)
  assert.deepStrictEqual(rebalanceDomaPieces(short, 0, 1400, 150, 600), [1400, 1000])
  // 長い区間は従来どおり差 1000 mm 以上（7270 を 4000 + 3270 にはできない）
  const long = layoutDomaRun(6370, 1000, 'both', s)
  assert.strictEqual(rebalanceDomaPieces(long, 0, 4000, 150, 600), null)
})

test('rebalanceDomaPieces: 手入力では直線部 = 重ね の本も選べる（自動では選ばない）', () => {
  const layout = layoutDomaRun(1820, 1000, 'both', DEFAULT_DOMA_BAR_SETTINGS)
  assert.deepStrictEqual(layout.pieces.map((p) => p.lengthMm), [1800, 920])
  assert.deepStrictEqual(rebalanceDomaPieces(layout, 0, 1970, 150, 600), [1970, 750])
  assert.deepStrictEqual(rebalanceDomaPieces(layout, 1, 750, 150, 600), [1970, 750])
})
