// Step 2 -- pick the last good capture of every URL, per archive.
//
// Keeps, for each URL in each archive, the newest capture that was taken
// before the global cutoff and answered with a 2xx status. The full capture
// metadata is carried through so the archives can be compared and merged
// later on.
//
//   node src/002_latestVersions.js
//   node src/002_latestVersions.js --archive=arquivo.pt

import fs from "fs";
import { archiveDirs, CUTOFF_FILE } from "./lib/config.js";
import { selectArchives } from "./lib/archives/index.js";
import { ensureDir, readJson, writeJson, parseArgs, formatCount } from "./lib/util.js";

const args = parseArgs();
const VAGUE_MIMES = new Set(["warc/revisit", "unk", "", "-", null, undefined]);

async function processArchive(archive, cutoff) {
  const dirs = archiveDirs(archive.id);
  ensureDir(dirs.index);

  const best = new Map();
  const mimeHint = new Map();
  const stats = { captures: 0, afterCutoff: 0, notOk: 0, considered: 0 };
  const urls = new Set();

  for await (const capture of archive.streamCaptures({ dirs })) {
    stats.captures++;
    urls.add(capture.k);

    if (capture.ts >= cutoff) { stats.afterCutoff++; continue; }
    if (!/^2\d\d$/.test(String(capture.s))) { stats.notOk++; continue; }
    stats.considered++;

    if (!VAGUE_MIMES.has(capture.m)) {
      const hint = mimeHint.get(capture.k);
      if (!hint || hint.ts < capture.ts) mimeHint.set(capture.k, { ts: capture.ts, mime: capture.m });
    }

    const current = best.get(capture.k);
    if (!current || capture.ts > current.ts) best.set(capture.k, capture);
  }

  const out = fs.createWriteStream(`${dirs.latest}.part`);
  let written = 0;
  let mimeResolved = 0;

  for (const key of [...best.keys()].sort()) {
    const capture = best.get(key);
    let mime = capture.m;
    if (VAGUE_MIMES.has(mime)) {
      const hint = mimeHint.get(key);
      if (hint) { mime = hint.mime; mimeResolved++; }
    }
    const record = {
      archive: archive.id,
      k: capture.k,
      ts: capture.ts,
      url: capture.url,
      m: mime,
      s: String(capture.s),
      d: capture.d,
      len: capture.len,
      ...(capture.extra ? { extra: capture.extra } : {}),
    };
    if (!out.write(JSON.stringify(record) + "\n")) await new Promise((r) => out.once("drain", r));
    written++;
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(`${dirs.latest}.part`, dirs.latest);

  writeJson(dirs.latestMeta, {
    archive: archive.id,
    cutoff,
    captures: stats.captures,
    capturesAfterCutoff: stats.afterCutoff,
    capturesNotOk: stats.notOk,
    capturesConsidered: stats.considered,
    urlsTotal: urls.size,
    urlsWithGoodCapture: written,
    urlsWithoutGoodCapture: urls.size - written,
    mimeResolvedFromHistory: mimeResolved,
    generatedAt: new Date().toISOString(),
  });

  return { stats, urls: urls.size, written };
}

async function main() {
  const cutoffData = readJson(CUTOFF_FILE);
  if (!cutoffData) throw new Error(`missing ${CUTOFF_FILE} -- run step 001 first`);
  const cutoff = String(cutoffData.cutoff);
  console.log(`global cutoff: ${cutoff}`);

  for (const archive of selectArchives(args.archive)) {
    console.log(`\n=== ${archive.label} ===`);
    const { stats, urls, written } = await processArchive(archive, cutoff);
    if (stats.captures === 0) {
      console.log(`   no index on disk -- run step 000 first`);
      continue;
    }
    console.log(`   captures ............. ${formatCount(stats.captures)}`);
    console.log(`     at/after cutoff .... ${formatCount(stats.afterCutoff)}`);
    console.log(`     not 2xx ............ ${formatCount(stats.notOk)}`);
    console.log(`   distinct URLs ........ ${formatCount(urls)}`);
    console.log(`   with a good capture .. ${formatCount(written)}`);
  }
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
