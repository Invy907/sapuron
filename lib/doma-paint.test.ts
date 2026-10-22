import assert from 'node:assert'
import {
  domaRunLines,
  findDomaRunLengthCandidates,
  findDomaSpanCandidates,
  pickDomaDimension,
  type DomaDimensionLike,
} from './doma-paint'

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    console.error(`✗ ${name}`)
    throw e
  }
}

const dim = (id: string, x1: number, y1: number, x2: number, y2: number, mm: number): DomaDimensionLike => ({
  id,
  x1,
  y1,
  x2,
  y2,
  length_mm: mm,
})

// 資料 A の上側: 6370 + 6370、下側: 全体 12740（0.1 px/mm）
const left = dim('left', 0, 0, 637, 0, 6370)
const right = dim('right', 637, 0, 1274, 0, 6370)
const whole = dim('whole', 0, 900, 1274, 900, 12740)
// 右区画の縦（8190）
const tall = dim('tall', 1300, 50, 1300, 869, 8190)
const tateRight = { x1: 900, y1: 50, x2: 900, y2: 869 }

test('配筋範囲: 全体寸法（区画の合計）は外して区画寸法に決まる', () => {
  const c = findDomaSpanCandidates(tateRight, [left, right, whole, tall], 4)
  assert.deepStrictEqual(c.map((d) => d.id), ['right'])
  assert.strictEqual(pickDomaDimension(c)?.id, 'right')
})

test('配筋範囲: 部分寸法（開口部の幅など）が重なると決めない', () => {
  const opening = dim('opening', 850, 300, 940, 300, 900)
  const c = findDomaSpanCandidates(tateRight, [left, right, whole, opening], 4)
  assert.deepStrictEqual(c.map((d) => d.id).sort(), ['opening', 'right'])
  assert.strictEqual(pickDomaDimension(c), null)
})

test('配筋範囲: 合計が合わなければ全体寸法とはみなさない', () => {
  const wrongWhole = dim('wrong', 0, 900, 1274, 900, 12700)
  const c = findDomaSpanCandidates(tateRight, [left, right, wrongWhole], 4)
  assert.deepStrictEqual(c.map((d) => d.id).sort(), ['right', 'wrong'])
  assert.strictEqual(pickDomaDimension(c), null)
})

test('配筋範囲: 区画寸法しかなければそれに決まる', () => {
  const c = findDomaSpanCandidates(tateRight, [right], 4)
  assert.strictEqual(pickDomaDimension(c)?.length_mm, 6370)
})

test('L: 同じ向きで両端がそろう寸法線だけ', () => {
  const c = findDomaRunLengthCandidates(tateRight, [left, right, whole, tall], 4)
  assert.deepStrictEqual(c.map((d) => d.id), ['tall'])
  assert.strictEqual(findDomaRunLengthCandidates({ x1: 900, y1: 50, x2: 900, y2: 700 }, [tall], 4).length, 0)
})

test('配筋範囲: 手で引いた寸法線の端が少しずれていても全体寸法を外す（実データ）', () => {
  // 2026-10-22 の Test 図面: 左の 6370 が全体 12740 の始点から 15 px ずれている
  const realWhole = dim('w', 577.4, 1302.8, 1998.9, 1302.8, 12740)
  const realLeft = dim('l', 592.4, 184.8, 1292.7, 184.8, 6370)
  const realRight = dim('r', 1286.7, 178.8, 1998.9, 178.8, 6370)
  const run = { x1: 1692.4, y1: 304.8, x2: 1692.4, y2: 1238.7 }
  // 33% 表示のときの判定幅（4 px / 0.33）
  const c = findDomaSpanCandidates(run, [realWhole, realLeft, realRight], 4 / 0.33)
  assert.deepStrictEqual(c.map((d) => d.id), ['r'])
})

test('図面の線: 直線部は曲げを除いた長さ、曲げは 150 で描く（12740 → 5850 + 6000 + 2090）', () => {
  const settings = { diameter: 'D13', pitchMm: 200, bendMm: 150, stockMm: 6000, lapMm: 600 }
  const k = 0.1 // px / mm
  const run = {
    x1: 0,
    y1: 0,
    x2: 12740 * k,
    y2: 0,
    direction: 'yoko' as const,
    length_mm: 12740,
    span_mm: 5460,
    bends: 'both' as const,
    settings,
    pieces_override: null,
  }
  const mm = (l: { x1: number; y1: number; x2: number; y2: number }) =>
    Math.round(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) / k)
  // 1 本目: 直線部・始点の曲げ / 2 本目: 直線部 / 3 本目: 直線部・終点の曲げ
  assert.deepStrictEqual(domaRunLines(run, 1).map(mm), [5850, 150, 6000, 2090, 150])
})

console.log('\nAll doma-paint tests passed.')
