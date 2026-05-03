"use client";

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
import { Server, Users, Settings, LogOut, LayoutDashboard, FolderOpen, Box } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";

const items = [
  {
    title: "仪表盘",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "服务器节点",
    url: "/dashboard/nodes",
    icon: Server,
  },
  {
    title: "实例管理",
    url: "/dashboard/instances",
    icon: Box,
  },
  {
    title: "文件管理",
    url: "/dashboard/files",
    icon: FolderOpen,
  },
  {
    title: "用户管理",
    url: "/dashboard/users",
    icon: Users,
  },
  {
    title: "系统设置",
    url: "/dashboard/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();

  const isActive = (url: string) => {
    if (url === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(url);
  };

  return (
    <Sidebar>
      <SidebarHeader className="h-16 flex items-center justify-center border-b px-4">
        <h2 className="text-lg font-bold truncate w-full text-center">Cyrene 面板</h2>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>菜单</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton 
              onClick={() => {
                localStorage.removeItem("token");
                router.push("/login");
              }}
              className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
            >
              <LogOut />
              <span>退出登录</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
