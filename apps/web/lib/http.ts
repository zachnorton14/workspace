import { NotFoundError } from "@workspace/core";
import { ZodError } from "zod";
import { requestAuthorized } from "./auth";

type Handler<C> = (req: Request, ctx: C) => Promise<unknown>;

/** Wraps a route: auth check, JSON response, and consistent error shapes. */
export function api<C>(fn: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    if (!(await requestAuthorized(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
    try {
      const out = await fn(req, ctx);
      return out instanceof Response ? out : Response.json(out);
    } catch (e) {
      if (e instanceof ZodError) return Response.json({ error: "invalid_input", issues: e.issues }, { status: 400 });
      if (e instanceof NotFoundError) return Response.json({ error: "not_found", message: e.message }, { status: 404 });
      console.error(e);
      return Response.json({ error: "internal" }, { status: 500 });
    }
  };
}

export async function body(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { return {}; }
}
