import { apiHandler } from "@/server/api-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Context = { params: Promise<{ segments?: string[] }> };
async function handle(request: Request, context: Context) {
  return apiHandler(request, (await context.params).segments ?? []);
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
