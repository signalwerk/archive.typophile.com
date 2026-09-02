// Step 9 -- one line per thread, so a listing page never opens 62,469 files.
//
// A thread's YAML is almost entirely the HTML of its post and its comments. A
// listing wants none of that: a title, a date, a forum, a count. Finding those
// by reading every file takes about a minute, and the site used to pay it
// whenever its own cache was invalidated -- which step 8 did every single time,
// because storing html_clean rewrites all 62,469 files.
//
// So this is keyed on the fingerprint step 6 recorded for the capture each
// thread was built from, not on the size and date of the file. Cleaning
// rewrites the file but cannot change the capture it came from, so a cleaning
// pass now leaves the whole index standing and this step has nothing to do.
//
// The index is written in full every run, so it always describes the whole
// corpus rather than the increment this run happened to touch -- the same way
// step 7 writes the member index.
//
//   node src/009_threadIndex.js
//   node src/009_threadIndex.js --force     re-read every thread

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { DATA } from "./lib/config.js";
import { ARCHIVE_IDS } from "./lib/archives/index.js";
import { summarise, summaryVersion } from "./lib/summary.js";
import { parseArgs, formatCount, writeJson } from "./lib/util.js";

const args = parseArgs();
const force = Boolean(args.force);

const NODES_DIR = `${DATA}/parsed/nodes`;
const INDEX_FILE = `${NODES_DIR}/_index.jsonl`;
const META_FILE = `${DATA}/parsed/threads.meta.json`;
const PARSE_STATE = `${DATA}/parsed/state.json`;

// What a cached line has to match to still be good: the capture the thread was
// parsed from, the parser that read it, and the shape of a summary.
function keyFor(entry, version, stat) {
  if (entry?.fp && entry?.parser) return `${entry.fp}:${entry.parser}:${version}`;
  // No fingerprint recorded -- fall back to the file itself, which is right but
  // costs a re-read after every cleaning pass.
  return `size:${stat.size}:${Math.round(stat.mtimeMs)}:${version}`;
}

async function main() {
  if (!fs.existsSync(NODES_DIR)) throw new Error(`missing ${NODES_DIR} -- run step 006 first`);

  let parseState = {};
  try {
    parseState = JSON.parse(fs.readFileSync(PARSE_STATE, "utf8"));
  } catch {
    console.log(`no ${PARSE_STATE} -- falling back to file dates, which a cleaning pass invalidates`);
  }

  // Each line carries the key it was written under, so the index needs no
  // second file to say whether it is still current.
  const known = new Map();
  if (!force && fs.existsSync(INDEX_FILE)) {
    for (const line of fs.readFileSync(INDEX_FILE, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.id != null) known.set(entry.id, entry);
      } catch { /* torn line */ }
    }
  }

  const version = summaryVersion();
  const files = fs.readdirSync(NODES_DIR).filter((f) => /^\d+\.yaml$/.test(f));
  const lines = [];
  let reused = 0;
  let reread = 0;
  let unreadable = 0;

  for (const name of files) {
    const node = Number(name.slice(0, -5));
    const file = path.join(NODES_DIR, name);
    const key = keyFor(parseState[node], version, fs.statSync(file));

    const have = known.get(node);
    if (have && have.k === key) {
      lines.push(have);
      reused++;
      continue;
    }

    let doc;
    try {
      doc = YAML.parse(fs.readFileSync(file, "utf8"));
    } catch {
      unreadable++;
      continue;
    }
    if (!doc) { unreadable++; continue; }

    lines.push({ ...summarise(doc), k: key });
    reread++;
    if (reread % 2000 === 0) process.stdout.write(`\r  read ${formatCount(reread)} thread(s) ...`);
  }
  process.stdout.write("\r");

  const out = fs.createWriteStream(`${INDEX_FILE}.part`);
  for (const line of lines) out.write(`${JSON.stringify(line)}\n`);
  await new Promise((resolve) => out.end(resolve));
  fs.renameSync(`${INDEX_FILE}.part`, INDEX_FILE);

  // Which archive each published thread came from. The site says so on its
  // about page, and the number has to describe the pages that exist rather
  // than the captures that were selected: step 5 chose 66,645 and a handful
  // never made it through step 6, so counting the lines written here is the
  // only count that matches what a reader can open.
  //
  // Every archive is listed, zeros included. An archive holding nothing we
  // ended up using is a real finding about the recovery, not an entry to hide.
  const byArchive = Object.fromEntries(ARCHIVE_IDS.map((id) => [id, 0]));
  for (const line of lines) {
    const id = line.archive ?? "unknown";
    byArchive[id] = (byArchive[id] ?? 0) + 1;
  }
  writeJson(META_FILE, {
    threads: lines.length,
    byArchive,
    generatedAt: new Date().toISOString(),
  });

  const size = fs.statSync(INDEX_FILE).size;
  console.log(`threads ............. ${formatCount(files.length)}`);
  console.log(`  read now .......... ${formatCount(reread)}`);
  console.log(`  still current ..... ${formatCount(reused)}`);
  if (unreadable) console.log(`  unreadable ........ ${formatCount(unreadable)}`);
  console.log(`\nchosen from:`);
  for (const [id, n] of Object.entries(byArchive).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${id.padEnd(18)} ${formatCount(n)}`);
  }
  console.log(`\nwrote ${formatCount(lines.length)} line(s), ${(size / 1e6).toFixed(1)} MB -> ${INDEX_FILE}`);
  console.log(`wrote ${META_FILE}`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
