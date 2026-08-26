import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.TYPOPHILE_DATA
  ? path.resolve(process.env.TYPOPHILE_DATA)
  : path.resolve(here, "../../data/parsed");

const NODES_DIR = path.join(DATA_DIR, "nodes");
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
    author: doc.post?.user_name ?? null,
    authorId: doc.post?.user_id ?? null,
    date: doc.post?.date ?? null,
    comments: comments.length,
    lastDate: last?.date ?? doc.post?.date ?? null,
    archive: doc.source?.archive ?? null,
    truncated: Boolean(doc.source?.truncated),
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

  let cache = { entries: {} };
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch { /* first run */ }

  const files = fs.readdirSync(NODES_DIR).filter((f) => f.endsWith(".yaml"));
  const entries = {};
  let reread = 0;

  for (const name of files) {
    const full = path.join(NODES_DIR, name);
    const stat = fs.statSync(full);
    const known = cache.entries?.[name];
    const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;

    if (known && known.stamp === stamp) {
      entries[name] = known;
      continue;
    }
    const doc = YAML.parse(fs.readFileSync(full, "utf8"));
    entries[name] = { stamp, summary: summarise(doc) };
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
  threads.sort((a, b) => String(b.lastDate ?? "").localeCompare(String(a.lastDate ?? "")));

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

export function paginate(items, page, perPage = PER_PAGE) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  return {
    items: items.slice((current - 1) * perPage, current * perPage),
    page: current,
    pages,
  };
}
