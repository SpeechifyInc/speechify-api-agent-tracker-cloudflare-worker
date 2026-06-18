import { trackRequest } from "@usesapient/agent-tracker/cloudflare";

interface Env {
  SAPIENT_API_KEY: string;
  ORIGIN_URL: string;
  RESOLVE_OVERRIDE?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Track visit using the SDK — isolated so tracking never breaks the proxy
      try {
        if (env?.SAPIENT_API_KEY && ctx?.waitUntil) {
          trackRequest({ apiKey: env.SAPIENT_API_KEY }, request, ctx.waitUntil.bind(ctx));
        }
      } catch {
        // ignore tracking errors
      }

      const originUrl = env?.ORIGIN_URL;
      if (!originUrl) {
        return new Response("ORIGIN_URL not configured", { status: 500 });
      }

      let origin: URL;
      try {
        origin = new URL(originUrl);
      } catch {
        return new Response("Invalid ORIGIN_URL configuration", { status: 500 });
      }

      if (!origin.hostname) {
        return new Response("Invalid ORIGIN_URL configuration", { status: 500 });
      }

      let proxyUrl: URL;
      try {
        proxyUrl = new URL(request.url);
      } catch {
        return new Response("Invalid request URL", { status: 400 });
      }

      const proxyInit: RequestInit = {
        method: request.method,
        headers: request.headers,
      };
      if (request.method !== "GET" && request.method !== "HEAD" && request.body != null) {
        proxyInit.body = request.body;
      }

      const useResolveOverride = env?.RESOLVE_OVERRIDE === "true";

      let proxyRequest: Request;

      if (useResolveOverride) {
        // Preserve the incoming Host header; DNS resolves to ORIGIN_URL instead.
        proxyRequest = new Request(request.url, {
          ...proxyInit,
          cf: {
            resolveOverride: origin.hostname,
          },
        } as RequestInit);
      } else {
        // Original behavior for everyone else
        proxyUrl.hostname = origin.hostname;
        proxyUrl.protocol = origin.protocol;
        proxyUrl.port = origin.port;

        proxyRequest = new Request(proxyUrl.toString(), proxyInit);
      }

      return await fetch(proxyRequest);
    } catch (e) {
      // Never crash - return error response instead
      const message = e instanceof Error ? e.message : "Unknown error";
      return new Response(`Proxy error: ${message}`, { status: 502 });
    }
  },
};
