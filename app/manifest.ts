import type { MetadataRoute } from "next";

/**
 * Web App Manifest(/manifest.webmanifest として配信される)。
 * ホーム画面に追加したときのアプリ名・アイコン・起動時の見た目を決める。
 * アイコンは scripts/generate-icons.mjs で生成したものを使う。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "gym-buddy",
    short_name: "gym-buddy",
    description: "ジムでのワークアウトと食事をサクッと記録する筋トレ管理アプリ",
    lang: "ja",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    id: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#2563eb",
    background_color: "#f4f5f7",
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "ワークアウトを記録", short_name: "記録", url: "/" },
      { name: "食事を記録", short_name: "食事", url: "/meals" },
      { name: "からだを記録", short_name: "からだ", url: "/body" },
    ],
  };
}
