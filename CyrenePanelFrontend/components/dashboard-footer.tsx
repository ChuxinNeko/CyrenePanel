"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function DashboardFooter() {
  const [footerCode, setFooterCode] = useState("");

  useEffect(() => {
    const fetchFooterCode = async () => {
      try {
        const { data, error } = await (api as any).api.settings.footer.get();
        if (!error && data?.success && data.code) {
          setFooterCode(data.code);
        }
      } catch {
        // ignore
      }
    };
    fetchFooterCode();
  }, []);

  return (
    <footer className="border-t bg-background/80 backdrop-blur-xl">
      {/* 全局页脚 - 不可覆盖 */}
      <div className="py-3 text-center text-xs text-muted-foreground">
        CyrenePanel &copy; {new Date().getFullYear()} All rights reserved.
      </div>

      {/* 用户自定义页脚代码 - 位于全局页脚下方 */}
      {footerCode && (
        <div
          className="border-t border-dashed"
          dangerouslySetInnerHTML={{ __html: footerCode }}
        />
      )}
    </footer>
  );
}