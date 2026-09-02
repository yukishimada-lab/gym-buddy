-- ============================================================
-- gym-buddy / Phase 7: Google ログイン対応と、新規ユーザーの初期化を安全にする
--
-- ★ 冪等(何度実行しても同じ結果)・非破壊:
--   DROP TABLE / TRUNCATE / DELETE は 1 つも含まれていません。
--   既存ユーザーのデータには一切触れません。
--
-- 【このマイグレーションの目的】
-- Google ログインの追加により、これまで一度も動いたことのない
-- 「本人以外の新規ユーザーがサインアップする」経路が初めて使われます。
--
-- Supabase では auth.users への INSERT と、そこに仕掛けたトリガーが
-- 同じトランザクションで実行されます。つまりトリガーの中で 1 つでも
-- エラーが起きると、サインアップ自体が
--   「Database error saving new user」
-- で失敗し、新しい人はアプリに入ることすらできません。
--
-- 初期種目の登録(seed_default_exercises)は「あると嬉しい」おまけであって、
-- サインアップを止めてまで成功させる必要はありません。
-- そこで、
--   1. 例外を握りつぶして必ずサインアップを通す(失敗しても警告ログのみ)
--   2. すでに種目がある場合は二重登録しない
-- ように作り直します。
-- 初期種目が入らなかった場合でも、アプリの「種目」タブに
-- 「代表的な種目をまとめて登録」ボタンが出るため、ユーザーは詰まりません。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 新規ユーザーへの初期種目の自動登録(安全版)
--    種目の一覧は lib/defaultExercises.ts と同じ内容です。
--    どちらかを直すときは必ず両方そろえること。
-- ------------------------------------------------------------
create or replace function public.seed_default_exercises()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 同じメールアドレスの別プロバイダ(GitHub ↔ Google)が結び付いた場合など、
  -- すでに種目を持っているユーザーには何もしない
  if exists (select 1 from public.exercises where user_id = new.id) then
    return new;
  end if;

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
exception
  -- ここで例外を外に出すとサインアップごと失敗するため、必ず握りつぶす。
  -- 種目が入らなくても、アプリ側の「代表的な種目をまとめて登録」ボタンで復旧できる。
  when others then
    raise warning 'seed_default_exercises に失敗しました (user_id=%): %', new.id, sqlerrm;
    return new;
end;
$$;

-- ------------------------------------------------------------
-- 2. トリガーを張り直す(万一外れていた場合の保険)
-- ------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.seed_default_exercises();

-- ------------------------------------------------------------
-- 3. 既存ユーザーの取りこぼし補完
--    種目が 1 件も無いユーザー(トリガーが動く前に作られたアカウントなど)に
--    初期種目を入れる。すでに 1 件でも持っている人には何もしない。
-- ------------------------------------------------------------
insert into public.exercises (user_id, name, muscle_group)
select u.id, d.name, d.muscle_group
from auth.users u
cross join (
  values
    ('ベンチプレス', '胸'),
    ('ダンベルフライ', '胸'),
    ('インクラインベンチプレス', '胸'),
    ('デッドリフト', '背中'),
    ('ラットプルダウン', '背中'),
    ('ベントオーバーロー', '背中'),
    ('ショルダープレス', '肩'),
    ('サイドレイズ', '肩'),
    ('バーベルカール', '腕'),
    ('トライセプスエクステンション', '腕'),
    ('スクワット', '脚'),
    ('レッグプレス', '脚'),
    ('レッグカール', '脚'),
    ('アブローラー', '体幹'),
    ('プランク', '体幹')
) as d(name, muscle_group)
where not exists (
  select 1 from public.exercises e where e.user_id = u.id
);

-- ------------------------------------------------------------
-- 4. 共通の食品マスタが空になっていないかの確認用メモ
--    食品マスタ(food_items の user_id IS NULL 行)は全ユーザー共通で、
--    Phase 2 のマイグレーションでシード済みです。RLS も
--    「user_id is null なら誰でも参照可」になっているため、
--    新規ユーザーでも最初から食事記録の候補が表示されます。
--    ここでは件数だけ確認して、0 件なら警告を出します。
-- ------------------------------------------------------------
do $$
declare
  shared_count integer;
begin
  select count(*) into shared_count from public.food_items where user_id is null;
  if shared_count = 0 then
    raise warning '共通の食品マスタが 0 件です。Phase 2 のマイグレーションを適用してください。';
  end if;
end
$$;
