// Step 7 -- build a record per member from the parsed threads.
//
// Users are not archived as pages we can parse; what survives is the byline on
// every post and comment. Aggregating those gives a name, an avatar, and the
// full list of what each member wrote.
//
// Avatars are copied out of the downloaded archives into the parsed data, so
// the site has them without reaching back into data/archives.
//
//   node src/007_users.js
//   node src/007_users.js --force     rewrite every user file

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { archiveDirs, DATA } from "./lib/config.js";
import { ARCHIVES } from "./lib/archives/index.js";
import { ensureDir, readJsonl, writeJson, parseArgs, formatCount } from "./lib/util.js";

const args = parseArgs();
const force = Boolean(args.force);

const NODES_DIR = `${DATA}/parsed/nodes`;
const USERS_DIR = `${DATA}/parsed/users`;
const PICTURES_DIR = `${USERS_DIR}/pictures`;
const INDEX_FILE = `${USERS_DIR}/_index.jsonl`;
const UNRESOLVED_FILE = `${USERS_DIR}/_unresolved.yaml`;
const LOG_FILE = `${DATA}/parsed/users.log`;

// Where a picture URL can be found on disk, best copy first.
function buildPictureLookup() {
  const best = new Map(); // urlkey -> { file, ts, verified }

  for (const archive of ARCHIVES) {
    const dirs = archiveDirs(archive.id);
    if (!fs.existsSync(dirs.downloadState)) continue;

    const state = new Map();
    for (const line of fs.readFileSync(dirs.downloadState, "utf8").split("\n")) {
      if (!line || !line.includes("/files/pictures/")) continue;
      try { const r = JSON.parse(line); state.set(r.k, r); } catch { /* torn line */ }
    }
    if (state.size === 0) continue;

    for (const [key, r] of state) {
      if (!r.f) continue;
      const file = path.join(dirs.files, r.f);
      if (!fs.existsSync(file)) continue;
      const current = best.get(key);
      // Prefer a verified copy, then the most recent one.
      const better =
        !current ||
        (r.ok === true && current.verified !== true) ||
        (r.ok === true === (current.verified === true) && String(r.ts) > String(current.ts));
      if (better) best.set(key, { file, ts: String(r.ts), verified: r.ok === true, archive: archive.id });
    }
  }
  return best;
}

const urlkeyForPicture = (p) => `com,typophile)${p.toLowerCase()}`;

function copyPicture(lookup, imagePath, userId) {
  const found = lookup.get(urlkeyForPicture(imagePath));
  if (!found) return { copied: false, reason: "not downloaded" };

  const ext = (path.extname(imagePath) || ".gif").toLowerCase();
  const target = path.join(PICTURES_DIR, `picture-${userId}${ext}`);
  const rel = path.relative(`${DATA}/parsed`, target);

  try {
    const src = fs.statSync(found.file);
    if (fs.existsSync(target) && fs.statSync(target).size === src.size) {
      return { copied: false, reason: "already there", file: rel, archive: found.archive };
    }
    ensureDir(PICTURES_DIR);
    fs.copyFileSync(found.file, target);
    return { copied: true, file: rel, archive: found.archive };
  } catch (err) {
    return { copied: false, reason: err.message };
  }
}

