import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const host = "127.0.0.1";
const port = 4173;
const root = process.cwd();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function safePath(urlPath) {
  const pathname = urlPath === "/" ? "/index.html" : urlPath;
  const normalized = normalize(pathname)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
  return join(root, normalized);
}

createServer(async (request, response) => {
  try {
    const filePath = safePath(new URL(request.url, `http://${request.headers.host}`).pathname);
    const file = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "text/plain; charset=utf-8" });
    response.end(file);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found.");
  }
}).listen(port, host, () => {
  console.log(`Discipline Chronicle server running at http://${host}:${port}`);
});
