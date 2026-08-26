import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseRoute } from "./lib/routes.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

// Render one page per request instead of the whole site.
//
// The index of thread summaries is cached on disk and only re-read for files
// whose size or mtime changed, so editing a single thread's YAML costs one
// re-read -- not eleven thousand. Component edits go through Vite's normal
// module graph and need no data work at all.
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

            // Cheap after the first call; see lib/data.mjs.
            const index = buildIndex({ quiet: true });
            const data = resolve(route, index);
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
