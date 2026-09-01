"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  EstimatedFoodItem,
  FoodItem,
  MealLog,
  MealType,
} from "@/lib/types";

function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
  return `${y}年${m}月${d}日(${weekday})`;
}

const MEAL_TYPES: { value: MealType; label: string; icon: string }[] = [
  { value: "breakfast", label: "朝食", icon: "🌅" },
  { value: "lunch", label: "昼食", icon: "☀️" },
  { value: "dinner", label: "夕食", icon: "🌙" },
  { value: "snack", label: "間食", icon: "🍪" },
];

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 100g あたりの値とグラム数から実際の値を計算 */
function scale(per100: number, grams: number) {
  return round1((per100 * grams) / 100);
}

/** 追加前の下書き 1 品目 */
type DraftItem = {
  key: string;
  food_item_id: string | null;
  food_name: string;
  amount_g: string; // 空文字 = 不明(外食など)
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  calories: string;
  /** マスタ由来の場合の 100g あたり値(グラム変更時に自動再計算する) */
  per100: Pick<FoodItem, "protein_g" | "fat_g" | "carbs_g" | "calories"> | null;
};

type EditState = {
  id: string;
  food_name: string;
  amount_g: string;
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  calories: string;
};

let draftSeq = 0;
const nextKey = () => `draft-${++draftSeq}`;

function estimateToDraft(item: EstimatedFoodItem): DraftItem {
  return {
    key: nextKey(),
    food_item_id: null,
    food_name: item.food_name,
    amount_g: item.amount_g != null ? String(item.amount_g) : "",
    protein_g: String(item.protein_g),
    fat_g: String(item.fat_g),
    carbs_g: String(item.carbs_g),
    calories: String(item.calories),
    per100: null,
  };
}

/** 画像を縮小して JPEG の Blob と base64 に変換(通信量と解析コストを抑える) */
async function compressImage(
  file: File
): Promise<{ blob: Blob; base64: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    el.src = dataUrl;
  });
  const maxSize = 1024;
  const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の変換に失敗しました");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpegUrl = canvas.toDataURL("image/jpeg", 0.8);
  const base64 = jpegUrl.split(",")[1];
  const blob = await (await fetch(jpegUrl)).blob();
  return { blob, base64 };
}

