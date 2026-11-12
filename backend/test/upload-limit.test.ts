/** Checks that a file over the upload limit gets a clear 400 (not a reset connection) and that the limit is published. */
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: Server;
let port = 0;

beforeAll(async () => {
  process.env.MAX_UPLOAD_MB = "1";
  const { createApp } = await import("../src/app.js");
  server = createApp((req, _res, next) => { req.userRole = "hr"; req.userEmail = "hr@example.com"; next(); }).listen(0);
  port = (server.address() as AddressInfo).port;
});
afterAll(() => void server.close());

const BOUNDARY = "----limit";
const head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nroster\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="roster.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`;
const tail = `\r\n--${BOUNDARY}--\r\n`;

/** Streams a multipart upload in small slow chunks, like a slow link; resolves with the response or the socket error. */
function slowUpload(path: string, fileBytes: number, chunked = false) {
  return new Promise<{ status?: number; body?: string; error?: string }>((resolve) => {
    const total = head.length + fileBytes + tail.length;
    const req = httpRequest({ port, path, method: "POST", headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`, ...(chunked ? {} : { "content-length": String(total) }) } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", (e) => resolve({ error: (e as NodeJS.ErrnoException).code ?? e.message }));
    req.write(head);
    let sent = 0;
    const chunk = Buffer.alloc(64 * 1024, 1);
    const pump = () => {
      while (sent < fileBytes) {
        const n = Math.min(chunk.length, fileBytes - sent);
        sent += n;
        if (!req.write(chunk.subarray(0, n))) return void req.once("drain", () => setTimeout(pump, 1));
      }
      req.end(tail);
    };
    pump();
  });
}

describe("upload size limit", () => {
  it("publishes the limits so the page can check before sending", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/limits`);
    expect(await res.json()).toEqual({ maxUploadMb: 1, maxLeavesUploadMb: 10 });
  });

  it("a file within the limit is read (it is then refused only for its type)", async () => {
    const f = new FormData();
    f.set("kind", "roster");
    f.set("file", new Blob([new Uint8Array(10_000)]), "notes.txt");
    const res = await fetch(`http://127.0.0.1:${port}/api/uploads`, { method: "POST", body: f });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/\.csv or \.xlsx/);
  });

  it("a file over the limit gets a 400 that names the limit", async () => {
    const f = new FormData();
    f.set("kind", "roster");
    f.set("file", new Blob([new Uint8Array(2 * 1024 * 1024)]), "roster.xlsx");
    const res = await fetch(`http://127.0.0.1:${port}/api/uploads`, { method: "POST", body: f });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("File is too large (limit 1 MB)");
  });

  it("a slow upload far over the limit still receives the 400 (no connection reset)", async () => {
    const r = await slowUpload("/api/uploads", 8 * 1024 * 1024);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body!).error).toBe("File is too large (limit 1 MB)");
  });

  it("the same when the size is not declared up front (chunked body)", async () => {
    const r = await slowUpload("/api/uploads", 8 * 1024 * 1024, true);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body!).error).toBe("File is too large (limit 1 MB)");
  });

  it("the leaves upload keeps its own 10 MB limit", async () => {
    const r = await slowUpload("/api/leaves/upload", 11 * 1024 * 1024);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body!).error).toBe("File is too large (limit 10 MB)");
  });
});
