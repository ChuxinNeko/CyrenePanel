"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/audit", label: "面板操作" },
  { href: "/dashboard/audit/ssh", label: "SSH 登录" },
];

/**
 * 审计日志下两个视图的切换。
 * 做成真链接而不是受控 Tab：两者数据源不同、各自有筛选状态，
 * 分成独立路由才能深链、能前进后退。
 */
export function AuditTabs() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
              active
                ? "bg-card font-medium shadow-elev-2"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
