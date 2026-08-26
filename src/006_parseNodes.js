// Step 6 -- parse the chosen node pages into one YAML file each.
//
// The HTML is preserved exactly as it appeared in the post and in each
// comment; nothing is rewritten or stripped here. Anything that cannot be
// extracted is written to the parse log rather than silently dropped.
//
//   node src/006_parseNodes.js
//   node src/006_parseNodes.js --force        re-parse everything
//   node src/006_parseNodes.js --limit=50

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import YAML from "yaml";
import { DATA } from "./lib/config.js";
import { detectGeneration } from "./lib/generations.js";
import { userIdFor } from "./lib/users.js";
import { totalPagesFrom } from "./lib/pager.js";
import { ensureDir, ensureDirCached, readJsonl, writeJson, parseArgs, formatCount } from "./lib/util.js";

const args = parseArgs();
const force = Boolean(args.force);
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;

const IN_FILE = `${DATA}/combined/nodes.jsonl`;
const OUT = `${DATA}/parsed`;
const NODES_OUT = `${OUT}/nodes`;
const LOG_FILE = `${OUT}/parse.log`;
const STATE_FILE = `${OUT}/state.json`;
// Everything the byline said about an author, kept out of the thread files so
// a member's name and avatar are stored once rather than 84,000 times. Step 7
// turns this into one file per member.
const OBSERVATIONS_FILE = `${OUT}/users/_observations.jsonl`;

// A thread entry carries a reference to its author, not a copy of them.
function toEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    user: userIdFor(entry),
    date: entry.date,
    date_raw: entry.date_raw,
    votes: entry.votes,
    html: entry.html,
  };
}

function toObservation(entry, kind, ctx) {
  const user = userIdFor(entry);
  if (user === null) return null;
  return {
    user,
    name: entry.user_name ?? null,
    path: entry.user_path ?? null,
    image: entry.user_image ?? null,
    node: ctx.node,
    title: ctx.title ?? null,
    forum: ctx.forum ?? null,
    kind,
    comment: kind === "comment" ? entry.id ?? null : null,
    date: entry.date ?? null,
  };
}

// A change to the parsers must invalidate everything they produced, otherwise
// a fixed bug quietly leaves stale YAML behind. Hashing the source that does
// the work makes that automatic instead of something to remember.
function parserVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const hash = crypto.createHash("sha1");
  for (const f of [`${here}/lib/generations.js`, `${here}/006_parseNodes.js`]) {
    try { hash.update(fs.readFileSync(f)); } catch { /* ignore */ }
  }
  return hash.digest("hex").slice(0, 16);
}

// `data/parsed/state.json` records, per node, what its YAML was built from and
// what was wrong with it. It is the authority for skipping: the log is rebuilt
// in full on every run, and a node can only be skipped if its findings can be
// carried forward. A node missing from the state is re-parsed, which costs
// time but never leaves the log under-reporting.

// "20150418213620" -> "2015-04-18T21:36:20Z"
function captureIso(ts) {
  const s = String(ts);
  if (s.length < 14) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
}

