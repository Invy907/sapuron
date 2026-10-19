-- 図面に描く土間筋 1 本を「加工本 1 本」として扱う。
--   straight_mm: 直線部の長さ（既定は 定尺 − 端部曲げ = 5850）
--   bend_end:    端部曲げを付ける側（描いた線の start / end / none）
-- 加工長さ = straight_mm + 端部曲げ（片側のみ）。

alter table drawing_doma_bars rename column run_length_mm to straight_mm;

alter table drawing_doma_bars
  add column if not exists bend_end text not null default 'start';
