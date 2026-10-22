-- 土間筋（設置区間）が L・配筋範囲に使った寸法線を覚えておく。
-- 寸法線を選んだときだけ入る。手入力や寸法線が消えたときは null。
alter table drawing_doma_runs
  add column if not exists length_dim_id uuid references drawing_doma_dimensions(id) on delete set null,
  add column if not exists span_dim_id uuid references drawing_doma_dimensions(id) on delete set null;
