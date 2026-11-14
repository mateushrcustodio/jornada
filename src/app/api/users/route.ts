import { NextResponse } from "next/server";
import { getUsers } from "@/lib/bitrix/service";
import { errorResponse } from "@/lib/http";
export async function GET() {
  try {
    return NextResponse.json(await getUsers(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
