// Step 3 -- turn the chosen captures into concrete download jobs.
//
// Adds the local target path and, per archive, how the bytes are actually
// retrieved: a replay URL for the Wayback Machine and arquivo.pt, a WARC byte
// range for Common Crawl.
//
//   node src/003_downloadList.js
//   node src/003_downloadList.js --archive=arquivo.pt --include='/node/[0-9]+$'
//   node src/003_downloadList.js --exclude='\.(css|js|swf|gif)$'

import fs from "fs";
import crypto from "crypto";
import { archiveDirs, CUTOFF_FILE } from "./lib/config.js";
import { selectArchives } from "./lib/archives/index.js";
import {
  ensureDir, readJsonl, readJson, writeJson, localPathFor, timestampedCapturePath,
  parseArgs, formatCount, formatBytes,
} from "./lib/util.js";

const args = parseArgs();
const include = args.include ? new RegExp(args.include) : null;
const exclude = args.exclude ? new RegExp(args.exclude) : null;
const mimes = args.mime ? new Set(String(args.mime).split(",").map((m) => m.trim())) : null;
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;

async function processArchive(archive) {
  const dirs = archiveDirs(archive.id);
  ensureDir(dirs.index);

  if (!fs.existsSync(dirs.latest)) return null;

  const taken = new Map();
  const jobs = [];
  const byMime = new Map();
  let read = 0, filtered = 0, collisions = 0, bytes = 0;

  for await (const entry of readJsonl(dirs.latest)) {
    read++;
    if (include && !include.test(entry.k)) { filtered++; continue; }
    if (exclude && exclude.test(entry.k)) { filtered++; continue; }
    if (mimes && !mimes.has(entry.m)) { filtered++; continue; }
    if (jobs.length >= limit) { filtered++; continue; }

    let localPath = localPathFor(entry.k, entry.m);
    if (!localPath) { filtered++; continue; }

    // Two URLs can normalise onto one filename (`/foo` and `/foo.html`).
    // Resolve this before adding the timestamp, otherwise two colliding URLs
    // captured at different moments would silently lose their stable suffix.
    if (taken.has(localPath)) {
      const suffix = crypto.createHash("sha1").update(entry.k).digest("hex").slice(0, 8);
      const dot = localPath.lastIndexOf(".");
      localPath = dot > localPath.lastIndexOf("/")
        ? `${localPath.slice(0, dot)}~${suffix}${localPath.slice(dot)}`
        : `${localPath}~${suffix}`;
      collisions++;
    }
    taken.set(localPath, entry.k);

    const file = timestampedCapturePath(entry.ts, localPath);
    if (!file) { filtered++; continue; }

    byMime.set(entry.m, (byMime.get(entry.m) || 0) + 1);
    bytes += entry.len || 0;

    jobs.push({ ...entry, file, fetch: archive.buildFetch(entry) });
  }

  const out = fs.createWriteStream(`${dirs.downloads}.part`);
  for (const job of jobs) {
    if (!out.write(JSON.stringify(job) + "\n")) await new Promise((r) => out.once("drain", r));
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(`${dirs.downloads}.part`, dirs.downloads);

  const topMimes = [...byMime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  writeJson(dirs.downloadsMeta, {
    archive: archive.id,
    cutoff: readJson(CUTOFF_FILE)?.cutoff ?? null,
    filters: {
      include: args.include ?? null, exclude: args.exclude ?? null,
      mime: args.mime ?? null, limit: Number.isFinite(limit) ? limit : null,
    },
    candidates: read,
    filteredOut: filtered,
    jobs: jobs.length,
    pathCollisionsResolved: collisions,
    approxArchivedBytes: bytes,
    mimeBreakdown: Object.fromEntries(topMimes),
    generatedAt: new Date().toISOString(),
  });

  return { read, filtered, jobs: jobs.length, collisions, bytes, topMimes };
}

async function main() {
  for (const archive of selectArchives(args.archive)) {
    console.log(`\n=== ${archive.label} ===`);
    const result = await processArchive(archive);
    if (!result) { console.log(`   no latest.jsonl -- run step 002 first`); continue; }
    console.log(`   candidates ..... ${formatCount(result.read)}`);
    console.log(`   filtered out ... ${formatCount(result.filtered)}`);
    console.log(`   download jobs .. ${formatCount(result.jobs)}`);
    if (result.collisions) console.log(`   name collisions  ${formatCount(result.collisions)} (resolved)`);
    console.log(`   archived size .. ~${formatBytes(result.bytes)}`);
    for (const [mime, count] of result.topMimes.slice(0, 5)) {
      console.log(`      ${String(count).padStart(7)}  ${mime}`);
    }
  }
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
