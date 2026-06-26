"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Save, X, Settings2 } from "lucide-react";
import { toast } from "sonner";

interface AIProvider {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  format: "openai" | "anthropic";
  models: string[];
}

interface AISettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvidersUpdated?: () => void;
}

export default function AISettingsDialog({
  open,
  onOpenChange,
  onProvidersUpdated,
}: AISettingsDialogProps) {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [modelInput, setModelInput] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiPath, setApiPath] = useState("");
  const [testingModel, setTestingModel] = useState(false);

  const loadProviders = useCallback(async () => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch("/api/ai/providers", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setProviders(data.providers);
      }
    } catch {
      toast.error("加载提供商列表失败");
    }
  }, []);

  useEffect(() => {
    if (open) loadProviders();
  }, [open, loadProviders]);

  const handleAdd = () => {
    setIsAdding(true);
    setBaseUrl("");
    setApiPath("/v1/chat/completions");
    setEditingProvider({
      id: "",
      name: "",
      apiUrl: "",
      apiKey: "",
      format: "openai",
      models: [],
    });
  };

  const handleEdit = (provider: AIProvider) => {
    setIsAdding(false);
    
    let bUrl = provider.apiUrl || "";
    let aPath = "";
    
    if (provider.format === "openai") {
      if (bUrl.endsWith("/v1/chat/completions")) {
        aPath = "/v1/chat/completions";
        bUrl = bUrl.slice(0, -"/v1/chat/completions".length);
      } else if (bUrl.endsWith("/v1/completions")) {
        aPath = "/v1/completions";
        bUrl = bUrl.slice(0, -"/v1/completions".length);
      } else if (bUrl.endsWith("/v1/response")) {
        aPath = "/v1/response";
        bUrl = bUrl.slice(0, -"/v1/response".length);
      } else if (bUrl.endsWith("/vi/response")) {
        aPath = "/vi/response";
        bUrl = bUrl.slice(0, -"/vi/response".length);
      }
    } else if (provider.format === "anthropic") {
      if (bUrl.endsWith("/v1/messages")) {
        aPath = "/v1/messages";
        bUrl = bUrl.slice(0, -"/v1/messages".length);
      }
    }
    
    if (!aPath && bUrl) {
      try {
        const u = new URL(bUrl);
        if (u.pathname !== "/") {
          aPath = u.pathname;
          bUrl = u.origin;
        }
      } catch {}
    }

    if (!aPath) {
      aPath = provider.format === "openai" ? "/v1/chat/completions" : "/v1/messages";
    }
    
    setBaseUrl(bUrl);
    setApiPath(aPath);
    setEditingProvider({ ...provider });
    setModelInput("");
  };

  const handleDelete = async (id: string) => {
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`/api/ai/providers/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        toast.success("提供商已删除");
        loadProviders();
        onProvidersUpdated?.();
      } else {
        toast.error(data.message || "删除失败");
      }
    } catch {
      toast.error("删除失败");
    }
  };

  const handleSave = async () => {
    if (!editingProvider) return;

    let trimmedBase = baseUrl.trim().replace(/\/$/, "");
    if (trimmedBase && !/^https?:\/\//i.test(trimmedBase)) {
      trimmedBase = "https://" + trimmedBase;
    }
    const finalUrl = trimmedBase + (apiPath.startsWith("/") ? apiPath : "/" + apiPath);
    const providerToSave = { ...editingProvider, apiUrl: finalUrl };

    if (!providerToSave.name || !baseUrl.trim() || !providerToSave.apiKey) {
      toast.error("请填写名称、Base URL 和 API Key");
      return;
    }

    const token = localStorage.getItem("token");
    const url = editingProvider.id
      ? `/api/ai/providers/${editingProvider.id}`
      : "/api/ai/providers";
    const method = editingProvider.id ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(providerToSave),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(isAdding ? "提供商已添加" : "提供商已更新");
        setEditingProvider(null);
        setIsAdding(false);
        loadProviders();
        onProvidersUpdated?.();
      } else {
        toast.error(data.message || "保存失败");
      }
    } catch {
      toast.error("保存失败");
    }
  };

  const addModel = async () => {
    if (!editingProvider || !modelInput.trim()) return;
    const trimmed = modelInput.trim();
    if (editingProvider.models.includes(trimmed)) {
      toast.warning("模型已存在");
      return;
    }
    
    if (!baseUrl.trim() || !editingProvider.apiKey) {
      toast.error("添加模型前，请先填写 Base URL 和 API Key");
      return;
    }

    setTestingModel(true);
    let trimmedBase = baseUrl.trim().replace(/\/$/, "");
    if (trimmedBase && !/^https?:\/\//i.test(trimmedBase)) {
      trimmedBase = "https://" + trimmedBase;
    }
    const finalUrl = trimmedBase + (apiPath.startsWith("/") ? apiPath : "/" + apiPath);

    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          apiUrl: finalUrl,
          apiKey: editingProvider.apiKey,
          format: editingProvider.format,
          model: trimmed,
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        setEditingProvider({
          ...editingProvider,
          models: [...editingProvider.models, trimmed],
        });
        setModelInput("");
        toast.success(`模型可用！首字: ${data.ttft}ms, 速度: ${data.tps} t/s`);
      } else {
        toast.error(data.message || "模型测试失败");
      }
    } catch {
      toast.error("请求超时或网络错误");
    } finally {
      setTestingModel(false);
    }
  };

  const removeModel = (index: number) => {
    if (!editingProvider) return;
    setEditingProvider({
      ...editingProvider,
      models: editingProvider.models.filter((_, i) => i !== index),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            AI 助手设置
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 提供商列表 */}
          {!editingProvider && (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">AI 提供商</Label>
                <Button size="sm" variant="outline" onClick={handleAdd}>
                  <Plus className="h-4 w-4 mr-1" />
                  添加
                </Button>
              </div>
              {providers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  尚未配置 AI 提供商，点击上方 &quot;添加&quot; 按钮开始配置
                </div>
              ) : (
                <div className="space-y-2">
                  {providers.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {p.format.toUpperCase()} · {p.apiUrl}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          模型: {p.models.length > 0 ? p.models.join(", ") : "未配置"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => handleEdit(p)}
                        >
                          <Settings2 className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(p.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* 编辑/添加提供商 */}
          {editingProvider && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  {isAdding ? "添加提供商" : "编辑提供商"}
                </Label>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => {
                    setEditingProvider(null);
                    setIsAdding(false);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ai-name">名称</Label>
                  <Input
                    id="ai-name"
                    placeholder="如：OpenAI / Claude / DeepSeek"
                    value={editingProvider.name}
                    onChange={(e) =>
                      setEditingProvider({ ...editingProvider, name: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ai-format">API 格式</Label>
                  <Select
                    value={editingProvider.format}
                    onValueChange={(v: "openai" | "anthropic") => {
                      setEditingProvider({ ...editingProvider, format: v });
                      setApiPath(v === "openai" ? "/v1/chat/completions" : "/v1/messages");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI 兼容</SelectItem>
                      <SelectItem value="anthropic">Anthropic 兼容</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ai-base-url">Base URL</Label>
                  <Input
                    id="ai-base-url"
                    placeholder="如：https://api.openai.com"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ai-api-path">API 路由 (Endpoint)</Label>
                  {editingProvider.format === "openai" ? (
                    <Select value={apiPath} onValueChange={setApiPath}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="/v1/chat/completions">/v1/chat/completions</SelectItem>
                        <SelectItem value="/v1/completions">/v1/completions</SelectItem>
                        <SelectItem value="/v1/response">/v1/response</SelectItem>
                        <SelectItem value="/vi/response">/vi/response</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={apiPath} onValueChange={setApiPath}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="/v1/messages">/v1/messages</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ai-key">API Key</Label>
                  <Input
                    id="ai-key"
                    type="password"
                    placeholder="sk-..."
                    value={editingProvider.apiKey}
                    onChange={(e) =>
                      setEditingProvider({ ...editingProvider, apiKey: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>模型列表</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="输入模型名称，如 gpt-4o"
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addModel();
                        }
                      }}
                    />
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={addModel} 
                      disabled={testingModel}
                    >
                      {testingModel ? (
                        <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {editingProvider.models.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {editingProvider.models.map((m, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-xs"
                        >
                          {m}
                          <button
                            type="button"
                            onClick={() => removeModel(i)}
                            className="text-muted-foreground hover:text-foreground ml-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingProvider(null);
                    setIsAdding(false);
                  }}
                >
                  取消
                </Button>
                <Button onClick={handleSave}>
                  <Save className="h-4 w-4 mr-1" />
                  保存
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}