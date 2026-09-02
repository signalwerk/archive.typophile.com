// Step 12 -- publish recovered files that the site itself needs.
//
// Most recovered files are copied on demand while post HTML is cleaned. A
// few belong to the old site's interface instead, so no post necessarily
// refers to them. Keep those exceptions explicit here and preserve their old
// path below data/parsed; the site publishes that tree at the same URL.
//
//   node src/012_specialFiles.js

import fs from "fs";
import path from "path";
import { archiveDirs, DATA } from "./lib/config.js";
import { ARCHIVES } from "./lib/archives/index.js";
import { formatCount, writeFileAtomic } from "./lib/util.js";

const SPECIAL_FILES = [
  {
    key: "com,typophile)/misc/id_generic.gif",
    target: "misc/id_generic.gif",
  },
];

function findBestCaptures() {
  const wanted = new Set(SPECIAL_FILES.map((file) => file.key));
  const wantedKeys = [...wanted];
  const best = new Map();

  for (const archive of ARCHIVES) {
    const dirs = archiveDirs(archive.id);
    if (!fs.existsSync(dirs.downloadState)) continue;

    for (const line of fs.readFileSync(dirs.downloadState, "utf8").split("\n")) {
      if (!line || !wantedKeys.some((key) => line.includes(key))) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (!wanted.has(record.k) || !record.f) continue;

      const source = path.join(dirs.files, record.f);
      if (!fs.existsSync(source)) continue;

      const current = best.get(record.k);
      const better =
        !current ||
        (record.ok === true && !current.verified) ||
        ((record.ok === true) === current.verified && String(record.ts) > current.timestamp);
      if (better) {
        best.set(record.k, {
          source,
          timestamp: String(record.ts),
          verified: record.ok === true,
        });
      }
    }
  }

  return best;
}

function main() {
  const captures = findBestCaptures();
  let copied = 0;
  let unchanged = 0;

  for (const special of SPECIAL_FILES) {
    const capture = captures.get(special.key);
    if (!capture) {
      throw new Error(`missing downloaded capture for ${special.key}`);
    }

    const target = path.join(DATA, "parsed", special.target);
    const bytes = fs.readFileSync(capture.source);
    if (fs.existsSync(target) && fs.readFileSync(target).equals(bytes)) {
      unchanged++;
      continue;
    }

    writeFileAtomic(target, bytes);
    copied++;
  }

  console.log(`special files ...... ${formatCount(SPECIAL_FILES.length)}`);
  console.log(`  copied ........... ${formatCount(copied)}`);
  console.log(`  unchanged ........ ${formatCount(unchanged)}`);
  console.log(`\nspecial files -> ${DATA}/parsed/`);
}

try { main(); } catch (err) {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
}
