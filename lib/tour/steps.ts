import type { TourId, TourStep } from "./types";

/**
 * ページごとの説明文。
 *
 * ■ 書きかたのルール
 * - 専門用語を使わない。初めてアプリを触る人が読んで分かる言葉にする
 * - 1 ステップは 1〜2 文。長い説明は複数ステップに分ける
 * - target は data-tour 属性の値。画面に無ければそのステップは自動で飛ばされるので、
 *   「記録が 1 件もない人」には出せない説明(カードや前回比など)もここに書いてよい
 */

/** どのページでも最後に出す共通のステップ */
const HELP_AGAIN: TourStep = {
  target: "help-button",
  title: "もう一度見たいとき",
  description:
    "この「?」ボタンを押すと、いつでもこの説明をやり直せます。ページごとに内容が変わります。",
};

const RECORD: TourStep[] = [
  {
    target: "record-date",
    title: "まずは日付",
    description:
      "記録する日を選びます。ふだんは今日の日付が入っているので、そのままで大丈夫です。",
  },
  {
    target: "record-routine",
    title: "ルーティンから一括で追加",
    description:
      "「胸の日」のように保存しておいた組み合わせを選んで「展開」を押すと、種目がまとめて並びます。",
  },
  {
    target: "record-select",
    title: "まとめて消したいとき",
    description:
      "「選択して削除」を押すと、いらない種目にチェックを入れてまとめて消せます。",
  },
  {
    target: "record-card",
    title: "記録した種目",
    description:
      "追加した種目はこのカードに並びます。「編集」を押すと重量や回数を直せます。",
  },
  {
    target: "drag-handle",
    title: "順番を入れ替える",
    description:
      "このつまみを長押ししたまま上下に動かすと、種目の順番を並べ替えられます。",
  },
  {
    target: "record-trend",
    title: "前回との比べかた",
    description:
      "同じ種目の前回と比べた結果です。青は伸びた、赤は下がったという意味です。",
  },
  {
    target: "record-memo",
    title: "気づきをメモ",
    description:
      "フォームの調子や痛みなどを書いておけます。次に同じ種目をやるとき、前回のメモが出ます。",
  },
  {
    target: "record-add",
    title: "種目を追加する",
    description:
      "種目を選んで「追加する」を押すと、この日の記録に加わります。種目は「種目」タブで増やせます。",
  },
  {
    target: "record-sets",
    title: "セットごとに入力",
    description:
      "1 セットずつ「重量 × 回数」を入れます。「セットを追加」を押すと行が増えます。",
  },
  {
    target: "bottom-nav",
    title: "ほかの画面へ",
    description:
      "下のタブから食事・からだ・カレンダーなどに移動できます。今いる画面は青色になります。",
    side: "top",
  },
  HELP_AGAIN,
];

const MEALS: TourStep[] = [
  {
    target: "meals-date",
    title: "日付を選ぶ",
    description: "食事を記録する日です。過去の日にさかのぼって書くこともできます。",
  },
  {
    target: "meals-totals",
    title: "その日の合計",
    description:
      "食べたカロリーと、タンパク質・脂質・炭水化物(まとめて PFC と呼びます)の合計です。",
  },
  {
    target: "meals-list",
    title: "記録した食事",
    description:
      "朝食・昼食・夕食・間食ごとに並びます。それぞれ「編集」「削除」ができます。",
  },
  {
    target: "meals-type",
    title: "いつ食べたか選ぶ",
    description: "これから追加する食事が、朝・昼・夜・間食のどれかを選びます。",
  },
  {
    target: "meals-mode",
    title: "入力方法は 4 つ",
    description:
      "マイ商品・食品から・写真から・外食検索を切り替えられます。使いやすいものでどうぞ。",
  },
  {
    target: "meals-mode-photo",
    title: "写真から自動で入れる",
    description:
      "食事の写真を選ぶと、AI が品目とだいたいのグラム数を推定して下書きにします。",
  },
  {
    target: "meals-mode-restaurant",
    title: "外食のメニューを調べる",
    description:
      "店名とメニュー名を入れると栄養情報を探します。見つかった値は下書きに入ります。",
  },
  {
    target: "meals-mode-product",
    title: "マイ商品から選ぶ",
    description:
      "登録しておいた商品を選ぶだけで、パッケージどおりの正確な数値が入ります。",
  },
  {
    target: "meals-manual",
    title: "手で入力する",
    description:
      "どの方法でも見つからないときは、ここから空の行を足して自分で数値を入れられます。",
  },
  {
    target: "meals-save",
    title: "確認して記録",
    description:
      "下書きの数値は自由に直せます。最後にこのボタンを押すと保存されます。",
  },
  {
    target: "meals-my-products",
    title: "よく食べる商品を登録",
    description:
      "いつも買う商品はマイ商品に登録しておくと、次からは選ぶだけで記録できます。",
  },
  HELP_AGAIN,
];

