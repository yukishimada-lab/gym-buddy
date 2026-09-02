-- ============================================================
-- gym-buddy / Phase 5: 種目の部位の整備 / 0kg 記録の補正
--
-- 由来: もとの supabase/phase5.sql(現在は supabase/legacy/phase5.sql)
-- ★ このマイグレーションは本番 Supabase に未適用です。
--   GitHub Actions のワークフロー(.github/workflows/supabase-migrations.yml)
--   の初回実行で適用されます。
--
-- ★ 既存データを消さない設計です。
--   - テーブルの DROP / 再作成は一切していません
--   - 追加は ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   - 補正は UPDATE のみ。DELETE は 1 つもありません
--   - 何度実行しても結果が変わらない(冪等)ように書いています
--
-- 実行順の前提: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
-- ============================================================

-- ============================================================
-- 0. 【診断用】「重量が 0kg」問題の原因を確認するクエリ
--
--    このセクションは実行されません(すべてコメント)。
--    気になるときに中身をコピーして SQL Editor で個別に実行してください。
--
--    ■ 調査の結論(2026-09 時点)
--      重量が 0kg になっていた記録は、マイグレーションで失われたのではなく
--      「記録タブの『ルーティンから一括追加』で展開したまま、重量を入力して
--        いない記録」でした。
--      ルーティンの種目に目標重量(default_weight_kg)が未設定だと、
--      展開時に 0kg のセットが default_sets 個(既定 3 セット)作られます。
--      その結果、日別詳細に「3set · 最大 0kg · 0kg」が並びます。
--      phase4.sql の移行処理(旧 workout_logs → workout_sets)は
--      ローカルに本番同等のデータを作って再現検証し、重量が正しく引き継がれる
--      ことを確認済みです。念のため、万一の取りこぼしに備えた復旧 UPDATE を
--      セクション 2 に入れてあります(該当が無ければ 0 件で終わります)。
--
--    ■ 診断 1: 重量が 1 つも入っていない記録の一覧
--      select l.workout_date, e.name,
--             count(ws.*)                       as set_count,
--             max(ws.weight_kg)                 as max_set_weight,
--             max(l.weight_kg)                  as legacy_weight
--      from public.workout_logs l
--      join public.exercises e on e.id = l.exercise_id
--      left join public.workout_sets ws on ws.workout_log_id = l.id
--      group by l.id, l.workout_date, e.name
--      having coalesce(max(ws.weight_kg), 0) = 0
--      order by l.workout_date desc, e.name;
--
--    ■ 診断 2: 旧カラムに重量が残っているのにセットが 0kg のもの
--      (= phase4.sql の移行で取りこぼした可能性がある記録。通常は 0 件)
--      select l.id, l.workout_date, e.name, l.weight_kg as legacy_weight
--      from public.workout_logs l
--      join public.exercises e on e.id = l.exercise_id
--      where l.weight_kg > 0
--        and not exists (
--          select 1 from public.workout_sets ws
--          where ws.workout_log_id = l.id and ws.weight_kg > 0
--        );
--
--    ■ 診断 3: 同じ日に同じ種目が 2 件以上ある記録(ベンチプレスの重複など)
--      select l.workout_date, e.name, count(*) as log_count,
--             array_agg(l.id order by l.sort_order) as log_ids
--      from public.workout_logs l
--      join public.exercises e on e.id = l.exercise_id
--      group by l.workout_date, l.exercise_id, e.name
--      having count(*) > 1
--      order by l.workout_date desc;
--
--      ※ phase4.sql は workout_logs に 1 行も INSERT していないため、
--        重複はマイグレーションではなくアプリ側の操作(ルーティンの二重展開や、
--        手入力したあとに同じ種目を含むルーティンを展開した等)で生まれたものです。
--        本当に不要かどうかは中身を見ないと判断できないので、このスクリプトでは
--        自動削除しません。診断 3 で確認したうえで、消したい行だけを
--        次のように削除してください(セットも自動で消えます)。
--
--          delete from public.workout_logs where id = '<診断3で出た log_id>';
-- ============================================================


-- ============================================================
-- 1. 種目の部位 (exercises.muscle_group) の整備
--
--    カラム自体は schema.sql の時点で存在するが、
--    - 未設定 (null) の種目がある
--    - Phase 4 までの区分「腹」と、新しい区分「体幹」が混在する
--    ため、区分を 8 つ(胸 / 背中 / 肩 / 腕 / 脚 / 体幹 / 有酸素 / その他)に
--    そろえ、未設定の種目には種目名から推定した部位を入れる。
-- ============================================================

