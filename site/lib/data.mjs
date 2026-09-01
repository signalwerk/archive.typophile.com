import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.TYPOPHILE_DATA
  ? path.resolve(process.env.TYPOPHILE_DATA)
  : path.resolve(here, "../../data/parsed");

const NODES_DIR = path.join(DATA_DIR, "nodes");
const USERS_DIR = path.join(DATA_DIR, "users");
export const PICTURES_DIR = path.join(USERS_DIR, "pictures");
export const FILES_DIR = path.join(DATA_DIR, "files");
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
// post and comment HTML we do not need here. Parsing all of them takes a
// while, so the summaries are cached and only re-read when a file's size or
// mtime changes. In dev, editing one thread costs one re-read -- not eleven
// thousand.

function summarise(doc) {
  const comments = doc.comments ?? [];
  const last = comments.length ? comments[comments.length - 1] : null;
  return {
    id: doc.node,
    title: doc.title || `node ${doc.node}`,
    forum: doc.forum?.id ?? null,
    forumTitle: doc.forum?.title ?? null,
    author: doc.post?.user ?? null,
    date: doc.post?.date ?? null,
    comments: comments.length,
    lastDate: last?.date ?? doc.post?.date ?? null,
    archive: doc.source?.archive ?? null,
    truncated: Boolean(doc.source?.truncated),
  };
}

// Changing what a summary holds has to invalidate the summaries already
// cached, or a field added here would silently never appear for threads whose
// files have not been touched since.
//
// It is the shape of a summary that matters, so this hashes `summarise` and
// nothing else. Hashing the whole file, as this once did, threw away all
// sixty thousand summaries -- a minute of re-parsing -- whenever anything else
// here was touched, down to a comment.
let summaryVersionCache = null;
function summaryVersion() {
  if (summaryVersionCache) return summaryVersionCache;
  summaryVersionCache = crypto
    .createHash("sha1")
    .update(summarise.toString())
    .digest("hex")
    .slice(0, 12);
  return summaryVersionCache;
}

// Held for as long as the process lives, because rebuilding it means one stat
// per thread and re-reading a cache file of some twenty megabytes -- half a
// second, and the dev server was paying it on every single request.
//
// A directory's mtime moves whenever an entry is created, removed or renamed,
// which is how every pipeline step writes (to `.part`, then rename), so a run
// of any of them is caught. Editing one thread's YAML in place is not; restart
// the dev server after doing that by hand.
let indexCache = null;

export function buildIndex({ quiet = false } = {}) {
  if (!fs.existsSync(NODES_DIR)) {
    throw new Error(
      `no parsed data at ${NODES_DIR}\n` +
      `Run the pipeline first (npm run select && npm run parse in the repo root), ` +
      `or point TYPOPHILE_DATA at a parsed directory.`
    );
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

  const threads = Object.values(entries).map((e) => e.summary);
  // Newest thread first, by when it was started -- not by last reply, so the
  // order does not shuffle when an old thread happens to get a late comment.
  threads.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  const forums = new Map();
  for (const t of threads) {
    if (t.forum === null) continue;
    if (!forums.has(t.forum)) forums.set(t.forum, { id: t.forum, title: t.forumTitle, threads: 0 });
    forums.get(t.forum).threads++;
  }

  const value = {
    threads,
    forums: [...forums.values()].sort((a, b) => b.threads - a.threads),
    totals: {
      threads: threads.length,
      comments: threads.reduce((n, t) => n + t.comments, 0),
    },
  };
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
