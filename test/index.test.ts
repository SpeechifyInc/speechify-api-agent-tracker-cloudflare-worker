import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@usesapient/agent-tracker/cloudflare", () => ({
  trackRequest: vi.fn(),
}));

import worker from "../src";

const baseEnv = {
  SAPIENT_API_KEY: "",
  ORIGIN_URL: "https://app.buildwithfern.com",
  FERN_HOST: "docs.example.com",
};

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function call(url: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(url, init), baseEnv as never, ctx);
}

describe("worker proxy", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("returns non-3xx responses unchanged with a single upstream fetch", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("<html>OK</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const res = await call("https://docs.example.com/foo");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>OK</html>");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sets redirect: manual on the upstream fetch (prevents CF same-host trap)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await call("https://docs.example.com/foo");

    const req = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(req.redirect).toBe("manual");
  });

  it("sets x-fern-host on the upstream fetch", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await call("https://docs.example.com/foo");

    const req = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(req.headers.get("x-fern-host")).toBe("docs.example.com");
  });

  it("rewrites the request URL to ORIGIN_URL's hostname, preserving path", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await call("https://docs.example.com/foo/bar");

    const req = fetchSpy.mock.calls[0]?.[0] as Request;
    const url = new URL(req.url);
    expect(url.hostname).toBe("app.buildwithfern.com");
    expect(url.pathname).toBe("/foo/bar");
  });

  it("rewrites same-host 303 Location back to the Fern upstream and re-fetches", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: { location: "https://docs.example.com/foo.md" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("# hello", {
          status: 200,
          headers: { "content-type": "text/markdown" },
        }),
      );

    const res = await call("https://docs.example.com/foo", {
      headers: { accept: "text/markdown" },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("# hello");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const follow = fetchSpy.mock.calls[1]?.[0] as Request;
    const followUrl = new URL(follow.url);
    expect(followUrl.hostname).toBe("app.buildwithfern.com");
    expect(followUrl.pathname).toBe("/foo.md");
    expect(follow.headers.get("x-fern-host")).toBe("docs.example.com");
    expect(follow.redirect).toBe("manual");
    expect(follow.method).toBe("GET");
  });

  it("follows cross-host 3xx unchanged (no hostname rewrite)", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://external.example.org/elsewhere" },
        }),
      )
      .mockResolvedValueOnce(new Response("external content", { status: 200 }));

    const res = await call("https://docs.example.com/foo");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("external content");

    const follow = fetchSpy.mock.calls[1]?.[0] as Request;
    expect(new URL(follow.url).hostname).toBe("external.example.org");
  });

  it("stops at MAX_REDIRECTS and returns the last 3xx instead of looping", async () => {
    for (let i = 0; i < 10; i++) {
      fetchSpy.mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: { location: `https://docs.example.com/loop${i}.md` },
        }),
      );
    }

    const res = await call("https://docs.example.com/foo", {
      headers: { accept: "text/markdown" },
    });

    expect(res.status).toBe(303);
    // 1 initial + at most 5 follow hops = 6 max
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("returns a 3xx with no Location header as-is", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 304 }));

    const res = await call("https://docs.example.com/foo");

    expect(res.status).toBe(304);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves relative Location against the current upstream URL", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: { location: "/foo.md" },
        }),
      )
      .mockResolvedValueOnce(new Response("# hello", { status: 200 }));

    await call("https://docs.example.com/foo");

    const follow = fetchSpy.mock.calls[1]?.[0] as Request;
    const followUrl = new URL(follow.url);
    expect(followUrl.hostname).toBe("app.buildwithfern.com");
    expect(followUrl.pathname).toBe("/foo.md");
  });

  it("converts non-GET method to GET on 303 follow-up (HTTP spec)", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: { location: "https://docs.example.com/foo.md" },
        }),
      )
      .mockResolvedValueOnce(new Response("body", { status: 200 }));

    await call("https://docs.example.com/foo", { method: "POST" });

    const follow = fetchSpy.mock.calls[1]?.[0] as Request;
    expect(follow.method).toBe("GET");
  });
});
