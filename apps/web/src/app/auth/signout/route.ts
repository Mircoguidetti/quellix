import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth/server";

export async function POST(request: Request) {
  await signOut();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
