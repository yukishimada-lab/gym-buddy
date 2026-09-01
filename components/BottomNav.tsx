"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "記録", icon: "✏️" },
  { href: "/meals", label: "食事", icon: "🍽️" },
  { href: "/history", label: "履歴", icon: "📅" },
  { href: "/exercises", label: "種目", icon: "🏋️" },
  { href: "/routines", label: "ルーティン", icon: "📋" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md">
        {tabs.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                active ? "font-bold text-blue-600" : "text-gray-500"
              }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
