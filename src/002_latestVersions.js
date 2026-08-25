// Step 2 -- pick the last good capture of every URL.
//
// Streams the CDX index and keeps, per URL, the newest capture that
//   * was taken before the cutoff from step 1,
//   * answered with a 2xx status.
// Everything else (redirects, 404s, placeholder-era captures) is dropped.
//
//   node src/002_latestVersions.js

import fs from "fs";
import { DIRS, FILES } from "./lib/config.js";
import { ensureDir, readLines, readJson, writeJson, formatCount } from "./lib/util.js";

const VAGUE_MIMES = new Set(["warc/revisit", "unk", "", "-"]);

async function main() {
  ensureDir(DIRS.index);

  const cutoffData = readJson(FILES.cutoff);
  if (!cutoffData) throw new Error(`missing ${FILES.cutoff} -- run step 001 first`);
  const cutoff = String(cutoffData.cutoff);
  console.log(`cutoff: ${cutoff}`);

  // urlkey -> best capture so far
  const best = new Map();
  // urlkey -> most recent concrete mime type, used to resolve revisit records
  const mimeHint = new Map();

  const stats = {
    captures: 0,
    afterCutoff: 0,
    notOk: 0,
    considered: 0,
    urlsSeen: new Set(),
  };

  let lines = 0;
  for await (const line of readLines(FILES.cdx)) {
    lines++;
    if (lines % 250_000 === 0) console.log(`   scanned ${formatCount(lines)} captures ...`);

    const [urlkey, timestamp, original, mimetype, statuscode, digest, length] = line.split(" ");
    if (!urlkey || !timestamp) continue;

    stats.captures++;
    stats.urlsSeen.add(urlkey);

    if (timestamp >= cutoff) {
      stats.afterCutoff++;
      continue;
    }
    if (!/^2\d\d$/.test(statuscode)) {
      stats.notOk++;
      continue;
    }

    stats.considered++;

    if (!VAGUE_MIMES.has(mimetype)) {
      const hint = mimeHint.get(urlkey);
      if (!hint || hint.ts < timestamp) mimeHint.set(urlkey, { ts: timestamp, mime: mimetype });
    }

    const current = best.get(urlkey);
    if (!current || timestamp > current.ts) {
      best.set(urlkey, { ts: timestamp, o: original, m: mimetype, d: digest, len: Number(length) || 0 });
    }
  }

  // Write the result, resolving revisit/unknown mime types from the hint map.
  const out = fs.createWriteStream(`${FILES.latest}.part`);
  let written = 0;
  let revisitResolved = 0;

  for (const urlkey of [...best.keys()].sort()) {
    const entry = best.get(urlkey);
    let mime = entry.m;
    if (VAGUE_MIMES.has(mime)) {
      const hint = mimeHint.get(urlkey);
      if (hint) {
        mime = hint.mime;
        revisitResolved++;
      }
    }
    const record = { k: urlkey, ts: entry.ts, d: entry.d, m: mime, o: entry.o, len: entry.len };
    if (!out.write(JSON.stringify(record) + "\n")) {
      await new Promise((r) => out.once("drain", r));
    }
    written++;
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(`${FILES.latest}.part`, FILES.latest);

  const urlsTotal = stats.urlsSeen.size;
  const meta = {
    cutoff,
    captures: stats.captures,
    capturesAfterCutoff: stats.afterCutoff,
    capturesNotOk: stats.notOk,
    capturesConsidered: stats.considered,
    urlsTotal,
    urlsWithGoodCapture: written,
    urlsWithoutGoodCapture: urlsTotal - written,
    mimeResolvedFromHistory: revisitResolved,
    generatedAt: new Date().toISOString(),
  };
  writeJson(FILES.latestMeta, meta);

  console.log(`
captures scanned .......... ${formatCount(stats.captures)}
  at/after cutoff ......... ${formatCount(stats.afterCutoff)}
  not 2xx ................. ${formatCount(stats.notOk)}
  usable .................. ${formatCount(stats.considered)}

distinct URLs ............. ${formatCount(urlsTotal)}
  with a good capture ..... ${formatCount(written)}
  without ................. ${formatCount(urlsTotal - written)}
  mime taken from history . ${formatCount(revisitResolved)}

wrote ${FILES.latest}`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
