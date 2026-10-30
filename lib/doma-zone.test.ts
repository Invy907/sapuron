import assert from 'node:assert'
import { DEFAULT_DOMA_BAR_SETTINGS, layoutDomaRun } from './slab-rebar'
import type { DrawingDomaRun } from './types/database'
import {
  domaZoneEdgeAtScreenSide,
  domaZoneRunValues,
  domaZoneRuns,
  domaZoneScreenSide,
  domaRunZoneCuts,
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

  // 上の辺（壁）が標準筋の始点にそろう区域: 手前はなく、先は L − 区域 + 重ね、区域の側は曲げなし
  const top = zoneAt(0, 195, { walls: { top: true, bottom: false, left: false, right: false } })
  const [cut] = domaRunZoneCuts(tate, [tate, top], dims)
  assert.deepStrictEqual(cut, {
    zoneId: 'z1',
    count: 8,
    fromMm: 0,
    toMm: 1950,
    before: null,
    after: { lengthMm: 4110, bends: 'end' },
  })
  // 区域にかからない 7 本は元の L、かかる 8 本は 4110
  const rows = splitDomaRunByZones(tate, [tate, top], dims)
  assert.deepStrictEqual(
    rows.map((r) => [r.length_mm, r.span_mm, r.bends]),
    [
      [5460, 1400, 'both'],
      [4110, 1600, 'end'],
    ],
  )

  // 途中にある区域: 手前と先の 2 本に分かれ、どちらも区域の中へ 600 入る
  const middle = zoneAt(200, 395)
  const [cut2] = domaRunZoneCuts(tate, [tate, middle], dims)
  assert.deepStrictEqual(
    [cut2!.fromMm, cut2!.toMm, cut2!.before, cut2!.after],
    [2000, 3950, { lengthMm: 2600, bends: 'start' }, { lengthMm: 2110, bends: 'end' }],
  )

  // ヨコだけの区域・並ぶ幅の外の区域ではタテの標準筋を切らない
  assert.deepStrictEqual(domaRunZoneCuts(tate, [tate, zoneAt(0, 195, { directions: { tate: false } })], dims), [])
  const outside = { ...zoneAt(0, 195), x1: 800, x2: 950 }
  assert.deepStrictEqual(domaRunZoneCuts(tate, [tate, outside], dims), [])

  // 集計用の展開: 標準筋は切った行、区域はタテ・ヨコ
  assert.deepStrictEqual(
    expandDomaRuns([tate, top], dims).map((r) => r.id),
    ['r1', 'r1:z1:after', 'z1:tate', 'z1:yoko'],
  )
}

console.log('doma-zone tests passed')
