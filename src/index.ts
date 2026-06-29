import { trackRequest } from "@usesapient/agent-tracker/cloudflare";

interface Env {
  SAPIENT_API_KEY: string;
  ORIGIN_URL: string;     // set to https://app.buildwithfern.com
  FERN_HOST: string;      // your bare docs domain, e.g. docs.example.com
  DOCS_SUBPATH?: string;  // optional, e.g. /docs — leave unset to proxy everything
}

// Max hops the Worker will follow when chasing same-host redirects from Fern.
// 5 is plenty: Fern's AI-Markdown flow is a single 303, this is just a safety bound.
const MAX_REDIRECTS = 5;

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

      // The bound hostname Cloudflare routed this Worker for. We must never
      // fetch() this hostname from inside the Worker: Cloudflare's Custom-Domain
      // same-host fetch rule turns it into a 522.
      // See: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-522/
      const boundHost = proxyUrl.hostname;

      // Fern routes on x-fern-host, so it must be set to your bare domain.
      // request.headers is immutable — copy into a mutable Headers object.
      const fernHost = env?.FERN_HOST || boundHost;
      const headers = new Headers(request.headers);
      headers.set("x-fern-host", fernHost);

      const proxyInit: RequestInit = {
        method: request.method,
        headers,
        // Don't auto-follow. When an AI client sends `Accept: text/markdown`,
        // Fern returns a 303 with `Location: https://<boundHost>/<path>.md`.
        // Auto-following that re-enters this Worker on its own bound host,
        // which Cloudflare blocks with a 522. We follow it ourselves below,
        // rewriting the hostname back to the Fern upstream first.
        redirect: "manual",
      };
      if (request.method !== "GET" && request.method !== "HEAD" && request.body != null) {
        proxyInit.body = request.body;
      }

      // Rewrite to the Fern upstream (app.buildwithfern.com), keep the path.
      proxyUrl.protocol = origin.protocol;
      proxyUrl.hostname = origin.hostname;
      proxyUrl.port = origin.port;

      let currentRequest = new Request(proxyUrl.toString(), proxyInit);
      let response = await fetch(currentRequest);

      // Follow same-host redirects ourselves, rewriting the target back to the
      // Fern upstream so the next fetch isn't a same-host call from this Worker.
      // Cross-host redirects pass through unchanged (followed as-is).
      for (
        let hop = 0;
        hop < MAX_REDIRECTS && response.status >= 300 && response.status < 400;
        hop++
      ) {
        const location = response.headers.get("location");
        if (!location) break;

        let target: URL;
        try {
          target = new URL(location, currentRequest.url);
        } catch {
          break;
        }

        if (target.hostname === boundHost) {
          target.protocol = origin.protocol;
          target.hostname = origin.hostname;
          target.port = origin.port;
        }

        // 303 always converts to GET. 307/308 should preserve method, but the
        // docs site is read-only and only emits 303s today, so GET is correct
        // in practice and safe as the default.
        const nextHeaders = new Headers(headers);
        currentRequest = new Request(target.toString(), {
          method: "GET",
          headers: nextHeaders,
          redirect: "manual",
        });
        response = await fetch(currentRequest);
      }

      return response;
    } catch (e) {
      // Never crash - return error response instead
      const message = e instanceof Error ? e.message : "Unknown error";
      return new Response(`Proxy error: ${message}`, { status: 502 });
    }
  },
};
