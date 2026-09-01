# 💪 gym-buddy

筋トレを記録するための個人向け Web アプリです。ジムでスマホから、その日のワークアウト(種目・重量・回数・セット数)をサクッと記録できます。

## 主な機能(Phase 1)

- **GitHub アカウントでログイン**(Supabase Auth)
- **ワークアウト記録**: 日付ごとに種目・重量(kg)・回数(レップ)・セット数を記録/編集/削除
- **種目マスタ**: よく使う種目(ベンチプレス、スクワット等)を登録・管理。初回サインアップ時に代表的な種目が自動登録されます
- **ルーティン管理**: 「胸の日」「脚の日」のような種目の組み合わせを保存し、記録ページからワンタップでその日の記録に展開
- **履歴一覧**: 過去の記録を日付ごとに一覧表示

将来的には食事管理(PFC 計算)や体重・InBody データの記録にも対応予定です(`supabase/schema.sql` にスキーマ設計あり)。

## 技術スタック

- [Next.js](https://nextjs.org/)(App Router / TypeScript)
- [Supabase](https://supabase.com/)(認証 + データベース)
- [Tailwind CSS](https://tailwindcss.com/)
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

## 使い方のヒント

- **記録タブ**: 日付を選んで種目・重量・回数・セット数を入力し「追加する」。記録は後から編集・削除できます。
- **ルーティンタブ**: 「胸の日」などの名前でルーティンを作り、種目とデフォルトの重量・回数・セットを登録。記録タブの「ルーティンから一括追加」でその日の記録に一括展開できます。
- **種目タブ**: 種目の追加・名前変更・削除ができます。種目が 0 件の場合は「代表的な種目をまとめて登録」ボタンで初期セットを登録できます。

## 開発コマンド

```bash
npm run dev    # 開発サーバー起動
npm run build  # 本番ビルド
npm run start  # 本番ビルドの起動
npm run lint   # Lint
```

## ライセンス

個人利用を想定したプロジェクトです。
