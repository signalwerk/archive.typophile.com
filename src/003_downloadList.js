// Step 3 -- turn the chosen captures into concrete download jobs.
//
// Adds the Wayback replay URL and the local target path to every entry, and
// makes sure no two URLs claim the same file on disk.
//
//   node src/003_downloadList.js
//   node src/003_downloadList.js --include='/node/[0-9]+$' --mime=text/html
//   node src/003_downloadList.js --exclude='\.(css|js|gif)$'

import fs from "fs";
import crypto from "crypto";
import { DIRS, FILES } from "./lib/config.js";
import {
  ensureDir,
  readJsonl,
  readJson,
  writeJson,
  localPathFor,
  urlKeyToUrl,
  parseArgs,
  formatCount,
  formatBytes,
} from "./lib/util.js";

const args = parseArgs();

const include = args.include ? new RegExp(args.include) : null;
const exclude = args.exclude ? new RegExp(args.exclude) : null;
const mimes = args.mime ? new Set(String(args.mime).split(",").map((m) => m.trim())) : null;
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;

// `id_` asks the Wayback Machine for the untouched original response rather
// than the rewritten replay page. That keeps the archive faithful and -- since
// the CDX digest is the SHA-1 of exactly those bytes -- lets us verify every
// downloaded file byte for byte.
const replayUrl = (timestamp, url) => `https://web.archive.org/web/${timestamp}id_/${url}`;

async function main() {
  ensureDir(DIRS.index);

  if (!fs.existsSync(FILES.latest)) {
    throw new Error(`missing ${FILES.latest} -- run step 002 first`);
  }

  const taken = new Map(); // local path -> urlkey
  const jobs = [];
  const byMime = new Map();

  let read = 0;
  let filtered = 0;
  let collisions = 0;
  let bytes = 0;

  for await (const entry of readJsonl(FILES.latest)) {
    read++;

    if (include && !include.test(entry.k)) { filtered++; continue; }
    if (exclude && exclude.test(entry.k)) { filtered++; continue; }
    if (mimes && !mimes.has(entry.m)) { filtered++; continue; }
    if (jobs.length >= limit) { filtered++; continue; }

    const url = urlKeyToUrl(entry.k);
    let file = localPathFor(entry.k, entry.m);
    if (!url || !file) { filtered++; continue; }

    // Two different URLs can normalise onto one filename (e.g. `/foo` and
    // `/foo.html`). Keep the first and give the runner-up a short suffix.
    if (taken.has(file)) {
      const suffix = crypto.createHash("sha1").update(entry.k).digest("hex").slice(0, 8);
      const dot = file.lastIndexOf(".");
      file = dot > file.lastIndexOf("/") ? `${file.slice(0, dot)}~${suffix}${file.slice(dot)}` : `${file}~${suffix}`;
      collisions++;
    }
    taken.set(file, entry.k);

    byMime.set(entry.m, (byMime.get(entry.m) || 0) + 1);
    bytes += entry.len;

    jobs.push({
      k: entry.k,
      url,
      replay: replayUrl(entry.ts, url),
      ts: entry.ts,
      d: entry.d,
      m: entry.m,
      file,
    });
  }

  const out = fs.createWriteStream(`${FILES.downloads}.part`);
  for (const job of jobs) {
    if (!out.write(JSON.stringify(job) + "\n")) await new Promise((r) => out.once("drain", r));
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(`${FILES.downloads}.part`, FILES.downloads);

  const topMimes = [...byMime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  writeJson(FILES.downloadsMeta, {
    source: FILES.latest,
    cutoff: readJson(FILES.cutoff)?.cutoff ?? null,
    filters: {
      include: args.include ?? null,
      exclude: args.exclude ?? null,
      mime: args.mime ?? null,
      limit: Number.isFinite(limit) ? limit : null,
    },
    candidates: read,
    filteredOut: filtered,
    jobs: jobs.length,
    pathCollisionsResolved: collisions,
    approxArchivedBytes: bytes,
    mimeBreakdown: Object.fromEntries(topMimes),
    generatedAt: new Date().toISOString(),
  });

  console.log(`candidates ......... ${formatCount(read)}`);
  console.log(`filtered out ....... ${formatCount(filtered)}`);
  console.log(`download jobs ...... ${formatCount(jobs.length)}`);
  if (collisions) console.log(`name collisions .... ${formatCount(collisions)} (resolved with a hash suffix)`);
  console.log(`\nby mime type:`);
  for (const [mime, count] of topMimes) {
    console.log(`   ${String(count).padStart(8)}  ${mime}`);
  }
  console.log(`\nwrote ${FILES.downloads}`);
  console.log(`(archived size of these captures, compressed: ~${formatBytes(bytes)})`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
