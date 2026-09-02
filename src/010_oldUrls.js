// Step 10 -- connect pre-Drupal discussion URLs to the nodes they became.
//
// Before Typophile used /node/<id>, its forum ran on Discus and a thread lived
// at /forums/messages/<forum>/<thread>.html. The migration assigned unrelated
// Drupal node ids, so the old numbers cannot be translated arithmetically.
// What did survive unchanged is the thread title and the local timestamp of
// its first post. Together they make a strong join key. Where an old site bug
// or duplicate import makes that pair ambiguous, the first-post body and the
// number of replies settle it when possible. Anything still ambiguous is left
// alone and logged -- an invented old address is worse than no address.
//
// The archive holds many query-string snapshots of the same Discus page. We
// keep the one with the most posts, then derive the canonical address without
// its query string.
//
//   node src/010_oldUrls.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { archiveDirs, DATA } from "./lib/config.js";
import { ARCHIVES } from "./lib/archives/index.js";
import { normaliseHtmlText, parseLegacyThread } from "./lib/legacyThreads.js";
import { captureUrlPath, formatCount, writeFileAtomic } from "./lib/util.js";

const NODES_DIR = `${DATA}/parsed/nodes`;
const INDEX_FILE = `${NODES_DIR}/_index.jsonl`;
const LOG_FILE = `${DATA}/parsed/old-urls.log`;

function betterCapture(next, current) {
  if (!current) return true;
  if (next.posts !== current.posts) return next.posts > current.posts;
  const nextSignature = Number(Boolean(next.date)) + Number(Boolean(next.bodyKey));
  const currentSignature = Number(Boolean(current.date)) + Number(Boolean(current.bodyKey));
  if (nextSignature !== currentSignature) return nextSignature > currentSignature;
  if (next.captureTimestamp !== current.captureTimestamp) {
    return next.captureTimestamp > current.captureTimestamp;
  }
  return next.baseCapture && !current.baseCapture;
}

function readLegacyThreads() {
  const threads = new Map();
  let htmlFiles = 0;
  let threadCaptures = 0;

  for (const archive of ARCHIVES) {
    const dirs = archiveDirs(archive.id);
    if (!fs.existsSync(dirs.downloadState)) continue;

    // The timestamp is now a directory above the URL-shaped path, so state is
    // the authoritative and much cheaper inventory than walking every capture
    // directory looking for legacy discussions.
    for (const line of fs.readFileSync(dirs.downloadState, "utf8").split("\n")) {
      if (!line.includes("typophile.com/forums/messages/")) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const relative = captureUrlPath(entry.f);
      const match = /^typophile\.com\/forums\/messages\/(\d+)\/(\d+(?:__q_.+)?)\.html$/i.exec(relative ?? "");
      if (!match) continue;
      const forum = match[1];
      const filename = `${match[2]}.html`;
      const file = path.join(dirs.files, entry.f);
      if (!fs.existsSync(file)) continue;
      htmlFiles++;
      let parsed = null;
      try {
        parsed = parseLegacyThread(fs.readFileSync(file, "utf8"), forum, filename);
      } catch { /* an unreadable capture cannot provide a match */ }
      if (!parsed) continue;
      parsed.captureTimestamp = String(entry.ts ?? "");
      threadCaptures++;
      if (betterCapture(parsed, threads.get(parsed.key))) threads.set(parsed.key, parsed);
    }
  }

  return { threads: [...threads.values()], htmlFiles, threadCaptures };
}

function addTo(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function readNodeIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(`missing ${INDEX_FILE} -- run step 009 first`);
  }
  const nodes = [];
  for (const line of fs.readFileSync(INDEX_FILE, "utf8").split("\n")) {
    if (!line) continue;
    const entry = JSON.parse(line);
    nodes.push({ ...entry, titleKey: normaliseHtmlText(entry.title) });
  }
  return nodes;
}

