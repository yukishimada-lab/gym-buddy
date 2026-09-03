"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Dumbbell,
  NotebookPen,
  Scale,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/**
 * 画面下部のタブ。
 *
 * アイコンは lucide-react(MIT)の線画に統一している。
 * 絵文字は端末ごとに絵柄も色も変わってしまい、統一感が出ないため使わない。
 * 必要なアイコンだけを名前指定で import すること(バンドルを膨らませないため)。
 */
const tabs: {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** このタブの一部として扱う配下ページ(タブ自体は増やさずに現在地を示す) */
  extraPaths?: string[];
}[] = [
  { href: "/", label: "記録", Icon: NotebookPen },
  {
    href: "/meals",
    label: "食事",
    Icon: UtensilsCrossed,
    // マイ商品は食事記録から使う画面なので「食事」タブを選択中にする
    extraPaths: ["/my-products"],
  },
  { href: "/body", label: "からだ", Icon: Scale },
  { href: "/calendar", label: "カレンダー", Icon: CalendarDays },
  { href: "/exercises", label: "種目", Icon: Dumbbell },
  { href: "/routines", label: "ルーティン", Icon: ClipboardList },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md">
        {tabs.map(({ href, label, Icon, extraPaths }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname.startsWith(href) ||
                (extraPaths ?? []).some((p) => pathname.startsWith(p));
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              // 指で押しやすいよう縦の当たり判定を 56px 以上確保する
              className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] leading-none transition-colors ${
                active ? "text-blue-600" : "text-gray-400"
              }`}
            >
              <Icon
                aria-hidden
                size={22}
                // 選択中だけ線を太くして、色が見えにくい環境でも現在地が分かるようにする
                strokeWidth={active ? 2.25 : 1.75}
              />
              <span
                className={`whitespace-nowrap ${
                  active ? "font-semibold" : "font-medium"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
