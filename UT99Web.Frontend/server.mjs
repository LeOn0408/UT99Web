import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = here;
const port = Number(process.env.PORT || 8124);
const backend = new URL(process.env.UT99WEB_BACKEND_URL || "http://localhost:8123");
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".utx", "application/octet-stream"],
  [".u", "application/octet-stream"],
  [".uax", "application/octet-stream"],
  [".umx", "application/octet-stream"],
  [".unr", "application/octet-stream"],
  [".uz", "application/octet-stream"]
]);

function proxy(request, response) {
  const target = new URL(request.url, backend);
  const forward = http.request({
    protocol: backend.protocol,
    hostname: backend.hostname,
    port: backend.port,
    path: target.pathname + target.search,
    method: request.method,
    headers: { ...request.headers, host: backend.host }
  }, (upstream) => {
    response.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(response);
  });
  forward.on("error", () => {
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end("Backend unavailable");
  });
  request.pipe(forward);
}

const server = http.createServer((request, response) => {
  if (request.url?.startsWith("/api/")) {
    proxy(request, response);
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") {
    response.writeHead(302, { location: "/web/viewer.html" });
    response.end();
    return;
  }
  const filePath = path.join(root, pathname);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": types.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "content-length": stats.size,
      "cache-control": "no-store",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
      "x-content-type-options": "nosniff"
    });
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, () => {
  console.log(`UT99Web frontend (Node + Three.js): http://localhost:${port}/web/viewer.html`);
});
