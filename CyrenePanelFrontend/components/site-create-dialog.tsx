"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { API_BASE } from "@/lib/api-base";
import { toast } from "sonner";
import {
  ArrowRight,
  Braces,
  ChevronDown,
  ChevronLeft,
  Coffee,
  FileCode2,
  Globe,
  Hexagon,
  Loader2,
  Network,
  Settings2,
  Terminal,
  Zap,
} from "lucide-react";

type WizardType = "static" | "php" | "node" | "java" | "python" | "go" | "proxy";

interface SiteTypeOption {
  value: WizardType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const SITE_TYPES: SiteTypeOption[] = [
  { value: "static", label: "静态网站", icon: FileCode2, description: "托管 HTML / CSS / JS 等静态资源" },
  { value: "php", label: "PHP 网站", icon: Braces, description: "Nginx + PHP-FPM 运行 PHP 程序" },
  { value: "node", label: "Node.js", icon: Hexagon, description: "systemd 托管 Node.js 应用，自动反向代理" },
  { value: "java", label: "Java", icon: Coffee, description: "以 systemd 服务运行 jar 包等 Java 应用" },
  { value: "python", label: "Python", icon: Terminal, description: "以 systemd 服务运行 Python Web 应用" },
  { value: "go", label: "Go", icon: Zap, description: "以 systemd 服务运行编译好的 Go 程序" },
  { value: "proxy", label: "反向代理", icon: Network, description: "将域名流量转发到本机或远程服务" },
];

const RUNTIME_PLACEHOLDERS: Record<string, string> = {
  node: "npm run start 或 node app.js",
  java: "java -jar app.jar --server.port=8080",
  python: "python3 app.py 或 gunicorn app:app -b 127.0.0.1:8000",
  go: "./myapp -port 8080",
};

const DEFAULT_PORTS: Record<string, string> = {
  node: "3000",
  java: "8080",
  python: "8000",
  go: "8080",
};

interface SiteCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basePath: string;
  rootBase: string;
  phpUpstreams: { version: string; upstream: string }[];
  onCreated: () => void | Promise<void>;
}

interface CreateFormState {
  domain: string;
  otherDomains: string;
  root: string;
  rootTouched: boolean;
  phpUpstream: string;
  phpUpstreamCustom: string;
  startCommand: string;
  appPort: string;
  user: string;
  envText: string;
  autoStart: boolean;
  proxyTarget: string;
  proxyPath: string;
  port: string;
  index: string;
  remark: string;
}

const defaultForm: CreateFormState = {
  domain: "",
  otherDomains: "",
  root: "",
  rootTouched: false,
  phpUpstream: "",
  phpUpstreamCustom: "unix:/run/php/php-fpm.sock",
  startCommand: "",
  appPort: "",
  user: "",
  envText: "",
  autoStart: true,
  proxyTarget: "",
  proxyPath: "/",
  port: "80",
  index: "",
  remark: "",
};

function authHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export function SiteCreateDialog({
  open,
  onOpenChange,
  basePath,
  rootBase,
  phpUpstreams,
  onCreated,
}: SiteCreateDialogProps) {
  const [step, setStep] = useState(0);
  const [selectedType, setSelectedType] = useState<WizardType>("static");
  const [form, setForm] = useState<CreateFormState>(defaultForm);
  const [creating, setCreating] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(0);
      setSelectedType("static");
      setForm(defaultForm);
      setAdvancedOpen(false);
    }
  }, [open]);

  const typeOption = useMemo(
    () => SITE_TYPES.find((item) => item.value === selectedType) || SITE_TYPES[0],
    [selectedType],
  );

  const isRuntime = ["node", "java", "python", "go"].includes(selectedType);
  const hasRoot = selectedType === "static" || selectedType === "php" || isRuntime;
  const rootLabel = isRuntime ? "项目目录" : "网站目录";

  const setField = <K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleDomainChange = (domain: string) => {
    setForm((prev) => ({
      ...prev,
      domain,
      root: prev.rootTouched ? prev.root : domain ? `${rootBase}/${domain}` : "",
    }));
  };

  const handleRootChange = (root: string) => {
    setForm((prev) => ({ ...prev, root, rootTouched: true }));
  };

  const selectType = (value: WizardType) => {
    setSelectedType(value);
    if (["node", "java", "python", "go"].includes(value)) {
      setField("appPort", DEFAULT_PORTS[value] || "");
    }
  };

  const parseEnv = (text: string): [string, string][] => {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf("=");
        if (idx <= 0) return null;
        return [line.slice(0, idx).trim(), line.slice(idx + 1)] as [string, string];
      })
      .filter((pair): pair is [string, string] => !!pair);
  };

  const submit = async () => {
    const domain = form.domain.trim().toLowerCase();
    if (!domain) {
      toast.error("请填写主域名");
      return;
    }
    if (isRuntime) {
      if (!form.startCommand.trim()) {
        toast.error("请填写应用启动命令");
        return;
      }
      const port = Number(form.appPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        toast.error("应用端口必须是 1-65535 之间的数字");
        return;
      }
    }
    if (selectedType === "proxy" && !/^https?:\/\/.+/i.test(form.proxyTarget.trim())) {
      toast.error("反向代理目标必须以 http:// 或 https:// 开头");
      return;
    }

    const domains = [
      domain,
      ...form.otherDomains.split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean),
    ];

    const body: Record<string, unknown> = {
      domains,
      port: Number(form.port || 80),
      remark: form.remark,
    };

    if (selectedType === "static") {
      Object.assign(body, {
        type: "static",
        root: form.root.trim() || undefined,
        index: form.index.trim() || undefined,
      });
    } else if (selectedType === "php") {
      const upstream = form.phpUpstream === "custom" || !form.phpUpstream
        ? form.phpUpstreamCustom.trim()
        : form.phpUpstream;
      Object.assign(body, { type: "php", root: form.root.trim() || undefined, phpUpstream: upstream });
    } else if (isRuntime) {
      Object.assign(body, {
        type: "runtime",
        runtime: selectedType,
        root: form.root.trim() || undefined,
        startCommand: form.startCommand.trim(),
        appPort: Number(form.appPort),
        user: form.user.trim() || undefined,
        env: parseEnv(form.envText),
        autoStart: form.autoStart,
      });
    } else {
      Object.assign(body, {
        type: "proxy",
        proxyTarget: form.proxyTarget.trim().replace(/\/+$/, ""),
        proxyPath: form.proxyPath.trim() || "/",
      });
    }

    setCreating(true);
    try {
      const res = await apiPost<{ success: boolean; message?: string }>(basePath, body);
      if (res.success) {
        toast.success(res.message || "网站创建成功");
        onOpenChange(false);
        await onCreated();
      } else {
        toast.error(res.message || "网站创建失败");
      }
    } catch (e: any) {
      toast.error(e.message || "网站创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            创建网站
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 text-sm">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              step === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            1
          </span>
          <span className={step === 0 ? "font-medium" : "text-muted-foreground"}>选择类型</span>
          <span className="h-px w-6 bg-border" />
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              step === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            2
          </span>
          <span className={step === 1 ? "font-medium" : "text-muted-foreground"}>基本信息</span>
          {step === 1 && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <typeOption.icon className="h-3.5 w-3.5" />
              {typeOption.label}
            </span>
          )}
        </div>

        {step === 0 ? (
          <div className="grid grid-cols-1 gap-3 py-1 sm:grid-cols-2">
            {SITE_TYPES.map((item) => {
              const Icon = item.icon;
              const active = selectedType === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => selectType(item.value)}
                  className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                      active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {item.label}
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {item.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-5 py-1">
            <div className="space-y-4 rounded-lg border p-4">
              <div className="text-sm font-medium">域名信息</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>主域名</Label>
                  <Input
                    placeholder="example.com"
                    value={form.domain}
                    onChange={(e) => handleDomainChange(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>其他域名（可选）</Label>
                  <Input
                    placeholder="www.example.com cdn.example.com"
                    value={form.otherDomains}
                    onChange={(e) => setField("otherDomains", e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                多个域名使用同一站点配置；主域名同时作为站点目录的默认名称。
              </p>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <typeOption.icon className="h-4 w-4 text-primary" />
                {typeOption.label}配置
              </div>

              {hasRoot && (
                <div className="space-y-1.5">
                  <Label>{rootLabel}</Label>
                  <Input
                    className="font-mono text-sm"
                    placeholder={`${rootBase}/example.com`}
                    value={form.root}
                    onChange={(e) => handleRootChange(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {isRuntime
                      ? "应用的工作目录，启动命令将在此目录下执行。"
                      : "目录不存在时会自动创建，并生成默认 index.html。"}
                  </p>
                </div>
              )}

              {selectedType === "php" && (
                <div className="space-y-1.5">
                  <Label>PHP 版本</Label>
                  <Select
                    value={form.phpUpstream || (phpUpstreams.length ? phpUpstreams[phpUpstreams.length - 1].upstream : "custom")}
                    onValueChange={(value) => setField("phpUpstream", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择 PHP-FPM" />
                    </SelectTrigger>
                    <SelectContent>
                      {phpUpstreams.map((item) => (
                        <SelectItem key={item.upstream} value={item.upstream}>
                          PHP {item.version}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">自定义 FastCGI 地址</SelectItem>
                    </SelectContent>
                  </Select>
                  {(form.phpUpstream === "custom" || !phpUpstreams.length) && (
                    <Input
                      className="mt-2 font-mono text-sm"
                      placeholder="unix:/run/php/php8.2-fpm.sock"
                      value={form.phpUpstreamCustom}
                      onChange={(e) => setField("phpUpstreamCustom", e.target.value)}
                    />
                  )}
                  {!phpUpstreams.length && (
                    <p className="text-xs text-amber-600">
                      未检测到已安装的 PHP-FPM，请先在环境管理中安装，或填写自定义地址。
                    </p>
                  )}
                </div>
              )}

              {isRuntime && (
                <>
                  <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                    <div className="space-y-1.5">
                      <Label>启动命令</Label>
                      <Input
                        className="font-mono text-sm"
                        placeholder={RUNTIME_PLACEHOLDERS[selectedType]}
                        value={form.startCommand}
                        onChange={(e) => setField("startCommand", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>应用端口</Label>
                      <Input
                        inputMode="numeric"
                        placeholder="3000"
                        value={form.appPort}
                        onChange={(e) => setField("appPort", e.target.value.replace(/\D/g, ""))}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <div className="text-sm font-medium">创建后立即启动应用</div>
                      <div className="text-xs text-muted-foreground">
                        以 systemd 服务托管（开机自启、崩溃自动拉起），Nginx 将反代到 127.0.0.1:应用端口
                      </div>
                    </div>
                    <Switch
                      checked={form.autoStart}
                      onCheckedChange={(checked) => setField("autoStart", checked)}
                    />
                  </div>
                </>
              )}

              {selectedType === "proxy" && (
                <div className="space-y-1.5">
                  <Label>代理目标地址</Label>
                  <Input
                    className="font-mono text-sm"
                    placeholder="http://127.0.0.1:3000"
                    value={form.proxyTarget}
                    onChange={(e) => setField("proxyTarget", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    站点流量将原样转发到该地址，自动携带 WebSocket 升级头。
                  </p>
                </div>
              )}
            </div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between px-4">
                  <span className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    高级设置
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 rounded-lg border p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>监听端口</Label>
                    <Input
                      inputMode="numeric"
                      value={form.port}
                      onChange={(e) => setField("port", e.target.value.replace(/\D/g, ""))}
                    />
                    <p className="text-xs text-muted-foreground">Nginx 监听端口，默认 80。</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>备注</Label>
                    <Input
                      placeholder="项目、负责人或用途"
                      value={form.remark}
                      onChange={(e) => setField("remark", e.target.value)}
                    />
                  </div>
                </div>

                {selectedType === "proxy" && (
                  <div className="space-y-1.5">
                    <Label>代理路径</Label>
                    <Input
                      className="font-mono text-sm"
                      placeholder="/"
                      value={form.proxyPath}
                      onChange={(e) => setField("proxyPath", e.target.value)}
                    />
                  </div>
                )}

                {isRuntime && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>运行用户（可选）</Label>
                      <Input
                        className="font-mono text-sm"
                        placeholder="root"
                        value={form.user}
                        onChange={(e) => setField("user", e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        systemd 服务运行用户，默认 root，可改为 www 等低权限账户。
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>环境变量（可选）</Label>
                      <Textarea
                        className="font-mono text-xs"
                        placeholder={"NODE_ENV=production\nPORT=3000"}
                        value={form.envText}
                        onChange={(e) => setField("envText", e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">每行一条 KEY=VALUE。</p>
                    </div>
                  </div>
                )}

                {selectedType === "static" && (
                  <div className="space-y-1.5">
                    <Label>默认文档</Label>
                    <Input
                      className="font-mono text-sm"
                      placeholder="index.html index.htm"
                      value={form.index ?? ""}
                      onChange={(e) => setField("index", e.target.value)}
                    />
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        <DialogFooter>
          {step === 0 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={() => setStep(1)}>
                下一步
                <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(0)}>
                <ChevronLeft className="h-4 w-4" />
                上一步
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={submit} disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                立即创建
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
