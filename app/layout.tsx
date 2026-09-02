import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import { appleStartupImages } from "@/lib/appleSplash";

export const metadata: Metadata = {
  title: "gym-buddy | 筋トレ記録",
  description: "ジムでのワークアウトをサクッと記録する個人向けアプリ",
  applicationName: "gym-buddy",
  // ホーム画面に追加したときの見た目(iOS Safari 向け)
  appleWebApp: {
    capable: true,
    title: "gym-buddy",
    // 背景が明るいので、文字が黒くなる default を使う
    statusBarStyle: "default",
    startupImage: appleStartupImages,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // 記録した数値が電話番号などとしてリンク化されるのを防ぐ
  formatDetection: { telephone: false, date: false, address: false, email: false },
  other: {
    // Next は標準の mobile-web-app-capable しか出さないので、
    // 古い iOS でも standalone 起動できるよう Apple 独自のものを明示的に足す
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // ノッチやホームインジケーターの領域まで描画し、
  // 各コンポーネント側で env(safe-area-inset-*) を使って避ける
  viewportFit: "cover",
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
