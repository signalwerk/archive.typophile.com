// Static build: client assets, then one HTML file per route.
//
//   node scripts/build.mjs            everything
//   node scripts/build.mjs --limit=50 a quick subset, for checking output
//
// The template comes from the built index.html so every page links the same
// hashed stylesheet Vite just emitted.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(root, "dist");
const SSR_DIST = path.join(root, "dist-ssr");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const limit = args.limit ? Number(args.limit) : Infinity;

function writePage(routePath, html) {
  const dir = path.join(DIST, routePath === "/" ? "" : routePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
}

async function main() {
  const started = Date.now();

  console.log("building client assets ...");
  await build({ root, logLevel: "warn" });

  console.log("building server bundle ...");
  await build({
    root,
    logLevel: "warn",
    build: {
      ssr: "src/entry-server.jsx",
      outDir: "dist-ssr",
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: "entry-server.js" } },
    },
  });

  const template = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  const { render } = await import(path.join(SSR_DIST, "entry-server.js"));
  const { buildIndex } = await import(path.join(root, "lib/data.mjs"));
  const { resolve } = await import(path.join(root, "lib/resolve.mjs"));
  const { routeToPath } = await import(path.join(root, "lib/routes.mjs"));
  const { PER_PAGE } = await import(path.join(root, "lib/data.mjs"));

  console.log("reading parsed threads ...");
  const index = buildIndex();

  // Every route the site has.
  const routes = [];
  const indexPages = Math.max(1, Math.ceil(index.threads.length / PER_PAGE));
  for (let p = 1; p <= indexPages; p++) routes.push({ type: "index", page: p });
  for (const forum of index.forums) {
    const n = index.threads.filter((t) => t.forum === forum.id).length;
    const pages = Math.max(1, Math.ceil(n / PER_PAGE));
    for (let p = 1; p <= pages; p++) routes.push({ type: "forum", forum: forum.id, page: p });
  }
  for (const t of index.threads) routes.push({ type: "thread", node: t.id });

  const total = Math.min(routes.length, limit);
  console.log(`rendering ${total.toLocaleString("en-US")} pages ...`);

  let done = 0;
  let skipped = 0;
  for (const route of routes) {
    if (done + skipped >= limit) break;
    const data = resolve(route, index);
    if (!data) { skipped++; continue; }
    const out = render(route, data);
    writePage(
      routeToPath(route),
      template.replace("<!--app-title-->", out.title).replace("<!--app-html-->", out.html)
    );
    done++;
    if (done % 2000 === 0) process.stdout.write(`\r   ${done.toLocaleString("en-US")} / ${total.toLocaleString("en-US")}`);
  }
  process.stdout.write("\r");

  // GitHub Pages: custom domain, and no Jekyll processing of the output.
  fs.writeFileSync(path.join(DIST, "CNAME"), "typophile.signalwerk.ch\n");
  fs.writeFileSync(path.join(DIST, ".nojekyll"), "");
  // Anything unknown falls back to the index rather than GitHub's 404 page.
  fs.copyFileSync(path.join(DIST, "index.html"), path.join(DIST, "404.html"));

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`wrote ${done.toLocaleString("en-US")} pages to dist/ in ${secs}s`);
  if (skipped) console.log(`skipped ${skipped} route(s) with no data`);
}

main().catch((err) => {
  console.error(`\nbuild failed: ${err.stack || err.message}`);
  process.exit(1);
});
