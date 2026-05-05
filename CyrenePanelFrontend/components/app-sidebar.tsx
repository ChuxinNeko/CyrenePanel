"use client";

import { useEffect, useState } from "react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Server,
  Users,
  Settings,
  LogOut,
  LayoutDashboard,
  FolderOpen,
  Box,
  ChevronRight,
  Terminal,
  Container,
  Settings2,
  Layers,
} from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { usePanelName } from "@/lib/panel-name-context";

const navGroups = [
  {
    title: "概览",
    items: [
      {
        title: "仪表盘",
        url: "/dashboard",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: "实例管理",
    items: [
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
        title: "节点管理",
        url: "/dashboard/nodes",
        icon: Server,
      },
      {
        title: "Docker 管理",
        url: "/dashboard/docker",
        icon: Container,
      },
      {
        title: "服务管理",
        url: "/dashboard/services",
        icon: Settings2,
      },
      {
        title: "环境管理",
        url: "/dashboard/environments",
        icon: Layers,
      },
      {
        title: "终端",
        url: "/dashboard/terminal",
        icon: Terminal,
      },
    ],
  },
  {
    title: "系统管理",
    items: [
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
    ],
  },
];

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [username, setUsername] = useState<string>("");
  const { panelName } = usePanelName();

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const { data, error } = await api.api.me.get();
        if (!error && data?.success && data.profile) {
          setUsername((data.profile as { username: string }).username);
        }
      } catch {
        // ignore
      }
    };
    fetchProfile();
  }, []);

  const isActive = (url: string) => {
    if (url === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(url);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    router.push("/login");
  };

  return (
    <Sidebar>
      <SidebarHeader className="h-16 flex items-center justify-center border-b px-4">
        <h2 className="text-lg font-bold truncate w-full text-center">{panelName}</h2>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <Collapsible
            key={group.title}
            defaultOpen={true}
            className="group/collapsible"
          >
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger>
                  {group.title}
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.url)}
                          tooltip={item.title}
                        >
                          <a href={item.url}>
                            <item.icon />
                            <span>{item.title}</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>
      <SidebarFooter className="p-2 border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <span className="text-primary text-sm font-medium">{username ? username.charAt(0).toUpperCase() : "U"}</span>
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{username || "加载中..."}</span>
                    <span className="truncate text-xs text-muted-foreground">管理员</span>
                  </div>
                  <ChevronRight className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                align="start"
              >
                <DropdownMenuItem onClick={handleLogout} className="text-red-500 focus:text-red-500 focus:bg-red-500/10">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>退出登录</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}