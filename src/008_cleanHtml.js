// Step 8 -- clean up the stored HTML.
//
// Removes anything that would execute or fetch from elsewhere, and points
// links at our own copies where we hold the target. Both are done on a real
// parse of the document; see lib/cleanHtml.js.
//
// The result goes in a new `html_clean` field. The captured `html` is never
// modified, so this pass can be re-run or extended without losing the
// original.
//
//   node src/008_cleanHtml.js
//   node src/008_cleanHtml.js --force     re-clean everything

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { DATA } from "./lib/config.js";
import { cleanHtml } from "./lib/cleanHtml.js";
import { ensureDir, writeJson, parseArgs, formatCount } from "./lib/util.js";

const args = parseArgs();
const force = Boolean(args.force);
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;

const NODES_DIR = `${DATA}/parsed/nodes`;
const USERS_INDEX = `${DATA}/parsed/users/_index.jsonl`;
const STATE_FILE = `${DATA}/parsed/clean-state.json`;
const META_FILE = `${DATA}/parsed/clean.meta.json`;

// Changing the cleaner has to invalidate what it produced.
function cleanerVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const hash = crypto.createHash("sha1");
  for (const f of [`${here}/lib/cleanHtml.js`, `${here}/lib/links.js`, `${here}/008_cleanHtml.js`]) {
    try { hash.update(fs.readFileSync(f)); } catch { /* ignore */ }
  }
  return hash.digest("hex").slice(0, 16);
}

function main() {
  if (!fs.existsSync(NODES_DIR)) throw new Error(`missing ${NODES_DIR} -- run step 006 first`);

  // What we actually hold, and can therefore link to.
  const nodes = new Set(
    fs.readdirSync(NODES_DIR)
      .filter((f) => /^\d+\.yaml$/.test(f))
      .map((f) => Number(f.slice(0, -5)))
  );
  const users = new Set();
  if (fs.existsSync(USERS_INDEX)) {
    for (const line of fs.readFileSync(USERS_INDEX, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const u = JSON.parse(line);
        if (typeof u.id === "number") users.add(u.id);
      } catch { /* torn line */ }
    }
  }
  const have = (type, id) => (type === "node" ? nodes.has(id) : users.has(id));
  console.log(`can link to ${formatCount(nodes.size)} threads and ${formatCount(users.size)} members`);

  const version = cleanerVersion();
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { /* first run */ }
  const nextState = {};

  const counts = {
    threads: 0, cleaned: 0, unchanged: 0, entries: 0,
    links: 0, internal: 0, rewritten: 0, missing: 0,
    dropped: 0, handlers: 0, jsUrls: 0,
  };
  const missingCounts = new Map();

  const files = fs.readdirSync(NODES_DIR).filter((f) => /^\d+\.yaml$/.test(f));
  let n = 0;

  for (const name of files) {
    if (n >= limit) break;
    n++;
    counts.threads++;

    const file = path.join(NODES_DIR, name);
    const node = Number(name.slice(0, -5));
    const stat = fs.statSync(file);
    const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;

    const known = state[node];
    if (!force && known && known.stamp === stamp && known.version === version) {
      counts.unchanged++;
      nextState[node] = known;
      // Keep the totals describing the whole corpus, not just this run.
      counts.links += known.links ?? 0;
      counts.internal += known.internal ?? 0;
      counts.rewritten += known.rewritten ?? 0;
      counts.entries += known.entries ?? 0;
      counts.dropped += known.dropped ?? 0;
      counts.handlers += known.handlers ?? 0;
      counts.jsUrls += known.jsUrls ?? 0;
      for (const miss of known.missing ?? []) {
        missingCounts.set(miss, (missingCounts.get(miss) || 0) + 1);
      }
      continue;
    }

    let doc;
    try { doc = YAML.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    if (!doc) continue;

    const totals = { links: 0, internal: 0, rewritten: 0, entries: 0, dropped: 0, handlers: 0, jsUrls: 0 };
    const missedHere = [];

    const clean = (entry) => {
      if (!entry) return entry;
      totals.entries++;
      const { html: cleaned, stats } = cleanHtml(entry.html, have);
      totals.links += stats.links;
      totals.internal += stats.internal;
      totals.rewritten += stats.rewritten;
      totals.dropped += stats.dropped;
      totals.handlers += stats.handlers;
      totals.jsUrls += stats.jsUrls;
      for (const miss of stats.missing) {
        missingCounts.set(miss, (missingCounts.get(miss) || 0) + 1);
        missedHere.push(miss);
      }
      // Rebuilt so html_clean sits next to the original it came from.
      return {
        id: entry.id, user: entry.user, date: entry.date, date_raw: entry.date_raw,
        votes: entry.votes, html: entry.html, html_clean: cleaned,
      };
    };

    doc.post = clean(doc.post);
    doc.comments = (doc.comments ?? []).map(clean);

    const out = YAML.stringify(doc, { lineWidth: 0, blockQuote: "literal" });
    if (fs.readFileSync(file, "utf8") !== out) {
      fs.writeFileSync(`${file}.part`, out);
      fs.renameSync(`${file}.part`, file);
      counts.cleaned++;
    } else {
      counts.unchanged++;
    }

    const after = fs.statSync(file);
    nextState[node] = {
      stamp: `${after.size}:${Math.round(after.mtimeMs)}`,
      version, ...totals,
      ...(missedHere.length ? { missing: missedHere } : {}),
    };
    counts.links += totals.links;
    counts.internal += totals.internal;
    counts.rewritten += totals.rewritten;
    counts.entries += totals.entries;
    counts.dropped += totals.dropped;
    counts.handlers += totals.handlers;
    counts.jsUrls += totals.jsUrls;

    if (counts.threads % 2000 === 0) process.stdout.write(`\r  ${formatCount(counts.threads)} threads ...`);
  }
  process.stdout.write("\r");

  fs.writeFileSync(`${STATE_FILE}.part`, JSON.stringify(nextState));
  fs.renameSync(`${STATE_FILE}.part`, STATE_FILE);

  const missing = [...missingCounts.entries()].sort((a, b) => b[1] - a[1]);
  counts.missing = missing.reduce((sum, [, c]) => sum + c, 0);

  ensureDir(`${DATA}/parsed`);
  writeJson(META_FILE, {
    ...counts, cleaner: version,
    linkableThreads: nodes.size, linkableMembers: users.size,
    // What people linked to that we have not recovered -- a map of the gaps.
    topMissingTargets: Object.fromEntries(missing.slice(0, 40)),
    distinctMissingTargets: missing.length,
    generatedAt: new Date().toISOString(),
  });

  console.log(`threads ............. ${formatCount(counts.threads)}`);
  console.log(`  rewritten ......... ${formatCount(counts.cleaned)}`);
  console.log(`  already clean ..... ${formatCount(counts.unchanged)}`);
  console.log(`links seen .......... ${formatCount(counts.links)}`);
  console.log(`  point at us ....... ${formatCount(counts.internal)}`);
  console.log(`  repointed ......... ${formatCount(counts.rewritten)}`);
  console.log(`  target not held ... ${formatCount(counts.missing)} (${formatCount(missing.length)} distinct)`);
  console.log(`removed ............. ${formatCount(counts.dropped)} element(s), ${formatCount(counts.handlers)} inline handler(s), ${formatCount(counts.jsUrls)} javascript: address(es)`);
  console.log(`\nstored as html_clean alongside the captured html`);
}

try { main(); } catch (err) {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
}
