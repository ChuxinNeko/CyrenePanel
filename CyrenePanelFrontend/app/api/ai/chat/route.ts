import { NextRequest } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const backendUrl =
    process.env.CYRENE_BACKEND_URL ||
    process.env.BACKEND_URL ||
    `http://127.0.0.1:${process.env.BACKEND_PORT || "5677"}`;

  const url = `${backendUrl.replace(/\/+$/, "")}/api/ai/chat`;

  // Clone headers
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    // We don't forward host header to avoid issues with the backend rejecting mismatched hosts
    if (key.toLowerCase() !== "host") {
      headers.set(key, value);
    }
  });

  const body = await req.text();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    // We create a new response using the stream from the backend
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, message: `Proxy error: ${err.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
