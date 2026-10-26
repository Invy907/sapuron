-- 大コーナーは特殊コーナー筋と同じ扱いのため、既存データを統合する
update drawing_corner_bars
set category = 'SPECIAL_CORNER'
where category = 'BIG_CORNER';