function MealsPage() {
  const searchParams = useSearchParams();
  const [date, setDate] = useState(
    () => searchParams.get("date") ?? todayString()
  );
  const [logs, setLogs] = useState<MealLog[]>([]);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 追加フォーム
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [mode, setMode] = useState<"master" | "photo" | "restaurant">("master");
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);

  // 食品マスタ検索
  const [query, setQuery] = useState("");

  // 写真解析
  const [analyzing, setAnalyzing] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);

  // 外食検索
  const [restaurant, setRestaurant] = useState("");
  const [menu, setMenu] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);

  // 既存記録の編集
  const [edit, setEdit] = useState<EditState | null>(null);

  const loadLogs = useCallback(async (targetDate: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("meal_logs")
      .select("*")
      .eq("meal_date", targetDate)
      .order("created_at", { ascending: true });
    if (error) {
      setError(`食事記録の取得に失敗しました: ${error.message}`);
    } else {
      setLogs((data as MealLog[]) ?? []);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("food_items")
        .select("*")
        .order("name");
      if (error) {
        setError(
          `食品マスタの取得に失敗しました: ${error.message}(supabase/phase2.sql を実行済みか確認してください)`
        );
      } else {
        setFoods((data as FoodItem[]) ?? []);
      }
      await loadLogs(date);
      setLoading(false);
    })();
    // date 変更時は下の useEffect で再取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      await loadLogs(date);
    })();
  }, [date, loadLogs]);

  // 日別合計
  const totals = useMemo(
    () =>
      logs.reduce(
        (acc, log) => ({
          protein: acc.protein + Number(log.protein_g),
          fat: acc.fat + Number(log.fat_g),
          carbs: acc.carbs + Number(log.carbs_g),
          calories: acc.calories + Number(log.calories),
        }),
        { protein: 0, fat: 0, carbs: 0, calories: 0 }
      ),
    [logs]
  );

  const filteredFoods = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return foods.filter((f) => f.name.includes(q)).slice(0, 8);
  }, [foods, query]);

  // ---------- 下書きの操作 ----------

  const addFoodToDrafts = (food: FoodItem) => {
    const grams = 100;
    setDrafts((prev) => [
      ...prev,
      {
        key: nextKey(),
        food_item_id: food.id,
        food_name: food.name,
        amount_g: String(grams),
        protein_g: String(scale(food.protein_g, grams)),
        fat_g: String(scale(food.fat_g, grams)),
        carbs_g: String(scale(food.carbs_g, grams)),
        calories: String(scale(food.calories, grams)),
        per100: {
          protein_g: food.protein_g,
          fat_g: food.fat_g,
          carbs_g: food.carbs_g,
          calories: food.calories,
        },
      },
    ]);
    setQuery("");
  };

  const addEmptyDraft = () => {
    setDrafts((prev) => [
      ...prev,
      {
        key: nextKey(),
        food_item_id: null,
        food_name: "",
        amount_g: "",
        protein_g: "0",
        fat_g: "0",
        carbs_g: "0",
        calories: "0",
        per100: null,
      },
    ]);
  };

  const updateDraft = (key: string, patch: Partial<DraftItem>) => {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.key !== key) return d;
        const next = { ...d, ...patch };
        // マスタ由来の品目はグラム数の変更で PFC・カロリーを自動再計算
        if (patch.amount_g !== undefined && d.per100) {
          const grams = Number(patch.amount_g);
          if (Number.isFinite(grams) && grams >= 0) {
            next.protein_g = String(scale(d.per100.protein_g, grams));
            next.fat_g = String(scale(d.per100.fat_g, grams));
            next.carbs_g = String(scale(d.per100.carbs_g, grams));
            next.calories = String(scale(d.per100.calories, grams));
          }
        }
        return next;
      })
    );
  };

  const removeDraft = (key: string) => {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  };

  const saveDrafts = async () => {
    const valid = drafts.filter((d) => d.food_name.trim());
    if (valid.length === 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const rows = valid.map((d) => ({
      user_id: user.id,
      meal_date: date,
      meal_type: mealType,
      food_item_id: d.food_item_id,
      food_name: d.food_name.trim(),
      amount_g: d.amount_g === "" ? null : Number(d.amount_g) || 0,
      protein_g: Number(d.protein_g) || 0,
      fat_g: Number(d.fat_g) || 0,
      carbs_g: Number(d.carbs_g) || 0,
      calories: Number(d.calories) || 0,
      photo_path: photoPath,
    }));
    const { error } = await supabase.from("meal_logs").insert(rows);
    if (error) {
      setError(`保存に失敗しました: ${error.message}`);
    } else {
      setDrafts([]);
      setPhotoPath(null);
      setPhotoNote(null);
      setSearchNote(null);
      await loadLogs(date);
    }
    setSaving(false);
  };

  // ---------- 写真からの自動推定 ----------

  const analyzePhoto = async (file: File) => {
    setAnalyzing(true);
    setPhotoNote(null);
    setError(null);
    try {
      const { blob, base64 } = await compressImage(file);

      // 解析(サーバー側 API 経由で Gemini を呼ぶ)
      const res = await fetch("/api/meals/analyze-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType: "image/jpeg" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPhotoNote(json.error ?? "写真の解析に失敗しました。");
        return;
      }
      const items: EstimatedFoodItem[] = json.items ?? [];
      if (items.length === 0) {
        setPhotoNote(
          "写真から食品を認識できませんでした。手動で入力してください。"
        );
        return;
      }
      setDrafts((prev) => [...prev, ...items.map(estimateToDraft)]);
      setPhotoNote(
        `${items.length}品目を推定しました。内容を確認・修正してから記録してください(AI による概算です)。`
      );

      // 写真を Supabase Storage に保存(失敗しても記録は続行できる)
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("meal-photos")
          .upload(path, blob, { contentType: "image/jpeg" });
        if (uploadError) {
          console.warn("写真の保存に失敗:", uploadError.message);
        } else {
          setPhotoPath(path);
        }
      }
    } catch {
      setPhotoNote("写真の処理に失敗しました。別の写真でお試しください。");
    } finally {
      setAnalyzing(false);
    }
  };

  // ---------- 外食メニューの栄養情報検索 ----------

  const searchRestaurant = async () => {
    if (!restaurant.trim() || !menu.trim()) return;
    setSearching(true);
    setSearchNote(null);
    setError(null);
    try {
      const res = await fetch("/api/meals/restaurant-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant, menu }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSearchNote(json.error ?? "検索に失敗しました。");
        return;
      }
      if (!json.found || !json.item) {
        setSearchNote(
          `栄養情報が見つかりませんでした。${
            json.note ? `(${json.note})` : ""
          }下の「空の行を追加」から手動で入力してください。`
        );
        return;
      }
      setDrafts((prev) => [...prev, estimateToDraft(json.item)]);
      setSearchNote(
        `栄養情報を取得しました。内容を確認・修正してから記録してください。${
          json.note ? `(${json.note})` : ""
        }`
      );
      setRestaurant("");
      setMenu("");
    } catch {
      setSearchNote("検索に失敗しました。時間をおいてお試しください。");
    } finally {
      setSearching(false);
    }
  };

  // ---------- 既存記録の編集・削除 ----------

  const saveEdit = async () => {
    if (!edit) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("meal_logs")
      .update({
        food_name: edit.food_name.trim() || "(名称未設定)",
        amount_g: edit.amount_g === "" ? null : Number(edit.amount_g) || 0,
        protein_g: Number(edit.protein_g) || 0,
        fat_g: Number(edit.fat_g) || 0,
        carbs_g: Number(edit.carbs_g) || 0,
        calories: Number(edit.calories) || 0,
      })
      .eq("id", edit.id);
    if (error) {
      setError(`更新に失敗しました: ${error.message}`);
    } else {
      setEdit(null);
      await loadLogs(date);
    }
  };

  const deleteLog = async (id: string) => {
    if (!confirm("この記録を削除しますか?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("meal_logs").delete().eq("id", id);
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
    } else {
      await loadLogs(date);
    }
  };

  const numberField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    step = "0.1"
  ) => (
    <label className="text-xs text-gray-500">
      {label}
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
      />
    </label>
  );

  return (
    <main className="p-4">
      <h1 className="mb-4 text-xl font-bold">🍽️ 食事記録</h1>

      {/* 日付選択 */}
      <div className="mb-4 rounded-xl bg-white p-3 shadow-sm">
        <label className="mb-1 block text-xs font-semibold text-gray-500">
          日付
        </label>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
        />
        <p className="mt-1 text-xs text-gray-500">{formatDateLabel(date)}</p>
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 日別合計 */}
      <div className="mb-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">
          この日の合計
        </h2>
        <p className="mb-3 text-center">
          <span className="text-3xl font-bold">
            {Math.round(totals.calories)}
          </span>
          <span className="ml-1 text-sm text-gray-500">kcal</span>
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-red-50 py-2">
            <p className="text-xs text-gray-500">タンパク質</p>
            <p className="font-bold text-red-600">{round1(totals.protein)}g</p>
          </div>
          <div className="rounded-lg bg-yellow-50 py-2">
            <p className="text-xs text-gray-500">脂質</p>
            <p className="font-bold text-yellow-600">{round1(totals.fat)}g</p>
          </div>
          <div className="rounded-lg bg-blue-50 py-2">
            <p className="text-xs text-gray-500">炭水化物</p>
            <p className="font-bold text-blue-600">{round1(totals.carbs)}g</p>
          </div>
        </div>
      </div>

      {/* 食事タイミングごとの一覧 */}
      <section className="mb-4 space-y-3">
        {loading ? (
          <p className="py-6 text-center text-sm text-gray-400">読み込み中...</p>
        ) : logs.length === 0 ? (
          <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-400 shadow-sm">
            まだ食事の記録がありません
          </p>
        ) : (
          MEAL_TYPES.map((mt) => {
            const mealLogs = logs.filter((l) => l.meal_type === mt.value);
            if (mealLogs.length === 0) return null;
            const sub = mealLogs.reduce(
              (a, l) => a + Number(l.calories),
              0
            );
            return (
              <div key={mt.value} className="rounded-xl bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold">
                    {mt.icon} {mt.label}
                  </h3>
                  <span className="text-xs text-gray-500">
                    {Math.round(sub)} kcal
                  </span>
                </div>
                <ul className="space-y-2">
                  {mealLogs.map((log) => (
                    <li
                      key={log.id}
                      className="border-t border-gray-100 pt-2 first:border-t-0 first:pt-0"
                    >
                      {edit?.id === log.id ? (
                        <div>
                          <label className="text-xs text-gray-500">
                            食品名
                            <input
                              type="text"
                              value={edit.food_name}
                              onChange={(e) =>
                                setEdit({ ...edit, food_name: e.target.value })
                              }
                              className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                            />
                          </label>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {numberField("グラム(g)", edit.amount_g, (v) =>
                              setEdit({ ...edit, amount_g: v })
                            )}
                            {numberField("カロリー(kcal)", edit.calories, (v) =>
                              setEdit({ ...edit, calories: v })
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {numberField("P(g)", edit.protein_g, (v) =>
                              setEdit({ ...edit, protein_g: v })
                            )}
                            {numberField("F(g)", edit.fat_g, (v) =>
                              setEdit({ ...edit, fat_g: v })
                            )}
                            {numberField("C(g)", edit.carbs_g, (v) =>
                              setEdit({ ...edit, carbs_g: v })
                            )}
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={saveEdit}
                              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:opacity-80"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEdit(null)}
                              className="flex-1 rounded-lg bg-gray-200 py-2 text-sm font-semibold active:opacity-80"
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {log.food_name}
                              {log.amount_g != null && (
                                <span className="ml-1 font-normal text-gray-500">
                                  {Number(log.amount_g)}g
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">
                              {Math.round(Number(log.calories))}kcal / P
                              {round1(Number(log.protein_g))} F
                              {round1(Number(log.fat_g))} C
                              {round1(Number(log.carbs_g))}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() =>
                                setEdit({
                                  id: log.id,
                                  food_name: log.food_name,
                                  amount_g:
                                    log.amount_g != null
                                      ? String(log.amount_g)
                                      : "",
                                  protein_g: String(log.protein_g),
                                  fat_g: String(log.fat_g),
                                  carbs_g: String(log.carbs_g),
                                  calories: String(log.calories),
                                })
                              }
                              className="rounded-lg bg-gray-100 px-3 py-2 text-sm active:bg-gray-200"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => deleteLog(log.id)}
                              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 active:bg-red-100"
                            >
                              削除
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>

      {/* 追加フォーム */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-600">食事を追加</h2>

        {/* タイミング選択 */}
        <div className="mb-3 grid grid-cols-4 gap-1">
          {MEAL_TYPES.map((mt) => (
            <button
              key={mt.value}
              type="button"
              onClick={() => setMealType(mt.value)}
              className={`rounded-lg py-2 text-xs font-semibold ${
                mealType === mt.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 active:bg-gray-200"
              }`}
            >
              {mt.icon} {mt.label}
            </button>
          ))}
        </div>

        {/* 入力方法タブ */}
        <div className="mb-3 flex gap-1">
          {(
            [
              ["master", "🔍 食品から"],
              ["photo", "📷 写真から"],
              ["restaurant", "🏪 外食検索"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                mode === value
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-100 text-gray-600 active:bg-gray-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 食品マスタから検索 */}
        {mode === "master" && (
          <div className="mb-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="食品名で検索(例: 鶏むね)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            {query.trim() && (
              <ul className="mt-1 overflow-hidden rounded-lg border border-gray-200">
                {filteredFoods.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-gray-400">
                    見つかりません(下の「空の行を追加」で手動入力できます)
                  </li>
                ) : (
                  filteredFoods.map((food) => (
                    <li key={food.id} className="border-b border-gray-100 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => addFoodToDrafts(food)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm active:bg-gray-50"
                      >
                        <span className="truncate font-medium">{food.name}</span>
                        <span className="shrink-0 pl-2 text-xs text-gray-500">
                          {Math.round(food.calories)}kcal/100g
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        )}

        {/* 写真から推定 */}
        {mode === "photo" && (
          <div className="mb-3">
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500">
                食事の写真を選ぶと、AI が品目とグラム数を推定します
              </span>
              <input
                type="file"
                accept="image/*"
                disabled={analyzing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) analyzePhoto(file);
                  e.target.value = "";
                }}
                className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
              />
            </label>
            {analyzing && (
              <p className="mt-2 text-sm text-gray-500">
                📷 写真を解析しています...(数秒かかります)
              </p>
            )}
            {photoNote && (
              <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">
                {photoNote}
              </p>
            )}
          </div>
        )}

        {/* 外食メニュー検索 */}
        {mode === "restaurant" && (
          <div className="mb-3">
            <div className="mb-2 grid grid-cols-2 gap-2">
              <input
                type="text"
                value={restaurant}
                onChange={(e) => setRestaurant(e.target.value)}
                placeholder="店名(例: すき家)"
                className="rounded-lg border border-gray-300 px-3 py-2"
              />
              <input
                type="text"
                value={menu}
                onChange={(e) => setMenu(e.target.value)}
                placeholder="メニュー(例: 牛丼並盛)"
                className="rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
            <button
              type="button"
              onClick={searchRestaurant}
              disabled={searching || !restaurant.trim() || !menu.trim()}
              className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white active:opacity-80 disabled:opacity-40"
            >
              {searching ? "検索中...(数秒かかります)" : "栄養情報を検索"}
            </button>
            {searchNote && (
              <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">
                {searchNote}
              </p>
            )}
          </div>
        )}

        {/* 下書き一覧(編集可能) */}
        {drafts.length > 0 && (
          <ul className="mb-3 space-y-3">
            {drafts.map((d) => (
              <li key={d.key} className="rounded-lg bg-gray-50 p-2">
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={d.food_name}
                    onChange={(e) =>
                      updateDraft(d.key, { food_name: e.target.value })
                    }
                    placeholder="食品名"
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => removeDraft(d.key)}
                    className="shrink-0 rounded-lg bg-red-50 px-2 py-1.5 text-sm text-red-600 active:bg-red-100"
                  >
                    ✕
                  </button>
                </div>
                <div className="mb-2 grid grid-cols-2 gap-2">
                  {numberField(
                    d.per100 ? "グラム(g)※PFC自動計算" : "グラム(g)",
                    d.amount_g,
                    (v) => updateDraft(d.key, { amount_g: v }),
                    "1"
                  )}
                  {numberField("カロリー(kcal)", d.calories, (v) =>
                    updateDraft(d.key, { calories: v })
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {numberField("P(g)", d.protein_g, (v) =>
                    updateDraft(d.key, { protein_g: v })
                  )}
                  {numberField("F(g)", d.fat_g, (v) =>
                    updateDraft(d.key, { fat_g: v })
                  )}
                  {numberField("C(g)", d.carbs_g, (v) =>
                    updateDraft(d.key, { carbs_g: v })
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={addEmptyDraft}
          className="mb-3 w-full rounded-lg border border-dashed border-gray-300 py-2 text-sm text-gray-500 active:bg-gray-50"
        >
          + 空の行を追加(手動入力)
        </button>

        <button
          type="button"
          onClick={saveDrafts}
          disabled={saving || drafts.every((d) => !d.food_name.trim())}
          className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white active:opacity-80 disabled:opacity-40"
        >
          {saving
            ? "保存中..."
            : `${MEAL_TYPES.find((m) => m.value === mealType)?.label}に記録する(${
                drafts.filter((d) => d.food_name.trim()).length
              }品目)`}
        </button>
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <MealsPage />
    </Suspense>
  );
}
