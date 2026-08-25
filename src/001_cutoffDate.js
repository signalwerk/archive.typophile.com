// Step 1 -- find the moment typophile.com went offline.
//
// From that timestamp onward the Wayback Machine only holds placeholder
// pages, so every later capture is worthless. We stream the CDX index and
// look for captures whose digest matches a known placeholder.
//
//   node src/001_cutoffDate.js

import { DIRS, FILES, OFFLINE_HASHES, CUTOFF_OVERRIDE } from "./lib/config.js";
import { ensureDir, readLines, writeJson, formatCount } from "./lib/util.js";

function formatTimestamp(ts) {
  if (!ts || ts === "none") return "n/a";
  const s = String(ts);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}

async function main() {
  ensureDir(DIRS.index);

  // Per placeholder digest: how often it appears and when.
  const seen = new Map();
  for (const digest of Object.keys(OFFLINE_HASHES)) {
    seen.set(digest, { count: 0, first: null, last: null, firstUrl: null });
  }

  let lines = 0;
  for await (const line of readLines(FILES.cdx)) {
    lines++;
    const fields = line.split(" ");
    const hit = seen.get(fields[5]);
    if (hit) {
      hit.count++;
      const ts = fields[1];
      if (hit.first === null || ts < hit.first) {
        hit.first = ts;
        hit.firstUrl = fields[0];
      }
      if (hit.last === null || ts > hit.last) hit.last = ts;
    }
    if (lines % 250_000 === 0) console.log(`   scanned ${formatCount(lines)} captures ...`);
  }

  const hits = [...seen.entries()]
    .map(([digest, info]) => ({ digest, label: OFFLINE_HASHES[digest], ...info }))
    .sort((a, b) => (a.first || "9").localeCompare(b.first || "9"));

  console.log(`\nscanned ${formatCount(lines)} captures\n`);
  console.log("placeholder captures found:");
  for (const hit of hits) {
    console.log(
      `   ${hit.count ? String(hit.count).padStart(6) : "     0"}x  ` +
        `${formatTimestamp(hit.first)} .. ${formatTimestamp(hit.last)}  ${hit.label}`
    );
  }

  const found = hits.filter((h) => h.count > 0);
  let cutoff;

  if (CUTOFF_OVERRIDE) {
    cutoff = String(CUTOFF_OVERRIDE);
    console.log(`\nusing CUTOFF_OVERRIDE from config`);
  } else if (found.length === 0) {
    cutoff = "99999999999999";
    console.log(`\nno placeholder captures matched -- keeping every capture`);
  } else {
    cutoff = found[0].first;
  }

  const earliest = found[0];
  console.log(`\ncutoff: ${cutoff} (${formatTimestamp(cutoff)})`);
  if (earliest && !CUTOFF_OVERRIDE) {
    console.log(`   first seen on: ${earliest.firstUrl}`);
    console.log(`   placeholder:   ${earliest.label}`);
  }
  console.log(`   captures at or after the cutoff will be ignored`);

  writeJson(FILES.cutoff, {
    cutoff,
    override: CUTOFF_OVERRIDE ?? null,
    scannedCaptures: lines,
    placeholders: hits,
    generatedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
