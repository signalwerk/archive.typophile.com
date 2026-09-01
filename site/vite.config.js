import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseRoute } from "./lib/routes.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

// Render one page per request instead of the whole site.
//
// Nothing is prepared up front: the server starts at once, and a page costs
// only what that page needs. A thread reads one YAML file. Listings need the
// index of thread summaries, which is cached on disk, re-read only for files
// whose size or mtime changed, and then held in memory. Component edits go
// through Vite's normal module graph and need no data work at all.
function forumDevServer() {
  return {
    name: "typophile-dev",
    configureServer(server) {
      return () => {
        server.middlewares.use(async (req, res, next) => {
          const url = (req.originalUrl || req.url || "/").split("?")[0];
          if (url.startsWith("/@") || url.startsWith("/src/") || url.startsWith("/node_modules/")) {
            return next();
          }

          // Avatars live with the parsed data, not in the site tree; the static
          // build copies them into dist/pictures, so dev serves them from here.
          // Files posts embed or link to; the build copies these into dist.
          if (url.startsWith("/files/")) {
            const { FILES_DIR } = await server.ssrLoadModule("/lib/data.mjs");
            const file = path.join(FILES_DIR, decodeURIComponent(url.slice("/files/".length)));
            if (file.startsWith(path.resolve(FILES_DIR)) && fs.existsSync(file)) {
              return res.end(fs.readFileSync(file));
            }
            res.statusCode = 404;
            return res.end("no such file");
          }

          if (url.startsWith("/pictures/")) {
            const { PICTURES_DIR } = await server.ssrLoadModule("/lib/data.mjs");
            const name = path.basename(decodeURIComponent(url));
            const file = path.join(PICTURES_DIR, name);
            if (fs.existsSync(file)) {
              const ext = path.extname(name).toLowerCase();
              const type = ext === ".png" ? "image/png"
                : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
                : ext === ".gif" ? "image/gif" : "application/octet-stream";
              res.setHeader("Content-Type", type);
              return res.end(fs.readFileSync(file));
            }
            res.statusCode = 404;
            return res.end("no such picture");
          }
          const route = parseRoute(url);
          if (!route) return next();

          try {
            const { resolve } = await server.ssrLoadModule("/lib/resolve.mjs");
            const { buildIndex } = await server.ssrLoadModule("/lib/data.mjs");
            const { render } = await server.ssrLoadModule("/src/entry-server.jsx");

            // Built only if the route asks for it, and held in memory once it
            // has been; a thread page touches neither. See lib/data.mjs.
            const data = resolve(route, () => buildIndex({ quiet: true }));
            if (!data) {
              res.statusCode = 404;
              return res.end(`Not found: ${url}`);
            }

            const out = render(route, data);
            const template = fs.readFileSync(path.resolve(root, "index.html"), "utf8");
            const html = (await server.transformIndexHtml(url, template))
              .replace("<!--app-title-->", out.title)
              .replace("<!--app-html-->", out.html);

            res.setHeader("Content-Type", "text/html");
            res.end(html);
          } catch (err) {
            server.ssrFixStacktrace(err);
            next(err);
          }
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), forumDevServer()],
  appType: "custom",
  build: { outDir: "dist", emptyOutDir: true },
});
