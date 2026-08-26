// Step 7 -- build a record per member.
//
// Members were never archived as pages we can parse; what survives is the
// byline on every post and comment. Step 6 records those observations, and
// this turns them into one file per member -- name, avatar, and everything
// they wrote -- so the thread files only ever carry an id.
//
// Avatars are copied out of the downloaded archives into the parsed data, so
// the site never has to reach back into data/archives.
//
//   node src/007_users.js
//   node src/007_users.js --force     rewrite every member file

import fs from "fs";
import path from "path";
import YAML from "yaml";
import { archiveDirs, DATA } from "./lib/config.js";
import { ARCHIVES } from "./lib/archives/index.js";
import { ensureDir, readJsonl, writeJson, parseArgs, formatCount } from "./lib/util.js";

const args = parseArgs();
const force = Boolean(args.force);

const USERS_DIR = `${DATA}/parsed/users`;
const PICTURES_DIR = `${USERS_DIR}/pictures`;
const OBSERVATIONS_FILE = `${USERS_DIR}/_observations.jsonl`;
const INDEX_FILE = `${USERS_DIR}/_index.jsonl`;
const LOG_FILE = `${DATA}/parsed/users.log`;

// Where a picture URL can be found on disk, best copy first.
function buildPictureLookup() {
  const best = new Map();
  for (const archive of ARCHIVES) {
    const dirs = archiveDirs(archive.id);
    if (!fs.existsSync(dirs.downloadState)) continue;
    for (const line of fs.readFileSync(dirs.downloadState, "utf8").split("\n")) {
      if (!line || !line.includes("/files/pictures/")) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (!r.f) continue;
      const file = path.join(dirs.files, r.f);
      if (!fs.existsSync(file)) continue;
      const current = best.get(r.k);
      const better =
        !current ||
        (r.ok === true && !current.verified) ||
        ((r.ok === true) === current.verified && String(r.ts) > current.ts);
      if (better) best.set(r.k, { file, ts: String(r.ts), verified: r.ok === true, archive: archive.id });
    }
  }
  return best;
}

const urlkeyForPicture = (p) => `com,typophile)${p.toLowerCase()}`;

function copyPicture(lookup, imagePath, userId) {
  const found = lookup.get(urlkeyForPicture(imagePath));
  if (!found) return { copied: false };

  const ext = (path.extname(imagePath) || ".gif").toLowerCase();
  const target = path.join(PICTURES_DIR, `picture-${userId}${ext}`);
  const rel = path.relative(`${DATA}/parsed`, target);
  try {
    const src = fs.statSync(found.file);
    if (fs.existsSync(target) && fs.statSync(target).size === src.size) {
      return { copied: false, file: rel };
    }
    ensureDir(PICTURES_DIR);
    fs.copyFileSync(found.file, target);
    return { copied: true, file: rel };
  } catch {
    return { copied: false };
  }
}

// Numbers before slugs, each in their own order.
function compareIds(a, b) {
  const na = typeof a === "number";
  const nb = typeof b === "number";
  if (na && nb) return a - b;
  if (na !== nb) return na ? -1 : 1;
  return String(a).localeCompare(String(b));
}

async function main() {
  if (!fs.existsSync(OBSERVATIONS_FILE)) {
    throw new Error(`missing ${OBSERVATIONS_FILE} -- run step 006 first`);
  }
  ensureDir(USERS_DIR);

  const lookup = buildPictureLookup();
  console.log(`picture files available on disk: ${formatCount(lookup.size)}`);

  const users = new Map();
  let seen = 0;

  for await (const ob of readJsonl(OBSERVATIONS_FILE)) {
    seen++;
    if (!users.has(ob.user)) {
      users.set(ob.user, {
        id: ob.user, name: null, names: new Set(), path: null,
        image: null, imageAt: null, nameAt: null,
        posts: [], comments: [], first: null, last: null,
      });
    }
    const u = users.get(ob.user);
    const at = String(ob.date ?? "");

    if (ob.name) {
      u.names.add(ob.name);
      // People renamed themselves; the most recent byline wins.
      if (u.nameAt === null || at > u.nameAt) { u.name = ob.name; u.nameAt = at; }
    }
    if (ob.path && !u.path) u.path = ob.path;
    if (ob.image && (u.imageAt === null || at > u.imageAt)) { u.image = ob.image; u.imageAt = at; }

    if (ob.date) {
      if (!u.first || ob.date < u.first) u.first = ob.date;
      if (!u.last || ob.date > u.last) u.last = ob.date;
    }

    if (ob.kind === "post") u.posts.push({ node: ob.node, title: ob.title, date: ob.date ?? null, forum: ob.forum ?? null });
    else u.comments.push({ node: ob.node, title: ob.title, comment: ob.comment ?? null, date: ob.date ?? null });
  }

  const log = fs.createWriteStream(`${LOG_FILE}.part`);
  const counts = { observations: seen, users: 0, written: 0, unchanged: 0, withImage: 0, copied: 0, imageMissing: 0, slugIds: 0 };
  const indexLines = [];

  for (const id of [...users.keys()].sort(compareIds)) {
    const u = users.get(id);
    counts.users++;
    if (typeof id !== "number") counts.slugIds++;

    let picture = null;
    if (u.image) {
      counts.withImage++;
      const res = copyPicture(lookup, u.image, id);
      if (res.file) {
        picture = res.file;
        if (res.copied) counts.copied++;
      } else {
        counts.imageMissing++;
        log.write(`WARN  user ${String(id).padEnd(12)} avatar not downloaded yet: ${u.image}\n`);
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
    // Only touch the file when it differs, so re-runs stay quiet in git.
    if (!force && fs.existsSync(file) && fs.readFileSync(file, "utf8") === out) {
      counts.unchanged++;
    } else {
      fs.writeFileSync(`${file}.part`, out);
      fs.renameSync(`${file}.part`, file);
      counts.written++;
    }

    indexLines.push(JSON.stringify({
      id, name: doc.name, picture,
      posts: u.posts.length, comments: u.comments.length,
      first: u.first, last: u.last,
    }));
  }

  fs.writeFileSync(`${INDEX_FILE}.part`, indexLines.join("\n") + "\n");
  fs.renameSync(`${INDEX_FILE}.part`, INDEX_FILE);

  await new Promise((resolve) => log.end(resolve));
  fs.renameSync(`${LOG_FILE}.part`, LOG_FILE);

  writeJson(`${DATA}/parsed/users.meta.json`, {
    ...counts, picturesOnDisk: lookup.size, generatedAt: new Date().toISOString(),
  });

  console.log(`byline observations . ${formatCount(seen)}`);
  console.log(`members ............. ${formatCount(counts.users)}  (${formatCount(counts.slugIds)} without a numeric id)`);
  console.log(`  written ........... ${formatCount(counts.written)}`);
  console.log(`  unchanged ......... ${formatCount(counts.unchanged)}`);
  console.log(`avatars referenced .. ${formatCount(counts.withImage)}`);
  console.log(`  copied ............ ${formatCount(counts.copied)}`);
  console.log(`  not downloaded .... ${formatCount(counts.imageMissing)}`);
  console.log(`\nmembers -> ${USERS_DIR}/<id>.yaml`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
