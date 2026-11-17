import assert from 'node:assert'
import { DEFAULT_DOMA_BAR_SETTINGS, layoutDomaRun } from './slab-rebar'
import type { DrawingDomaRun } from './types/database'
import {
  domaZoneEdgeAtScreenSide,
  domaZoneRunValues,
  domaZoneRuns,
  domaZoneScreenSide,
  domaRunZoneCuts,
  domaZoneCutGap,
  domaZoneDistanceDimIds,
  domaZoneCutSetPieces,
  countBarsInRange,
  expandDomaRuns,
  splitDomaRunByZones,
  type DomaZoneSpec,
} from './doma-zone'

function zone(tateMm: number, yokoMm: number, spec: Partial<DomaZoneSpec> = {}): DrawingDomaRun {
  return {
    id: 'z1',
    drawing_id: 'd',
    page_no: 1,
    kind: 'special',
    direction: 'tate',
    x1: 100,
    y1: 50,
    x2: 400,
    y2: 440,
    length_mm: tateMm,
    span_mm: yokoMm,
    bends: 'none',
    settings: {
      ...DEFAULT_DOMA_BAR_SETTINGS,
      pitchMm: 150,
      zone: {
        tateAlongY: true,
        walls: { top: false, bottom: false, left: false, right: false },
        ...spec,
      },
    },
    pieces_override: null,
    length_dim_id: null,
    span_dim_id: null,
    created_at: '',
  }
}

// 手書きの例: 上の辺だけ壁。タテは上で曲げて止め、下へ重ね 600 はみ出す。ヨコは左右へ 600 ずつ
{
  const z = zone(1950, 1500, { walls: { top: true, bottom: false, left: false, right: false } })
  const tate = domaZoneRunValues(z, 'tate')
  assert.deepStrictEqual(
    { lengthMm: tate.lengthMm, spanMm: tate.spanMm, bends: tate.bends },
    { lengthMm: 2550, spanMm: 1500, bends: 'start' },
  )
  const yoko = domaZoneRunValues(z, 'yoko')
  assert.deepStrictEqual(
    { lengthMm: yoko.lengthMm, spanMm: yoko.spanMm, bends: yoko.bends },
    { lengthMm: 2700, spanMm: 1950, bends: 'none' },
  )
  const runs = domaZoneRuns(z)
  assert.deepStrictEqual(
    runs.map((r) => [r.id, r.direction, r.kind]),
    [
      ['z1:tate', 'tate', 'special'],
      ['z1:yoko', 'yoko', 'special'],
    ],
  )
  const [tateRun, yokoRun] = runs
  // 本数は配筋範囲 ÷ ピッチ 150 の切り上げ
  assert.strictEqual(layoutDomaRun(tateRun!.length_mm, tateRun!.span_mm, tateRun!.bends, tateRun!.settings).count, 10)
  assert.strictEqual(layoutDomaRun(yokoRun!.length_mm, yokoRun!.span_mm, yokoRun!.bends, yokoRun!.settings).count, 13)
  // 代表線: タテは範囲の中央の x、上の辺（壁）から始まり、下へはみ出しの分だけ伸びる
  const k = (440 - 50) / 1950
  assert.strictEqual(tateRun!.x1, 250)
  assert.strictEqual(tateRun!.y1, 50)
  assert.ok(Math.abs(tateRun!.y2 - (440 + 600 * k)) < 1e-9)
}

// はみ出しを手で変えたとき・重ねが変わったとき
{
  assert.strictEqual(domaZoneRunValues(zone(1000, 1000, { extendMm: 300 }), 'yoko').lengthMm, 1600)
  const d10 = zone(1000, 1000)
  d10.settings = { ...d10.settings, lapMm: 450 }
  assert.strictEqual(domaZoneRunValues(d10, 'tate').lengthMm, 1900)
}