function main() {
  if (!fs.existsSync(IN_FILE)) throw new Error(`missing ${IN_FILE} -- run step 005 first`);
  ensureDir(NODES_OUT);

  const parser = parserVersion();

  let state = {};
  if (fs.existsSync(STATE_FILE)) {
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { state = {}; }
  }
  const nextState = {};

  const log = fs.createWriteStream(`${LOG_FILE}.part`);
  const counts = {
    total: 0, parsed: 0, skipped: 0, failed: 0,
    warnings: 0, errors: 0, truncatedSource: 0, reparsedAfterParserChange: 0,
    multiPageThreads: 0, incompleteThreads: 0,
  };
  const byGeneration = {};
  const unknownSamples = [];

  // The log describes the whole corpus, not just this run's increment, so
  // findings for skipped nodes are replayed from the state file.
  const emit = (node, issues) => {
    for (const issue of issues) {
      if (issue.level === "error") counts.errors++;
      else counts.warnings++;
      if (issue.message.startsWith("source capture is truncated")) counts.truncatedSource++;
      log.write(`${issue.level.toUpperCase().padEnd(5)} node ${String(node).padEnd(7)} ${issue.message}\n`);
    }
  };

  return (async () => {
    for await (const pick of readJsonl(IN_FILE)) {
      counts.total++;
      if (counts.total > limit) { counts.total--; break; }

      const outFile = `${NODES_OUT}/${pick.node}.yaml`;

      // Re-runs only redo what actually changed. The fingerprint covers the
      // archive, timestamp, digest, file, size and soundness of the chosen
      // capture, so a re-download of the SAME timestamp that produced
      // different bytes is caught too.
      const known = state[pick.node];
      if (!force && known && fs.existsSync(outFile) && known.fp === pick.fp) {
        if (known.parser === parser) {
          counts.skipped++;
          nextState[pick.node] = known;
          if (known.generation) byGeneration[known.generation] = (byGeneration[known.generation] || 0) + 1;
          emit(pick.node, known.issues ?? []);
          continue;
        }
        counts.reparsedAfterParserChange++;
      }

      const issues = [];
      const parts = pick.pages ?? [];
      if (parts.length === 0) {
        emit(pick.node, [{ level: "error", message: "no pages selected for this thread" }]);
        counts.failed++;
        continue;
      }

      // A long thread was split across pages of 50 comments, and the opening
      // post repeats on every one. Take the post from the first page we can
      // read and concatenate the comments in page order.
      let generation = null;
      let result = null;
      let primary = null;
      let totalPages = null;
      const comments = [];
      const seenComments = new Set();
      const pagesRead = [];

      for (const part of parts) {
        let html;
        try {
          html = fs.readFileSync(part.file, "utf8");
        } catch (err) {
          issues.push({ level: "error", message: `page ${part.page}: cannot read ${part.file}: ${err.message}` });
          continue;
        }

        const $ = cheerio.load(html);
        const gen = detectGeneration($);
        if (!gen) {
          issues.push({ level: "error", message: `page ${part.page}: unknown page generation -- ${part.archive} ${part.ts}` });
          if (unknownSamples.length < 20) {
            unknownSamples.push({ node: pick.node, page: part.page, archive: part.archive, ts: part.ts, file: part.file });
          }
          continue;
        }

        const reported = totalPagesFrom($);
        if (reported !== null) totalPages = Math.max(totalPages ?? 0, reported);

        let parsed;
        try {
          parsed = gen.parse($, { nodeId: pick.node });
        } catch (err) {
          issues.push({ level: "error", message: `page ${part.page}: ${gen.id} parser threw: ${err.message}` });
          continue;
        }

        const isFirstUsable = result === null;
        if (isFirstUsable) {
          result = parsed;
          generation = gen;
          primary = part;
        }

        for (const c of parsed.comments ?? []) {
          const key = c.id ?? `p${part.page}:${comments.length}`;
          if (seenComments.has(key)) continue;
          seenComments.add(key);
          comments.push(c);
        }

        for (const issue of parsed.issues) {
          // The post is repeated on every page; only report its problems once.
          if (!isFirstUsable && issue.field?.startsWith("post")) continue;
          const where = parts.length > 1 ? ` [page ${part.page}]` : "";
          issues.push({
            level: issue.level,
            message: `${issue.field}${issue.ref ? ` (${issue.ref})` : ""}: ${issue.message}${where}`,
          });
        }

        if (part.truncated) {
          issues.push({
            level: "warn",
            message: `page ${part.page} capture is truncated (${part.archive} ${part.ts}) -- content may be incomplete`,
          });
        }
        pagesRead.push(part.page);
      }

      if (!result) {
        emit(pick.node, issues.length ? issues : [{ level: "error", message: "no page could be parsed" }]);
        counts.failed++;
        continue;
      }

      byGeneration[generation.id] = (byGeneration[generation.id] || 0) + 1;
      result.comments = comments;

      // Say plainly when a thread is only partly recovered.
      const pageCount = totalPages ?? (pagesRead.length ? Math.max(...pagesRead) + 1 : 1);
      const missingPages = [];
      for (let i = 0; i < pageCount; i++) if (!pagesRead.includes(i)) missingPages.push(i);
      if (missingPages.length) {
        counts.incompleteThreads++;
        issues.push({
          level: "warn",
          message: `thread has ${pageCount} page(s), ${pagesRead.length} recovered -- missing page(s) ${missingPages.slice(0, 12).join(", ")}${missingPages.length > 12 ? ` and ${missingPages.length - 12} more` : ""}`,
        });
      }
      if (parts.length > 1) counts.multiPageThreads++;

      emit(pick.node, issues);

      const ctx = { node: pick.node, title: result.title, forum: result.forum?.id ?? null };
      const observations = [];
      for (const [entry, kind] of [
        [result.post, "post"],
        ...(result.comments ?? []).map((c) => [c, "comment"]),
      ]) {
        const ob = toObservation(entry, kind, ctx);
        if (ob) observations.push(ob);
      }

      const doc = {
        node: pick.node,
        title: result.title,
        forum: result.forum,
        source: {
          archive: primary.archive,
          timestamp: primary.ts,
          captured_at: captureIso(primary.ts),
          url: primary.url,
          digest: primary.digest,
          verified: primary.verified,
          // True when ANY page we used was cut short.
          truncated: parts.some((p) => p.truncated),
          sound: parts.every((p) => p.sound !== false),
          content: primary.source,
          generation: generation.id,
          file: primary.file,
          fingerprint: pick.fp,
          parser,
        },
        // How much of a paginated thread we actually hold.
        pages: {
          total: pageCount,
          recovered: pagesRead.length,
          complete: missingPages.length === 0,
          have: pagesRead,
          ...(missingPages.length ? { missing: missingPages } : {}),
          parts: parts.map((p) => ({
            page: p.page,
            archive: p.archive,
            timestamp: p.ts,
            digest: p.digest,
            verified: p.verified,
            truncated: p.truncated,
            file: p.file,
          })),
        },
        post: toEntry(result.post),
        comments: (result.comments ?? []).map(toEntry),
      };

      ensureDirCached(path.dirname(outFile));
      const tmp = `${outFile}.part`;
      fs.writeFileSync(tmp, YAML.stringify(doc, { lineWidth: 0, blockQuote: "literal" }));
      fs.renameSync(tmp, outFile);
      nextState[pick.node] = {
        fp: pick.fp, parser, generation: generation.id,
        ...(issues.length ? { issues } : {}),
        ...(observations.length ? { users: observations } : {}),
      };
      counts.parsed++;

      if (counts.parsed % 1000 === 0) {
        process.stdout.write(`\r   parsed ${formatCount(counts.parsed)} ...`);
      }
    }

    await new Promise((r) => log.end(r));
    fs.renameSync(`${LOG_FILE}.part`, LOG_FILE);

    fs.writeFileSync(`${STATE_FILE}.part`, JSON.stringify(nextState));
    fs.renameSync(`${STATE_FILE}.part`, STATE_FILE);

    // Rewritten in full every run, including for skipped threads, so it always
    // describes the whole corpus.
    ensureDir(path.dirname(OBSERVATIONS_FILE));
    const obs = fs.createWriteStream(`${OBSERVATIONS_FILE}.part`);
    let observed = 0;
    for (const node of Object.keys(nextState)) {
      for (const ob of nextState[node].users ?? []) {
        obs.write(JSON.stringify(ob) + "\n");
        observed++;
      }
    }
    await new Promise((resolve) => obs.end(resolve));
    fs.renameSync(`${OBSERVATIONS_FILE}.part`, OBSERVATIONS_FILE);
    counts.observations = observed;

    writeJson(`${OUT}/parse.meta.json`, {
      ...counts, parser, byGeneration, unknownSamples, generatedAt: new Date().toISOString(),
    });

    process.stdout.write("\r");
    console.log(`nodes considered .... ${formatCount(counts.total)}`);
    console.log(`parsed .............. ${formatCount(counts.parsed)}`);
    console.log(`unchanged (skipped) . ${formatCount(counts.skipped)}`);
    console.log(`failed .............. ${formatCount(counts.failed)}`);
    console.log(`multi-page threads .. ${formatCount(counts.multiPageThreads)}`);
    console.log(`partly recovered .... ${formatCount(counts.incompleteThreads)} thread(s) are missing page(s)`);
    if (counts.reparsedAfterParserChange) {
      console.log(`re-parsed because the parser changed: ${formatCount(counts.reparsedAfterParserChange)}`);
    }
    if (counts.parsed === 0 && counts.failed === 0) {
      console.log(`\neverything already up to date`);
    }
    console.log(`\nby generation:`);
    for (const [id, n] of Object.entries(byGeneration).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${id.padEnd(12)} ${formatCount(n)}`);
    }
    console.log(`\nlog: ${formatCount(counts.errors)} error(s), ${formatCount(counts.warnings)} warning(s) -> ${LOG_FILE}`);
    if (counts.truncatedSource) {
      console.log(`   of which ${formatCount(counts.truncatedSource)} are truncated source captures`);
    }
    console.log(`yaml: ${NODES_OUT}/<node>.yaml`);
  })();
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
