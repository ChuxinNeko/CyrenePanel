import { NextResponse, type NextRequest } from "next/server";

/**
 * 面板的所有数据交互都走后端 REST API（/api/* 由 next.config.mjs 反代到 Elysia），
 * 前端不存在任何 Server Action（全仓库没有 "use server"）。
 *
 * 因此带 Next-Action 头的请求一定不是本站发出的——实际观察到的是扫描器往 / 上
 * POST 一个伪造的 action id。Next 处理不了就会抛 "Failed to find Server Action"
 * 并在日志里留下堆栈。这里直接短路成 404，既挡掉探测也让日志干净。
 */
export function proxy(request: NextRequest) {
  if (request.headers.has("next-action")) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  // /api/* 是反代到后端的热路径，静态资源也没必要过这一层
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
