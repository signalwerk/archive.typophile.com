// Step 11 -- recover old Discus threads that have no captured Drupal node.
//
// Step 10 identifies legacy /forums/messages/<forum>/<thread>.html pages that
// cannot be joined to anything under /node/. Those are precisely the pages at
// risk of disappearing between the two systems. This step parses them into
// the ordinary thread shape, but keeps them in data/parsed/messages. Files are
// keyed by both old forum id and old message id because Discus could retain the
// same message id when a discussion moved between forums.
//
// A Discus URL often has several archived query-string snapshots. Posts that
// exist in an early snapshot can disappear from a later one, so choosing one
// page loses data. All snapshots of one exact forum/message URL are merged by
// Discus post id, with the latest observation winning when a post was edited.
//
//   node src/011_oldMessages.js

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import YAML from "yaml";
import { archiveDirs, DATA } from "./lib/config.js";
import { ARCHIVES } from "./lib/archives/index.js";
import { normaliseHtmlText, parseLegacyCapture } from "./lib/legacyThreads.js";
import { captureUrlPath, ensureDir, formatCount, urlKeyToUrl, writeFileAtomic, writeJson } from "./lib/util.js";

const MATCH_LOG = `${DATA}/parsed/old-urls.log`;
const NODES_DIR = `${DATA}/parsed/nodes`;
const OUT_DIR = `${DATA}/parsed/messages`;
const STAGE_DIR = `${OUT_DIR}.part`;
const PREVIOUS_DIR = `${OUT_DIR}.previous`;
const USERS_INDEX = `${DATA}/parsed/users/_index.jsonl`;
const LOG_FILE = `${DATA}/parsed/messages.log`;
const META_FILE = `${DATA}/parsed/messages.meta.json`;
const STATE_FILE = `${DATA}/parsed/messages-state.json`;

function parserVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const hash = crypto.createHash("sha1");
  for (const file of [`${here}/lib/legacyThreads.js`, fileURLToPath(import.meta.url)]) {
    hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex").slice(0, 16);
}

function captureIso(timestamp) {
  const value = String(timestamp ?? "");
  if (value.length < 14) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
}

function missingThreads() {
  if (!fs.existsSync(MATCH_LOG)) {
    throw new Error(`missing ${MATCH_LOG} -- run step 010 first`);
  }
  const discussions = new Map();
  for (const line of fs.readFileSync(MATCH_LOG, "utf8").split("\n")) {
    const match = /^MISSING\s+http:\/\/www\.typophile\.com\/forums\/messages\/(\d+)\/(\d+)\.html\b/.exec(line);
    if (!match) continue;
    const forum = Number(match[1]);
    const thread = Number(match[2]);
    const key = `${forum}-${thread}`;
    discussions.set(key, { key, forum, thread });
  }
  return discussions;
}

