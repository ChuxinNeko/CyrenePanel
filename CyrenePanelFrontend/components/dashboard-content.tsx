"use client";

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { TaskCenter } from "@/components/task-center";
import { usePanelName } from "@/lib/panel-name-context";
import { DashboardFooter } from "@/components/dashboard-footer";

function DashboardHeader() {
  const { panelName } = usePanelName();
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background/80 backdrop-blur-xl px-4 justify-between">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <span className="font-semibold text-sm text-muted-foreground">{panelName}</span>
      </div>
      <div className="flex items-center gap-1">
        <TaskCenter />
        <ThemeToggle />
      </div>
    </header>
  );
}

export function DashboardContent({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar />
      <SidebarInset className="bg-background flex flex-col min-h-screen">
        <DashboardHeader />
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
        <DashboardFooter />
      </SidebarInset>
    </SidebarProvider>
  );
}
