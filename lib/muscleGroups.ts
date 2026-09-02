/**
 * 種目の部位(muscle_group)の区分と、種目名からの自動判定。
 *
 * 区分は「胸 / 背中 / 肩 / 腕 / 脚 / 体幹 / 有酸素 / その他」の 8 つに固定する。
 * 表示順もこの順番で固定(カレンダーの日別詳細・種目マスタ・共有画像で共通)。
 *
 * ここの判定ロジックは supabase/phase5.sql の既存データ補正と同じ内容にしてある。
 * どちらかを直すときは必ず両方そろえること。
 */

export const MUSCLE_GROUPS = [
  "胸",
  "背中",
  "肩",
  "腕",
  "脚",
  "体幹",
  "有酸素",
  "その他",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const OTHER_GROUP: MuscleGroup = "その他";

/**
 * Phase 4 までに使っていた区分から新しい区分への読み替え。
 * 「腹」は「体幹」に寄せる(データは phase5.sql でも書き換えるが、
 * 未実行の環境でも表示が崩れないようにアプリ側でも吸収する)。
 */
const LEGACY_ALIASES: Record<string, MuscleGroup> = {
  腹: "体幹",
  腹筋: "体幹",
  コア: "体幹",
  カーディオ: "有酸素",
  全身: "その他",
};

/**
 * 種目名 → 部位のキーワード判定表。
 *
 * 上から順に「最初に当たったもの」を採用するので、順番に意味がある。
 * 例) 「レッグレイズ」は体幹(「レッグ」で脚に落ちないよう体幹を先に見る)
 *     「レッグカール」は脚(「カール」で腕に落ちないよう脚を先に見る)
 *     「ナローベンチプレス」は腕(「ベンチプレス」で胸に落ちないよう腕を先に見る)
 */
const RULES: { group: MuscleGroup; keywords: string[] }[] = [
  {
    group: "有酸素",
    keywords: [
      "有酸素",
      "ランニング",
      "ジョギング",
      "ウォーキング",
      "トレッドミル",
      "エアロバイク",
      "バイク",
      "エリプティカル",
      "クロストレーナー",
      "ステアマスター",
      "縄跳び",
      "なわとび",
      "水泳",
      "スイミング",
      "hiit",
    ],
  },
  {
    group: "体幹",
    keywords: [
      "体幹",
      "腹筋",
      "腹直筋",
      "アブローラー",
      "アブドミナル",
      "アドミナブル",
      "クランチ",
      "シットアップ",
      "プランク",
      "レッグレイズ",
      "ニーレイズ",
      "ロシアンツイスト",
      "ドラゴンフラッグ",
      "ハンギング",
      "サイドベンド",
    ],
  },
  {
    group: "脚",
    keywords: [
      "脚",
      "大腿",
      "スクワット",
      "レッグ",
      "ランジ",
      "カーフ",
      "ヒップスラスト",
      "ヒップアブダクション",
      "ブルガリアン",
      "ステップアップ",
      "アダクション",
      "アブダクション",
    ],
  },
  {
    group: "腕",
    keywords: [
      "カール",
      "トライセプス",
      "上腕",
      "キックバック",
      "プレスダウン",
      "プッシュダウン",
      "ナローベンチ",
      "ナローグリップ",
      "フレンチプレス",
      "リストカール",
      "ハンマー",
      "コンセントレーション",
      "スカルクラッシャー",
    ],
  },
  {
    group: "肩",
    keywords: [
      "ショルダー",
      "サイドレイズ",
      "フロントレイズ",
      "リアレイズ",
      "リアデルト",
      "ミリタリープレス",
      "アーノルドプレス",
      "アップライトロー",
      "フェイスプル",
      "三角筋",
      "肩",
    ],
  },
  {
    group: "背中",
    keywords: [
      "背中",
      "広背筋",
      "ラットプル",
      "プルダウン",
      "懸垂",
      "チンニング",
      "プルアップ",
      "ローイング",
      "ベントオーバー",
      "デッドリフト",
      "シュラッグ",
      "プルオーバー",
      "バックエクステンション",
      "ロー",
    ],
  },
  {
    group: "胸",
    keywords: [
      "胸",
      "大胸筋",
      "ベンチプレス",
      "チェスト",
      "インクライン",
      "デクライン",
      "フライ",
      "ペックデック",
      "ケーブルクロス",
      "ディップス",
      "プッシュアップ",
      "腕立て",
    ],
  },
];

/** 種目名から部位を推定する。判定できなければ「その他」 */
export function inferMuscleGroup(name: string): MuscleGroup {
  const target = name.trim().toLowerCase();
  if (!target) return OTHER_GROUP;
  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => target.includes(keyword.toLowerCase()))) {
      return rule.group;
    }
  }
  return OTHER_GROUP;
}

/**
 * DB に入っている部位の値を表示用の区分にそろえる。
 * 未設定 / 旧区分 / 想定外の値でも必ず 8 区分のどれかを返す。
 * 未設定のときだけ種目名からの推定にフォールバックする。
 */
export function normalizeMuscleGroup(
  value: string | null | undefined,
  exerciseName?: string
): MuscleGroup {
  const trimmed = value?.trim();
  if (!trimmed) {
    return exerciseName ? inferMuscleGroup(exerciseName) : OTHER_GROUP;
  }
  if ((MUSCLE_GROUPS as readonly string[]).includes(trimmed)) {
    return trimmed as MuscleGroup;
  }
  const alias = LEGACY_ALIASES[trimmed];
  if (alias) return alias;
  return exerciseName ? inferMuscleGroup(exerciseName) : OTHER_GROUP;
}

/** MUSCLE_GROUPS の並び順のインデックス(未知の値は最後) */
export function muscleGroupOrder(group: string): number {
  const index = (MUSCLE_GROUPS as readonly string[]).indexOf(group);
  return index === -1 ? MUSCLE_GROUPS.length : index;
}

/**
 * 「部位ごとのセクション」に並べ替える汎用のグルーピング。
 * 部位の順番は MUSCLE_GROUPS 固定で、記録がある部位だけを返す。
 * セクション内の順番は渡された配列の順(= sort_order)をそのまま保つ。
 */
export function groupByMuscleGroup<T>(
  items: T[],
  getGroup: (item: T) => string
): { group: MuscleGroup; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getGroup(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => muscleGroupOrder(a) - muscleGroupOrder(b))
    .map(([group, list]) => ({ group: group as MuscleGroup, items: list }));
}
