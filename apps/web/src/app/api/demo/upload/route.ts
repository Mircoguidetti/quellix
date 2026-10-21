import { isDemoMode } from "@/lib/demo/mode";

/** Demo mode only: accepts an upload and discards it (nothing is stored). */
export async function PUT(request: Request) {
  if (!isDemoMode()) return new Response("Not found", { status: 404 });
  await request.arrayBuffer();
  return Response.json({ Key: "demo" });
}
