import { TaskProvider } from "@/lib/task-store";
import { PanelNameProvider } from "@/lib/panel-name-context";
import { DashboardContent } from "@/components/dashboard-content";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TaskProvider>
      <PanelNameProvider>
        <DashboardContent>{children}</DashboardContent>
      </PanelNameProvider>
    </TaskProvider>
  );
}
