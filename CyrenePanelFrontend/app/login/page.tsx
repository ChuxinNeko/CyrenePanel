"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { API_BASE } from "@/lib/api-base";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "sonner";

const STORAGE_KEY = "cyrene_panel_name";
const DEFAULT_NAME = "CyrenePanel";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [panelName, setPanelName] = useState(DEFAULT_NAME);
  const [footerCode, setFooterCode] = useState("");

  useEffect(() => {
    // 读缓存的面板名称
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      setPanelName(cached);
      document.title = cached;
    }

    // 使用公开API获取面板名称和页脚代码（无需登录）
    const fetchPublicSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/footer`);
        const data = await res.json();
        if (data?.success) {
          if (data.panelName) {
            setPanelName(data.panelName);
            localStorage.setItem(STORAGE_KEY, data.panelName);
            document.title = data.panelName;
          }
          if (data.code) {
            setFooterCode(data.code);
          }
        }
      } catch {
        // ignore
      }
    };
    fetchPublicSettings();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 这里的 api.api.login.post 拥有完整的强类型提示和入参校验
      const { data, error } = await api.api.login.post({
        username,
        password,
      });

      if (error) {
        toast.error("网络错误或服务器不可达");
        return;
      }

      if (data?.success && data.token) {
        localStorage.setItem("token", data.token);
        toast.success("登录成功");
        router.push("/dashboard");
      } else {
        toast.error(data?.message || "凭据无效");
      }
    } catch (err) {
      toast.error("发生意外错误");
    } finally {
      setLoading(false);
    }
  };

  return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <ThemeToggle />
        <form onSubmit={handleLogin} className="w-full max-w-[420px]">
          <Card className="w-full shadow-md">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold text-center">{panelName}</CardTitle>
              <CardDescription className="text-center">
                输入您的管理员凭据以访问控制面板
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                type="submit" 
                className="w-full" 
                disabled={loading}
              >
                {loading ? "登录中..." : "登录"}
              </Button>
            </CardFooter>
          </Card>
        </form>

        {/* 页脚 */}
        <footer className="mt-8 w-full max-w-[420px]">
          <div className="py-3 text-center text-xs text-muted-foreground">
            {panelName} &copy; {new Date().getFullYear()} All rights reserved.
          </div>
          {footerCode && (
            <div
              className="border-t border-dashed pt-3"
              dangerouslySetInnerHTML={{ __html: footerCode }}
            />
          )}
        </footer>
      </div>
  );
}
