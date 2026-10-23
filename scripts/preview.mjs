import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { output, siteFiles } from "./build.mjs";

export const basePath = "/daily-beta-pages/";
const files = new Set([...siteFiles, ".nojekyll"]);

export function createPreviewServer() {
  return createServer({ maxHeaderSize: 8192, requestTimeout: 15000 }, async (request, response) => {
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }
    let path;
    try { path = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { response.writeHead(400).end("Invalid URL"); return; }
    if (path === "/") {
      response.writeHead(302, { Location: basePath }).end();
      return;
    }
    const file = path.startsWith(basePath) ? path.slice(basePath.length) || "index.html" : null;
    if (!files.has(file)) { response.writeHead(404).end("Not found"); return; }
    try {
      const data = await readFile(new URL(file, output));
      const type = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/plain";
      response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Content-Length": data.length });
      response.end(request.method === "HEAD" ? undefined : data);
    } catch (error) {
      console.error("Could not serve preview asset:", error);
      response.writeHead(500).end("Preview asset unavailable. Run npm run build.");
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length > 2) throw new Error("The preview is local-only; server arguments are not supported.");
  if (process.env.HOST !== undefined && !["127.0.0.1", "localhost"].includes(process.env.HOST)) throw new Error("The preview is local-only; remove the HOST override.");
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
  const server = createPreviewServer();
  server.on("error", (error) => { console.error(`Could not start local preview: ${error.message}`); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`Local preview: http://127.0.0.1:${port}${basePath}`));
}
