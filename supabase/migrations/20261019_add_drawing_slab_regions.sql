-- 図面詳細画面の「土間筋」タブで配置するスラブ領域を保存する。
--
-- 保存するのは外形と配筋条件だけ。加工本・数量は lib/slab-rebar.ts で毎回再計算し、
-- 図面上の鉄筋線・加工本・集計行を別データとして扱う。
--
--   shape: { type: 'rect', widthMm, heightMm }
--        | { type: 'l', widthMm, heightMm, cutCorner: 'tl'|'tr'|'bl'|'br', cutWidthMm, cutHeightMm }
--   settings: { diameter, pitchTateMm, pitchYokoMm, bendMm, stockMm, lapMm }
--
-- RLS は drawing_corner_bars と同じ「自分のプロジェクトの図面のみ」パターン。

create table if not exists drawing_slab_regions (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references drawings(id) on delete cascade,
  page_no int not null default 1,
  -- standard / special
  kind text not null default 'standard',
  shape jsonb not null,
  settings jsonb not null,
  -- 配置点（図面座標系。外形 bbox の中心を合わせる）
  x double precision not null,
  y double precision not null,
  -- 図面上の大きさ（bbox の長辺, px）。描画は模式図として扱う
  size_px double precision not null default 320,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists drawing_slab_regions_drawing_id_idx
  on drawing_slab_regions (drawing_id);

alter table drawing_slab_regions enable row level security;

drop policy if exists "Users can view slab regions of own drawings" on drawing_slab_regions;
create policy "Users can view slab regions of own drawings"
  on drawing_slab_regions for select
  using (
    exists (
      select 1
      from drawings d
      join projects p on p.id = d.project_id
      where d.id = drawing_slab_regions.drawing_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert slab regions to own drawings" on drawing_slab_regions;
create policy "Users can insert slab regions to own drawings"
  on drawing_slab_regions for insert
  with check (
    exists (
      select 1
      from drawings d
      join projects p on p.id = d.project_id
      where d.id = drawing_slab_regions.drawing_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update slab regions of own drawings" on drawing_slab_regions;
create policy "Users can update slab regions of own drawings"
  on drawing_slab_regions for update
  using (
    exists (
      select 1
      from drawings d
      join projects p on p.id = d.project_id
      where d.id = drawing_slab_regions.drawing_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete slab regions of own drawings" on drawing_slab_regions;
create policy "Users can delete slab regions of own drawings"
  on drawing_slab_regions for delete
  using (
    exists (
      select 1
      from drawings d
      join projects p on p.id = d.project_id
      where d.id = drawing_slab_regions.drawing_id
        and p.user_id = auth.uid()
    )
  );
