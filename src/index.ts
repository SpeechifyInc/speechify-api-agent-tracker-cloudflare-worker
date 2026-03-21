import { trackRequest } from "@usesapient/agent-tracker/cloudflare";

interface Env {
  SAPIENT_API_KEY: string;
  ORIGIN_URL: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Track visit using the SDK (non-blocking)
    if (env.SAPIENT_API_KEY) {
      trackRequest({ apiKey: env.SAPIENT_API_KEY }, request, ctx.waitUntil.bind(ctx));
    }

    // Proxy request to origin
    if (!env.ORIGIN_URL) {
      return new Response("ORIGIN_URL not configured", { status: 500 });
    }

    const origin = new URL(env.ORIGIN_URL);
    const proxyUrl = new URL(request.url);
    proxyUrl.hostname = origin.hostname;
    proxyUrl.protocol = origin.protocol;

    const proxyRequest = new Request(proxyUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    return fetch(proxyRequest);
  },
};
