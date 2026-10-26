-- 特殊コーナー筋の左右反転（配置・選択パネルの「反転」）
alter table public.drawing_corner_bars
  add column if not exists flipped boolean not null default false;

comment on column public.drawing_corner_bars.flipped is
  'SPECIAL_CORNER only: mirror shape horizontally before rotation';
