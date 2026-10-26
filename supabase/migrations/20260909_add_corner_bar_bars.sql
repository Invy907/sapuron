-- 付加筋 1 配置に複数の鉄筋径を持たせる。
--
-- これまでは 1 配置 = 鉄筋径 1 つ（diameter）＋ 辺の寸法 1 組（segments）だったため、
-- 同じ位置に D10 と D13 のように実寸の違う鉄筋を入れられなかった。
-- 径ごとに 本数・各辺の寸法・寸法基準（芯々／内々／外々）を個別に持てるよう bars に移す。
--
--   bars: [{ id, barType, quantity, segments: [{ id, lengthMm, measurementType }, ...] }, ...]
--
-- bars[i].segments の要素数は shape_type の辺数と一致する（アプリ側で正規化）。
-- category（筋種類）と shape_type（形状）は配置ごとに 1 つのままなので、
-- 1 つの配置に別の筋種類が混ざることはない。
--
-- 旧列 diameter / segments は残す。アプリはもう読まないが、
-- bars[0] をミラーして書き続けるためロールバックしても表示が壊れない。

alter table drawing_corner_bars
  add column if not exists bars jsonb not null default '[]'::jsonb;

update drawing_corner_bars
set bars = jsonb_build_array(
  jsonb_build_object(
    'id', 'b1',
    'barType', coalesce(diameter, 'D13'),
    'quantity', 1,
    'segments', coalesce(segments, '[]'::jsonb)
  )
)
where bars = '[]'::jsonb;
