import { handleApi } from "../../../server/api.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleApi;
export const POST = handleApi;
export const OPTIONS = handleApi;
