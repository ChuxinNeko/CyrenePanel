import {
  Box,
  Container,
  Database,
  FolderOpen,
  Globe2,
  Layers,
  LayoutDashboard,
  ScrollText,
  Server,
  Settings,
  Settings2,
  ShieldCheck,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

export interface NavGroup {
  /** 分组眉标，按规范用等宽小写偏上的技术声音渲染 */
  title: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    title: "概览",
    items: [{ title: "仪表盘", url: "/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "实例管理",
    items: [
      { title: "实例管理", url: "/dashboard/instances", icon: Box },
      { title: "文件管理", url: "/dashboard/files", icon: FolderOpen },
      { title: "节点管理", url: "/dashboard/nodes", icon: Server },
      { title: "Docker 管理", url: "/dashboard/docker", icon: Container },
      { title: "数据库管理", url: "/dashboard/database", icon: Database },
      { title: "服务管理", url: "/dashboard/services", icon: Settings2 },
      { title: "网站管理", url: "/dashboard/sites", icon: Globe2 },
      { title: "环境管理", url: "/dashboard/environments", icon: Layers },
      { title: "终端", url: "/dashboard/terminal", icon: Terminal },
    ],
  },
  {
    title: "系统管理",
    items: [
      { title: "用户管理", url: "/dashboard/users", icon: Users },
      { title: "审计日志", url: "/dashboard/audit", icon: ScrollText },
      { title: "安全", url: "/dashboard/security", icon: ShieldCheck },
      { title: "系统设置", url: "/dashboard/settings", icon: Settings },
    ],
  },
];

/** 侧边栏之外还有些二级页，面包屑要能标出来 */
const subRouteLabels: Record<string, string> = {
  "/dashboard/database/mysql": "MySQL",
  "/dashboard/database/mongodb": "MongoDB",
};

export function isNavItemActive(url: string, pathname: string): boolean {
  if (url === "/dashboard") return pathname === "/dashboard";
  return pathname === url || pathname.startsWith(`${url}/`);
}

/**
 * 由当前路径推出面包屑。一级取导航表里最长匹配的那一项，
 * 二级取 subRouteLabels，都没命中就只显示一级。
 */
export function resolveBreadcrumb(pathname: string): string[] {
  const allItems = navGroups.flatMap((group) => group.items);

  const matched = allItems
    .filter((item) => isNavItemActive(item.url, pathname))
    .sort((a, b) => b.url.length - a.url.length)[0];

  if (!matched) return [];

  const crumbs = [matched.title];
  const sub = subRouteLabels[pathname];
  if (sub) crumbs.push(sub);
  return crumbs;
}
