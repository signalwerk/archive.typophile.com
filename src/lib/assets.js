// Files that posts point at -- the images people embedded and the specimens
// they attached, all under /files/ on the old site.
//
// Where we recovered one, it is copied into the parsed data and the post is
// pointed at our copy. Where we did not, the tag is left exactly as it was:
// a dead link is honest, a rewritten one that leads nowhere is not.

import fs from "fs";
import path from "path";
import { archiveDirs, DATA } from "./config.js";
import { ARCHIVES } from "./archives/index.js";
import { ensureDirCached } from "./util.js";

export const ASSETS_DIR = `${DATA}/parsed/files`;

const ASSET_KEY = /^com,typophile\)(\/files\/[^?]*)$/;

// urlkey -> the best copy we hold of that file.
export function buildAssetIndex() {
  const best = new Map();

  for (const archive of ARCHIVES) {
    const dirs = archiveDirs(archive.id);
    if (!fs.existsSync(dirs.downloadState)) continue;

    for (const line of fs.readFileSync(dirs.downloadState, "utf8").split("\n")) {
      if (!line || !line.includes(")/files/")) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (!r.f || !ASSET_KEY.test(r.k || "")) continue;

      const source = path.join(dirs.files, r.f);
      if (!fs.existsSync(source)) continue;

      const current = best.get(r.k);
      // A verified copy beats an unverified one; otherwise the most recent.
      const better =
        !current ||
        (r.ok === true && !current.verified) ||
        ((r.ok === true) === current.verified && String(r.ts) > current.ts);
      if (!better) continue;

      // The stored path already went through the same sanitising the
      // downloader used, so reuse it rather than rebuilding one from the URL.
      const rel = r.f.split("/").slice(1).join("/");
      best.set(r.k, { source, rel, ts: String(r.ts), verified: r.ok === true });
    }
  }
  return best;
}

// Copies on first use and answers with the address to point at, or null when
// we do not hold the file.
export function makeAssetResolver(index, stats) {
  const copied = new Map();

  return (pathname) => {
    const key = `com,typophile)${pathname.toLowerCase()}`;
    const hit = index.get(key);
    if (!hit) return null;

    if (!copied.has(key)) {
      const target = path.join(ASSETS_DIR, hit.rel.replace(/^files\//, ""));
      try {
        const src = fs.statSync(hit.source);
        if (!fs.existsSync(target) || fs.statSync(target).size !== src.size) {
          ensureDirCached(path.dirname(target));
          fs.copyFileSync(hit.source, target);
          stats.copied++;
        }
        copied.set(key, `/${hit.rel}`);
      } catch {
        copied.set(key, null);
      }
    }
    return copied.get(key);
  };
}
