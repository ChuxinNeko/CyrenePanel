import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Box } from "lucide-react";

export default function InstancesPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full">
      <h1 className="text-3xl font-bold tracking-tight">实例管理</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Box className="h-4 w-4" />
            实例列表
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">功能开发中，敬请期待…</p>
        </CardContent>
      </Card>
    </div>
  );
}