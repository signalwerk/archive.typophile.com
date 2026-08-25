// Step 1 -- find the moment typophile.com went offline.
//
// The cutoff is deliberately GLOBAL rather than per-archive: the site died
// once. Archives that never captured a placeholder page (arquivo.pt has
// captures running into 2018) would otherwise keep post-mortem junk.
//
// Because every archive reports the same base32 SHA-1 payload digest, one
// list of placeholder checksums identifies the same dead pages everywhere.
//
//   node src/001_cutoffDate.js

import { archiveDirs, CUTOFF_FILE, OFFLINE_HASHES, CUTOFF_OVERRIDE, DATA } from "./lib/config.js";
import { ARCHIVES } from "./lib/archives/index.js";
import { ensureDir, writeJson, formatCount } from "./lib/util.js";

function formatTimestamp(ts) {
  if (!ts) return "n/a";
  const s = String(ts);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}

async function main() {
  ensureDir(DATA);

  const perArchive = [];
  const global = new Map();
  for (const digest of Object.keys(OFFLINE_HASHES)) {
    global.set(digest, { count: 0, first: null, last: null, firstUrl: null });
  }

  for (const archive of ARCHIVES) {
    const dirs = archiveDirs(archive.id);
    const seen = new Map();
    for (const digest of Object.keys(OFFLINE_HASHES)) {
      seen.set(digest, { count: 0, first: null, last: null, firstUrl: null });
    }

    let captures = 0;
    for await (const capture of archive.streamCaptures({ dirs })) {
      captures++;
      const hit = seen.get(capture.d);
      if (!hit) continue;
      for (const target of [hit, global.get(capture.d)]) {
        target.count++;
        if (target.first === null || capture.ts < target.first) {
          target.first = capture.ts;
          target.firstUrl = capture.k;
        }
        if (target.last === null || capture.ts > target.last) target.last = capture.ts;
      }
    }

    const found = [...seen.entries()]
      .filter(([, v]) => v.count > 0)
      .map(([digest, v]) => ({ digest, label: OFFLINE_HASHES[digest], ...v }))
      .sort((a, b) => a.first.localeCompare(b.first));

    perArchive.push({ archive: archive.id, captures, placeholders: found });

    console.log(`\n=== ${archive.label} ===`);
    if (captures === 0) {
      console.log(`   no index on disk yet -- run step 000 first`);
      continue;
    }
    console.log(`   ${formatCount(captures)} captures scanned`);
    if (found.length === 0) {
      console.log(`   no placeholder captures found`);
    } else {
      for (const hit of found) {
        console.log(
          `   ${String(hit.count).padStart(6)}x  ${formatTimestamp(hit.first)} .. ` +
            `${formatTimestamp(hit.last)}  ${hit.label}`
        );
      }
    }
  }

  const allFound = [...global.entries()]
    .filter(([, v]) => v.count > 0)
    .map(([digest, v]) => ({ digest, label: OFFLINE_HASHES[digest], ...v }))
    .sort((a, b) => a.first.localeCompare(b.first));

  let cutoff;
  if (CUTOFF_OVERRIDE) {
    cutoff = String(CUTOFF_OVERRIDE);
  } else if (allFound.length === 0) {
    cutoff = "99999999999999";
  } else {
    cutoff = allFound[0].first;
  }

  console.log(`\n=== global cutoff ===`);
  console.log(`   ${cutoff} (${formatTimestamp(cutoff)})`);
  if (CUTOFF_OVERRIDE) {
    console.log(`   from CUTOFF_OVERRIDE in src/lib/config.js`);
  } else if (allFound.length === 0) {
    console.log(`   no placeholders anywhere -- keeping every capture`);
  } else {
    console.log(`   first seen on: ${allFound[0].firstUrl}`);
    console.log(`   placeholder:   ${allFound[0].label}`);
  }
  console.log(`   captures at or after this are ignored in every archive`);

  writeJson(CUTOFF_FILE, {
    cutoff,
    override: CUTOFF_OVERRIDE ?? null,
    placeholders: allFound,
    perArchive,
    generatedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
