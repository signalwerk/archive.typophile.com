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
import crypto from "crypto";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { archiveDirs, DATA } from "./lib/config.js";
import { ARCHIVES } from "./lib/archives/index.js";
import { ensureDir, readJsonl, writeJson, parseArgs, formatCount } from "./lib/util.js";
import { parseUserProfile } from "./lib/userProfile.js";

const args = parseArgs();
const force = Boolean(args.force);

const USERS_DIR = `${DATA}/parsed/users`;
const PICTURES_DIR = `${USERS_DIR}/pictures`;
const OBSERVATIONS_FILE = `${USERS_DIR}/_observations.jsonl`;
const INDEX_FILE = `${USERS_DIR}/_index.jsonl`;
const PROFILE_CACHE = `${USERS_DIR}/_profiles.json`;

// Changing how a profile is read has to invalidate what was read with the old
// version, or corrected fields quietly survive in the cache.
function profileParserVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(`${here}/lib/userProfile.js`)).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}
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

// "20150426213756" -> "2015-04-26T21:37:56Z"
function captureIso(ts) {
  const v = String(ts ?? "");
  if (v.length < 14) return null;
  return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}T${v.slice(8,10)}:${v.slice(10,12)}:${v.slice(12,14)}Z`;
}

// Downloaded /user/<id> pages, best copy per member.
function buildProfileLookup() {
  const best = new Map();
  const KEY = /^com,typophile\)\/user\/(\d+)$/;
  for (const archive of ARCHIVES) {
    const dirs = archiveDirs(archive.id);
    if (!fs.existsSync(dirs.downloadState)) continue;
    for (const line of fs.readFileSync(dirs.downloadState, "utf8").split("\n")) {
      if (!line || !line.includes(")/user/")) continue;
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      const m = KEY.exec(r.k || "");
      if (!m || !r.f) continue;
      const file = path.join(dirs.files, r.f);
      if (!fs.existsSync(file)) continue;
      const id = Number(m[1]);
      const current = best.get(id);
      // Prefer a verified copy, then the most recent.
      const better =
        !current ||
        (r.ok === true && !current.verified) ||
        ((r.ok === true) === current.verified && String(r.ts) > current.ts);
      if (better) best.set(id, { file, ts: String(r.ts), verified: r.ok === true, archive: archive.id });
    }
  }
  return best;
}

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

  const profileFiles = buildProfileLookup();
  console.log(`profile pages available on disk: ${formatCount(profileFiles.size)}`);

  // Parsing thousands of HTML pages is the slow part, so results are cached
  // against the file they came from and only re-read when that file changes.
  const parserVersion = profileParserVersion();
  let profileCache = {};
  try { profileCache = JSON.parse(fs.readFileSync(PROFILE_CACHE, "utf8")); } catch { /* first run */ }
  const nextProfileCache = {};
  let profilesParsed = 0;
  let profilesCached = 0;

  function profileFor(id) {
    const found = profileFiles.get(typeof id === "number" ? id : NaN);
    if (!found) return null;
    let stat;
    try { stat = fs.statSync(found.file); } catch { return null; }
    const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;
    const known = profileCache[id];
    if (!force && known && known.stamp === stamp && known.parser === parserVersion) {
      nextProfileCache[id] = known;
      profilesCached++;
      return known.fields ?? null;
    }
    let fields = null;
    try {
      fields = parseUserProfile(fs.readFileSync(found.file, "utf8"), { capturedAt: captureIso(found.ts) });
    } catch { fields = null; }
    nextProfileCache[id] = { stamp, parser: parserVersion, archive: found.archive, ts: found.ts, fields };
    profilesParsed++;
    return fields;
  }

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

  // Somebody can have a profile page but never have posted; they are still a
  // member, so give them a record too.
  for (const id of profileFiles.keys()) {
    if (users.has(id)) continue;
    users.set(id, {
      id, name: null, names: new Set(), path: null, image: null, imageAt: null,
      nameAt: null, posts: [], comments: [], first: null, last: null,
    });
  }

  const log = fs.createWriteStream(`${LOG_FILE}.part`);
  const counts = {
    observations: seen, users: 0, written: 0, unchanged: 0,
    withImage: 0, copied: 0, imageMissing: 0, slugIds: 0,
    withProfile: 0, withMemberSince: 0, postlessMembers: 0,
    staleRemoved: 0, stalePicturesRemoved: 0,
  };
  const indexLines = [];
  const expectedUserFiles = new Set();
  const expectedPictures = new Set();

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
        expectedPictures.add(path.basename(res.file));
        if (res.copied) counts.copied++;
      } else {
        counts.imageMissing++;
        log.write(`WARN  user ${String(id).padEnd(12)} avatar not downloaded yet: ${u.image}\n`);
      }
    }

    u.posts.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
    u.comments.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));

    const profile = profileFor(id);
    if (profile) {
      counts.withProfile++;
      if (profile.member_since) counts.withMemberSince++;
    }
    if (u.posts.length === 0 && u.comments.length === 0) counts.postlessMembers++;

    const doc = {
      user: id,
      name: u.name ?? [...u.names][0] ?? profile?.name ?? null,
      also_known_as: [...u.names].filter((n) => n !== u.name).sort(),
      path: u.path,
      image: u.image,
      picture,
      ...(profile ? {
        profile,
        profile_source: {
          archive: nextProfileCache[id]?.archive ?? null,
          timestamp: nextProfileCache[id]?.ts ?? null,
        },
      } : {}),
      first_seen: u.first,
      last_seen: u.last,
      counts: { posts: u.posts.length, comments: u.comments.length },
      posts: u.posts,
      comments: u.comments,
    };

    const out = YAML.stringify(doc, { lineWidth: 0, blockQuote: "literal" });
    const file = `${USERS_DIR}/${id}.yaml`;
    expectedUserFiles.add(`${id}.yaml`);
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
      ...(profile ? {
        city: profile.city ?? null,
        country: profile.country ?? null,
        member_since: profile.member_since ?? null,
      } : {}),
    }));
  }

  // This directory is derived from the current observations. Parser fixes can
  // merge identities (for example `user-103` into numeric user 103), so stale
  // records and their copied pictures must not survive a rebuild.
  for (const name of fs.readdirSync(USERS_DIR)) {
    if (!name.endsWith(".yaml") || expectedUserFiles.has(name)) continue;
    fs.unlinkSync(path.join(USERS_DIR, name));
    counts.staleRemoved++;
  }
  if (fs.existsSync(PICTURES_DIR)) {
    for (const name of fs.readdirSync(PICTURES_DIR)) {
      const file = path.join(PICTURES_DIR, name);
      if (!fs.statSync(file).isFile() || expectedPictures.has(name)) continue;
      fs.unlinkSync(file);
      counts.stalePicturesRemoved++;
    }
  }

  fs.writeFileSync(`${INDEX_FILE}.part`, indexLines.join("\n") + "\n");
  fs.renameSync(`${INDEX_FILE}.part`, INDEX_FILE);

  fs.writeFileSync(`${PROFILE_CACHE}.part`, JSON.stringify(nextProfileCache));
  fs.renameSync(`${PROFILE_CACHE}.part`, PROFILE_CACHE);

  await new Promise((resolve) => log.end(resolve));
  fs.renameSync(`${LOG_FILE}.part`, LOG_FILE);

  writeJson(`${DATA}/parsed/users.meta.json`, {
    ...counts, picturesOnDisk: lookup.size, generatedAt: new Date().toISOString(),
  });

  console.log(`byline observations . ${formatCount(seen)}`);
  console.log(`members ............. ${formatCount(counts.users)}  (${formatCount(counts.slugIds)} without a numeric id)`);
  console.log(`  written ........... ${formatCount(counts.written)}`);
  console.log(`  unchanged ......... ${formatCount(counts.unchanged)}`);
  if (counts.staleRemoved) console.log(`  stale removed ..... ${formatCount(counts.staleRemoved)}`);
  console.log(`profiles parsed ..... ${formatCount(counts.withProfile)}  (${formatCount(profilesParsed)} read, ${formatCount(profilesCached)} cached)`);
  console.log(`  with a join date .. ${formatCount(counts.withMemberSince)}`);
  console.log(`  no posts or replies ${formatCount(counts.postlessMembers)}`);
  console.log(`avatars referenced .. ${formatCount(counts.withImage)}`);
  console.log(`  copied ............ ${formatCount(counts.copied)}`);
  console.log(`  not downloaded .... ${formatCount(counts.imageMissing)}`);
  if (counts.stalePicturesRemoved) console.log(`  stale removed ..... ${formatCount(counts.stalePicturesRemoved)}`);
  console.log(`\nmembers -> ${USERS_DIR}/<id>.yaml`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
