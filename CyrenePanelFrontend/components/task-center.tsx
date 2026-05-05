"use client";

import { useMemo, useState } from "react";
import { Bell, CheckCircle2, Loader2, Trash2, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTasks, type PanelTask } from "@/lib/task-store";
import TaskLogTerminal from "@/components/task-log-terminal";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function taskBadge(task: PanelTask) {
  if (task.status === "running") {
    return <Badge className="bg-blue-500/15 text-blue-600 hover:bg-blue-500/15">进行中</Badge>;
  }
  if (task.status === "done") {
    return <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">成功</Badge>;
  }
  return <Badge variant="destructive">失败</Badge>;
}

function latestText(task: PanelTask) {
  const latest = task.logs[task.logs.length - 1];
  if (!latest) return "等待任务输出...";
  return latest.message || `${latest.layer ? `${latest.layer}: ` : ""}${latest.detail || ""}`;
}


function TaskIcon({ task }: { task: PanelTask }) {
  if (task.icon?.startsWith("http://") || task.icon?.startsWith("https://")) {
    return <img src={task.icon} alt="" className="h-8 w-8 rounded-md object-contain" />;
  }
  if (task.status === "running") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  if (task.status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
}

export function TaskCenter() {
  const { tasks, runningCount, clearTask, clearFinishedTasks } = useTasks();
  const [open, setOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || tasks[0] || null,
    [tasks, selectedTaskId],
  );

  const finishedCount = tasks.filter((task) => task.status !== "running").length;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative rounded-full"
        onClick={() => {
          setOpen(true);
          if (!selectedTaskId && tasks[0]) setSelectedTaskId(tasks[0].id);
        }}
      >
        <Bell className="h-[1.2rem] w-[1.2rem]" />
        {runningCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-medium text-white">
            {runningCount > 9 ? "9+" : runningCount}
          </span>
        )}
        <span className="sr-only">消息中心</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-[95vw] flex h-[85vh] w-[95vw] flex-col overflow-hidden p-0 gap-0">
          <DialogHeader className="sr-only">
            <DialogTitle>消息中心</DialogTitle>
            <DialogDescription>查看部署任务状态和实时日志。</DialogDescription>
          </DialogHeader>

          <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Bell className="h-4 w-4 shrink-0 text-blue-500" />
              <span className="truncate text-sm font-medium">消息中心</span>
              {runningCount > 0 && (
                <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-600">
                  {runningCount} 个进行中
                </span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">
                共 {tasks.length} 个任务
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {finishedCount > 0 && (
                <Button variant="ghost" size="sm" className="h-8" onClick={clearFinishedTasks}>
                  清除已完成
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="关闭"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="hidden w-72 shrink-0 flex-col border-r bg-muted/10 md:flex">
              <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                任务列表
              </div>
              <ScrollArea className="flex-1">
                {tasks.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">暂无任务</div>
                ) : (
                  <div className="space-y-1 p-2">
                    {tasks.map((task) => (
                      <button
                        key={task.id}
                        className={`w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/80 ${
                          selectedTask?.id === task.id ? "bg-muted text-foreground" : "text-muted-foreground"
                        }`}
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border">
                            <TaskIcon task={task} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">{task.title}</p>
                              {taskBadge(task)}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                              {latestText(task)}
                            </p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {formatTime(task.createdAt)}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              {selectedTask ? (
                <>
                  <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-medium">{selectedTask.title}</h3>
                        {taskBadge(selectedTask)}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        开始于 {formatTime(selectedTask.createdAt)}
                        {selectedTask.finishedAt ? `，结束于 ${formatTime(selectedTask.finishedAt)}` : ""}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => clearTask(selectedTask.id)}>
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">清除任务</span>
                    </Button>
                  </div>

                  <div className="flex-1 overflow-hidden bg-[#0b0f14]">
                    {selectedTask.logs.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        等待任务输出...
                      </div>
                    ) : (
                      <TaskLogTerminal key={selectedTask.id} logs={selectedTask.logs} className="flex-1" />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  选择一个任务查看详情
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}