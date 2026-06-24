import { NextResponse } from "next/server";

const backendPort = process.env.CYRENE_BACKEND_PORT || "5677";

export async function GET() {
  return NextResponse.json({
    backendPort: Number(backendPort),
  });
}