"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { ChevronRight, LogOut, Terminal as TerminalIcon } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearMeCache, fetchMe } from "@/lib/me";
import { usePanelName } from "@/lib/panel-name-context";
import { isNavItemActive, navGroups } from "@/lib/nav";

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [username, setUsername] = useState<string>("");
  const { panelName } = usePanelName();

  useEffect(() => {
    // 与页面内的 /api/me 共用同一次请求，避免侧边栏和页面各拉一遍
    fetchMe().then((profile) => {
      if (profile) setUsername(profile.username);
    });
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    clearMeCache();
    router.push("/login");
  };

  return (
    <Sidebar className="border-r">
      {/* 与顶栏同高，两条发丝线在视觉上连成一条 */}
      <SidebarHeader className="h-16 shrink-0 justify-center border-b px-4">
        <Link href="/dashboard" className="flex items-center gap-2.5 overflow-hidden">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <TerminalIcon className="size-3.5" />
          </span>
          <span className="truncate text-sm font-semibold tracking-display">
            {panelName}
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        {navGroups.map((group) => (
          <Collapsible key={group.title} defaultOpen className="group/collapsible">
            <SidebarGroup className="py-1">
              <SidebarGroupLabel asChild className="h-7 text-mute hover:text-foreground">
                <CollapsibleTrigger className="eyebrow w-full">
                  {group.title}
                  <ChevronRight className="ml-auto size-3.5 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const active = isNavItemActive(item.url, pathname);
                      return (
                        <SidebarMenuItem key={item.url}>
                          {/* 规范 ex-app-shell-row：选中态用品牌主色做左边缘指示条 */}
                          {active && (
                            <span
                              aria-hidden
                              className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary"
                            />
                          )}
                          <SidebarMenuButton
                            asChild
                            isActive={active}
                            tooltip={item.title}
                            className="h-8 gap-2.5 rounded-md px-2 text-sm data-[active=true]:font-medium"
                          >
                            <Link href={item.url}>
                              <item.icon className="size-4 shrink-0" />
                              <span className="truncate">{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton className="h-11 gap-2.5 rounded-md px-2 data-open:bg-sidebar-accent">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                    {username ? username.charAt(0).toUpperCase() : "—"}
                  </span>
                  <span className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium">
                      {username || "加载中…"}
                    </span>
                    <span className="truncate text-xs text-mute">管理员</span>
                  </span>
                  <ChevronRight className="ml-auto size-4 text-mute" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 shadow-elev-5"
              >
                <DropdownMenuLabel className="eyebrow px-2 py-1.5">
                  已登录
                </DropdownMenuLabel>
                <DropdownMenuItem disabled className="font-mono text-xs opacity-100">
                  {username || "—"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <LogOut className="mr-2 size-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
