import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * 设计规范把几何无衬线面（Geist）定为叙述层、等宽面（Geist Mono）定为技术层。
 * Geist 本身在 Google Fonts 上，所以直接用真身，不退回 Inter 替代品。
 */
const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  // 规范的字重工作集是 400/500/600，显示级上限就是 600，不加 700
  weight: ["400", "500", "600"],
  display: "swap",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  weight: ["400", "500"],
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={cn("font-sans antialiased", fontSans.variable, fontMono.variable)}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
