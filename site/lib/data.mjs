import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
// The pipeline owns the shape of a thread summary, because the pipeline is
// what writes them; see src/lib/summary.js and step 9.
import { summarise, summaryVersion } from "../../src/lib/summary.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.TYPOPHILE_DATA
  ? path.resolve(process.env.TYPOPHILE_DATA)
  : path.resolve(here, "../../data/parsed");

const NODES_DIR = path.join(DATA_DIR, "nodes");
const USERS_DIR = path.join(DATA_DIR, "users");
export const PICTURES_DIR = path.join(USERS_DIR, "pictures");
export const FILES_DIR = path.join(DATA_DIR, "files");
export const MISC_DIR = path.join(DATA_DIR, "misc");
const THREAD_INDEX = path.join(NODES_DIR, "_index.jsonl");
const THREAD_META = path.join(DATA_DIR, "threads.meta.json");
const CACHE_FILE = path.resolve(here, "../.cache/index.json");

export const PER_PAGE = 100;

// --- one thread ------------------------------------------------------------

export function loadNode(id) {
  const file = path.join(NODES_DIR, `${id}.yaml`);
  if (!fs.existsSync(file)) return null;
  try {
    return YAML.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// --- where the pages came from ---------------------------------------------
//
// Step 9 counts the published threads by the archive each one's copy was taken
// from, beside the index it writes them into. Reading that one small file is
// what the about page needs; counting the index again here would give the same
// answer more slowly and could drift from what the pipeline reported.

export function loadArchiveCounts() {
  try {
    const meta = JSON.parse(fs.readFileSync(THREAD_META, "utf8"));
    return meta?.byArchive ?? null;
  } catch {
    // Step 9 has not run, or is from before this file existed. The about page
    // leaves the counts out rather than showing a number it cannot stand behind.
    return null;
  }
}

// --- members ---------------------------------------------------------------
//
// The member index is one small line per user, written by step 7, so listing
// pages never touch the per-user files.

export function loadUser(id) {
  const file = path.join(USERS_DIR, `${id}.yaml`);
  if (!fs.existsSync(file)) return null;
  try {
    return YAML.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

let userIndexCache = null;

export function buildUserIndex() {
  const file = path.join(USERS_DIR, "_index.jsonl");
  if (!fs.existsSync(file)) return { users: [], byId: new Map() };

  const stat = fs.statSync(file);
  const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;
  if (userIndexCache?.stamp === stamp) return userIndexCache.value;

  const users = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try { users.push(JSON.parse(line)); } catch { /* torn line */ }
  }
  users.sort((a, b) => (b.posts + b.comments) - (a.posts + a.comments));

  const value = { users, byId: new Map(users.map((u) => [u.id, u])) };
  userIndexCache = { stamp, value };
  return value;
}

// --- the index -------------------------------------------------------------
//
// Every listing page needs a line per thread, but a thread's YAML is mostly
// post and comment HTML none of them want. Step 9 writes those lines out to
// `nodes/_index.jsonl`, so ordinarily this reads one file of a few megabytes
// and is done.
//
// Where that file has not been written, the summaries are gathered from the
// thread files instead and cached on disk. That path is correct but slow, and
// -- because it is keyed on each file's size and date -- a cleaning pass,
// which rewrites all of them, costs a full minute of re-reading. Running step
// 9 is what makes that go away.

// Held for as long as the process lives. Even the cheap path is a file read
// and a parse, and the dev server was paying it on every single request.
//
// A directory's mtime moves whenever an entry is created, removed or renamed,
// which is how every pipeline step writes (to `.part`, then rename), so a run
// of any of them is caught. Editing one thread's YAML in place is not; restart
// the dev server after doing that by hand.
let indexCache = null;

// Sorted, counted, and grouped into forums -- the same whichever way the
// summaries were come by.
function shape(threads) {
  // Newest thread first, by when it was started -- not by last reply, so the
  // order does not shuffle when an old thread happens to get a late comment.
  threads.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  const forums = new Map();
  for (const t of threads) {
    if (t.forum === null) continue;
    if (!forums.has(t.forum)) forums.set(t.forum, { id: t.forum, title: t.forumTitle, threads: 0 });
    forums.get(t.forum).threads++;
  }

  return {
    threads,
    forums: [...forums.values()].sort((a, b) => b.threads - a.threads),
    totals: {
      threads: threads.length,
      comments: threads.reduce((n, t) => n + t.comments, 0),
    },
  };
}

export function buildIndex({ quiet = false } = {}) {
  if (!fs.existsSync(NODES_DIR)) {
    throw new Error(
      `no parsed data at ${NODES_DIR}\n` +
      `Run the pipeline first (npm run select && npm run parse in the repo root), ` +
      `or point TYPOPHILE_DATA at a parsed directory.`
    );
  }

  if (fs.existsSync(THREAD_INDEX)) {
    const stat = fs.statSync(THREAD_INDEX);
    const stamp = `step9:${stat.size}:${Math.round(stat.mtimeMs)}`;
    if (indexCache?.stamp === stamp) return indexCache.value;

    const threads = [];
    for (const line of fs.readFileSync(THREAD_INDEX, "utf8").split("\n")) {
      if (!line) continue;
      try {
        // `k` is step 9's own record of what the line was written from; it
        // says nothing to a listing page.
        const { k, ...thread } = JSON.parse(line);
        threads.push(thread);
      } catch { /* torn line */ }
    }

    const value = shape(threads);
    indexCache = { stamp, value };
    return value;
  }

  const dirStamp = `${Math.round(fs.statSync(NODES_DIR).mtimeMs)}:${summaryVersion()}`;
  if (indexCache?.stamp === dirStamp) return indexCache.value;

  let cache = { entries: {} };
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch { /* first run */ }

  const version = summaryVersion();
  const files = fs.readdirSync(NODES_DIR).filter((f) => f.endsWith(".yaml"));
  const entries = {};
  let reread = 0;

  for (const name of files) {
    const full = path.join(NODES_DIR, name);
    const stat = fs.statSync(full);
    const known = cache.entries?.[name];
    const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;

    if (known && known.stamp === stamp && known.v === version) {
      entries[name] = known;
      continue;
    }
    const doc = YAML.parse(fs.readFileSync(full, "utf8"));
    entries[name] = { stamp, v: version, summary: summarise(doc) };
    reread++;
  }

  const changed = reread > 0 || Object.keys(entries).length !== Object.keys(cache.entries ?? {}).length;
  if (changed) {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(`${CACHE_FILE}.part`, JSON.stringify({ entries }));
    fs.renameSync(`${CACHE_FILE}.part`, CACHE_FILE);
  }
  if (!quiet && reread > 0) {
    console.log(`  index: read ${reread} of ${files.length} threads (rest from cache)`);
  }

  const value = shape(Object.values(entries).map((e) => e.summary));
  indexCache = { stamp: dirStamp, value };
  return value;
}

export function paginate(items, page, perPage = PER_PAGE) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  return {
    items: items.slice((current - 1) * perPage, current * perPage),
    page: current,
    pages,
  };
}