async function main() {
  if (!fs.existsSync(NODES_DIR)) throw new Error(`missing ${NODES_DIR} -- run step 006 first`);
  ensureDir(USERS_DIR);

  const lookup = buildPictureLookup();
  console.log(`picture files available on disk: ${formatCount(lookup.size)}`);

  const users = new Map();
  const unresolved = new Map(); // people with a name but no numeric id

  const note = (entry, kind, ctx) => {
    if (entry.user_id == null) {
      if (!entry.user_name) return;
      const key = entry.user_path || entry.user_name;
      if (!unresolved.has(key)) {
        unresolved.set(key, { name: entry.user_name, path: entry.user_path ?? null, posts: 0, comments: 0 });
      }
      unresolved.get(key)[kind === "post" ? "posts" : "comments"]++;
      return;
    }

    const id = entry.user_id;
    if (!users.has(id)) {
      users.set(id, {
        id, name: null, names: new Set(), path: null, image: null,
        imageSeen: null, posts: [], comments: [], first: null, last: null,
      });
    }
    const u = users.get(id);
    if (entry.user_name) u.names.add(entry.user_name);
    if (entry.user_path && !u.path) u.path = entry.user_path;

    // Keep the most recently captured avatar.
    if (entry.user_image && (!u.imageSeen || String(entry.date ?? "") > u.imageSeen)) {
      u.image = entry.user_image;
      u.imageSeen = String(entry.date ?? "");
      if (entry.user_name) u.name = entry.user_name;
    }
    if (!u.name && entry.user_name) u.name = entry.user_name;

    if (entry.date) {
      if (!u.first || entry.date < u.first) u.first = entry.date;
      if (!u.last || entry.date > u.last) u.last = entry.date;
    }

    if (kind === "post") u.posts.push({ node: ctx.node, title: ctx.title, date: entry.date ?? null, forum: ctx.forum ?? null });
    else u.comments.push({ node: ctx.node, title: ctx.title, comment: entry.id ?? null, date: entry.date ?? null });
  };

  const files = fs.readdirSync(NODES_DIR).filter((f) => f.endsWith(".yaml"));
  let scanned = 0;
  for (const name of files) {
    let doc;
    try { doc = YAML.parse(fs.readFileSync(path.join(NODES_DIR, name), "utf8")); } catch { continue; }
    if (!doc) continue;
    scanned++;
    const ctx = { node: doc.node, title: doc.title, forum: doc.forum?.id ?? null };
    if (doc.post) note(doc.post, "post", ctx);
    for (const c of doc.comments ?? []) note(c, "comment", ctx);
    if (scanned % 2000 === 0) process.stdout.write(`\r  scanned ${formatCount(scanned)} threads ...`);
  }
  process.stdout.write("\r");

  // --- write ---------------------------------------------------------------
  ensureDir(USERS_DIR);
  const log = fs.createWriteStream(`${LOG_FILE}.part`);
  const counts = { users: 0, written: 0, unchanged: 0, withImage: 0, copied: 0, imageMissing: 0 };
  const indexLines = [];

  for (const id of [...users.keys()].sort((a, b) => a - b)) {
    const u = users.get(id);
    counts.users++;

    let picture = null;
    if (u.image) {
      counts.withImage++;
      const res = copyPicture(lookup, u.image, id);
      if (res.file) {
        picture = res.file;
        if (res.copied) counts.copied++;
      } else {
        counts.imageMissing++;
        log.write(`WARN  user ${String(id).padEnd(7)} avatar not on disk yet: ${u.image}\n`);
      }
    }

    u.posts.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
    u.comments.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));

    const doc = {
      user: id,
      name: u.name ?? [...u.names][0] ?? null,
      also_known_as: [...u.names].filter((n) => n !== u.name).sort(),
      path: u.path,
      image: u.image,
      picture,
      first_seen: u.first,
      last_seen: u.last,
      counts: { posts: u.posts.length, comments: u.comments.length },
      posts: u.posts,
      comments: u.comments,
    };

    const out = YAML.stringify(doc, { lineWidth: 0, blockQuote: "literal" });
    const file = `${USERS_DIR}/${id}.yaml`;
    // Only touch the file when it actually differs, so re-runs stay quiet in git.
    if (!force && fs.existsSync(file) && fs.readFileSync(file, "utf8") === out) {
      counts.unchanged++;
    } else {
      fs.writeFileSync(`${file}.part`, out);
      fs.renameSync(`${file}.part`, file);
      counts.written++;
    }

    indexLines.push(JSON.stringify({
      id, name: doc.name, picture, posts: u.posts.length, comments: u.comments.length,
      first: u.first, last: u.last,
    }));
  }

  fs.writeFileSync(`${INDEX_FILE}.part`, indexLines.join("\n") + "\n");
  fs.renameSync(`${INDEX_FILE}.part`, INDEX_FILE);

  const unres = [...unresolved.values()].sort((a, b) => (b.posts + b.comments) - (a.posts + a.comments));
  fs.writeFileSync(UNRESOLVED_FILE, YAML.stringify({
    note: "Authors with a display name but no numeric user id (guests, and members with a vanity profile path). They have no user page because there is no stable id to key one on.",
    count: unres.length,
    authors: unres,
  }, { lineWidth: 0 }));
  for (const a of unres) {
    log.write(`WARN  user -       no numeric id for "${a.name}"${a.path ? ` (${a.path})` : ""} -- ${a.posts + a.comments} entries\n`);
  }

  // end() is asynchronous and the stream opens its file lazily -- wait for the
  // close before renaming, or the rename can fire before the file exists.
  await new Promise((resolve) => log.end(resolve));
  fs.renameSync(`${LOG_FILE}.part`, LOG_FILE);

  writeJson(`${DATA}/parsed/users.meta.json`, {
    ...counts, threadsScanned: scanned, unresolvedAuthors: unres.length,
    picturesOnDisk: lookup.size, generatedAt: new Date().toISOString(),
  });

  console.log(`threads scanned ..... ${formatCount(scanned)}`);
  console.log(`members ............. ${formatCount(counts.users)}`);
  console.log(`  written ........... ${formatCount(counts.written)}`);
  console.log(`  unchanged ......... ${formatCount(counts.unchanged)}`);
  console.log(`avatars referenced .. ${formatCount(counts.withImage)}`);
  console.log(`  copied ............ ${formatCount(counts.copied)}`);
  console.log(`  not downloaded .... ${formatCount(counts.imageMissing)}`);
  console.log(`no numeric id ....... ${formatCount(unres.length)} author(s) -> ${UNRESOLVED_FILE}`);
  console.log(`\nusers -> ${USERS_DIR}/<id>.yaml`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