-- 念のため(古い環境でカラムが無い場合に備える)
alter table public.exercises
  add column if not exists muscle_group text;

create index if not exists exercises_user_muscle_group_idx
  on public.exercises (user_id, muscle_group);

-- ------------------------------------------------------------
-- 1-1. 種目名から部位を推定する関数
--
--      lib/muscleGroups.ts の inferMuscleGroup と同じ判定内容・同じ優先順位。
--      どちらかを直すときは必ず両方そろえること。
--      上から順に最初に当たったものを採用するので、順番に意味がある。
--        「レッグレイズ」→ 体幹(「レッグ」で脚に落ちないよう体幹を先に見る)
--        「レッグカール」→ 脚(「カール」で腕に落ちないよう脚を先に見る)
--        「ナローベンチプレス」→ 腕(「ベンチプレス」で胸に落ちないように)
-- ------------------------------------------------------------
create or replace function public.infer_muscle_group(exercise_name text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(exercise_name, '')) ~
      '(有酸素|ランニング|ジョギング|ウォーキング|トレッドミル|エアロバイク|バイク|エリプティカル|クロストレーナー|ステアマスター|縄跳び|なわとび|水泳|スイミング|hiit)'
      then '有酸素'
    when lower(coalesce(exercise_name, '')) ~
      '(体幹|腹筋|腹直筋|アブローラー|アブドミナル|アドミナブル|クランチ|シットアップ|プランク|レッグレイズ|ニーレイズ|ロシアンツイスト|ドラゴンフラッグ|ハンギング|サイドベンド)'
      then '体幹'
    when lower(coalesce(exercise_name, '')) ~
      '(脚|大腿|スクワット|レッグ|ランジ|カーフ|ヒップスラスト|ヒップアブダクション|ブルガリアン|ステップアップ|アダクション|アブダクション)'
      then '脚'
    when lower(coalesce(exercise_name, '')) ~
      '(カール|トライセプス|上腕|キックバック|プレスダウン|プッシュダウン|ナローベンチ|ナローグリップ|フレンチプレス|リストカール|ハンマー|コンセントレーション|スカルクラッシャー)'
      then '腕'
    when lower(coalesce(exercise_name, '')) ~
      '(ショルダー|サイドレイズ|フロントレイズ|リアレイズ|リアデルト|ミリタリープレス|アーノルドプレス|アップライトロー|フェイスプル|三角筋|肩)'
      then '肩'
    when lower(coalesce(exercise_name, '')) ~
      '(背中|広背筋|ラットプル|プルダウン|懸垂|チンニング|プルアップ|ローイング|ベントオーバー|デッドリフト|シュラッグ|プルオーバー|バックエクステンション|ロー)'
      then '背中'
    when lower(coalesce(exercise_name, '')) ~
      '(胸|大胸筋|ベンチプレス|チェスト|インクライン|デクライン|フライ|ペックデック|ケーブルクロス|ディップス|プッシュアップ|腕立て)'
      then '胸'
    else 'その他'
  end;
$$;

-- ------------------------------------------------------------
-- 1-2. 既存の種目の部位をそろえる
--      - すでに新しい 8 区分のどれかなら触らない(ユーザーが選んだ値を尊重)
--      - 旧区分は読み替える(腹 → 体幹 など)
--      - 未設定 / 想定外の値は種目名から推定する
-- ------------------------------------------------------------
update public.exercises e
set muscle_group = normalized.value
from (
  select
    id,
    case
      when muscle_group in ('胸', '背中', '肩', '腕', '脚', '体幹', '有酸素', 'その他')
        then muscle_group
      when muscle_group in ('腹', '腹筋', 'コア')          then '体幹'
      when muscle_group in ('カーディオ')                   then '有酸素'
      when muscle_group in ('全身')                         then 'その他'
      else public.infer_muscle_group(name)
    end as value
  from public.exercises
) as normalized
where normalized.id = e.id
  and e.muscle_group is distinct from normalized.value;

