"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Play, Loader2, Clock } from "lucide-react";
import { API_BASE } from "@/lib/api-base";

async function apiGet<T = any>(path: string): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function apiPost<T = any>(path: string, body?: any): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

interface QueryResult {
  type: "select" | "execute";
  columns?: { name: string; type: number }[];
  rows?: any[];
  rowCount?: number;
  affectedRows?: number;
  message?: string;
}

export function MysqlSqlConsole({ connectionId }: { connectionId: string }) {
  const [sql, setSql] = useState("SELECT 1;");
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>("");
  const [results, setResults] = useState<QueryResult[]>([]);
  const [elapsed, setElapsed] = useState<number>(0);
  const [executing, setExecuting] = useState(false);
  const [MonacoEditor, setMonacoEditor] = useState<any>(null);

  useEffect(() => {
    import("@monaco-editor/react").then((mod) => {
      setMonacoEditor(() => mod.default);
    });
  }, []);

  useEffect(() => {
    const fetchDbs = async () => {
      const data = await apiGet(`/api/mysql/databases?connectionId=${connectionId}`);
      if (data.success) setDatabases(data.databases);
    };
    if (connectionId) fetchDbs();
  }, [connectionId]);

  const executeQuery = useCallback(async () => {
    if (!sql.trim()) return;
    setExecuting(true);
    setResults([]);

    const data = await apiPost("/api/mysql/query", {
      connectionId,
      sql: sql.trim(),
      database: selectedDb || undefined,
    });

    setExecuting(false);
    if (data.success) {
      setResults(data.results || []);
      setElapsed(data.elapsed || 0);
    } else {
      toast.error(data.message || "执行失败");
      setResults([]);
    }
  }, [connectionId, sql, selectedDb]);

  const handleEditorMount = (editor: any) => {
    editor.addAction({
      id: "execute-sql",
      label: "Execute SQL",
      keybindings: [2048 | 3], // Ctrl+Enter
      run: () => executeQuery(),
    });
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 shrink-0">
        <Select value={selectedDb} onValueChange={setSelectedDb}>
          <SelectTrigger className="w-48 h-8">
            <SelectValue placeholder="选择数据库 (可选)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">不指定数据库</SelectItem>
            {databases.map((db) => (
              <SelectItem key={db} value={db}>{db}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={executeQuery} disabled={executing}>
          {executing ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-1" />
          )}
          执行 (Ctrl+Enter)
        </Button>
        {elapsed > 0 && (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            {elapsed}ms
          </Badge>
        )}
      </div>

      {/* SQL 编辑器 */}
      <Card className="shrink-0" style={{ height: "200px" }}>
        <CardContent className="p-0 h-full">
          {MonacoEditor ? (
            <MonacoEditor
              height="100%"
              language="sql"
              theme="vs-dark"
              value={sql}
              onChange={(v: string | undefined) => setSql(v || "")}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                tabSize: 2,
              }}
            />
          ) : (
            <textarea
              className="w-full h-full p-3 font-mono text-sm bg-zinc-900 text-zinc-100 resize-none border-0 focus:outline-none"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); executeQuery(); }
              }}
              placeholder="输入 SQL 语句..."
            />
          )}
        </CardContent>
      </Card>

      {/* 结果区 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {results.length === 0 && !executing && (
          <Card className="h-full flex items-center justify-center">
            <CardContent className="text-center text-muted-foreground text-sm">
              执行 SQL 查看结果
            </CardContent>
          </Card>
        )}
        {results.map((result, idx) => (
          <Card key={idx} className="mb-3">
            <CardContent className="p-0">
              {result.type === "select" ? (
                <>
                  <div className="p-2 border-b bg-muted/50 flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      结果集 #{idx + 1}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {result.rowCount} 行
                    </span>
                  </div>
                  <ScrollArea className="max-h-80">
                    <div className="overflow-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 bg-background">
                          <tr className="border-b">
                            {result.columns?.map((col) => (
                              <th key={col.name} className="p-1.5 text-left font-medium whitespace-nowrap">
                                {col.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows?.map((row, ri) => (
                            <tr key={ri} className="border-b hover:bg-muted/30">
                              {result.columns?.map((col) => (
                                <td key={col.name} className="p-1.5 font-mono max-w-48 truncate">
                                  {row[col.name] === null ? (
                                    <span className="text-muted-foreground italic">NULL</span>
                                  ) : (
                                    String(row[col.name])
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <div className="p-3 text-sm">
                  <Badge variant="outline" className="mr-2">执行成功</Badge>
                  影响行数: {result.affectedRows}
                  {result.message && <span className="ml-2 text-muted-foreground">{result.message}</span>}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}