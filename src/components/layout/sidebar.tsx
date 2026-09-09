"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ClipboardCheck, LayoutDashboard, ListChecks, PlusCircle, ScrollText, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const NAV = [
  { href: "/", label: "ダッシュボード", icon: LayoutDashboard, exact: true },
  { href: "/companies", label: "企業一覧", icon: Building2 },
  { href: "/search", label: "企業を探す", icon: Search },
  { href: "/review", label: "確認待ち", icon: ClipboardCheck },
  { href: "/companies/new", label: "企業を手動追加", icon: PlusCircle, exact: true },
  { href: "/jobs", label: "ジョブ", icon: ListChecks },
  { href: "/logs", label: "ログ", icon: ScrollText },
];

export function SidebarNav({ reviewCount = 0 }: { reviewCount?: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || (pathname.startsWith(`${item.href}/`) && !(item.href === "/companies" && pathname === "/companies/new"));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-accent",
              active && "bg-accent font-medium text-foreground",
            )}
          >
            <Icon className="size-4 text-muted-foreground" />
            {item.label}
            {item.href === "/review" && reviewCount > 0 ? (
              <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-amber-800">{reviewCount}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