// 片方の向きだけ・手入力の加工本
{
  const z = zone(1950, 1500, { directions: { yoko: false }, overrides: { tate: [1800, 1650] } })
  const runs = expandDomaRuns([z])
  assert.deepStrictEqual(runs.map((r) => r.direction), ['tate'])
  assert.deepStrictEqual(runs[0]!.pieces_override, [1800, 1650])
}

// 90° 回転表示（時計回り）では図面の左の辺が画面の上に来る
{
  assert.strictEqual(domaZoneScreenSide('left', 1), 'top')
  assert.strictEqual(domaZoneScreenSide('top', 1), 'right')
  assert.strictEqual(domaZoneEdgeAtScreenSide('top', 1), 'left')
  assert.strictEqual(domaZoneEdgeAtScreenSide('bottom', 0), 'bottom')
  // 回転表示で描いた範囲は、タテ筋が図面の x の向き（左右の辺が端）
  const z = zone(1000, 2000, { tateAlongY: false, walls: { top: false, bottom: false, left: true, right: false } })
  assert.strictEqual(domaZoneRunValues(z, 'tate').bends, 'start')
  assert.strictEqual(domaZoneRunValues(z, 'yoko').bends, 'none')
}

// 区域にかかる標準筋: 区域の中へ重ね 600 だけ入るところで切る（図面 0.1 px/mm）
{
  const tate: DrawingDomaRun = {
    ...zone(0, 0),
    id: 'r1',
    kind: 'standard',
    x1: 600,
    y1: 0,
    x2: 600,
    y2: 546,
    length_mm: 5460,
    span_mm: 3000,
    bends: 'both',
    settings: { ...DEFAULT_DOMA_BAR_SETTINGS },
    span_dim_id: 'dim-span',
  }
  const dims = [{ id: 'dim-span', x1: 450, y1: 600, x2: 750, y2: 600 }]
  const zoneAt = (y1: number, y2: number, spec: Partial<DomaZoneSpec> = {}): DrawingDomaRun => ({
    ...zone(1950, 1500, spec),
    x1: 500,
    y1,
    x2: 650,
    y2,
  })

  // 区域までの長さ（L の向き・配筋範囲の向き）は入力か寸法線の値だけ。図面の px を mm に換算しないので、
  // 決まらなければ切らない（上の辺が始点にそろう区域は始点から 0 と分かるが、配筋範囲の向きが決まらない）
  const top = zoneAt(0, 195, { walls: { top: true, bottom: false, left: false, right: false } })
  assert.deepStrictEqual(domaRunZoneCuts(tate, [tate, top], dims), [
    {
      zoneId: 'z1',
      count: 0,
      fromMm: 0,
      toMm: 0,
      complete: false,
      startMm: 0,
      crossMm: null,
      startSource: 'edge',
      crossSource: null,
      dimIds: [],
      before: null,
      after: null,
      crossPx: [500, 650],
    },
  ])
  assert.deepStrictEqual(splitDomaRunByZones(tate, [tate, top], dims), [tate])

  // 上の辺（壁）が標準筋の始点にそろう区域（始点から 0）: 手前はなく、先は L − 区域 + 重ね、区域の側は曲げなし。
  // 本数は配筋範囲の左端から 200 ごとに並べ、区域 500〜2000 mm に来る 600〜1800 の 7 本
  const withInput = (starts: number, crossStarts: number, countFrom?: 'low' | 'high'): DrawingDomaRun => ({
    ...tate,
    settings: {
      ...tate.settings,
      zoneStarts: { z1: starts },
      zoneCrossStarts: { z1: crossStarts },
      ...(countFrom ? { countFrom } : {}),
    },
  })
  const atTop = withInput(0, 500)
  const [cut] = domaRunZoneCuts(atTop, [atTop, top], dims)
  assert.deepStrictEqual(cut, {
    zoneId: 'z1',
    count: 7,
    fromMm: 0,
    toMm: 1950,
    complete: true,
    startMm: 0,
    crossMm: 500,
    startSource: 'input',
    crossSource: 'input',
    dimIds: [],
    before: null,
    after: { lengthMm: 4110, bends: 'end' },
    crossPx: [500, 650],
  })
  // 区域にかからない 8 本は元の L、かかる 7 本は 4110
  const rows = splitDomaRunByZones(atTop, [atTop, top], dims)
  assert.deepStrictEqual(
    rows.map((r) => [r.length_mm, r.span_mm, r.bends]),
    [
      [5460, 1600, 'both'],
      [4110, 1400, 'end'],
    ],
  )
  // 右端から 1000 と入力すると区域は 1000〜2500 mm で、1000〜2400 の 8 本
  const fromRight = withInput(0, 1000, 'high')
  assert.strictEqual(domaRunZoneCuts(fromRight, [fromRight, top], dims)[0]!.count, 8)

  // 途中にある区域（始点から 2000）: 手前と先の 2 本に分かれ、どちらも区域の中へ 600 入る
  const middle = zoneAt(200, 395)
  const inMiddle = withInput(2000, 500)
  const [cut2] = domaRunZoneCuts(inMiddle, [inMiddle, middle], dims)
  assert.deepStrictEqual(
    [cut2!.fromMm, cut2!.toMm, cut2!.before, cut2!.after],
    [2000, 3950, { lengthMm: 2600, bends: 'start' }, { lengthMm: 2110, bends: 'end' }],
  )
  // 図面に描いた区域の位置とは関係なく、入力した長さで切る（始点から 1200 → 1200〜3150）
  const typed = withInput(1200, 500)
  const [cut4] = domaRunZoneCuts(typed, [typed, middle], dims)
  assert.deepStrictEqual(
    [cut4!.fromMm, cut4!.toMm, cut4!.before, cut4!.after],
    [1200, 3150, { lengthMm: 1800, bends: 'start' }, { lengthMm: 2910, bends: 'end' }],
  )

  // 図面の線は区域の辺から重ね 600（60 px）入ったところまで。L の端にかかる側は区域の外まで消す
  const gap2 = domaZoneCutGap(inMiddle, middle, cut2!)
  assert.deepStrictEqual(
    [gap2!.minY, gap2!.maxY, gap2!.entries],
    [260, 335, [{ edge: 200, inner: 260 }, { edge: 395, inner: 335 }]],
  )
  const gap1 = domaZoneCutGap(atTop, top, cut!)
  assert.deepStrictEqual([gap1!.maxY, gap1!.entries], [135, [{ edge: 195, inner: 135 }]])
  assert.ok(gap1!.minY < 0)

  // ヨコだけの区域・並ぶ幅の外の区域ではタテの標準筋を切らない
  assert.deepStrictEqual(domaRunZoneCuts(tate, [tate, zoneAt(0, 195, { directions: { tate: false } })], dims), [])
  const outside = { ...zoneAt(0, 195), x1: 800, x2: 950 }
  assert.deepStrictEqual(domaRunZoneCuts(tate, [tate, outside], dims), [])

  // 手入力がなければ、端から区域の辺までつながる寸法線の値の合計で決める（図面の px は mm に換算しない）。
  // 寸法線は手で引くので端が少しずれていてよい
  const spanDim = { id: 'dim-span', x1: 450, y1: 600, x2: 750, y2: 600, length_mm: 3000 }
  const chainDims = [
    spanDim,
    { id: 'a1', x1: 300, y1: 0, x2: 300, y2: 202, length_mm: 2000 },
    { id: 'a2', x1: 300, y1: 202, x2: 300, y2: 395, length_mm: 1950 },
    { id: 'a3', x1: 300, y1: 395, x2: 300, y2: 546, length_mm: 1510 },
    { id: 'c1', x1: 450, y1: -50, x2: 498, y2: -50, length_mm: 500 },
    { id: 'c2', x1: 498, y1: -50, x2: 650, y2: -50, length_mm: 1500 },
    { id: 'c3', x1: 650, y1: -50, x2: 750, y2: -50, length_mm: 1000 },
  ]
  const [auto] = domaRunZoneCuts(tate, [tate, middle], chainDims)
  assert.deepStrictEqual(
    [auto!.complete, auto!.fromMm, auto!.toMm, auto!.startSource, auto!.crossSource, auto!.dimIds],
    [true, 2000, 3950, 'dimension', 'dimension', ['a1', 'c1']],
  )
  assert.strictEqual(auto!.count, domaRunZoneCuts(inMiddle, [inMiddle, middle], dims)[0]!.count)
  // 始点から区域までの寸法線がなくても、区域の奥の辺から終点までがあれば 全体 − 区域 − 奥 で決まる
  const [fromFar] = domaRunZoneCuts(
    tate,
    [tate, middle],
    chainDims.filter((d) => d.id !== 'a1' && d.id !== 'c1'),
  )
  assert.deepStrictEqual([fromFar!.startMm, fromFar!.crossMm], [2000, 500])
  // 数え始めが右なら、右の端から区域まで（1000）
  const highCount: DrawingDomaRun = { ...tate, settings: { ...tate.settings, countFrom: 'high' } }
  assert.strictEqual(domaRunZoneCuts(highCount, [highCount, middle], chainDims)[0]!.crossMm, 1000)
  // 区域を囲んでいる途中に強調する寸法線: かかる標準筋の端から区域までの長さを読むもの（手入力のある長さは除く）
  assert.deepStrictEqual(domaZoneDistanceDimIds(middle, [tate], chainDims), ['a1', 'c1'])
  assert.deepStrictEqual(domaZoneDistanceDimIds(middle, [typed], chainDims), [])
  assert.deepStrictEqual(domaZoneDistanceDimIds({ ...middle, length_mm: 0, span_mm: 0 }, [tate], chainDims), ['a1', 'c1'])
  // 区域の辺が L の寸法線の端にそろう（始点から 0）ときは、その L の寸法線を使ったものとして強調する
  const withLengthDim: DrawingDomaRun = { ...tate, length_dim_id: 'dim-L' }
  const lengthDims = [...chainDims, { id: 'dim-L', x1: 200, y1: 3, x2: 200, y2: 546, length_mm: 5460 }]
  const [atEdge] = domaRunZoneCuts(withLengthDim, [withLengthDim, top], lengthDims)
  assert.deepStrictEqual([atEdge!.startMm, atEdge!.startSource], [0, 'dimension'])
  assert.ok(atEdge!.dimIds.includes('dim-L'))
  assert.ok(domaZoneDistanceDimIds(top, [withLengthDim], lengthDims).includes('dim-L'))
  // 寸法線のない標準筋で描いた端にそろうだけなら edge
  assert.strictEqual(domaRunZoneCuts(tate, [tate, top], chainDims)[0]!.startSource, 'edge')
  // 手入力があればそちら
  const [typedOver] = domaRunZoneCuts(typed, [typed, middle], chainDims)
  assert.deepStrictEqual([typedOver!.fromMm, typedOver!.startSource, typedOver!.dimIds], [1200, 'input', []])
  // つなぎ方で値が変わる（同じ所に 2000 と 2100 の寸法線がある）ときは決めない
  const [conflict] = domaRunZoneCuts(
    tate,
    [tate, middle],
    [...chainDims.filter((d) => d.id !== 'a2' && d.id !== 'a3'), { id: 'a1b', x1: 280, y1: 0, x2: 280, y2: 200, length_mm: 2100 }],
  )
  assert.deepStrictEqual([conflict!.complete, conflict!.startMm], [false, null])
  // 配筋範囲の寸法線がない（端の位置が決まらない）と配筋範囲の向きは読まない
  const [noSpan] = domaRunZoneCuts(
    { ...tate, span_dim_id: null },
    [tate, middle],
    chainDims.filter((d) => d.id !== 'dim-span'),
  )
  assert.deepStrictEqual([noSpan!.startMm, noSpan!.crossMm], [2000, null])

  // 集計用の展開: 標準筋は切った行、区域はタテ・ヨコ
  assert.deepStrictEqual(
    expandDomaRuns([atTop, top], dims).map((r) => r.id),
    ['r1', 'r1:z1:after', 'z1:tate', 'z1:yoko'],
  )
}

