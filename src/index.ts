import { trackRequest } from "@usesapient/agent-tracker/cloudflare";

interface Env {
  SAPIENT_API_KEY: string;
  ORIGIN_URL: string;     // set to https://app.buildwithfern.com
  FERN_HOST: string;      // your bare docs domain, e.g. docs.example.com
  DOCS_SUBPATH?: string;  // optional, e.g. /docs — leave unset to proxy everything
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Track visit using the SDK — isolated so tracking never breaks the proxy
      try {
        if (env?.SAPIENT_API_KEY && ctx?.waitUntil) {
          trackRequest({ apiKey: env.SAPIENT_API_KEY }, request, ctx.waitUntil.bind(ctx));
        }
      } catch (err) {
        console.error("sapient tracking failed:", err);
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

      // Optional: only handle the docs subpath; 404 everything else.
      // Skip this if you scope the Worker route to mydomain.com/docs/* instead.
      const subpath = env?.DOCS_SUBPATH;
      if (subpath) {
        const inScope =
          proxyUrl.pathname === subpath ||
          proxyUrl.pathname.startsWith(`${subpath}/`);
        if (!inScope) {
          return new Response("Not found", { status: 404 });
        }
      }

      // Fern routes on x-fern-host, so it must be set to your bare domain.
      // request.headers is immutable — copy into a mutable Headers object.
      const fernHost = env?.FERN_HOST || proxyUrl.hostname;
      const headers = new Headers(request.headers);
      headers.set("x-fern-host", fernHost);

      const proxyInit: RequestInit = {
        method: request.method,
        headers,
      };
      if (request.method !== "GET" && request.method !== "HEAD" && request.body != null) {
        proxyInit.body = request.body;
      }

      // Rewrite to the Fern upstream (app.buildwithfern.com), keep the path.
      proxyUrl.protocol = origin.protocol;
      proxyUrl.hostname = origin.hostname;
      proxyUrl.port = origin.port;

      const proxyRequest = new Request(proxyUrl.toString(), proxyInit);

      return await fetch(proxyRequest);
    } catch (e) {
      // Never crash - return error response instead
      const message = e instanceof Error ? e.message : "Unknown error";
      return new Response(`Proxy error: ${message}`, { status: 502 });
    }
  },
};