-- ------------------------------------------------------------
-- 1-3. 新規ユーザーへの初期種目(schema.sql のトリガー)も新しい区分にそろえる
--      lib/defaultExercises.ts と同じ内容。
-- ------------------------------------------------------------
create or replace function public.seed_default_exercises()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.exercises (user_id, name, muscle_group)
  values
    (new.id, 'ベンチプレス', '胸'),
    (new.id, 'ダンベルフライ', '胸'),
    (new.id, 'インクラインベンチプレス', '胸'),
    (new.id, 'デッドリフト', '背中'),
    (new.id, 'ラットプルダウン', '背中'),
    (new.id, 'ベントオーバーロー', '背中'),
    (new.id, 'ショルダープレス', '肩'),
    (new.id, 'サイドレイズ', '肩'),
    (new.id, 'バーベルカール', '腕'),
    (new.id, 'トライセプスエクステンション', '腕'),
    (new.id, 'スクワット', '脚'),
    (new.id, 'レッグプレス', '脚'),
    (new.id, 'レッグカール', '脚'),
    (new.id, 'アブローラー', '体幹'),
    (new.id, 'プランク', '体幹');
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 1-4. exercises の RLS
--      schema.sql で設定済みだが、取りこぼしが無いようここでも張り直す。
--      (ポリシーの内容は schema.sql と同一)
-- ------------------------------------------------------------
alter table public.exercises enable row level security;

drop policy if exists "own exercises: select" on public.exercises;
create policy "own exercises: select" on public.exercises
  for select using (auth.uid() = user_id);

drop policy if exists "own exercises: insert" on public.exercises;
create policy "own exercises: insert" on public.exercises
  for insert with check (auth.uid() = user_id);

drop policy if exists "own exercises: update" on public.exercises;
create policy "own exercises: update" on public.exercises
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own exercises: delete" on public.exercises;
create policy "own exercises: delete" on public.exercises
  for delete using (auth.uid() = user_id);


-- ============================================================
-- 2. 【復旧】旧カラムに重量が残っているのにセットが 0kg の記録を直す
--
--    phase4.sql の移行(旧 workout_logs → workout_sets)は再現検証した
--    かぎり正しく動くが、万一取りこぼしがあった場合の保険として、
--    「旧カラム weight_kg が 0 より大きいのに、セットの重量がすべて 0」
--    という復旧可能な記録だけを対象に、旧カラムの重量を書き戻す。
--
--    - 重量が最初から入っていない記録(ルーティンを展開しただけの記録や
--      自重種目)は旧カラムも 0 なので、この UPDATE の対象外。
--      無い数値を作り出すことはしない。
--    - 該当が無ければ 0 件更新で終わる(通常はこちら)。
--    - workout_sets の更新でトリガーが走り、旧カラムも自動で整合する。
-- ============================================================
update public.workout_sets ws
set weight_kg = l.weight_kg
from public.workout_logs l
where ws.workout_log_id = l.id
  and l.weight_kg > 0
  and not exists (
    select 1 from public.workout_sets w2
    where w2.workout_log_id = l.id
      and w2.weight_kg > 0
  );



-- ============================================================
-- 3. 実行結果の確認
--    マイグレーションのログ(GitHub Actions の実行ログ)に NOTICE として
--    出力される。すべて 0 なら想定どおり。
--    ※ 最後の「重量が入っていない記録」は自重種目やルーティンを展開した
--      ままの記録なので、0 でなくても異常ではない。
-- ============================================================
do $report$
declare
  missing_group   bigint;
  unknown_group   bigint;
  unrecovered     bigint;
  no_weight       bigint;
begin
  select count(*) into missing_group
    from public.exercises where muscle_group is null;

  select count(*) into unknown_group
    from public.exercises
    where muscle_group not in ('胸','背中','肩','腕','脚','体幹','有酸素','その他');

  select count(*) into unrecovered
    from public.workout_logs l
    where l.weight_kg > 0
      and not exists (
        select 1 from public.workout_sets ws
        where ws.workout_log_id = l.id and ws.weight_kg > 0
      );

  select count(*) into no_weight
    from public.workout_logs l
    where not exists (
      select 1 from public.workout_sets ws
      where ws.workout_log_id = l.id and ws.weight_kg > 0
    );

  raise notice 'Phase 5 の結果: 部位が未設定の種目=% (0 が正常) / 想定外の部位の種目=% (0 が正常) / 重量を復旧できていない記録=% (0 が正常) / 重量が入っていない記録=% (自重種目・ルーティン展開したままの記録)',
    missing_group, unknown_group, unrecovered, no_weight;
end
$report$;
