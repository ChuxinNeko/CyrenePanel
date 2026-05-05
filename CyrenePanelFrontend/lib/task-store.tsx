"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type TaskStatus = "running" | "done" | "error";

export interface TaskLogEntry {
  type: "stage" | "progress" | "done" | "error";
  message?: string;
  stage?: string;
  layer?: string;
  status?: string;
  detail?: string;
  timestamp: number;
}

export interface PanelTask {
  id: string;
  title: string;
  icon?: string;
  status: TaskStatus;
  logs: TaskLogEntry[];
  createdAt: number;
  finishedAt?: number;
  targetUrl?: string;
  result?: {
    containerId?: string;
    message?: string;
  };
}

export interface DeployStreamRequest {
  title: string;
  icon?: string;
  url: string;
  headers: HeadersInit;
  body: string;
  targetUrl?: string;
  onDone?: () => void | Promise<void>;
}

interface TaskContextValue {
  tasks: PanelTask[];
  runningCount: number;
  startDeployTask: (request: DeployStreamRequest) => string;
  appendTaskLog: (taskId: string, entry: Omit<TaskLogEntry, "timestamp">) => void;
  finishTask: (taskId: string, result?: PanelTask["result"]) => void;
  failTask: (taskId: string, message: string) => void;
  clearTask: (taskId: string) => void;
  clearFinishedTasks: () => void;
}

const MAX_TASK_LOGS = 800;

const TaskContext = createContext<TaskContextValue | null>(null);

function createTaskId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeEvent(event: any): Omit<TaskLogEntry, "timestamp"> {
  return {
    type: event?.type || "progress",
    message: event?.message,
    stage: event?.stage,
    layer: event?.layer,
    status: event?.status,
    detail: event?.detail,
  };
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<PanelTask[]>([]);
  const abortControllers = useRef(new Map<string, AbortController>());

  const appendTaskLog = useCallback((taskId: string, entry: Omit<TaskLogEntry, "timestamp">) => {
    const log: TaskLogEntry = { ...entry, timestamp: Date.now() };
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;
        const logs = [...task.logs, log];
        return {
          ...task,
          logs: logs.length > MAX_TASK_LOGS ? logs.slice(-MAX_TASK_LOGS) : logs,
        };
      }),
    );
  }, []);

  const finishTask = useCallback((taskId: string, result?: PanelTask["result"]) => {
    abortControllers.current.delete(taskId);
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "done",
              finishedAt: task.finishedAt ?? Date.now(),
              result,
            }
          : task,
      ),
    );
  }, []);

  const failTask = useCallback((taskId: string, message: string) => {
    abortControllers.current.delete(taskId);
    const log: TaskLogEntry = { type: "error", message, timestamp: Date.now() };
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "error",
              finishedAt: task.finishedAt ?? Date.now(),
              logs: [...task.logs, log].slice(-MAX_TASK_LOGS),
              result: { message },
            }
          : task,
      ),
    );
  }, []);

  const runDeployStream = useCallback(
    async (taskId: string, request: DeployStreamRequest, controller: AbortController) => {
      try {
        const res = await fetch(request.url, {
          method: "POST",
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
          failTask(taskId, err.message || "请求失败");
          return;
        }

        if (!res.body) {
          failTask(taskId, "响应流为空");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = normalizeEvent(JSON.parse(line.slice(6)));
              appendTaskLog(taskId, event);

              if (event.type === "done") {
                finishTask(taskId, {
                  containerId: (event as any).containerId,
                  message: event.message || "部署成功",
                });
                await request.onDone?.();
                return;
              }

              if (event.type === "error") {
                failTask(taskId, event.message || "部署失败");
                return;
              }
            } catch {
              // 忽略无法解析的 SSE 行，避免单行异常中断任务。
            }
          }
        }
      } catch (e: any) {
        if (controller.signal.aborted) return;
        failTask(taskId, e.message || "请求失败");
      } finally {
        abortControllers.current.delete(taskId);
      }
    },
    [appendTaskLog, failTask, finishTask],
  );

  const startDeployTask = useCallback(
    (request: DeployStreamRequest) => {
      const id = createTaskId();
      const controller = new AbortController();
      abortControllers.current.set(id, controller);

      setTasks((prev) => [
        {
          id,
          title: request.title,
          icon: request.icon,
          status: "running",
          logs: [],
          createdAt: Date.now(),
          targetUrl: request.targetUrl,
        },
        ...prev,
      ]);

      void runDeployStream(id, request, controller);
      return id;
    },
    [runDeployStream],
  );

  const clearTask = useCallback((taskId: string) => {
    const controller = abortControllers.current.get(taskId);
    controller?.abort();
    abortControllers.current.delete(taskId);
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
  }, []);

  const clearFinishedTasks = useCallback(() => {
    setTasks((prev) => prev.filter((task) => task.status === "running"));
  }, []);

  const runningCount = tasks.filter((task) => task.status === "running").length;

  const value = useMemo<TaskContextValue>(
    () => ({
      tasks,
      runningCount,
      startDeployTask,
      appendTaskLog,
      finishTask,
      failTask,
      clearTask,
      clearFinishedTasks,
    }),
    [tasks, runningCount, startDeployTask, appendTaskLog, finishTask, failTask, clearTask, clearFinishedTasks],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks() {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error("useTasks must be used within TaskProvider");
  }
  return context;
}