-- 土間筋タブを「図面上に描く」方式にする。
--   1) drawing_doma_dimensions: 各辺の寸法線（両端に 90° の短い線を付けて描く）
--   2) drawing_doma_bars:       タテ／ヨコごとに描いた土間筋 1 本（代表線）
-- 加工本・本数は lib/slab-rebar.ts で毎回計算し、保存しない。
--
-- 外形入力方式の drawing_slab_regions は廃止する。

drop table if exists drawing_slab_regions;

create table if not exists drawing_doma_dimensions (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references drawings(id) on delete cascade,
  page_no int not null default 1,
  x1 double precision not null,
  y1 double precision not null,
  x2 double precision not null,
  y2 double precision not null,
  length_mm int not null,
  created_at timestamptz not null default now()
);

create index if not exists drawing_doma_dimensions_drawing_id_idx
  on drawing_doma_dimensions (drawing_id);

create table if not exists drawing_doma_bars (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references drawings(id) on delete cascade,
  page_no int not null default 1,
  -- standard / special
  kind text not null default 'standard',
  -- tate / yoko
  direction text not null,
  x1 double precision not null,
  y1 double precision not null,
  x2 double precision not null,
  y2 double precision not null,
  -- 鉄筋 1 本の設置長さ
  run_length_mm int not null,
  -- 配筋幅（本数 = 配筋幅 ÷ ピッチ の切り上げ）
  span_mm int not null,
  -- { diameter, pitchMm, bendMm, stockMm, lapMm }
  settings jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists drawing_doma_bars_drawing_id_idx
  on drawing_doma_bars (drawing_id);

alter table drawing_doma_dimensions enable row level security;
alter table drawing_doma_bars enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['drawing_doma_dimensions', 'drawing_doma_bars'] loop
    execute format('drop policy if exists "own drawings select" on %I', t);
    execute format('drop policy if exists "own drawings insert" on %I', t);
    execute format('drop policy if exists "own drawings update" on %I', t);
    execute format('drop policy if exists "own drawings delete" on %I', t);
    execute format(
      'create policy "own drawings select" on %I for select using (exists (select 1 from drawings d join projects p on p.id = d.project_id where d.id = %I.drawing_id and p.user_id = auth.uid()))',
      t, t);
    execute format(
      'create policy "own drawings insert" on %I for insert with check (exists (select 1 from drawings d join projects p on p.id = d.project_id where d.id = %I.drawing_id and p.user_id = auth.uid()))',
      t, t);
    execute format(
      'create policy "own drawings update" on %I for update using (exists (select 1 from drawings d join projects p on p.id = d.project_id where d.id = %I.drawing_id and p.user_id = auth.uid()))',
      t, t);
    execute format(
      'create policy "own drawings delete" on %I for delete using (exists (select 1 from drawings d join projects p on p.id = d.project_id where d.id = %I.drawing_id and p.user_id = auth.uid()))',
      t, t);
  end loop;
end $$;
