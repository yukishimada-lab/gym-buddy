/**
 * gym-buddy の Service Worker(自前実装)。
 *
 * ■ 方針
 *   - キャッシュするのは「誰が見ても同じ静的アセット」だけ。
 *     具体的には /_next/static/, /icons/, /splash/, /manifest.webmanifest。
 *   - 認証情報やユーザーの記録データは絶対にキャッシュしない。
 *     Supabase / Gemini はそもそも別オリジンなので fetch に一切介入せず、
 *     同一オリジンでも /api/ と /auth/ は素通しにする(network-only)。
 *   - HTML(ページ遷移)もキャッシュしない。ネットワークを必ず見に行き、
 *     オフラインのときだけ /offline.html を出す。
 *     ログイン状態でページの中身が変わるので、HTML を貯めると
 *     「古い画面が出る」「別アカウントの画面が残る」事故になりうるため。
 *
 * ■ 更新
 *   CACHE_VERSION を上げれば古いキャッシュは activate で全部消える。
 *   新しいデプロイのたびに URL(ハッシュ付き)が変わるので、
 *   基本は「古いバージョンのキャッシュを消す」だけで十分。
 */

const CACHE_VERSION = "v1";
const STATIC_CACHE = `gym-buddy-static-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

/** インストール時に必ず持っておくもの(オフライン画面とアイコン) */
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

/** キャッシュしてよい同一オリジンのパス(前方一致) */
const CACHEABLE_PREFIXES = ["/_next/static/", "/icons/", "/splash/"];

/** 絶対にキャッシュしないパス(前方一致)。認証とデータ取得まわり */
const NEVER_CACHE_PREFIXES = ["/api/", "/auth/", "/_next/image", "/_next/data/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      // 1 つでも失敗するとインストールごと失敗するので個別に握りつぶす
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch(() => {})
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("gym-buddy-") && key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** ページ側から「今すぐ新しい SW に切り替えて」と言われたとき用 */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isCacheableAsset(url) {
  if (url.pathname === "/manifest.webmanifest") return true;
  return CACHEABLE_PREFIXES.some((p) => url.pathname.startsWith(p));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // GET 以外(保存・削除など)は一切触らない
  if (request.method !== "GET") return;
  // Range リクエスト(動画のシークなど)はそのままブラウザに任せる
  if (request.headers.has("range")) return;

  const url = new URL(request.url);

  // 別オリジン(Supabase / Gemini / OAuth プロバイダ)は完全に素通し
  if (url.origin !== self.location.origin) return;

  // 認証・API まわりは respondWith すらせず、ブラウザ既定の動きに任せる。
  // 特に /auth/callback はリダイレクトで成立する処理なので、
  // Service Worker が間に入るとログインが壊れやすい。
  if (NEVER_CACHE_PREFIXES.some((p) => url.pathname.startsWith(p))) return;

  // ページ遷移はネットワーク優先。落ちたときだけオフライン画面を出す。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return (
          cached ??
          new Response("オフラインです", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      })
    );
    return;
  }

  // 上記以外の同一オリジンの GET は、静的アセットだけを対象にする
  if (!isCacheableAsset(url)) return;

  // 静的アセットはキャッシュ優先(ファイル名にハッシュが入るので安全)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // 正常な同一オリジンのレスポンスだけ保存する
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
