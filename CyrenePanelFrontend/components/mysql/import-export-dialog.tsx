"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Download, Upload, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/api-base";

async function apiGet<T = any>(path: string): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function apiPost(path: string, body?: any) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function MysqlImportExport({ connectionId }: { connectionId: string }) {
  const [databases, setDatabases] = useState<string[]>([]);
  const [exportDb, setExportDb] = useState("");
  const [importDb, setImportDb] = useState("");
  const [importSql, setImportSql] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const fetchDbs = async () => {
      const data = await apiGet(`/api/mysql/databases?connectionId=${connectionId}`);
      if (data.success) setDatabases(data.databases);
    };
    if (connectionId) fetchDbs();
  }, [connectionId]);

  const handleExport = async () => {
    if (!exportDb) { toast.error("请选择要导出的数据库"); return; }
    setExporting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `${API_BASE}/api/mysql/databases/${exportDb}/export?connectionId=${connectionId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "导出失败" }));
        toast.error(err.message || "导出失败");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportDb}_${new Date().toISOString().slice(0, 10)}.sql`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出完成");
    } catch (e: any) {
      toast.error(e.message || "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportSql(text);
    toast.info(`已加载文件: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  };

  const handleImport = async () => {
    if (!importDb) { toast.error("请选择目标数据库"); return; }
    if (!importSql.trim()) { toast.error("请输入或上传 SQL 内容"); return; }
    setImporting(true);
    const data = await apiPost(`/api/mysql/databases/${importDb}/import`, {
      connectionId,
      sql: importSql,
    });
    setImporting(false);
    if (data.success) {
      toast.success(data.message || "导入完成");
      setImportSql("");
    } else {
      toast.error(data.message || "导入失败");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 导出 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4" />
            导出数据库
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>选择数据库</Label>
            <Select value={exportDb} onValueChange={setExportDb}>
              <SelectTrigger>
                <SelectValue placeholder="选择要导出的数据库" />
              </SelectTrigger>
              <SelectContent>
                {databases.map((db) => (
                  <SelectItem key={db} value={db}>{db}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            使用 mysqldump 导出完整数据库（包含结构和数据、存储过程、触发器、事件）
          </p>
          <Button onClick={handleExport} disabled={exporting || !exportDb} className="w-full">
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            {exporting ? "导出中..." : "导出 SQL 文件"}
          </Button>
        </CardContent>
      </Card>

      {/* 导入 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" />
            导入 SQL
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>目标数据库</Label>
            <Select value={importDb} onValueChange={setImportDb}>
              <SelectTrigger>
                <SelectValue placeholder="选择目标数据库" />
              </SelectTrigger>
              <SelectContent>
                {databases.map((db) => (
                  <SelectItem key={db} value={db}>{db}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>SQL 文件</Label>
            <input
              type="file"
              accept=".sql,.txt"
              onChange={handleImportFile}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
            />
          </div>
          <div className="space-y-2">
            <Label>或直接输入 SQL</Label>
            <Textarea
              className="font-mono text-xs h-32"
              placeholder="粘贴 SQL 语句..."
              value={importSql}
              onChange={(e) => setImportSql(e.target.value)}
            />
          </div>
          <Button onClick={handleImport} disabled={importing || !importDb} className="w-full">
            {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {importing ? "导入中..." : "执行导入"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}