function matchedThreads() {
  const discussions = new Map();
  const prefix = Buffer.alloc(2048);
  for (const name of fs.readdirSync(NODES_DIR)) {
    const nodeMatch = /^(\d+)\.yaml$/.exec(name);
    if (!nodeMatch) continue;
    const file = path.join(NODES_DIR, name);
    let size = 0;
    let fd;
    try {
      fd = fs.openSync(file, "r");
      size = fs.readSync(fd, prefix, 0, prefix.length, 0);
    } catch { continue; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    const urlMatch = /^old_url:\s+http:\/\/www\.typophile\.com\/forums\/messages\/(\d+)\/(\d+)\.html\s*$/m
      .exec(prefix.toString("utf8", 0, size));
    if (!urlMatch) continue;
    const forum = Number(urlMatch[1]);
    const thread = Number(urlMatch[2]);
    const key = `${forum}-${thread}`;
    discussions.set(key, {
      key,
      forum,
      thread,
      node: Number(nodeMatch[1]),
      file,
    });
  }
  return discussions;
}

function availableCaptures(wanted) {
  const byDiscussion = new Map([...wanted.keys()].map((key) => [key, []]));
  for (const archive of ARCHIVES) {
    const dirs = archiveDirs(archive.id);
    if (!fs.existsSync(dirs.downloadState)) continue;
    for (const line of fs.readFileSync(dirs.downloadState, "utf8").split("\n")) {
      if (!line.includes("typophile.com/forums/messages/")) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const relative = captureUrlPath(entry.f);
      const match = /^typophile\.com\/forums\/messages\/(\d+)\/(\d+)(?:__q_.+)?\.html$/i.exec(relative ?? "");
      if (!match) continue;
      const forum = Number(match[1]);
      const thread = Number(match[2]);
      const key = `${forum}-${thread}`;
      if (!wanted.has(key)) continue;
      const file = path.join(dirs.files, entry.f);
      if (!fs.existsSync(file)) continue;
      byDiscussion.get(key).push({
        archive: archive.id,
        file,
        relFile: file,
        filename: path.basename(relative),
        forum,
        timestamp: String(entry.ts ?? ""),
        digest: entry.d ?? null,
        verified: entry.ok === true,
        truncated: Boolean(entry.truncated),
        url: urlKeyToUrl(entry.k) ?? null,
      });
    }
  }
  return byDiscussion;
}

function fingerprint(captures, parser, resolutionVersion) {
  const value = captures
    .map((capture) => {
      const stat = fs.statSync(capture.file);
      return [capture.archive, capture.timestamp, capture.digest, capture.file, stat.size, Math.round(stat.mtimeMs)];
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return crypto.createHash("sha1")
    .update(JSON.stringify({ parser, resolutionVersion, value }))
    .digest("hex")
    .slice(0, 16);
}

function readKnownUsers() {
  if (!fs.existsSync(USERS_INDEX)) {
    throw new Error(`missing ${USERS_INDEX} -- run step 007 first`);
  }
  const source = fs.readFileSync(USERS_INDEX, "utf8");
  const ids = new Set();
  for (const line of source.split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.id != null) ids.add(String(entry.id));
    } catch { /* a torn line cannot establish a user */ }
  }
  return {
    ids,
    version: crypto.createHash("sha1").update(source).digest("hex").slice(0, 16),
  };
}

function cleanEntry(entry) {
  return {
    id: entry.id,
    user: entry.user,
    date: entry.date,
    date_raw: entry.date_raw,
    votes: entry.votes,
    html: entry.html,
  };
}

function auditUsers(entries, resolver) {
  const audit = new Map();
  for (const entry of entries) {
    const legacyUser = entry.user;
    const key = legacyUser == null ? "<none>" : String(legacyUser);
    const mappedUser = resolver.resolved.get(key);
    const isAmbiguous = resolver.ambiguous.has(key);
    const candidates = resolver.ambiguous.get(key) ?? resolver.unavailable.get(key) ?? [];
    const status = mappedUser !== undefined
      ? "resolved"
      : isAmbiguous ? "ambiguous" : "unresolved";
    if (!audit.has(key)) {
      audit.set(key, {
        status,
        user: legacyUser,
        mappedUser: mappedUser ?? null,
        candidates,
        names: new Set(),
        profiles: new Set(),
        entries: 0,
      });
    }
    const finding = audit.get(key);
    if (entry._user_name) finding.names.add(entry._user_name);
    if (entry._user_path) finding.profiles.add(entry._user_path);
    finding.entries++;
    if (status === "resolved") entry.user = mappedUser;
  }
  return [...audit.values()].map((finding) => ({
    status: finding.status,
    user: finding.user,
    mappedUser: finding.mappedUser,
    candidates: finding.candidates,
    names: [...finding.names].sort(),
    profiles: [...finding.profiles].sort(),
    entries: finding.entries,
  }));
}

function addUserAudit(target, audit, discussion) {
  for (const finding of audit) {
    const key = finding.user == null ? "<none>" : String(finding.user);
    if (!target.has(key)) {
      target.set(key, {
        status: finding.status,
        user: finding.user,
        mappedUser: finding.mappedUser ?? null,
        candidates: finding.candidates ?? [],
        names: new Set(),
        profiles: new Set(),
        entries: 0,
        discussions: new Set(),
      });
    }
    const total = target.get(key);
    for (const name of finding.names ?? []) total.names.add(name);
    for (const profile of finding.profiles ?? []) total.profiles.add(profile);
    total.entries += finding.entries ?? 0;
    total.discussions.add(discussion);
  }
}

function mergeCaptures(captures) {
  const parsed = [];
  for (const capture of [...captures].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    let page;
    try {
      page = parseLegacyCapture(
        fs.readFileSync(capture.file, "utf8"), capture.forum, capture.filename
      );
    } catch { page = null; }
    if (page) parsed.push({ ...capture, page });
  }
  if (parsed.length === 0) return null;

  // Captures were sorted oldest to newest, so replacing by id retains edits
  // and the most recent surviving byline without losing older-only posts.
  const posts = new Map();
  for (const capture of parsed) {
    for (const post of capture.page.posts) posts.set(post.id, post);
  }
  const ordered = [...posts.values()].sort((a, b) => {
    if (a._time != null && b._time != null && a._time !== b._time) return a._time - b._time;
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
    return a.id - b.id;
  });
  if (ordered.length === 0) return null;
  return { parsed, ordered, primary: parsed[parsed.length - 1] };
}

// A migrated discussion gives direct identity evidence: the Discus author on
// an old post and the Drupal user on that same migrated post are the same
// person. Discus and Drupal used different reply ids, so replies are aligned
// only on an exact local timestamp + normalised body signature. The opening
// post is aligned by its already established old-thread -> node relation.
// Conflicting evidence is kept ambiguous rather than resolved by name.
function buildUserResolver(matched, captures, users) {
  const evidence = new Map();
  const counts = {
    threads: matched.size,
    compared: 0,
    entries: 0,
    missingCapture: 0,
    unreadableNode: 0,
    missingTarget: 0,
  };

  function addEvidence(oldEntry, newEntry) {
    if (oldEntry?.user == null || newEntry?.user == null) return;
    const targetKey = String(newEntry.user);
    const targetKnown = users.ids.has(targetKey);
    if (!targetKnown) counts.missingTarget++;
    const legacyKey = String(oldEntry.user);
    if (!evidence.has(legacyKey)) evidence.set(legacyKey, new Map());
    const candidates = evidence.get(legacyKey);
    if (!candidates.has(targetKey)) {
      candidates.set(targetKey, { user: newEntry.user, known: targetKnown, entries: 0 });
    }
    candidates.get(targetKey).entries++;
    counts.entries++;
  }

  for (const match of matched.values()) {
    const legacy = mergeCaptures(captures.get(match.key) ?? []);
    if (!legacy) {
      counts.missingCapture++;
      continue;
    }
    let node;
    try { node = YAML.parse(fs.readFileSync(match.file, "utf8")); }
    catch { counts.unreadableNode++; continue; }
    if (!node?.post) {
      counts.unreadableNode++;
      continue;
    }
    counts.compared++;
    addEvidence(legacy.ordered[0], node.post);

    const bySignature = new Map();
    for (const entry of [node.post, ...(node.comments ?? [])]) {
      if (!entry.date || !entry.html) continue;
      const signature = `${entry.date}\0${normaliseHtmlText(entry.html)}`;
      if (!bySignature.has(signature)) bySignature.set(signature, []);
      bySignature.get(signature).push(entry);
    }
    for (const oldEntry of legacy.ordered.slice(1)) {
      if (!oldEntry.date || !oldEntry.html) continue;
      const signature = `${oldEntry.date}\0${normaliseHtmlText(oldEntry.html)}`;
      const candidates = bySignature.get(signature) ?? [];
      if (candidates.length === 1) addEvidence(oldEntry, candidates[0]);
    }
  }

  const resolved = new Map();
  const ambiguous = new Map();
  const unavailable = new Map();
  const versionInput = [];
  for (const [legacyUser, found] of [...evidence].sort((a, b) => a[0].localeCompare(b[0]))) {
    const candidates = [...found.values()]
      .sort((a, b) => String(a.user).localeCompare(String(b.user), "en", { numeric: true }));
    versionInput.push([legacyUser, candidates.map((candidate) => candidate.user)]);
    if (candidates.length === 1 && candidates[0].known) {
      resolved.set(legacyUser, candidates[0].user);
    } else if (candidates.length === 1) {
      unavailable.set(legacyUser, [candidates[0].user]);
    }
    else ambiguous.set(legacyUser, candidates.map((candidate) => candidate.user));
  }
  return {
    resolved,
    ambiguous,
    unavailable,
    counts,
    version: crypto.createHash("sha1")
      .update(JSON.stringify({ users: users.version, evidence: versionInput }))
      .digest("hex")
      .slice(0, 16),
  };
}

// Build the whole directory beside the published one, then swap it into
// place. Step 10's MISSING set can shrink when new Drupal captures arrive;
// reconstructing from that set guarantees that a newly matched discussion is
// removed rather than surviving as an unreferenced YAML file. The old
// directory remains intact until the replacement is complete.
function prepareStage() {
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  ensureDir(STAGE_DIR);
}

function publishStage() {
  fs.rmSync(PREVIOUS_DIR, { recursive: true, force: true });
  const hadPrevious = fs.existsSync(OUT_DIR);
  if (hadPrevious) fs.renameSync(OUT_DIR, PREVIOUS_DIR);
  try {
    fs.renameSync(STAGE_DIR, OUT_DIR);
  } catch (err) {
    if (hadPrevious && !fs.existsSync(OUT_DIR)) {
      fs.renameSync(PREVIOUS_DIR, OUT_DIR);
    }
    throw err;
  }
  fs.rmSync(PREVIOUS_DIR, { recursive: true, force: true });
}

function mergeThread(thread, captures, parser, resolver) {
  const merged = mergeCaptures(captures);
  if (!merged) return null;
  const { parsed, ordered, primary } = merged;
  const userAudit = auditUsers(ordered, resolver);
  const fp = fingerprint(captures, parser, resolver.version);
  const part = {
    page: 0,
    archive: primary.archive,
    timestamp: primary.timestamp,
    digest: primary.digest,
    verified: primary.verified,
    truncated: primary.truncated,
    file: primary.relFile,
  };
  return {
    doc: {
      node: thread,
      title: primary.page.title || null,
      old_url: primary.page.url,
      forum: {
        id: primary.page.forum,
        title: primary.page.forumTitle,
      },
      source: {
        archive: primary.archive,
        timestamp: primary.timestamp,
        captured_at: captureIso(primary.timestamp),
        url: primary.url ?? primary.page.url,
        digest: primary.digest,
        verified: primary.verified,
        truncated: primary.truncated,
        sound: primary.verified && !primary.truncated,
        content: parsed.length > 1 ? "merged snapshots" : "original",
        generation: "discus",
        file: primary.relFile,
        snapshots: parsed.length,
      },
      pages: {
        total: 1,
        recovered: 1,
        complete: true,
        have: [0],
        parts: [part],
      },
      post: cleanEntry(ordered[0]),
      comments: ordered.slice(1).map(cleanEntry),
    },
    capturesParsed: parsed.length,
    postsRecovered: ordered.length,
    userAudit,
    fp,
  };
}

function main() {
  const wanted = missingThreads();
  const matched = matchedThreads();
  const allDiscussions = new Map([...wanted, ...matched]);
  const captures = availableCaptures(allDiscussions);
  const parser = parserVersion();
  const users = readKnownUsers();
  const resolver = buildUserResolver(matched, captures, users);
  prepareStage();

  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { /* first run */ }
  const nextState = {};
  const log = [];
  const userAudit = new Map();
  const counts = {
    urls: wanted.size,
    threads: wanted.size,
    parsed: 0,
    skipped: 0,
    failed: 0,
    captures: 0,
    posts: 0,
    comments: 0,
    missingDate: 0,
    missingUser: 0,
    emptyHtml: 0,
    resolvedUsers: 0,
    resolvedEntries: 0,
    unresolvedUsers: 0,
    unresolvedEntries: 0,
    ambiguousUsers: 0,
    ambiguousEntries: 0,
    staleRemoved: fs.existsSync(OUT_DIR)
      ? fs.readdirSync(OUT_DIR).filter((name) =>
          name.endsWith(".yaml") && !wanted.has(name.slice(0, -5))
        ).length
      : 0,
  };

  const discussions = [...wanted.values()].sort((a, b) =>
    a.forum - b.forum || a.thread - b.thread
  );
  for (const discussion of discussions) {
    const { key, forum, thread } = discussion;
    const found = captures.get(key) ?? [];
    const currentFile = path.join(OUT_DIR, `${key}.yaml`);
    const outFile = path.join(STAGE_DIR, `${key}.yaml`);
    if (found.length === 0) {
      counts.failed++;
      log.push(`ERROR message ${forum}/${thread}  no downloaded capture found`);
      continue;
    }
    const fp = fingerprint(found, parser, resolver.version);
    if (state[key]?.fp === fp && state[key]?.parser === parser && fs.existsSync(currentFile)) {
      fs.copyFileSync(currentFile, outFile);
      nextState[key] = state[key];
      counts.skipped++;
      counts.captures += state[key].captures ?? 0;
      counts.posts += state[key].posts ?? 0;
      counts.comments += state[key].comments ?? 0;
      counts.missingDate += state[key].missingDate ?? 0;
      counts.missingUser += state[key].missingUser ?? 0;
      counts.emptyHtml += state[key].emptyHtml ?? 0;
      addUserAudit(userAudit, state[key].userAudit ?? [], key);
      continue;
    }

    const merged = mergeThread(thread, found, parser, resolver);
    if (!merged) {
      counts.failed++;
      log.push(`ERROR message ${forum}/${thread}  captures contain no parseable discussion posts`);
      continue;
    }
    const entries = [merged.doc.post, ...merged.doc.comments];
    const findings = {
      missingDate: entries.filter((entry) => !entry.date).length,
      missingUser: entries.filter((entry) => entry.user == null).length,
      emptyHtml: entries.filter((entry) => !entry.html).length,
    };
    for (const [kind, number] of Object.entries(findings)) {
      if (number) log.push(`WARN  message ${forum}/${thread}  ${number} ${kind} entr${number === 1 ? "y" : "ies"}`);
    }

    writeFileAtomic(
      outFile,
      YAML.stringify(merged.doc, { lineWidth: 0, blockQuote: "literal" })
    );
    nextState[key] = {
      fp: merged.fp,
      parser,
      captures: merged.capturesParsed,
      posts: merged.postsRecovered,
      comments: merged.doc.comments.length,
      userAudit: merged.userAudit,
      ...findings,
    };
    addUserAudit(userAudit, merged.userAudit, key);
    counts.parsed++;
    counts.captures += merged.capturesParsed;
    counts.posts += merged.postsRecovered;
    counts.comments += merged.doc.comments.length;
    counts.missingDate += findings.missingDate;
    counts.missingUser += findings.missingUser;
    counts.emptyHtml += findings.emptyHtml;
  }

  for (const finding of userAudit.values()) {
    const prefix = finding.status === "resolved"
      ? "resolved" : finding.status === "ambiguous" ? "ambiguous" : "unresolved";
    counts[`${prefix}Users`]++;
    counts[`${prefix}Entries`] += finding.entries;
  }
  const problems = [...userAudit.entries()].filter(([, finding]) =>
    finding.status !== "resolved"
  );
  if (problems.length) {
    log.push("# UNRESOLVED_USER has no migrated-post evidence for a Drupal user.");
    log.push("# AMBIGUOUS_USER has migrated posts pointing to multiple Drupal users.");
    log.push("# Names are evidence only; step 11 never guesses an account from a display name.");
    log.push("");
    for (const [key, finding] of problems.sort((a, b) => a[0].localeCompare(b[0]))) {
      const label = finding.status === "ambiguous" ? "AMBIGUOUS_USER" : "UNRESOLVED_USER";
      log.push(
        `${label} user=${JSON.stringify(finding.user)} ` +
        `candidates=${JSON.stringify(finding.candidates)} ` +
        `profiles=${JSON.stringify([...finding.profiles].sort())} ` +
        `names=${JSON.stringify([...finding.names].sort())} ` +
        `entries=${finding.entries} discussions=${finding.discussions.size}`
      );
    }
  }

  publishStage();
  writeFileAtomic(LOG_FILE, log.join("\n") + (log.length ? "\n" : ""));
  writeFileAtomic(STATE_FILE, JSON.stringify(nextState));
  writeJson(META_FILE, { ...counts, parser, generatedAt: new Date().toISOString() });

  console.log(`missing old urls .... ${formatCount(counts.urls)}`);
  console.log(`legacy discussions .. ${formatCount(counts.threads)}`);
  console.log(`  parsed ............. ${formatCount(counts.parsed)}`);
  console.log(`  already current .... ${formatCount(counts.skipped)}`);
  if (counts.failed) console.log(`  failed ............. ${formatCount(counts.failed)}`);
  if (counts.staleRemoved) console.log(`  stale removed ...... ${formatCount(counts.staleRemoved)}`);
  console.log(`snapshots merged ..... ${formatCount(counts.captures)}`);
  console.log(`posts recovered ...... ${formatCount(counts.posts)} (${formatCount(counts.comments)} replies)`);
  console.log(`findings ............. ${formatCount(counts.missingDate)} no date, ${formatCount(counts.missingUser)} no user, ${formatCount(counts.emptyHtml)} empty html`);
  console.log(`user map evidence .... ${formatCount(resolver.counts.entries)} posts in ${formatCount(resolver.counts.compared)} matched threads`);
  console.log(`  mappings learned ... ${formatCount(resolver.resolved.size)}`);
  if (resolver.ambiguous.size) console.log(`  mapping conflicts .. ${formatCount(resolver.ambiguous.size)}`);
  console.log(`resolved users ....... ${formatCount(counts.resolvedUsers)} (${formatCount(counts.resolvedEntries)} entries)`);
  console.log(`unresolved users ..... ${formatCount(counts.unresolvedUsers)} (${formatCount(counts.unresolvedEntries)} entries)`);
  if (counts.ambiguousUsers) console.log(`ambiguous users ...... ${formatCount(counts.ambiguousUsers)} (${formatCount(counts.ambiguousEntries)} entries)`);
  console.log(`\nyaml -> ${OUT_DIR}/<forum-id>-<old-message-id>.yaml`);
  console.log(`log  -> ${LOG_FILE}`);
}

try { main(); } catch (err) {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
}
