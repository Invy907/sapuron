import assert from 'node:assert'
import {
  aggregateAdditionalRebars,
  type AdditionalRebarPlacementLike,
} from './corner-bar-summary'
import { cornerBarKakouchouMm } from './corner-bar-kakouchou'
import type {
  CornerBarSegment,
  MeasurementDeductionsMm,
  MeasurementType,
} from './corner-bar-presets'

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    console.error(`✗ ${name}`)
    throw e
  }
}

function segs(
  lengths: Array<number | null>,
  measurement: MeasurementType | null = null,
): CornerBarSegment[] {
  return lengths.map((lengthMm, i) => ({
    id: `s${i + 1}`,
    lengthMm,
    measurementType: measurement,
  }))
}

function placement(
  category: string,
  shapeType: string,
  bars: Array<{
    barType: string
    quantity: number
    segments: CornerBarSegment[]
    measurementDeductionsMm?: MeasurementDeductionsMm
  }>,
): AdditionalRebarPlacementLike {
  return {
    category,
    shape_type: shapeType,
    bars: bars.map((bar, i) => ({ id: `b${i + 1}`, ...bar })),
  }
}

function diameterTotals(
  summary: ReturnType<typeof aggregateAdditionalRebars>,
  category: string,
): Record<string, number> {
  const group = summary.groups.find((g) => g.category === category)
  assert.ok(group, `${category} のグループが無い`)
  return Object.fromEntries(group.diameterTotals.map((d) => [d.diameter, d.quantity]))
}

// 1) ガイド §19 の例。配置の件数ではなく bars[].quantity の合計になること
test('§19 例: 筋種類ごとに径別の本数を合算する', () => {
  const summary = aggregateAdditionalRebars([
    placement('CORNER', 'L', [
      { barType: 'D13', quantity: 3, segments: segs([600, 600]) },
      { barType: 'D10', quantity: 1, segments: segs([450, 450]) },
    ]),
    placement('CORNER', 'L', [{ barType: 'D13', quantity: 2, segments: segs([600, 600]) }]),
    placement('SOE', 'STRAIGHT', [
      { barType: 'D13', quantity: 4, segments: segs([1200]) },
      { barType: 'D10', quantity: 2, segments: segs([900]) },
    ]),
    placement('SPECIAL_CORNER', 'L', [
      { barType: 'D10', quantity: 1, segments: segs([700, 700]) },
    ]),
  ])

  assert.deepEqual(diameterTotals(summary, 'CORNER'), { D10: 1, D13: 5 })
  assert.deepEqual(diameterTotals(summary, 'SOE'), { D10: 2, D13: 4 })
  assert.deepEqual(diameterTotals(summary, 'SPECIAL_CORNER'), { D10: 1 })
  assert.equal(summary.totalQuantity, 3 + 1 + 2 + 4 + 2 + 1)

  // 筋種類の並びは コーナー筋 → 添え筋 → 特殊コーナー筋
  assert.deepEqual(
    summary.groups.map((g) => g.category),
    ['CORNER', 'SOE', 'SPECIAL_CORNER'],
  )
  assert.deepEqual(
    summary.groups.map((g) => g.label),
    ['コーナー筋', '添え筋', '特殊コーナー筋'],
  )
})

// 2) 径別の並びは常に D10 → D13 → D16 → D19 → D22
test('径の並びが D10 → D13 → D16 → D19 → D22 になる', () => {
  const summary = aggregateAdditionalRebars([
    placement('CORNER', 'L', [
      { barType: 'D22', quantity: 1, segments: segs([600, 600]) },
      { barType: 'D10', quantity: 30, segments: segs([450, 450]) },
      { barType: 'D19', quantity: 2, segments: segs([900, 900]) },
      { barType: 'D13', quantity: 56, segments: segs([600, 600]) },
      { barType: 'D16', quantity: 4, segments: segs([750, 750]) },
    ]),
  ])

  const group = summary.groups[0]!
  assert.deepEqual(
    group.diameterTotals.map((d) => d.diameter),
    ['D10', 'D13', 'D16', 'D19', 'D22'],
  )
  assert.deepEqual(
    group.diameterTotals.map((d) => d.quantity),
    [30, 56, 4, 2, 1],
  )
})

// 3) 加工長は外々・芯々の辺 1 本につき -20。内々・未設定の辺は減らさない
test('外々・芯々の辺ごとに 20 を引く', () => {
  assert.equal(cornerBarKakouchouMm(segs([700, 700], 'SOTO_SOTO')), 1360)
  assert.equal(cornerBarKakouchouMm(segs([600, 455, 115, 600], 'SHIN_SHIN')), 1690)
})

test('内々・寸法基準未設定の辺は加工長に影響しない', () => {
  assert.equal(cornerBarKakouchouMm(segs([700, 700], 'UCHI_UCHI')), 1400)
  assert.equal(cornerBarKakouchouMm(segs([700, 700])), 1400)
})

