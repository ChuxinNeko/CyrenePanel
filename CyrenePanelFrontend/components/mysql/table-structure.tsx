"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Key, Hash } from "lucide-react";
import { API_BASE } from "@/lib/api-base";

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  default: string | null;
  extra: string;
  comment: string;
}

interface IndexInfo {
  name: string;
  column: string;
  unique: boolean;
  type: string;
}

async function apiGet<T = any>(path: string): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

export function MysqlTableStructure({
  connectionId,
  database,
  table,
}: {
  connectionId: string;
  database: string;
  table: string;
}) {
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [createSql, setCreateSql] = useState("");
  const [loading, setLoading] = useState(true);
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const data = await apiGet(
        `/api/mysql/databases/${database}/tables/${table}/structure?connectionId=${connectionId}`
      );
      if (data.success) {
        setColumns(data.columns || []);
        setIndexes(data.indexes || []);
        setCreateSql(data.createSql || "");
      }
      setLoading(false);
    };
    fetch();
  }, [connectionId, database, table]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 字段列表 */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 font-medium">字段名</th>
                  <th className="text-left p-2 font-medium">类型</th>
                  <th className="text-left p-2 font-medium">可空</th>
                  <th className="text-left p-2 font-medium">键</th>
                  <th className="text-left p-2 font-medium">默认值</th>
                  <th className="text-left p-2 font-medium">额外</th>
                  <th className="text-left p-2 font-medium">注释</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col) => (
                  <tr key={col.name} className="border-b hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs flex items-center gap-1">
                      {col.key === "PRI" && <Key className="h-3 w-3 text-yellow-500" />}
                      {col.key === "MUL" && <Hash className="h-3 w-3 text-blue-400" />}
                      {col.name}
                    </td>
                    <td className="p-2 font-mono text-xs text-muted-foreground">{col.type}</td>
                    <td className="p-2">
                      <Badge variant={col.nullable ? "secondary" : "outline"} className="text-[10px]">
                        {col.nullable ? "YES" : "NO"}
                      </Badge>
                    </td>
                    <td className="p-2 text-xs">{col.key || "-"}</td>
                    <td className="p-2 font-mono text-xs text-muted-foreground">
                      {col.default === null ? <span className="italic">NULL</span> : col.default || "-"}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">{col.extra || "-"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{col.comment || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 索引列表 */}
      {indexes.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="p-2 border-b bg-muted/50">
              <span className="text-sm font-medium">索引</span>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-medium">名称</th>
                    <th className="text-left p-2 font-medium">字段</th>
                    <th className="text-left p-2 font-medium">唯一</th>
                    <th className="text-left p-2 font-medium">类型</th>
                  </tr>
                </thead>
                <tbody>
                  {indexes.map((idx, i) => (
                    <tr key={`${idx.name}-${i}`} className="border-b hover:bg-muted/30">
                      <td className="p-2 font-mono text-xs">{idx.name}</td>
                      <td className="p-2 font-mono text-xs">{idx.column}</td>
                      <td className="p-2">
                        <Badge variant={idx.unique ? "default" : "secondary"} className="text-[10px]">
                          {idx.unique ? "YES" : "NO"}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs">{idx.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 建表语句 */}
      {createSql && (
        <Card>
          <CardContent className="p-0">
            <div
              className="p-2 border-b bg-muted/50 cursor-pointer"
              onClick={() => setShowSql(!showSql)}
            >
              <span className="text-sm font-medium">
                建表语句 {showSql ? "▼" : "▶"}
              </span>
            </div>
            {showSql && (
              <ScrollArea className="max-h-64">
                <pre className="p-3 text-xs font-mono whitespace-pre-wrap">{createSql}</pre>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}