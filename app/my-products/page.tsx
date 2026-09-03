"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  ChevronLeft,
  Package,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import HelpButton from "@/components/HelpButton";
import { compressImage } from "@/lib/image";
import {
  BASIS_OPTIONS,
  countUnit,
  sortByUsage,
  summaryLine,
} from "@/lib/myProducts";
import type {
  MyProduct,
  MyProductBasis,
  NutritionLabelReading,
} from "@/lib/types";

/** 登録・編集フォームの状態(入力中は数値も文字列で持つ) */
type FormState = {
  /** 既存商品の編集なら id、新規登録なら null */
  id: string | null;
  name: string;
  maker: string;
  basis: MyProductBasis;
  serving_g: string;
  protein_g: string;
  fat_g: string;
  carbs_g: string;
  calories: string;
  memo: string;
  /** 成分表示の写真(Storage のパス)。読み取りから登録したときだけ入る */
  photo_path: string | null;
};

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  maker: "",
  basis: "per_100g",
  serving_g: "",
  protein_g: "",
  fat_g: "",
  carbs_g: "",
  calories: "",
  memo: "",
  photo_path: null,
};

function formFromProduct(p: MyProduct): FormState {
  return {
    id: p.id,
    name: p.name,
    maker: p.maker ?? "",
    basis: p.basis,
    serving_g: p.serving_g != null ? String(Number(p.serving_g)) : "",
    protein_g: String(Number(p.protein_g)),
    fat_g: String(Number(p.fat_g)),
    carbs_g: String(Number(p.carbs_g)),
    calories: String(Number(p.calories)),
    memo: p.memo ?? "",
    photo_path: p.photo_path,
  };
}

function formFromReading(
  reading: NutritionLabelReading,
  photoPath: string | null
): FormState {
  return {
    id: null,
    name: reading.name ?? "",
    maker: reading.maker ?? "",
    basis: reading.basis,
    serving_g: reading.serving_g != null ? String(reading.serving_g) : "",
    protein_g: String(reading.protein_g),
    fat_g: String(reading.fat_g),
    carbs_g: String(reading.carbs_g),
    calories: String(reading.calories),
    memo: "",
    photo_path: photoPath,
  };
}

const toNumber = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0;
};