test('寸法基準が混在する場合は外々・芯々の辺の数だけ引く', () => {
  assert.equal(
    cornerBarKakouchouMm([
      { id: 's1', lengthMm: 600, measurementType: 'SOTO_SOTO' },
      { id: 's2', lengthMm: 455, measurementType: 'UCHI_UCHI' },
      { id: 's3', lengthMm: 115, measurementType: 'SHIN_SHIN' },
      { id: 's4', lengthMm: 600, measurementType: null },
    ]),
    1770 - 40,
  )
})

test('寸法が未入力の辺があると加工長は null', () => {
  assert.equal(cornerBarKakouchouMm(segs([600, null, 600])), null)
  assert.equal(cornerBarKakouchouMm([]), null)
})

// 4) §9 同じ사양は 1 行に合算する（別配置でも）
test('§9 別の配置でも仕様が同じなら 1 行にまとめる', () => {
  const summary = aggregateAdditionalRebars([
    placement('SPECIAL_CORNER', 'L', [
      { barType: 'D10', quantity: 1, segments: segs([700, 700], 'SHIN_SHIN') },
    ]),
    placement('SPECIAL_CORNER', 'L', [
      { barType: 'D10', quantity: 2, segments: segs([700, 700], 'SHIN_SHIN') },
    ]),
  ])

  const rows = summary.groups[0]!.specRows
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.quantity, 3)
  assert.equal(rows[0]!.dimsText, '700 × 700')
  assert.equal(rows[0]!.dimsDetailText, '700芯々 × 700芯々')
  assert.equal(rows[0]!.uniformMeasurementType, 'SHIN_SHIN')
  assert.equal(rows[0]!.segmentSumMm, 1400)
  // 特殊コーナー筋は減りを入力していなければ引かない
  assert.equal(rows[0]!.kakouchouMm, 1400)
})

// 5) §10 数字が同じでも寸法基準が違えば別の行
test('§10 数字が同じでも寸法基準が違えば合算しない', () => {
  const summary = aggregateAdditionalRebars([
    placement('CORNER', 'L', [
      {
        barType: 'D13',
        quantity: 1,
        segments: [
          { id: 's1', lengthMm: 600, measurementType: 'SOTO_SOTO' },
          { id: 's2', lengthMm: 600, measurementType: 'UCHI_UCHI' },
        ],
      },
    ]),
    placement('CORNER', 'L', [
      { barType: 'D13', quantity: 1, segments: segs([600, 600], 'SHIN_SHIN') },
    ]),
  ])

  const rows = summary.groups[0]!.specRows
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows.map((r) => r.quantity),
    [1, 1],
  )
  // 径別の合計は寸法基準に関わらず合算される
  assert.deepEqual(diameterTotals(summary, 'CORNER'), { D13: 2 })
  // 寸法基準が混在する行は uniformMeasurementType が null
  const mixed = rows.find((r) => r.dimsDetailText.includes('外々'))
  assert.ok(mixed)
  assert.equal(mixed.uniformMeasurementType, null)
  assert.equal(mixed.dimsDetailText, '600外々 × 600内々')
})

test('§10 形状・segment 個数が違えば合算しない', () => {
  const summary = aggregateAdditionalRebars([
    placement('SPECIAL_CORNER', 'V_STEP2', [
      { barType: 'D13', quantity: 2, segments: segs([600, 455, 115, 600], 'SHIN_SHIN') },
    ]),
    placement('SPECIAL_CORNER', 'V_OFFSET', [
      { barType: 'D13', quantity: 1, segments: segs([600, 455, 115], 'SHIN_SHIN') },
    ]),
  ])

  const rows = summary.groups[0]!.specRows
  assert.equal(rows.length, 2)
  assert.deepEqual(diameterTotals(summary, 'SPECIAL_CORNER'), { D13: 3 })

  const four = rows.find((r) => r.segments.length === 4)!
  assert.equal(four.dimsText, '600 × 455 × 115 × 600')
  assert.equal(four.kakouchouMm, 1770)
  assert.equal(four.quantity, 2)
  assert.equal(four.shapeLabel, '2段階段')
})

// 5b) 特殊コーナー筋は配置ごとに入力した寸法基準別の減りを辺ごとに引く
test('減りを渡すと寸法基準ごとにその値を辺ごとに引く', () => {
  const deductions = { UCHI_UCHI: 5, SOTO_SOTO: 30, SHIN_SHIN: 15 }
  assert.equal(
    cornerBarKakouchouMm(
      [
        { id: 's1', lengthMm: 600, measurementType: 'SOTO_SOTO' },
        { id: 's2', lengthMm: 300, measurementType: 'UCHI_UCHI' },
        { id: 's3', lengthMm: 600, measurementType: 'SHIN_SHIN' },
        { id: 's4', lengthMm: 300, measurementType: null },
      ],
      deductions,
    ),
    1800 - 30 - 5 - 15,
  )
})

