// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, setCsrf, streamChat, type StreamEvent } from "./api";

const stream = (chunks: string[], status = 200) => {
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
};

afterEach(() => vi.restoreAllMocks());

describe("streamChat", () => {
  it("rearma eventos partidos entre chunks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => stream(['event: delta\ndata: {"text":"Ho', 'la"}\n\nevent: done\ndata: {"answer":"Hola"}\n\n'])));
    const seen: StreamEvent[] = [];
    await streamChat({ message: "x" }, (e) => seen.push(e));
    expect(seen).toEqual([{ event: "delta", data: { text: "Hola" } }, { event: "done", data: { answer: "Hola" } }]);
  });

  it("lanza ApiError con el código cuando el servidor rechaza antes de empezar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 })));
    await expect(streamChat({ message: "x" }, () => {})).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("no revienta con acentos y emojis partidos en bytes", async () => {
    const payload = new TextEncoder().encode('event: delta\ndata: {"text":"¿Vacaciones? 😊"}\n\n');
    const enc = (a: Uint8Array) => a;
    const body = new ReadableStream({ start(c) { c.enqueue(enc(payload.slice(0, 31))); c.enqueue(enc(payload.slice(31))); c.close(); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    const seen: StreamEvent[] = [];
    await streamChat({}, (e) => seen.push(e));
    expect(seen[0]).toEqual({ event: "delta", data: { text: "¿Vacaciones? 😊" } });
  });
});

describe("api", () => {
  it("manda el token CSRF solo en escrituras", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setCsrf("tok");
    await api("GET", "/api/x");
    await api("POST", "/api/x", {});
    const [get, post] = fetchMock.mock.calls.map((c) => (c as any)[1].headers);
    expect(get["X-CSRF-Token"]).toBeUndefined();
    expect(post["X-CSRF-Token"]).toBe("tok");
  });

  it("traduce errores de validación en un mensaje claro", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: [{ msg: "x" }] }), { status: 422 })));
    await expect(api("POST", "/api/x", {})).rejects.toBeInstanceOf(ApiError);
    await expect(api("POST", "/api/x", {})).rejects.toThrow(/Revisá los datos/);
  });

  it("avisa cuando no hay conexión", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fail"); }));
    await expect(api("GET", "/api/x")).rejects.toThrow(/No pude conectarme/);
  });
});