// 顧客の拾い（R8.11 大地様邸・福本様邸）: 標準筋を端からピッチごとに並べ、区域に来る本を数える
{
  // 大地 ヨコ: 9,555 を 200 で 48 本。下から 0〜2,275 が 12 本、区域 2,275〜5,915 が 18 本、残り 18 本
  assert.strictEqual(countBarsInRange(0, 2275, 200, 48), 12)
  assert.strictEqual(countBarsInRange(2275, 5915, 200, 48), 18)
  assert.strictEqual(countBarsInRange(5915, 9555, 200, 48), 18)
  // 大地 タテ: 8,190 を 200 で 41 本。左の区域 4,550 が 23 本、残り 18 本
  assert.strictEqual(countBarsInRange(0, 4550, 200, 41), 23)
  assert.strictEqual(countBarsInRange(4550, 8190, 200, 41), 18)
  // 福本 タテ: 10,920 を 200 で 55 本。区域 3,640 は右から数えると 18 本、左からだと 19 本
  assert.strictEqual(countBarsInRange(910, 4550, 200, 55), 18)
  assert.strictEqual(countBarsInRange(6370, 10010, 200, 55), 19)
}

// 曲げのない端がある 1 本は、必要な長さより長く手入力してよい（5,400 → 6,000 から切りやすい 5,500）
{
  const settings = { ...DEFAULT_DOMA_BAR_SETTINGS, bendMm: 250 }
  const longer = layoutDomaRun(5150, 3640, 'start', settings, [5500])
  assert.deepStrictEqual([longer.source, longer.warnings], ['manual', []])
  // 両端曲げ（伸ばす端がない）や、必要な長さより短いときは合計が合わない警告
  assert.ok(layoutDomaRun(4900, 3640, 'both', settings, [5500]).warnings.includes('MANUAL_SUM_MISMATCH'))
  assert.ok(layoutDomaRun(5150, 3640, 'start', settings, [5300]).warnings.includes('MANUAL_SUM_MISMATCH'))
}


