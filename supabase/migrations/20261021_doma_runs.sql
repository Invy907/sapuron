-- 土間筋を「設置区間 1 つ（1 セット）」で描く方式にする。
--   drawing_doma_runs: 図面に描いた設置区間 1 つ。加工本・重ね・本数は
--   lib/slab-rebar.ts の layoutDomaRun で毎回計算し、保存しない。
--   pieces_override に加工本の長さを手入力したときだけ、その値を使う。
--
-- 旧 drawing_doma_bars の削除は 20261021_drop_doma_bars.sql に分けた。

create table if not exists drawing_doma_runs (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references drawings(id) on delete cascade,
  page_no int not null default 1,
  -- standard / special
  kind text not null default 'standard',
  -- tate / yoko
  direction text not null,
  -- 描いた線（設置区間の両端）。表示用
  x1 double precision not null,
  y1 double precision not null,
  x2 double precision not null,
  y2 double precision not null,
  -- 設置区間の長さ L
  length_mm int not null,
  -- 配筋範囲（本数 = 配筋範囲 ÷ ピッチ の切り上げ）
  span_mm int not null,
  -- 端部曲げを付ける側: both / start / end / none
  bends text not null default 'both',
  -- { diameter, pitchMm, bendMm, stockMm, lapMm }
  settings jsonb not null,
  -- 加工本の長さの手入力（例 [6000, 1270]）。null なら自動
  pieces_override jsonb,
  created_at timestamptz not null default now()
);

create index if not exists drawing_doma_runs_drawing_id_idx
  on drawing_doma_runs (drawing_id);

alter table drawing_doma_runs enable row level security;

drop policy if exists "own drawings select" on drawing_doma_runs;
drop policy if exists "own drawings insert" on drawing_doma_runs;
drop policy if exists "own drawings update" on drawing_doma_runs;
drop policy if exists "own drawings delete" on drawing_doma_runs;

create policy "own drawings select" on drawing_doma_runs for select using (
  exists (select 1 from drawings d join projects p on p.id = d.project_id
          where d.id = drawing_doma_runs.drawing_id and p.user_id = auth.uid()));
create policy "own drawings insert" on drawing_doma_runs for insert with check (
  exists (select 1 from drawings d join projects p on p.id = d.project_id
          where d.id = drawing_doma_runs.drawing_id and p.user_id = auth.uid()));
create policy "own drawings update" on drawing_doma_runs for update using (
  exists (select 1 from drawings d join projects p on p.id = d.project_id
          where d.id = drawing_doma_runs.drawing_id and p.user_id = auth.uid()));
create policy "own drawings delete" on drawing_doma_runs for delete using (
  exists (select 1 from drawings d join projects p on p.id = d.project_id
          where d.id = drawing_doma_runs.drawing_id and p.user_id = auth.uid()));
