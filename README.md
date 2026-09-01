# 💪 gym-buddy

筋トレを記録するための個人向け Web アプリです。ジムでスマホから、その日のワークアウト(種目・重量・回数・セット数)をサクッと記録できます。

## 主な機能(Phase 1)

- **GitHub アカウントでログイン**(Supabase Auth)
- **ワークアウト記録**: 日付ごとに種目・重量(kg)・回数(レップ)・セット数を記録/編集/削除
- **種目マスタ**: よく使う種目(ベンチプレス、スクワット等)を登録・管理。初回サインアップ時に代表的な種目が自動登録されます
- **ルーティン管理**: 「胸の日」「脚の日」のような種目の組み合わせを保存し、記録ページからワンタップでその日の記録に展開
- **履歴一覧**: 過去の記録を日付ごとに一覧表示

## 主な機能(Phase 2: 食事管理と PFC 計算)

- **食品マスタ**: 白米・鶏むね肉・卵・納豆・プロテインなど定番食品約 30 品目の PFC・カロリー(100g あたり)を初期データとして収録
- **食事記録**: 日付 × タイミング(朝食/昼食/夕食/間食)ごとに、食品+グラム数を複数品目記録/編集/削除。食品マスタから検索して選ぶと、グラム数から PFC・カロリーを自動計算
- **写真からの自動推定**: 食事の写真をアップロードすると、Gemini Vision API が品目とおおよそのグラム数・PFC を推定してフォームに自動入力(内容は記録前に修正できます)。写真は Supabase Storage に保存されます
- **外食メニューの栄養情報検索**: 店名+メニュー名を入力すると、Gemini API の Google 検索グラウンディングで公式の栄養成分情報を検索してフォームに自動入力(見つからない場合は手動入力)
- **日別の PFC・カロリー合計**: その日の食事一覧と、カロリー・タンパク質・脂質・炭水化物の合計を表示

## 主な機能(Phase 3: 体重・InBody データの記録と目標サポート)

- **体重記録**: 日付ごとに体重(kg)とメモを記録/編集/削除。1 日 1 件を基本とし、同じ日付で記録すると上書きされます
- **InBody データ記録**: 体脂肪率(%)・骨格筋量(kg)・体脂肪量(kg)・基礎代謝量(kcal)・体水分量(L)を測定日ごとに記録。項目はすべて任意なので、測定できた項目だけ入力すれば OK です
- **推移グラフ**: 体重・体脂肪率・骨格筋量の時系列グラフ(Recharts)。**1ヶ月 / 3ヶ月 / 全期間**で期間を切り替えできます。単位もスケールも違う 3 指標を 1 つのグラフに重ねる(2 軸グラフ)のではなく、指標ごとにグラフを分けて誤読を防いでいます
- **目標設定**: 目標体重・目標体脂肪率・目標達成希望日・モード(増量/減量/維持)を設定
- **目標サポート分析**:
  - 現在地から目標までの差分と、達成に必要な **1 日あたりのカロリー収支**(体重 1kg = 7,200kcal 換算)の目安
  - Phase 2 の食事記録と組み合わせた、**直近 14 日の平均摂取カロリー・平均タンパク質**が目標に対して足りているか/超過しているかの判定
  - 直近 28 日の体重記録から求めた**週あたりの増減ペース**と、そのペースが続いた場合の**目標達成予測日**
  - 上記の数値(体重推移・目標・直近の食事傾向・トレーニング頻度)を Gemini API に渡して生成する、**日本語の AI アドバイス**(サーバーサイドで実行)

## 技術スタック

