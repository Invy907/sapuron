-- 図面詳細画面の「コーナー筋」タブで配置した鉄筋オブジェクトを保存する。
--
-- ユニットとは完全に分離した図面レベルのオブジェクトとして持つ。
-- 「鉄筋 1 本 ＝ 長さ 1 個」では保存せず、形状を構成する辺(segment)ごとに
-- 寸法値(mm)と寸法基準（芯々／内々）を順序どおり segments jsonb に持つ。
--
--   segments: [{ id, lengthMm, measurementType, labelOffsetX?, labelOffsetY? }, ...]
--   measurementType: 'SHIN_SHIN' | 'UCHI_UCHI' | 'SOTO_SOTO' | null
--
-- category（筋種類）と shape_type（形状トポロジー）は独立させる。
-- 同じ L 形がコーナー筋にも添え筋にも使えるため 1:1 に固定しない。
--
-- RLS は drawing_segments と同じ「自分のプロジェクトの図面のみ」パターンに合わせる。

create table if not exists drawing_corner_bars (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references drawings(id) on delete cascade,
  page_no int not null default 1,
  -- 筋種類: CORNER / SOE / SPECIAL_CORNER / PARTIAL_REINFORCE / BIG_CORNER / BENT / GENKAN_DROP
  category text not null default 'CORNER',
  -- 形状トポロジー: STRAIGHT / L / U / Z / STEP / T
  shape_type text not null default 'L',
  diameter text,
  -- 辺ごとの寸法(mm)と寸法基準。配列の順序が辺1, 辺2, … に対応する
  -- 数量は持たない: 図面に 1 つ配置したものが 1 本で、集計は配置数で数える
  segments jsonb not null default '[]'::jsonb,
  -- 配置点（drawing_segments と同じ図面座標系。形状の bbox 中心を合わせる）
  x double precision not null,
  y double precision not null,
  -- 図面上の大きさ（bbox の長辺, px）。配置時のドラッグで決める。
  -- 実寸(mm)を図面座標にそのまま使うと大きすぎるため、描画は模式図として扱う
  size_px double precision not null default 110,
  -- 0/1/2/3 = 0/90/180/270 度（時計回り）
  rotation int not null default 0,
  color text not null default 'blue',
  label text,
  created_at timestamptz not null default now()
);

create index if not exists drawing_corner_bars_drawing_id_idx
  on drawing_corner_bars (drawing_id);

-- 旧モデル（preset_id / dims / bars）からの移行。
-- 形状と寸法の持ち方が変わり機械的な変換ができないため、列は落として作り直す。
alter table drawing_corner_bars
  drop column if exists preset_id,
  drop column if exists dims,
  drop column if exists bars;

alter table drawing_corner_bars
  add column if not exists shape_type text not null default 'L',
  add column if not exists diameter text,
  add column if not exists segments jsonb not null default '[]'::jsonb,
  add column if not exists size_px double precision not null default 110;

-- 数量は配置数で数えるため、旧列は落とす
alter table drawing_corner_bars drop column if exists quantity;

alter table drawing_corner_bars
  alter column category set default 'CORNER';

alter table drawing_corner_bars enable row level security;

drop policy if exists "Users can view corner bars of own drawings" on drawing_corner_bars;
create policy "Users can view corner bars of own drawings"
  on drawing_corner_bars for select
  using (
    exists (
      select 1
      from drawings d
      join projects p on p.id = d.project_id
      where d.id = drawing_corner_bars.drawing_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert corner bars to own drawings" on drawing_corner_bars;
create policy "Users can insert corner bars to own drawings"
  on drawing_corner_bars for insert
  with check (
    exists (
      select 1
      from drawings d
      join projects p on p.id = d.project_id
      where d.id = drawing_corner_bars.drawing_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update corner bars of own drawings" on drawing_corner_bars;
create policy "Users can update corner bars of own drawings"
  on drawing_corner_bars for update
  using (
    exists (
      select 1
      from drawings d
      join projects p on p.id = d.project_id
      where d.id = drawing_corner_bars.drawing_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete corner bars of own drawings" on drawing_corner_bars;
create policy "Users can delete corner bars of own drawings"
  on drawing_corner_bars for delete
  using (
    exists (
      select 1
      from drawings d
      join projects p on p.id = d.project_id
      where d.id = drawing_corner_bars.drawing_id
        and p.user_id = auth.uid()
    )
  );