export default function MyProductsPage() {
  const [products, setProducts] = useState<MyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("my_products")
      .select("*")
      .order("name");
    if (error) {
      setError(`マイ商品の取得に失敗しました: ${error.message}`);
    } else {
      setProducts((data as MyProduct[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim();
    const sorted = sortByUsage(products);
    if (!q) return sorted;
    return sorted.filter(
      (p) => p.name.includes(q) || (p.maker ?? "").includes(q)
    );
  }, [products, query]);

  /** フォームを開いてそこまでスクロールする */
  const openForm = (next: FormState) => {
    setForm(next);
    setNotice(null);
    // 描画後にスクロールしたいので次のフレームまで待つ
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // ---------- 成分表示の写真から読み取る ----------

  const scanLabel = async (file: File) => {
    setScanning(true);
    setScanNote(null);
    setError(null);
    try {
      const { blob, base64 } = await compressImage(file, 1280);

      const res = await fetch("/api/products/analyze-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType: "image/jpeg" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScanNote(json.error ?? "読み取りに失敗しました。");
        return;
      }
      const reading: NutritionLabelReading = json.reading;

      // 写真も残しておく(失敗しても登録は続行できる)
      let photoPath: string | null = null;
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const path = `${user.id}/labels/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("meal-photos")
          .upload(path, blob, { contentType: "image/jpeg" });
        if (uploadError) {
          console.warn("成分表示の写真の保存に失敗:", uploadError.message);
        } else {
          photoPath = path;
        }
      }

      openForm(formFromReading(reading, photoPath));
      if (json.empty) {
        setScanNote(
          "栄養成分表示の数値を読み取れませんでした。表の部分が大きく写るように撮り直すか、下のフォームに手入力してください。"
        );
      } else {
        setScanNote(
          [
            "読み取りました。数値が合っているか確認して、必要なら直してから保存してください。",
            reading.basis_text ? `(表示: ${reading.basis_text})` : "",
            reading.note ?? "",
          ]
            .filter(Boolean)
            .join(" ")
        );
      }
    } catch {
      setScanNote("写真の処理に失敗しました。別の写真でお試しください。");
    } finally {
      setScanning(false);
    }
  };

  // ---------- 保存・削除 ----------

  const save = async () => {
    if (!form || !form.name.trim()) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // セッションが切れている場合(AppShell が /login に飛ばす)。
    // ボタンが押せないまま固まらないよう保存中フラグは戻しておく。
    if (!user) {
      setSaving(false);
      return;
    }

    const servingG = form.serving_g.trim() === "" ? null : toNumber(form.serving_g);
    const values = {
      name: form.name.trim(),
      maker: form.maker.trim() || null,
      basis: form.basis,
      serving_g: servingG && servingG > 0 ? servingG : null,
      protein_g: toNumber(form.protein_g),
      fat_g: toNumber(form.fat_g),
      carbs_g: toNumber(form.carbs_g),
      calories: toNumber(form.calories),
      memo: form.memo.trim() || null,
      photo_path: form.photo_path,
    };

    const { error } = form.id
      ? await supabase.from("my_products").update(values).eq("id", form.id)
      : await supabase.from("my_products").insert({ ...values, user_id: user.id });

    if (error) {
      // 23505 = 同じ名前・メーカーの商品がすでにある
      setError(
        error.code === "23505"
          ? "同じ商品名(とメーカー)のマイ商品がすでに登録されています。名前を変えるか、既存の商品を編集してください。"
          : `保存に失敗しました: ${error.message}`
      );
    } else {
      setNotice(form.id ? "更新しました。" : "マイ商品を登録しました。");
      setForm(null);
      setScanNote(null);
      await load();
    }
    setSaving(false);
  };

  const remove = async (p: MyProduct) => {
    if (
      !confirm(
        `「${p.name}」を削除しますか?\n過去の食事記録はそのまま残ります。`
      )
    )
      return;
    const supabase = createClient();
    const { error } = await supabase.from("my_products").delete().eq("id", p.id);
    if (error) {
      setError(`削除に失敗しました: ${error.message}`);
    } else {
      if (form?.id === p.id) setForm(null);
      await load();
    }
  };

  const toggleFavorite = async (p: MyProduct) => {
    // 先に画面を更新して、タップの反応を待たせない
    setProducts((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, is_favorite: !x.is_favorite } : x))
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("my_products")
      .update({ is_favorite: !p.is_favorite })
      .eq("id", p.id);
    if (error) {
      setError(`お気に入りの変更に失敗しました: ${error.message}`);
      await load();
    }
  };

  const numberField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder?: string
  ) => (
    <label className="text-xs text-gray-500">
      {label}
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        min="0"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5"
      />
    </label>
  );

  const unit = form ? countUnit(form.basis) : null;

  return (
    <main className="p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Package aria-hidden size={20} strokeWidth={2} />
          マイ商品
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/meals"
            data-tour="products-back"
            className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 active:bg-gray-200"
          >
            <ChevronLeft aria-hidden size={14} />
            食事
          </Link>
          <HelpButton tour="products" />
        </div>
      </div>

      <p className="mb-4 text-xs leading-relaxed text-gray-500">
        いつも買っている商品の栄養成分を登録しておくと、食事記録で選ぶだけで正確な
        PFC・カロリーを記録できます。パッケージ裏の「栄養成分表示」を撮るだけで自動入力できます。
      </p>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </p>
      )}

      {/* 登録の入口(写真から / 手入力) */}
      <section className="mb-4 rounded-xl bg-white p-3 shadow-sm">
        <label data-tour="products-scan" className="block">
          <span className="mb-2 block text-xs text-gray-500">
            パッケージの栄養成分表示を撮ると、AI が数値を読み取ってフォームに入れます
          </span>
          <input
            type="file"
            accept="image/*"
            disabled={scanning}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) scanLabel(file);
              e.target.value = "";
            }}
            className="hidden"
          />
          <span
            className={`flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-semibold text-white active:opacity-80 ${
              scanning ? "opacity-50" : ""
            }`}
          >
            <Camera aria-hidden size={18} />
            {scanning ? "読み取り中...(数秒かかります)" : "成分表示を撮って登録"}
          </span>
        </label>

        <button
          type="button"
          data-tour="products-manual"
          onClick={() => openForm(EMPTY_FORM)}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-gray-300 py-2.5 text-sm text-gray-500 active:bg-gray-50"
        >
          <Plus aria-hidden size={16} />
          手入力で登録する
        </button>

        {scanNote && (
          <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs leading-relaxed text-emerald-700">
            {scanNote}
          </p>
        )}
      </section>

      {/* 登録・編集フォーム */}
      {form && (
        <section
          ref={formRef}
          className="mb-4 scroll-mt-4 rounded-xl bg-white p-3 shadow-sm"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-600">
              {form.id ? "マイ商品を編集" : "マイ商品を登録"}
            </h2>
            <button
              type="button"
              onClick={() => setForm(null)}
              aria-label="閉じる"
              className="rounded-lg bg-gray-100 p-1.5 text-gray-500 active:bg-gray-200"
            >
              <X aria-hidden size={16} />
            </button>
          </div>

          <label className="block text-xs text-gray-500">
            商品名<span className="ml-1 text-red-500">必須</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例: 〇〇社 コーンフレーク"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>

          <label className="mt-2 block text-xs text-gray-500">
            メーカー(任意)
            <input
              type="text"
              value={form.maker}
              onChange={(e) => setForm({ ...form, maker: e.target.value })}
              placeholder="例: 〇〇食品"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>

          {/* 基準量 */}
          <p className="mt-3 text-xs font-semibold text-gray-500">
            成分表示の基準量
          </p>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {BASIS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setForm({ ...form, basis: o.value })}
                className={`rounded-lg py-2 text-xs font-semibold ${
                  form.basis === o.value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 active:bg-gray-200"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <label className="mt-2 block text-xs text-gray-500">
            {form.basis === "per_100g"
              ? "1食(1個)の重さ(g)(任意・入れておくと「1食分」で記録できます)"
              : `1${unit ?? "食"}の重さ(g)(任意・入れておくとグラム指定でも記録できます)`}
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={form.serving_g}
              onChange={(e) => setForm({ ...form, serving_g: e.target.value })}
              placeholder="例: 40"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>

          <p className="mt-3 text-xs font-semibold text-gray-500">
            {BASIS_OPTIONS.find((o) => o.value === form.basis)?.label}の栄養成分
          </p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {numberField(
              "カロリー(kcal)",
              form.calories,
              (v) => setForm({ ...form, calories: v }),
              "例: 380"
            )}
            {numberField("タンパク質(g)", form.protein_g, (v) =>
              setForm({ ...form, protein_g: v })
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {numberField("脂質(g)", form.fat_g, (v) =>
              setForm({ ...form, fat_g: v })
            )}
            {numberField("炭水化物(g)", form.carbs_g, (v) =>
              setForm({ ...form, carbs_g: v })
            )}
          </div>

          <label className="mt-2 block text-xs text-gray-500">
            メモ(任意)
            <input
              type="text"
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder="例: 牛乳200mlと一緒に食べる"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>

          <button
            type="button"
            onClick={save}
            disabled={saving || !form.name.trim()}
            className="mt-3 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white active:opacity-80 disabled:opacity-40"
          >
            {saving ? "保存中..." : form.id ? "更新する" : "登録する"}
          </button>
        </section>
      )}

      {/* 一覧 */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-600">
            登録済み({products.length}件)
          </h2>
        </div>

        {products.length > 0 && (
          <div data-tour="products-search" className="relative mb-2">
            <Search
              aria-hidden
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="商品名・メーカーで検索"
              className="w-full rounded-lg border border-gray-300 py-2 pr-3 pl-9"
            />
          </div>
        )}

        {loading ? (
          <p className="py-6 text-center text-sm text-gray-400">読み込み中...</p>
        ) : visible.length === 0 ? (
          <p className="rounded-xl bg-white py-6 text-center text-sm text-gray-400 shadow-sm">
            {products.length === 0
              ? "まだマイ商品がありません。上のボタンから登録してください"
              : "見つかりません"}
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((p) => (
              <li
                key={p.id}
                data-tour="products-list"
                className="rounded-xl bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    {p.maker && (
                      <p className="truncate text-xs text-gray-400">{p.maker}</p>
                    )}
                    <p className="mt-0.5 text-xs tabular-nums text-gray-500">
                      {summaryLine(p)}
                    </p>
                    {p.use_count > 0 && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        使用 {p.use_count} 回
                      </p>
                    )}
                    {p.memo && (
                      <p className="mt-1 truncate text-xs text-gray-500">
                        {p.memo}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleFavorite(p)}
                      aria-label={
                        p.is_favorite ? "お気に入りを解除" : "お気に入りに追加"
                      }
                      aria-pressed={p.is_favorite}
                      className={`rounded-lg p-2 active:bg-gray-200 ${
                        p.is_favorite
                          ? "bg-amber-50 text-amber-500"
                          : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      <Star
                        aria-hidden
                        size={16}
                        fill={p.is_favorite ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => openForm(formFromProduct(p))}
                      aria-label="編集"
                      className="rounded-lg bg-gray-100 p-2 text-gray-600 active:bg-gray-200"
                    >
                      <Pencil aria-hidden size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      aria-label="削除"
                      className="rounded-lg bg-red-50 p-2 text-red-600 active:bg-red-100"
                    >
                      <Trash2 aria-hidden size={16} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