test('特殊コーナー筋: 入力した減りで加工長を出し、減りが違えば別の行にする', () => {
  const steps = segs([600, 300, 600], 'SHIN_SHIN')
  const summary = aggregateAdditionalRebars([
    placement('SPECIAL_CORNER', 'V_OFFSET', [
      {
        barType: 'D13',
        quantity: 1,
        segments: steps,
        measurementDeductionsMm: { UCHI_UCHI: 0, SOTO_SOTO: 20, SHIN_SHIN: 10 },
      },
    ]),
    placement('SPECIAL_CORNER', 'V_OFFSET', [{ barType: 'D13', quantity: 2, segments: steps }]),
  ])

  const rows = summary.groups[0]!.specRows
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows.map((r) => [r.quantity, r.kakouchouMm]),
    [
      [2, 1500],
      [1, 1470],
    ],
  )
  // 減りが全て 0 の行は減りを入れる前と同じ key（結果ページの手入力を保つ）
  assert.ok(!rows[0]!.key.includes('ded:'))
  assert.ok(rows[1]!.key.includes('ded:0,20,10'))
})

test('コーナー筋などは従来どおり外々・芯々の辺ごとに 20 を引く', () => {
  const summary = aggregateAdditionalRebars([
    placement('CORNER', 'L', [
      {
        barType: 'D13',
        quantity: 1,
        segments: segs([700, 700], 'SOTO_SOTO'),
        measurementDeductionsMm: { UCHI_UCHI: 0, SOTO_SOTO: 50, SHIN_SHIN: 50 },
      },
    ]),
  ])
  assert.equal(summary.groups[0]!.specRows[0]!.kakouchouMm, 1360)
})

// 6) 旧スキーマ（bars 無し、diameter / segments のみ）でも本数を落とさない
test('旧スキーマの行は diameter を 1 本として数える', () => {
  const summary = aggregateAdditionalRebars([
    {
      category: 'CORNER',
      shape_type: 'L',
      bars: [],
      diameter: 'D13',
      segments: segs([600, 600], 'SHIN_SHIN'),
    },
  ])

  assert.deepEqual(diameterTotals(summary, 'CORNER'), { D13: 1 })
  assert.equal(summary.groups[0]!.specRows[0]!.dimsText, '600 × 600')
})

test('本数 0 の鉄筋と空の配置は結果に出ない', () => {
  const summary = aggregateAdditionalRebars([
    placement('CORNER', 'L', [{ barType: 'D13', quantity: 0, segments: segs([600, 600]) }]),
  ])
  assert.deepEqual(summary.groups, [])
  assert.equal(summary.totalQuantity, 0)
})

// 7) 開口補強筋は資料（スリーブ補強筋・開口補強筋）の計算式どおりになる
test('開口補強筋: 資料の加工長と、加工長に入らない高さ', () => {
  const opening = (shapeType: string, lengths: number[], extra: Record<string, number>) => ({
    category: 'OPENING',
    shape_type: shapeType,
    bars: [{ barType: 'D13', quantity: 1, segments: segs(lengths), ...extra }],
  })
  const summary = aggregateAdditionalRebars([
    // (350 × 4) + 200 − 80 = 1520
    opening('OPENING_RING', [100, 350, 350, 350, 350, 100], { deductionTotalMm: 80 }),
    // 100 + 620 + 100 − 20 = 800
    opening('OPENING_HOOK_L', [100, 620, 100], { deductionTotalMm: 20 }),
    // 150 + 450 + 650 = 1250（高さ 320 は計算に入らない）
    opening('OPENING_CRANK', [150, 450, 650], { heightMm: 320 }),
    // 600 + 650 = 1250（高さ 425）
    opening('OPENING_SLANT', [600, 650], { heightMm: 425 }),
    // 100 + 380 + 100 − 20 = 560
    opening('OPENING_BRACKET', [100, 380, 100], { deductionTotalMm: 20 }),
  ])
  const rows = summary.groups[0]!.specRows
  const byShape = Object.fromEntries(rows.map((r) => [r.shapeType, r]))
  assert.equal(byShape.OPENING_RING!.kakouchouMm, 1520)
  assert.equal(byShape.OPENING_HOOK_L!.kakouchouMm, 800)
  assert.equal(byShape.OPENING_CRANK!.kakouchouMm, 1250)
  assert.equal(byShape.OPENING_CRANK!.heightMm, 320)
  assert.equal(byShape.OPENING_SLANT!.kakouchouMm, 1250)
  assert.equal(byShape.OPENING_SLANT!.heightMm, 425)
  assert.equal(byShape.OPENING_BRACKET!.kakouchouMm, 560)
  assert.equal(byShape.OPENING_BRACKET!.heightMm, undefined)
})

console.log('\nすべてのテストが通りました')
