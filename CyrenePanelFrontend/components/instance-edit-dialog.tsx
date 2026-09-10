"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertCircle, FolderSearch, Info, Plus, Trash2 } from "lucide-react";
import { API_BASE } from "@/lib/api-base";
import { DirectoryBrowserDialog } from "@/components/directory-browser-dialog";
import type { Instance } from "@/lib/instances";

interface EnvPair {
  key: string;
  value: string;
}

function authHeaders(): HeadersInit {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * 编辑已有实例。
 *
 * 节点和实例 ID 不可改 —— 后端的 PUT 只接受 name/command/cwd/env/autoRestart，
 * 跨节点迁移不在它的能力范围内。
 */
export function InstanceEditDialog({
  instance,
  open,
  onOpenChange,
  onSaved,
}: {
  instance: Instance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑实例</DialogTitle>
          <DialogDescription>
            修改实例的启动配置。节点和实例 ID 不可更改。
          </DialogDescription>
        </DialogHeader>
        {instance && (
          <EditForm
            instance={instance}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 表单单独一层，且渲染在 DialogContent 内部。
 *
 * Radix 关闭时会卸载 DialogContent，所以这里的状态每次打开都是全新的，
 * 不需要用 effect 去灌初值。这一点很关键：详情页在实例运行时每 5 秒轮询一次，
 * 如果用 effect 跟着 instance 重置表单，用户输入到一半就会被轮询清空。
 */
function EditForm({
  instance,
  onOpenChange,
  onSaved,
}: {
  instance: Instance;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(instance.name);
  const [command, setCommand] = useState(instance.command);
  const [cwd, setCwd] = useState(instance.cwd);
  const [autoRestart, setAutoRestart] = useState(instance.autoRestart);
  const [envPairs, setEnvPairs] = useState<EnvPair[]>(() =>
    Object.entries(instance.env ?? {}).map(([key, value]) => ({ key, value }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);

  const addEnv = () => setEnvPairs([...envPairs, { key: "", value: "" }]);
  const removeEnv = (index: number) =>
    setEnvPairs(envPairs.filter((_, i) => i !== index));
  const updateEnv = (index: number, field: "key" | "value", value: string) => {
    const next = [...envPairs];
    next[index][field] = value;
    setEnvPairs(next);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !command.trim() || !cwd.trim()) {
      setError("请填写所有必填字段");
      return;
    }

    setSubmitting(true);
    setError("");

    const env: Record<string, string> = {};
    for (const pair of envPairs) {
      if (pair.key.trim()) env[pair.key.trim()] = pair.value;
    }

    try {
      const res = await fetch(`${API_BASE}/api/instances/${instance.id}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          name: name.trim(),
          command: command.trim(),
          cwd: cwd.trim(),
          env,
          autoRestart,
        }),
      });
      const data = (await res.json()) as { success: boolean; message?: string };
      if (data.success) {
        onOpenChange(false);
        onSaved();
      } else {
        setError(data.message || "保存失败");
      }
    } catch {
      setError("请求失败");
    } finally {
      setSubmitting(false);
    }
  };

  const isRunning = instance.status === "running";

  return (
    <>
      <div className="space-y-4 py-2">
        {/* 运行中改配置不会热生效，必须说清楚，否则用户会以为保存没起作用 */}
        {isRunning && (
          <p className="flex items-start gap-1.5 rounded-md bg-warning/12 px-3 py-2 text-xs text-warning-fg">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            实例正在运行，启动命令、工作目录和环境变量的改动需要重启后才生效。
          </p>
        )}

        <div className="space-y-2">
          <Label>实例名称 *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>启动命令 *</Label>
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="font-mono"
          />
        </div>

        <div className="space-y-2">
          <Label>工作目录 *</Label>
          <div className="flex gap-2">
            <Input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              className="flex-1 font-mono"
            />
            <Button
              variant="outline"
              size="icon"
              type="button"
              onClick={() => setBrowseOpen(true)}
              title="浏览目录"
            >
              <FolderSearch className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={autoRestart} onCheckedChange={setAutoRestart} />
          <Label className="cursor-pointer">崩溃后自动重启</Label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>环境变量</Label>
            <Button variant="outline" size="sm" onClick={addEnv} type="button">
              <Plus className="size-3" />
              添加
            </Button>
          </div>
          {envPairs.length > 0 && (
            <div className="space-y-2 rounded-lg border p-3">
              {envPairs.map((pair, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="KEY"
                    value={pair.key}
                    onChange={(e) => updateEnv(i, "key", e.target.value)}
                    className="flex-1 font-mono"
                  />
                  <Input
                    placeholder="VALUE"
                    value={pair.value}
                    onChange={(e) => updateEnv(i, "value", e.target.value)}
                    className="flex-1 font-mono"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeEnv(i)}
                    type="button"
                    aria-label={`删除环境变量 ${pair.key || i + 1}`}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "保存中…" : "保存更改"}
        </Button>
      </DialogFooter>

      <DirectoryBrowserDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        nodeId={instance.nodeId}
        onSelect={setCwd}
      />
    </>
  );
}