const BODY: TourStep[] = [
  {
    target: "body-range",
    title: "グラフの期間を切り替え",
    description: "1か月・3か月・全期間を切り替えて、体の変化を確認できます。",
  },
  {
    target: "body-charts",
    title: "体重などの推移",
    description: "体重・体脂肪率・骨格筋量のグラフです。記録が増えると線が伸びていきます。",
  },
  {
    target: "body-weight",
    title: "体重を記録する",
    description:
      "毎日の記録はこの体重だけで十分です。同じ日にもう一度保存すると上書きされます。",
  },
  {
    target: "body-inbody",
    title: "InBody は測れた日だけ",
    description:
      "体脂肪率や骨格筋量は任意です。ジムで測れた日だけ開いて入力すれば大丈夫です。",
  },
  {
    target: "body-save",
    title: "保存する",
    description: "入力できたらこのボタンで保存します。1 日 1 件の記録になります。",
  },
  {
    target: "body-list",
    title: "記録の一覧",
    description: "過去の記録を数値で確認できます。ここから編集・削除もできます。",
  },
  {
    target: "body-goal",
    title: "目標を決める",
    description:
      "目標の体重や期限を決めると、ペースが足りているかのアドバイスを見られます。",
  },
  HELP_AGAIN,
];

const CALENDAR: TourStep[] = [
  {
    target: "calendar-month",
    title: "月を切り替える",
    description: "‹ › で前の月・次の月に移動できます。",
  },
  {
    target: "calendar-grid",
    title: "日付をタップ",
    description: "タップするとその日の内容が下に表示されます。色が付いた日は記録がある日です。",
  },
  {
    target: "calendar-legend",
    title: "色と印の意味",
    description:
      "塗りつぶしの印はトレーニングをした日、輪郭だけの印は食事を記録した日です。",
  },
  {
    target: "calendar-detail",
    title: "その日の内容",
    description:
      "トレーニングは部位ごとにまとめて表示されます。食事や体重もここで確認できます。",
  },
  {
    target: "calendar-share",
    title: "1 日のまとめを画像に",
    description:
      "このボタンを押すと、その日の内容を 1 枚の画像にして保存・共有できます。",
  },
  {
    target: "calendar-open",
    title: "その日を編集する",
    description: "選んだ日の記録画面・食事画面をそのまま開いて、書き足せます。",
  },
  {
    target: "calendar-history",
    title: "リストでも見られる",
    description: "カレンダーではなく、過去の記録を新しい順の一覧で見たいときはこちらです。",
  },
  HELP_AGAIN,
];

const EXERCISES: TourStep[] = [
  {
    target: "exercises-seed",
    title: "まずはまとめて登録",
    description:
      "何も登録されていないときは、このボタンで代表的な種目を一度に追加できます。",
  },
  {
    target: "exercises-muscle",
    title: "部位を選ぶ",
    description:
      "ここで選んだ部位は、カレンダーで「胸の日」「脚の日」のようにまとめる印になります。",
  },
  {
    target: "exercises-add",
    title: "種目を追加する",
    description: "種目名を入れて「追加」を押すと、記録画面で選べるようになります。",
  },
  {
    target: "exercises-list",
    title: "あとから直せる",
    description: "登録した種目は部位ごとに並びます。「編集」で名前や部位を変えられます。",
  },
  HELP_AGAIN,
];

const ROUTINES: TourStep[] = [
  {
    target: "routines-create",
    title: "ルーティンを作る",
    description:
      "「胸の日」のようにいつもの組み合わせに名前を付けて作ります。まずは名前だけで大丈夫です。",
  },
  {
    target: "routines-add-item",
    title: "種目を入れる",
    description:
      "「種目を追加」を押すと、そのルーティンに入れる種目と、重量・回数・セット数を決められます。",
  },
  {
    target: "routines-item",
    title: "あとから直せる",
    description: "「編集」で目標の重量や回数を変えられます。× でルーティンから外せます。",
  },
  {
    target: "drag-handle",
    title: "順番を並べ替える",
    description:
      "このつまみを長押ししたまま上下に動かすと、種目をやる順番に並べ替えられます。",
  },
  {
    target: "bottom-nav",
    title: "記録画面で使う",
    description:
      "作ったルーティンは「記録」タブの画面で選んで、ワンタップでその日の記録に展開できます。",
    side: "top",
  },
  HELP_AGAIN,
];

const PRODUCTS: TourStep[] = [
  {
    target: "products-scan",
    title: "写真で登録するのが速い",
    description:
      "パッケージ裏の「栄養成分表示」を撮ると、AI が数値を読み取ってフォームに入れてくれます。",
  },
  {
    target: "products-manual",
    title: "手入力もできる",
    description: "写真がうまく読めないときや、自分で数値を入れたいときはこちらです。",
  },
  {
    target: "products-search",
    title: "登録済みを探す",
    description: "商品名やメーカー名で絞り込めます。数が増えてきたときに便利です。",
  },
  {
    target: "products-list",
    title: "登録した商品",
    description:
      "星を付けるとよく使う商品として上に出ます。「編集」で数値の直しもできます。",
  },
  {
    target: "products-back",
    title: "食事記録で使う",
    description:
      "登録した商品は食事画面の「マイ商品」から選ぶだけで、正確な数値をそのまま記録できます。",
  },
  HELP_AGAIN,
];

export const TOURS: Record<TourId, TourStep[]> = {
  record: RECORD,
  meals: MEALS,
  body: BODY,
  calendar: CALENDAR,
  exercises: EXERCISES,
  routines: ROUTINES,
  products: PRODUCTS,
};
