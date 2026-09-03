"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Camera,
  ChevronRight,
  Cookie,
  Moon,
  Package,
  Search,
  Star,
  Store,
  Sun,
  Sunrise,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/image";
import {
  type AmountMode,
  basisLabel,
  calcIntake,
  canUseGrams,
  countUnit,
  findMatchingProduct,
  sortByUsage,
  summaryLine as productSummaryLine,
} from "@/lib/myProducts";
import type {
  EstimatedFoodItem,
  FoodItem,
  MealLog,
  MealType,
  MyProduct,
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

const MEAL_TYPES: { value: MealType; label: string; Icon: LucideIcon }[] = [
  { value: "breakfast", label: "朝食", Icon: Sunrise },
  { value: "lunch", label: "昼食", Icon: Sun },
  { value: "dinner", label: "夕食", Icon: Moon },
  { value: "snack", label: "間食", Icon: Cookie },
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
  /** マイ商品から追加した場合の参照 */
  my_product_id: string | null;
  /** マイ商品から追加した場合の商品そのもの(数量変更時の再計算に使う) */
  product: MyProduct | null;
  /** マイ商品の量の指定方法(グラム / 個数・食数) */
  amount_mode: AmountMode;
  /** マイ商品の数量(amount_mode に応じてグラム数 or 個数) */
  quantity: string;
  food_name: string;
  amount_g: string; // 空文字 = 不明(外食など)
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  calories: string;
  /** マスタ由来の場合の 100g あたり値(グラム変更時に自動再計算する) */
  per100: Pick<FoodItem, "protein_g" | "fat_g" | "carbs_g" | "calories"> | null;
  /** 写真推定の品目に名前が近いマイ商品(正確な数値に置き換えられる) */
  suggestion: MyProduct | null;
};

/** マイ商品に依存しない項目の初期値 */
const DRAFT_DEFAULTS = {
  my_product_id: null,
  product: null,
  amount_mode: "grams" as AmountMode,
  quantity: "",
  suggestion: null,
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

function estimateToDraft(
  item: EstimatedFoodItem,
  suggestion: MyProduct | null = null
): DraftItem {
  return {
    ...DRAFT_DEFAULTS,
    key: nextKey(),
    food_item_id: null,
    food_name: item.food_name,
    amount_g: item.amount_g != null ? String(item.amount_g) : "",
    protein_g: String(item.protein_g),
    fat_g: String(item.fat_g),
    carbs_g: String(item.carbs_g),
    calories: String(item.calories),
    per100: null,
    suggestion,
  };
}

/**
 * マイ商品から下書きを作る。
 * 100g あたりで登録した商品はグラム指定、
 * 1食 / 1個 で登録した商品は個数指定を既定にする。
 */
function productToDraft(
  product: MyProduct,
  mode?: AmountMode,
  quantity?: number
): DraftItem {
  const amountMode: AmountMode =
    mode ?? (product.basis === "per_100g" ? "grams" : "count");
  const qty =
    quantity ??
    (amountMode === "grams" ? Number(product.serving_g) || 100 : 1);
  const intake = calcIntake(product, amountMode, qty);
  return {
    ...DRAFT_DEFAULTS,
    key: nextKey(),
    food_item_id: null,
    my_product_id: product.id,
    product,
    amount_mode: amountMode,
    quantity: String(qty),
    food_name: product.name,
    amount_g: intake?.amount_g != null ? String(intake.amount_g) : "",
    protein_g: String(intake?.nutrition.protein_g ?? 0),
    fat_g: String(intake?.nutrition.fat_g ?? 0),
    carbs_g: String(intake?.nutrition.carbs_g ?? 0),
    calories: String(intake?.nutrition.calories ?? 0),
    per100: null,
  };
}

function MealsPage() {
  const searchParams = useSearchParams();
  const [date, setDate] = useState(
    () => searchParams.get("date") ?? todayString()
  );
  const [logs, setLogs] = useState<MealLog[]>([]);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [products, setProducts] = useState<MyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 追加フォーム
  const [mealType, setMealType] = useState<MealType>("breakfast");
  // マイ商品を 1 つでも登録していれば「マイ商品」タブを初期表示にする
  // (登録が無いうちは従来どおり「食品から」)。ユーザーがタブを触ったら
  // 自動選択はしない。
  const [mode, setMode] = useState<
    "master" | "product" | "photo" | "restaurant"
  >("master");
  const modeTouched = useRef(false);
  const selectMode = (value: typeof mode) => {
    modeTouched.current = true;
    setMode(value);
  };
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);

  // 食品マスタ検索
  const [query, setQuery] = useState("");

  // マイ商品検索
  const [productQuery, setProductQuery] = useState("");

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

  /** マイ商品(自分で登録した商品)を読み込む */
  const loadProducts = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.from("my_products").select("*");
    if (error) {
      // マイ商品はあくまで補助機能なので、取得できなくても
      // 食事記録そのものは使えるようにしておく(画面全体をエラーにしない)
      console.warn("マイ商品の取得に失敗:", error.message);
      return;
    }
    const rows = (data as MyProduct[]) ?? [];
    setProducts(rows);
    if (rows.length > 0 && !modeTouched.current) {
      setMode("product");
    }
  }, []);

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
      await loadProducts();
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

  /**
   * マイ商品の候補。
   * 検索していないときも「お気に入り → よく使う順」で候補を出して、
   * 毎日使う商品はタップ 1 回で選べるようにする。
   */
  const productSuggestions = useMemo(() => {
    const q = productQuery.trim();
    const sorted = sortByUsage(products);
    if (!q) return sorted.slice(0, 8);
    return sorted
      .filter((p) => p.name.includes(q) || (p.maker ?? "").includes(q))
      .slice(0, 8);
  }, [products, productQuery]);

  // ---------- 下書きの操作 ----------

  const addFoodToDrafts = (food: FoodItem) => {
    const grams = 100;
    setDrafts((prev) => [
      ...prev,
      {
        ...DRAFT_DEFAULTS,
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

  /** マイ商品を下書きに追加する */
  const addProductToDrafts = (product: MyProduct) => {
    setDrafts((prev) => [...prev, productToDraft(product)]);
    setProductQuery("");
  };

  /**
   * 写真から推定した品目を、名前が近いマイ商品の正確な数値に置き換える。
   * グラム数が推定できていて、その商品がグラム指定に対応していれば
   * 推定グラム数をそのまま引き継ぐ。
   */
  const applySuggestion = (draft: DraftItem) => {
    const product = draft.suggestion;
    if (!product) return;
    const grams = Number(draft.amount_g);
    const useGrams = canUseGrams(product) && Number.isFinite(grams) && grams > 0;
    const next = useGrams
      ? productToDraft(product, "grams", grams)
      : productToDraft(product);
    setDrafts((prev) =>
      prev.map((d) => (d.key === draft.key ? { ...next, key: d.key } : d))
    );
  };

  /** 提案を使わずに推定値のまま記録する(次からは出さない) */
  const dismissSuggestion = (key: string) => {
    setDrafts((prev) =>
      prev.map((d) => (d.key === key ? { ...d, suggestion: null } : d))
    );
  };

  const addEmptyDraft = () => {
    setDrafts((prev) => [
      ...prev,
      {
        ...DRAFT_DEFAULTS,
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
        // マイ商品は数量(g / 個数)の変更で PFC・カロリーを自動再計算
        if (
          d.product &&
          (patch.quantity !== undefined || patch.amount_mode !== undefined)
        ) {
          const intake =
            next.quantity.trim() === ""
              ? null
              : calcIntake(d.product, next.amount_mode, Number(next.quantity));
          // 入力を消している途中は 0 で上書きせず、前の値を残す
          if (intake) {
            next.protein_g = String(intake.nutrition.protein_g);
            next.fat_g = String(intake.nutrition.fat_g);
            next.carbs_g = String(intake.nutrition.carbs_g);
            next.calories = String(intake.nutrition.calories);
            next.amount_g =
              intake.amount_g != null ? String(intake.amount_g) : "";
          }
          return next;
        }
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
      my_product_id: d.my_product_id,
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
      // 使ったマイ商品の使用回数・最終使用日時を更新して、
      // 次回から候補の上のほうに出るようにする(失敗しても記録は成立する)
      const usedIds = [
        ...new Set(
          valid.map((d) => d.my_product_id).filter((id): id is string => !!id)
        ),
      ];
      if (usedIds.length > 0) {
        await Promise.all(
          usedIds.map((id) =>
            supabase.rpc("touch_my_product", { p_id: id }).then(({ error }) => {
              if (error) console.warn("マイ商品の使用回数更新に失敗:", error.message);
            })
          )
        );
        await loadProducts();
      }
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
      // 登録済みのマイ商品と名前が近いものは、推定値より正確な数値を
      // 使えるように候補として添える(採用するかはユーザーが選ぶ)。
      const newDrafts = items.map((item) =>
        estimateToDraft(item, findMatchingProduct(item.food_name, products))
      );
      const matched = newDrafts.filter((d) => d.suggestion).length;
      setDrafts((prev) => [...prev, ...newDrafts]);
      setPhotoNote(
        `${items.length}品目を推定しました。内容を確認・修正してから記録してください(AI による概算です)。` +
          (matched > 0
            ? `${matched}品目はマイ商品に近い名前でした。正確な数値に置き換えられます。`
            : "")
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
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <UtensilsCrossed aria-hidden size={20} strokeWidth={2} />
          食事記録
        </h1>
        <Link
          href="/my-products"
          className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white active:opacity-80"
        >
          <Package aria-hidden size={14} />
          マイ商品
          <ChevronRight aria-hidden size={14} />
        </Link>
      </div>

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
                  <h3 className="flex items-center gap-1.5 text-sm font-bold">
                    <mt.Icon
                      aria-hidden
                      size={16}
                      strokeWidth={2}
                      className="text-gray-400"
                    />
                    {mt.label}
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
              className={`flex flex-col items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold ${
                mealType === mt.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 active:bg-gray-200"
              }`}
            >
              <mt.Icon aria-hidden size={16} strokeWidth={2} />
              {mt.label}
            </button>
          ))}
        </div>

        {/* 入力方法タブ */}
        <div className="mb-3 grid grid-cols-4 gap-1">
          {(
            [
              ["product", "マイ商品", Package],
              ["master", "食品から", Search],
              ["photo", "写真から", Camera],
              ["restaurant", "外食検索", Store],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => selectMode(value)}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg py-2 text-[11px] font-semibold ${
                mode === value
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-100 text-gray-600 active:bg-gray-200"
              }`}
            >
              <Icon aria-hidden size={16} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>

        {/* マイ商品から選ぶ */}
        {mode === "product" && (
          <div className="mb-3">
            <input
              type="text"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="マイ商品を検索(例: コーンフレーク)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            {products.length === 0 ? (
              <div className="mt-2 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-500">
                いつも買っている商品の栄養成分を登録しておくと、選ぶだけで正確に記録できます。
                <Link
                  href="/my-products"
                  className="mt-2 flex items-center justify-center gap-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:opacity-80"
                >
                  <Package aria-hidden size={14} />
                  マイ商品を登録する
                </Link>
              </div>
            ) : (
              <>
                <ul className="mt-1 overflow-hidden rounded-lg border border-gray-200">
                  {productSuggestions.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-400">
                      見つかりません
                    </li>
                  ) : (
                    productSuggestions.map((product) => (
                      <li
                        key={product.id}
                        className="border-b border-gray-100 last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() => addProductToDrafts(product)}
                          className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm active:bg-gray-50"
                        >
                          {product.is_favorite && (
                            <Star
                              aria-hidden
                              size={14}
                              fill="currentColor"
                              className="mt-0.5 shrink-0 text-amber-400"
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {product.name}
                            </span>
                            <span className="block truncate text-xs tabular-nums text-gray-500">
                              {productSummaryLine(product)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <Link
                  href="/my-products"
                  className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold text-blue-600"
                >
                  マイ商品を追加・編集する
                  <ChevronRight aria-hidden size={14} />
                </Link>
              </>
            )}
          </div>
        )}

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
              <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-500">
                <Camera aria-hidden size={16} />
                写真を解析しています...(数秒かかります)
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
                    aria-label="この品目を削除"
                    className="shrink-0 rounded-lg bg-red-50 p-2 text-red-600 active:bg-red-100"
                  >
                    <X aria-hidden size={16} />
                  </button>
                </div>

                {/* マイ商品と名前が近いとき、正確な数値に置き換える案内 */}
                {d.suggestion && (
                  <div className="mb-2 rounded-lg bg-blue-50 p-2">
                    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-blue-800">
                      <Package aria-hidden size={14} className="mt-0.5 shrink-0" />
                      <span>
                        マイ商品「{d.suggestion.name}」が登録されています。AI
                        の推定値より正確です。
                      </span>
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => applySuggestion(d)}
                        className="flex-1 rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white active:opacity-80"
                      >
                        マイ商品の数値を使う
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissSuggestion(d.key)}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-500 active:bg-gray-100"
                      >
                        推定値のまま
                      </button>
                    </div>
                  </div>
                )}

                {d.product ? (
                  /* マイ商品は「何g / 何個」を入れると PFC を自動計算する */
                  <div className="mb-2">
                    <p className="mb-1 flex items-center gap-1 text-xs text-blue-700">
                      <Package aria-hidden size={12} />
                      マイ商品({basisLabel(d.product.basis)}で登録)
                    </p>
                    <div className="flex gap-2">
                      <label className="min-w-0 flex-1 text-xs text-gray-500">
                        {d.amount_mode === "grams"
                          ? "グラム(g)"
                          : `個数(${countUnit(d.product.basis) ?? "食"})`}
                        <input
                          type="number"
                          inputMode="decimal"
                          step={d.amount_mode === "grams" ? "1" : "0.5"}
                          min="0"
                          value={d.quantity}
                          onChange={(e) =>
                            updateDraft(d.key, { quantity: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
                        />
                      </label>
                      {/* 1食 / 1個 の重さが分かっている商品は両方の指定に対応できる */}
                      {canUseGrams(d.product) &&
                        Number(d.product.serving_g) > 0 && (
                          <div className="flex shrink-0 flex-col justify-end">
                            <button
                              type="button"
                              onClick={() =>
                                updateDraft(d.key, {
                                  amount_mode:
                                    d.amount_mode === "grams"
                                      ? "count"
                                      : "grams",
                                  quantity:
                                    d.amount_mode === "grams"
                                      ? "1"
                                      : String(Number(d.product?.serving_g) || 100),
                                })
                              }
                              className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 active:bg-gray-300"
                            >
                              {d.amount_mode === "grams"
                                ? `${countUnit(d.product.basis) ?? "食"}で指定`
                                : "gで指定"}
                            </button>
                          </div>
                        )}
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-gray-500">
                      = {Math.round(Number(d.calories))}kcal / P
                      {round1(Number(d.protein_g))} F{round1(Number(d.fat_g))} C
                      {round1(Number(d.carbs_g))}
                    </p>
                  </div>
                ) : (
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
                )}
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
