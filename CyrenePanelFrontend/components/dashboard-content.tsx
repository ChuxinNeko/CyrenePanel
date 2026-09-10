"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { TaskCenter } from "@/components/task-center";
import { RestartButton } from "@/components/restart-button";
import { DashboardFooter } from "@/components/dashboard-footer";
import { resolveBreadcrumb } from "@/lib/nav";

/**
 * 顶栏对齐规范的 nav-bar：64px 高、canvas 底、发丝线收口。
 * 左侧是定位信息（折叠钮 + 面包屑），右侧是全局动作，中间留白。
 */
function DashboardHeader() {
  const pathname = usePathname();
  const crumbs = resolveBreadcrumb(pathname);

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-background/80 px-6 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1.5 size-8 text-mute hover:text-foreground" />
        <Separator orientation="vertical" className="mr-1 !h-4" />
        <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5 text-sm">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <Fragment key={crumb}>
                {index > 0 && <span className="text-mute select-none">/</span>}
                <span
                  className={
                    last
                      ? "truncate font-medium tracking-display"
                      : "truncate text-muted-foreground"
                  }
                  aria-current={last ? "page" : undefined}
                >
                  {crumb}
                </span>
              </Fragment>
            );
          })}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <RestartButton />
        <TaskCenter />
        <Separator orientation="vertical" className="mx-0.5 !h-4" />
        <ThemeToggle />
      </div>
    </header>
  );
}

export function DashboardContent({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider defaultOpen>
      <AppSidebar />
      <SidebarInset className="flex min-h-screen flex-col bg-background">
        <DashboardHeader />
        {/* p-6 = 规范 spacing.lg 24px；铺满式页面靠 h-[calc(100vh-7rem)] 依赖这个数值 */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
        <DashboardFooter />
      </SidebarInset>
    </SidebarProvider>
  );
}