// 区域で切った本は、同じセット（標準筋）の継手の位置に合わせ、区域の側の 1 本だけを残りにする
{
  const settings = { ...DEFAULT_DOMA_BAR_SETTINGS, bendMm: 150, lapMm: 600 }
  // 12,740（両端曲げ）を 6,000 + 5,500 + 2,740。区域の先 6,970（終点曲げ）は 4,980 + 2,740（終点側の本は同じ）
  const set = { length_mm: 12740, span_mm: 3000, bends: 'both' as const, settings, pieces_override: [6000, 5500, 2740] }
  assert.deepStrictEqual(domaZoneCutSetPieces(set, { lengthMm: 6970, bends: 'end' }, 'after', 20), [4980, 2740])
  // 手前の長い本は始点側の 6,000 をそのまま使う
  assert.deepStrictEqual(domaZoneCutSetPieces(set, { lengthMm: 8000, bends: 'start' }, 'before', 20), [6000, 2750])
  // 1 本で収まる本は継手を作らない
  assert.strictEqual(domaZoneCutSetPieces(set, { lengthMm: 2970, bends: 'start' }, 'before', 20), null)
  // 継手のない標準筋は合わせるものがない
  const short = { ...set, length_mm: 4000, bends: 'end' as const, pieces_override: null }
  assert.strictEqual(domaZoneCutSetPieces(short, { lengthMm: 6970, bends: 'end' }, 'after', 20), null)
}

console.log('doma-zone tests passed')
