// Step 5 -- choose which archived copy of each /node/<id> page to parse.
//
// The same thread may exist in all three archives at different dates. We take
// the LATEST capture, because a later capture of a forum thread carries more
// replies -- with one exception: a capture that is not a whole document loses
// to a complete older one.
//
// Each choice carries a fingerprint over everything that could change the
// parse, so step 6 can tell in one comparison whether its YAML is still
// current -- including the case where the same archive and timestamp were
// re-downloaded and produced different bytes.
//
//   node src/005_selectNodes.js
//   node src/005_selectNodes.js --prefer-latest   purely newest, ignore soundness

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { archiveDirs, DATA } from "./lib/config.js";
import { ARCHIVES } from "./lib/archives/index.js";
import { ensureDir, readJsonl, writeJson, parseArgs, formatCount } from "./lib/util.js";

const args = parseArgs();
const preferLatest = Boolean(args["prefer-latest"]);

const OUT = `${DATA}/combined`;
const OUT_FILE = `${OUT}/nodes.jsonl`;
const NODE_KEY = /^com,typophile\)\/node\/(\d+)$/;

// Is this capture a whole document?
//
//   * `truncated`  -- the archive itself recorded that it cut the record short.
//   * unverified originals -- the bytes did not match the digest and no better
//     copy was found. On the Wayback Machine this is usually a damaged record
//     whose HTML stops mid-tag, so it cannot be trusted to be complete.
//   * `rewritten`  -- recovered through the ordinary replay. Not byte-verifiable
//     (its URLs were rewritten) but the document IS whole, so it stays eligible.
function isSound(c) {
  if (c.truncated) return false;
  if (c.verified) return true;
  return c.source === "rewritten";
}

// Everything that would make the parsed result differ.
function fingerprint(c) {
  return crypto
    .createHash("sha1")
    .update([c.archive, c.ts, c.digest, c.file, c.size, c.source, c.truncated, c.verified].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function loadPrevious(file) {
  const previous = new Map();
  if (!fs.existsSync(file)) return previous;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try { const r = JSON.parse(line); previous.set(r.node, r.fp); } catch { /* torn line */ }
  }
  return previous;
}

function loadState(dirs) {
  const state = new Map();
  if (!fs.existsSync(dirs.downloadState)) return state;
  for (const line of fs.readFileSync(dirs.downloadState, "utf8").split("\n")) {
    if (!line) continue;
    try { const r = JSON.parse(line); state.set(r.k, r); } catch { /* torn line */ }
  }
  return state;
}

async function main() {
  ensureDir(OUT);

  // nodeId -> candidate captures
  const candidates = new Map();
  const perArchive = {};

  for (const archive of ARCHIVES) {
    const dirs = archiveDirs(archive.id);
    perArchive[archive.id] = { indexed: 0, onDisk: 0, truncated: 0 };
    if (!fs.existsSync(dirs.latest)) continue;

    const state = loadState(dirs);

    for await (const entry of readJsonl(dirs.latest)) {
      const m = NODE_KEY.exec(entry.k);
      if (!m) continue;
      if (entry.m && !/html/i.test(entry.m)) continue;
      perArchive[archive.id].indexed++;

      const known = state.get(entry.k);
      const file = path.join(dirs.files, known?.f ?? "");
      if (!known?.f || !fs.existsSync(file)) continue;
      perArchive[archive.id].onDisk++;

      const truncated = Boolean(known.truncated);
      if (truncated) perArchive[archive.id].truncated++;

      const nodeId = Number(m[1]);
      if (!candidates.has(nodeId)) candidates.set(nodeId, []);
      candidates.get(nodeId).push({
        node: nodeId,
        archive: archive.id,
        ts: entry.ts,
        url: entry.url,
        digest: entry.d,
        verified: known.ok === true,
        truncated,
        source: known.source ?? "original",
        file,
        size: known.size ?? null,
      });
    }
  }

  const previous = loadPrevious(OUT_FILE);
  const chosen = [];
  const contributions = {};
  let soundnessSwaps = 0;
  let onlyUnsound = 0;
  let added = 0;
  let changed = 0;
  let unchanged = 0;

  for (const [nodeId, list] of [...candidates.entries()].sort((a, b) => a[0] - b[0])) {
    const byLatest = [...list].sort((a, b) => b.ts.localeCompare(a.ts));

    let pick;
    if (preferLatest) {
      pick = byLatest[0];
    } else {
      const sound = byLatest.filter(isSound);
      if (sound.length) {
        pick = sound[0];
        if (!isSound(byLatest[0])) soundnessSwaps++;
      } else {
        pick = byLatest[0];
        onlyUnsound++;
      }
    }

    const fp = fingerprint(pick);
    const before = previous.get(nodeId);
    if (before === undefined) added++;
    else if (before !== fp) changed++;
    else unchanged++;

    contributions[pick.archive] = (contributions[pick.archive] || 0) + 1;
    chosen.push({ ...pick, sound: isSound(pick), candidates: list.length, fp });
  }

  // A node that used to have a copy and no longer does keeps its old YAML;
  // say so rather than leaving it to be discovered later.
  const gone = [...previous.keys()].filter((n) => !candidates.has(n)).length;

  const out = fs.createWriteStream(`${OUT_FILE}.part`);
  for (const c of chosen) {
    if (!out.write(JSON.stringify(c) + "\n")) await new Promise((r) => out.once("drain", r));
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(`${OUT_FILE}.part`, OUT_FILE);

  writeJson(`${OUT}/nodes.meta.json`, {
    nodes: chosen.length,
    strategy: preferLatest ? "latest capture" : "latest sound capture",
    contributions,
    added, changed, unchanged, disappeared: gone,
    soundnessSwaps,
    onlyUnsoundAvailable: onlyUnsound,
    perArchive,
    generatedAt: new Date().toISOString(),
  });

  console.log(`node pages available per archive:`);
  for (const [id, s] of Object.entries(perArchive)) {
    console.log(`   ${id.padEnd(18)} indexed ${String(formatCount(s.indexed)).padStart(7)}   downloaded ${String(formatCount(s.onDisk)).padStart(7)}   truncated ${formatCount(s.truncated)}`);
  }
  console.log(`\ndistinct nodes ....... ${formatCount(chosen.length)}`);
  console.log(`chosen from:`);
  for (const [id, n] of Object.entries(contributions).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${id.padEnd(18)} ${formatCount(n)}`);
  }
  if (soundnessSwaps) console.log(`\ntook an older whole copy over an incomplete newer one: ${formatCount(soundnessSwaps)}`);
  if (onlyUnsound) console.log(`only an incomplete copy exists: ${formatCount(onlyUnsound)}`);

  console.log(`\nsince the last run:`);
  console.log(`   new nodes ........ ${formatCount(added)}`);
  console.log(`   changed copy ..... ${formatCount(changed)}`);
  console.log(`   unchanged ........ ${formatCount(unchanged)}`);
  if (gone) console.log(`   no longer found .. ${formatCount(gone)} (their YAML is left in place)`);
  console.log(`\nwrote ${OUT_FILE}`);
  if (added + changed === 0) console.log(`nothing changed -- step 6 will have no work to do`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