- [Next.js](https://nextjs.org/)(App Router / TypeScript)
- [Supabase](https://supabase.com/)(認証 + データベース)
- [Tailwind CSS](https://tailwindcss.com/)
- [Recharts](https://recharts.org/)(推移グラフ)
- [Gemini API](https://ai.google.dev/)(食事の写真解析・外食検索・目標アドバイス)
- デプロイ先: [Vercel](https://vercel.com/)

---

## セットアップ手順

初めての方でも順番にやれば動くように書いています。全体の流れは次の 4 ステップです。

1. Supabase プロジェクトを作る
2. データベース(テーブル)を作る
3. GitHub ログインを設定する
4. アプリを起動する(ローカル or Vercel)

### 1. Supabase プロジェクトの作成

1. [https://supabase.com](https://supabase.com) を開き、右上の **Sign In** をクリックします。
2. **Continue with GitHub** を選ぶと、GitHub アカウントでそのままサインアップ/ログインできます(GitHub アカウントがない場合は先に [github.com](https://github.com) で作成してください)。
3. ログイン後、**New Project** をクリックします。
4. 以下を入力してプロジェクトを作成します。
   - **Name**: `gym-buddy` など好きな名前
   - **Database Password**: 自動生成でOK(メモしておくと安心)
   - **Region**: `Northeast Asia (Tokyo)` を選ぶと日本から速いです
5. 1〜2 分でプロジェクトが作成されます。

### 2. データベースのセットアップ(schema.sql の実行)

1. Supabase ダッシュボードの左メニューから **SQL Editor** を開きます。
2. このリポジトリの [`supabase/schema.sql`](./supabase/schema.sql) の中身を**全部コピー**して、エディタに貼り付けます。
3. 右下の **Run** をクリックします。`Success. No rows returned` と表示されれば完了です。

これでテーブル(種目・記録・ルーティン)と、ユーザーが自分のデータにしかアクセスできないようにするセキュリティ設定(Row Level Security)が作成されます。新規ユーザーには代表的な種目(ベンチプレス、スクワット等)が自動で登録されます。

### 3. GitHub OAuth(GitHub ログイン)の設定

アプリに「GitHub でログイン」するための設定です。**GitHub 側**と **Supabase 側**の 2 箇所を設定します。

#### 3-1. GitHub で OAuth App を作成

1. GitHub にログインし、[https://github.com/settings/developers](https://github.com/settings/developers) を開きます。
2. **OAuth Apps** → **New OAuth App** をクリックします。
3. 以下を入力します。
   - **Application name**: `gym-buddy` など好きな名前
   - **Homepage URL**: `http://localhost:3000`(あとで Vercel の URL に変えてもOK)
   - **Authorization callback URL**: ここが重要です。Supabase ダッシュボードの **Authentication → Sign In / Providers → GitHub** に表示されている **Callback URL** をコピーして貼り付けます。形式は次のようになります。
     ```
     https://<プロジェクトのref>.supabase.co/auth/v1/callback
     ```
4. **Register application** をクリックします。
5. 表示された **Client ID** をメモします。**Generate a new client secret** をクリックして **Client Secret** も作成し、メモします(この画面を閉じると二度と見られないので注意)。

#### 3-2. Supabase に GitHub プロバイダを設定

1. Supabase ダッシュボードの **Authentication → Sign In / Providers** を開きます。
2. **GitHub** を選び、**Enable Sign in with GitHub** をオンにします。
3. 先ほどメモした **Client ID** と **Client Secret** を貼り付けて **Save** します。

#### 3-3. リダイレクト URL の設定

1. Supabase ダッシュボードの **Authentication → URL Configuration** を開きます。
2. **Site URL** にアプリの URL を設定します。
   - ローカル開発なら: `http://localhost:3000`
   - Vercel にデプロイしたら: `https://あなたのアプリ.vercel.app`
3. **Redirect URLs** に以下を追加します(ローカルと本番の両方を登録しておくと便利です)。
   ```
   http://localhost:3000/auth/callback
   https://あなたのアプリ.vercel.app/auth/callback
   ```

### 4. ローカルでの起動

Node.js(v20 以上推奨)がインストールされている前提です。

```bash
# 1. リポジトリを取得
git clone https://github.com/yukishimada-lab/gym-buddy.git
cd gym-buddy

# 2. 依存パッケージをインストール
npm install

# 3. 環境変数ファイルを作成
cp .env.example .env.local
```

`.env.local` をエディタで開き、Supabase ダッシュボードの **Project Settings → API** に表示されている値を貼り付けます。

```
NEXT_PUBLIC_SUPABASE_URL=https://<プロジェクトのref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public キー>
```

保存したら開発サーバーを起動します。

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開き、「GitHub でログイン」できれば成功です。

### 5. Vercel へのデプロイ

1. [https://vercel.com](https://vercel.com) を開き、**Continue with GitHub** でサインアップ/ログインします。
2. **Add New… → Project** をクリックし、`gym-buddy` リポジトリを **Import** します。
3. **Environment Variables** に以下の 2 つを追加します(値は `.env.local` と同じ)。
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. **Deploy** をクリックします。数分でデプロイが完了し、`https://〜.vercel.app` の URL が発行されます。
5. 発行された URL を使って、次の 2 箇所を更新します。
   - Supabase の **Authentication → URL Configuration**: Site URL と Redirect URLs(`https://〜.vercel.app/auth/callback`)
   - (必要なら)GitHub OAuth App の Homepage URL

これでスマホのブラウザからいつでも記録できるようになります。ホーム画面に追加しておくとアプリのように使えて便利です。

---

## Phase 2(食事管理)のセットアップ

Phase 2 の機能を使うには、次の 2 つの作業が必要です。

### A. Phase 2 用 SQL の実行(食品マスタ・食事記録テーブルの作成)

1. Supabase ダッシュボードの左メニューから **SQL Editor** を開きます。
2. このリポジトリの [`supabase/phase2.sql`](./supabase/phase2.sql) の中身を**全部コピー**して、エディタに貼り付けます。
3. 右下の **Run** をクリックします。`Success. No rows returned` と表示されれば完了です。

これで次のものが作成されます。

- 食品マスタ(`food_items`)+ 定番食品約 30 品目の初期データ
- 食事記録テーブル(`meal_logs`)
- 食事写真用の Storage バケット(`meal-photos`)
- ユーザーが自分のデータにしかアクセスできない RLS ポリシー

### B. Gemini API キーの取得と設定

写真からの自動推定と外食メニュー検索には Google の Gemini API を使います(個人利用の範囲なら無料枠で十分使えます)。

#### B-1. API キーを無料発行する

1. [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey) を開きます(Google アカウントでログイン)。
2. **Create API key** をクリックすると、`AIza...` で始まる API キーが発行されます。コピーしてメモします。

#### B-2. Vercel に環境変数を追加する

1. Vercel のダッシュボードで `gym-buddy` プロジェクトを開きます。
2. **Project Settings → Environment Variables** を開きます。
3. 以下を追加して **Save** します。
   - **Key**: `GEMINI_API_KEY`(⚠️ `NEXT_PUBLIC_` は**付けない**でください。付けるとキーがブラウザに公開されてしまいます。このキーはサーバー内でのみ使われます)
   - **Value**: B-1 でコピーした API キー
4. 環境変数はデプロイ時に読み込まれるため、**Deployments** タブから最新デプロイの **Redeploy** を実行して反映します。

ローカル開発の場合は `.env.local` に同じ名前で追加してください。

```
GEMINI_API_KEY=AIza...
```

> **キーを設定しなくても**アプリ自体は動作します(ビルドも通ります)。写真解析・外食検索を使ったときに「Gemini API キーが設定されていません」というメッセージが表示されるだけで、食品マスタからの記録・手動入力は問題なく使えます。

---

## Phase 3(体重・InBody・目標サポート)のセットアップ

### Phase 3 用 SQL の実行(体重・InBody・目標テーブルの作成)

1. Supabase ダッシュボードの左メニューから **SQL Editor** を開きます。
2. このリポジトリの [`supabase/phase3.sql`](./supabase/phase3.sql) の中身を**全部コピー**して、エディタに貼り付けます。
3. 右下の **Run** をクリックします。`Success. No rows returned` と表示されれば完了です。

これで次のものが作成されます。

- 体重記録テーブル(`weight_logs`) … 1 日 1 件(`user_id` × `log_date` が一意)
- InBody 記録テーブル(`inbody_logs`) … 測定日ごと。数値項目はすべて任意
- 目標設定テーブル(`body_goals`) … 1 ユーザーにつき 1 件
- ユーザーが自分のデータにしかアクセスできない RLS ポリシー

Phase 1 / Phase 2 のテーブルには一切変更を加えないので、`schema.sql` や `phase2.sql` を再実行する必要はありません。

### Gemini API キーについて

AI アドバイス生成は Phase 2 と同じ `GEMINI_API_KEY` を使います。すでに設定済みなら追加の作業はありません(まだの場合は上記「B. Gemini API キーの取得と設定」を参照)。キーが未設定でもアプリのビルド・記録・グラフ・分析は問題なく動作し、「アドバイスをもらう」を押したときにキー未設定のメッセージが表示されるだけです。

---

## 使い方のヒント

- **記録タブ**: 日付を選んで種目・重量・回数・セット数を入力し「追加する」。記録は後から編集・削除できます。
- **ルーティンタブ**: 「胸の日」などの名前でルーティンを作り、種目とデフォルトの重量・回数・セットを登録。記録タブの「ルーティンから一括追加」でその日の記録に一括展開できます。
- **種目タブ**: 種目の追加・名前変更・削除ができます。種目が 0 件の場合は「代表的な種目をまとめて登録」ボタンで初期セットを登録できます。
- **食事タブ**: タイミング(朝/昼/夜/間食)を選び、「食品から」で検索してグラム数を入れると PFC・カロリーが自動計算されます。「写真から」で食事写真を選ぶと AI が品目を推定、「外食検索」で店名+メニュー名から栄養情報を検索できます。いずれも記録前に内容を修正できます。
- **からだタブ**: 体重を記録すると推移グラフがすぐ更新されます。InBody で測った日は「InBody データを記録」を開いて、測れた項目だけ入力してください。グラフの期間は 1ヶ月/3ヶ月/全期間で切り替えられます。
- **目標と分析**: 「からだ」タブ右上の「🎯 目標と分析」から開きます。目標体重・目標体脂肪率・達成希望日・モードを設定すると、必要なカロリー収支や達成予測日が計算されます。体重・食事の記録が増えるほど分析の精度が上がります。「アドバイスをもらう」で AI からの具体的なアドバイスを受け取れます。

## 開発コマンド

```bash
npm run dev    # 開発サーバー起動
npm run build  # 本番ビルド
npm run start  # 本番ビルドの起動
npm run lint   # Lint
```

## ライセンス

個人利用を想定したプロジェクトです。
