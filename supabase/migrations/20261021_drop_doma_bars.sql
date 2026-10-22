-- 加工本を 1 本ずつ描いていた drawing_doma_bars を廃止する（土間筋は drawing_doma_runs に移行）。
-- 2026-10-22 時点で Test プロジェクトのテストデータ 2 行のみ。アプリはもう読まない。
-- 本番 DB からの削除になるため、doma_runs とは分けて手動で適用する。

drop table if exists drawing_doma_bars;
