const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "dist");
const port = Number(process.env.JINGTU_PREVIEW_PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

http.createServer((req, res) => {
  const clean = decodeURIComponent(req.url.split("?")[0]);
  const requested = clean === "/" ? "index.html" : clean.replace(/^\//, "");
  const file = path.resolve(root, requested);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, {"Content-Type": types[path.extname(file)] || "application/octet-stream"});
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => console.log(`Local: http://127.0.0.1:${port}`));