function insertOldUrl(doc, url) {
  const next = {};
  let inserted = false;
  for (const [key, value] of Object.entries(doc)) {
    if (key === "old_url") continue;
    next[key] = value;
    if (key === "title") {
      next.old_url = url;
      inserted = true;
    }
  }
  if (!inserted) next.old_url = url;
  return next;
}

function main() {
  const legacy = readLegacyThreads();
  const nodes = readNodeIndex();
  const byTitleDate = new Map();
  const byDate = new Map();
  for (const node of nodes) {
    addTo(byTitleDate, `${node.titleKey}\0${node.date ?? ""}`, node);
    addTo(byDate, node.date, node);
  }

  // Bodies are only opened for collisions and damaged/renamed titles. The
  // common title+date case therefore avoids parsing thousands of large YAMLs.
  const bodyCache = new Map();
  function bodyFor(node) {
    if (bodyCache.has(node.id)) return bodyCache.get(node.id);
    let body = "";
    try {
      const doc = YAML.parse(fs.readFileSync(path.join(NODES_DIR, `${node.id}.yaml`), "utf8"));
      body = normaliseHtmlText(doc?.post?.html);
    } catch { /* no body evidence */ }
    bodyCache.set(node.id, body);
    return body;
  }

  function narrow(candidates, old) {
    let remaining = candidates;
    if (old.bodyKey) {
      const sameBody = remaining.filter((node) => bodyFor(node) === old.bodyKey);
      if (sameBody.length) remaining = sameBody;
    }
    const sameSize = remaining.filter((node) => node.comments + 1 === old.posts);
    if (sameSize.length) remaining = sameSize;
    return remaining;
  }

  const proposals = [];
  const legacyProblems = [];
  for (const old of legacy.threads) {
    let candidates = [];
    let method = null;
    if (old.date && old.titleKey) {
      candidates = byTitleDate.get(`${old.titleKey}\0${old.date}`) ?? [];
      if (candidates.length === 1) method = "title+date";
      else if (candidates.length > 1) {
        candidates = narrow(candidates, old);
        if (candidates.length === 1) method = "title+date+content";
      }
    }

    // A surviving exact-title collision remains an ambiguity unless its body
    // or reply count resolved it. Do not erase that useful candidate set with
    // a failed fallback lookup.
    if (!method && candidates.length === 0 && old.date && old.bodyKey) {
      const sameBodyAndDate = (byDate.get(old.date) ?? [])
        .filter((node) => bodyFor(node) === old.bodyKey);
      candidates = narrow(sameBodyAndDate, old);
      if (candidates.length === 1) method = "date+content";
    }

    if (method) {
      proposals.push({ old, node: candidates[0], method });
    } else if (candidates.length > 1) {
      legacyProblems.push({ kind: "ambiguous", old, candidates });
    } else {
      legacyProblems.push({ kind: "unmatched", old, candidates: [] });
    }
  }

  // The migration should be one old thread to one node. Conflicts are useful
  // evidence of duplicate/renamed old threads, but not permission to choose.
  const byNode = new Map();
  for (const proposal of proposals) addTo(byNode, proposal.node.id, proposal);
  const matches = new Map();
  let conflicts = 0;
  let aliases = 0;
  for (const [node, group] of byNode) {
    if (group.length === 1) {
      matches.set(node, group[0]);
      continue;
    }

    // The same Discus thread id under multiple forum ids is a moved thread,
    // not two threads. Keep its most recently captured location as old_url;
    // every alias still counts as successfully connected to this node.
    if (new Set(group.map((entry) => entry.old.thread)).size === 1) {
      group.sort((a, b) => b.old.captureTimestamp.localeCompare(a.old.captureTimestamp));
      const newest = group.filter(
        (entry) => entry.old.captureTimestamp === group[0].old.captureTimestamp
      );
      if (newest.length === 1) {
        matches.set(node, newest[0]);
        aliases += group.length - 1;
        continue;
      }
    }

    conflicts++;
    for (const proposal of group) {
      legacyProblems.push({
        kind: "conflict", old: proposal.old,
        candidates: group.map((entry) => entry.node),
      });
    }
  }

  let written = 0;
  let current = 0;
  let removed = 0;
  let unreadable = 0;
  for (const [node, match] of [...matches].sort((a, b) => a[0] - b[0])) {
    const file = path.join(NODES_DIR, `${node}.yaml`);
    let doc;
    try { doc = YAML.parse(fs.readFileSync(file, "utf8")); } catch { unreadable++; continue; }
    if (!doc) { unreadable++; continue; }
    if (doc.old_url === match.old.url) {
      current++;
      continue;
    }
    const out = YAML.stringify(insertOldUrl(doc, match.old.url), { lineWidth: 0, blockQuote: "literal" });
    writeFileAtomic(file, out);
    written++;
  }

  // `old_url` is wholly derived by this step. Remove a value whose match has
  // disappeared or become ambiguous, otherwise a corrected parser could
  // leave yesterday's confident-looking answer behind forever. Only the first
  // kilobyte is inspected for unmatched nodes because the field sits beside
  // the title; their often-large post bodies need not be read.
  const prefix = Buffer.alloc(1024);
  for (const node of nodes) {
    if (matches.has(node.id)) continue;
    const file = path.join(NODES_DIR, `${node.id}.yaml`);
    let size = 0;
    let fd;
    try {
      fd = fs.openSync(file, "r");
      size = fs.readSync(fd, prefix, 0, prefix.length, 0);
    } catch { continue; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    if (!/^old_url:/m.test(prefix.toString("utf8", 0, size))) continue;

    let doc;
    try { doc = YAML.parse(fs.readFileSync(file, "utf8")); } catch { unreadable++; continue; }
    if (!doc || !("old_url" in doc)) continue;
    delete doc.old_url;
    writeFileAtomic(file, YAML.stringify(doc, { lineWidth: 0, blockQuote: "literal" }));
    removed++;
  }

  const log = [
    "# MISSING is a recovered pre-Drupal thread with no matching captured node.",
    "# It may not have been migrated, or its modern node may be absent from our captures.",
    "# AMBIGUOUS means more than one captured node has the same surviving signature.",
    "",
  ];
  for (const problem of legacyProblems.sort((a, b) => a.old.key.localeCompare(b.old.key, "en", { numeric: true }))) {
    const candidates = problem.candidates.map((node) => node.id).join(",") || "-";
    const label = problem.kind === "unmatched" ? "MISSING" : problem.kind.toUpperCase();
    log.push(`${label.padEnd(10)} ${problem.old.url} date=${problem.old.date ?? "-"} candidates=${candidates} title=${JSON.stringify(problem.old.title)}`);
  }
  writeFileAtomic(LOG_FILE, log.join("\n") + "\n");

  console.log(`legacy html files .... ${formatCount(legacy.htmlFiles)}`);
  console.log(`  thread snapshots ... ${formatCount(legacy.threadCaptures)}`);
  console.log(`  distinct threads ... ${formatCount(legacy.threads.length)}`);
  console.log(`matched nodes ........ ${formatCount(matches.size)}`);
  if (aliases) console.log(`  moved-url aliases .. ${formatCount(aliases)}`);
  console.log(`  urls written ....... ${formatCount(written)}`);
  console.log(`  already current .... ${formatCount(current)}`);
  if (removed) console.log(`  stale urls removed . ${formatCount(removed)}`);
  if (unreadable) console.log(`  unreadable ......... ${formatCount(unreadable)}`);
  console.log(`legacy without node .. ${formatCount(legacyProblems.filter((item) => item.kind === "unmatched").length)}`);
  console.log(`legacy ambiguous ..... ${formatCount(legacyProblems.filter((item) => item.kind === "ambiguous").length)}`);
  if (conflicts) console.log(`node conflicts ....... ${formatCount(conflicts)}`);
  console.log(`\nlog -> ${LOG_FILE}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (err) {
    console.error(`\nfailed: ${err.message}`);
    process.exit(1);
  }
}
