import { trackRequest } from "@usesapient/agent-tracker/cloudflare";

interface Env {
  SAPIENT_API_KEY: string;
  ORIGIN_URL: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Track visit using the SDK (non-blocking, never throws)
      if (env.SAPIENT_API_KEY) {
        trackRequest({ apiKey: env.SAPIENT_API_KEY }, request, ctx.waitUntil.bind(ctx));
      }

      // Proxy request to origin
      if (!env.ORIGIN_URL) {
        return new Response("ORIGIN_URL not configured", { status: 500 });
      }

      let origin: URL;
      try {
        origin = new URL(env.ORIGIN_URL);
      } catch {
        return new Response("Invalid ORIGIN_URL configuration", { status: 500 });
      }

      let proxyUrl: URL;
      try {
        proxyUrl = new URL(request.url);
      } catch {
        return new Response("Invalid request URL", { status: 400 });
      }

      proxyUrl.hostname = origin.hostname;
      proxyUrl.protocol = origin.protocol;

      const proxyRequest = new Request(proxyUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });

      return await fetch(proxyRequest);
    } catch (e) {
      // Never crash - return error response instead
      const message = e instanceof Error ? e.message : "Unknown error";
      return new Response(`Proxy error: ${message}`, { status: 502 });
    }
  },
};
