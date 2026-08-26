// Step 4 -- download the chosen captures, per archive.
//
// Safe to run as often as you like: a file is only fetched when it is missing
// or when what is on disk is not the exact capture we want. "Exact" is not a
// guess -- every archive publishes a base32 SHA-1 of the response payload, and
// we retrieve exactly those bytes, so each file is verified byte for byte.
//
//   node src/004_download.js
//   node src/004_download.js --archive=arquivo.pt
//   node src/004_download.js --concurrency=6 --dry-run
//   node src/004_download.js --verify        re-hash files instead of trusting the cache
//   node src/004_download.js --skip-failed   don't retry captures that failed before

import fs from "fs";
import path from "path";
import { archiveDirs, HTTP } from "./lib/config.js";
import { selectArchives } from "./lib/archives/index.js";
import { fetchRaw, fetchRange } from "./lib/http.js";
import { parseWarcRecord } from "./lib/warc.js";
import {
  ensureDir, ensureDirCached, readJsonl, digestOfBuffer, digestOfFile,
  parseArgs, formatCount, formatBytes, acquireLock,
} from "./lib/util.js";

const args = parseArgs();
const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : HTTP.concurrency;
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
const dryRun = Boolean(args["dry-run"]);
const forceVerify = Boolean(args.verify);
const skipFailed = Boolean(args["skip-failed"]);

let stopping = false;
const onStop = () => {
  if (stopping) return;
  stopping = true;
  process.stdout.write("\n\nstopping -- letting in-flight downloads finish ...\n");
};
process.on("SIGINT", onStop);
process.on("SIGTERM", onStop);

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "?";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

function statOf(file) {
  try {
    const s = fs.statSync(file);
    return s.isFile() ? s : null;
  } catch { return null; }
}

// Retrieve the payload bytes for one job, whichever way this archive serves
// them, plus any metadata only visible at fetch time.
async function retrieve(job) {
  if (job.fetch.t === "warc") {
    const res = await fetchRange(job.fetch.u, job.fetch.o, job.fetch.l);
    const record = parseWarcRecord(res.body);
    return {
      body: record.payload,
      meta: record.truncated ? { truncated: record.truncated } : {},
    };
  }
  const res = await fetchRaw(job.fetch.u);
  return { body: res.body, meta: {} };
}

async function runArchive(archive) {
  const dirs = archiveDirs(archive.id);
  if (!fs.existsSync(dirs.downloads)) {
    console.log(`   no downloads.jsonl -- run step 003 first`);
    return null;
  }

  ensureDir(dirs.files);
  ensureDir(dirs.state);

  // Refuse to run alongside another downloader for this archive.
  const releaseLock = acquireLock(`${dirs.state}/download.lock`, `download of ${archive.id}`);

  // --- state: append-only log, compacted at the end -------------------------
  const state = new Map();
  if (fs.existsSync(dirs.downloadState)) {
    for (const line of fs.readFileSync(dirs.downloadState, "utf8").split("\n")) {
      if (!line) continue;
      try { const r = JSON.parse(line); state.set(r.k, r); } catch { /* torn line */ }
    }
  }

  const jobs = [];
  for await (const job of readJsonl(dirs.downloads)) {
    jobs.push(job);
    if (jobs.length >= limit) break;
  }

  const stats = { total: jobs.length, cached: 0, verified: 0, downloaded: 0,
                  mismatched: 0, recovered: 0, failed: 0, truncated: 0, bytes: 0 };

  console.log(`   ${formatCount(jobs.length)} captures -> ${dirs.files}/${dryRun ? "  [dry run]" : ""}`);
  console.log(`   ${state.size ? formatCount(state.size) + " known files" : "no previous state"}, concurrency ${concurrency}`);

  const stateOut = fs.createWriteStream(dirs.downloadState, { flags: "a" });
  const failuresOut = fs.createWriteStream(dirs.failures, { flags: "a" });
  const recordState = (r) => { state.set(r.k, r); stateOut.write(JSON.stringify(r) + "\n"); };
  const recordFailure = (job, reason) =>
    failuresOut.write(JSON.stringify({
      k: job.k, url: job.url, ts: job.ts, archive: archive.id, reason,
      at: new Date().toISOString(),
    }) + "\n");

  async function alreadyCorrect(job, target) {
    const known = state.get(job.k);
    const stat = statOf(target);
    if (!stat) return false;

    if (!forceVerify && known && known.ok && known.d === job.d && known.f === job.file &&
        known.size === stat.size && known.mtime === Math.round(stat.mtimeMs)) {
      stats.cached++;
      return true;
    }

    // Hash whatever is there -- this also rescues a lost state file.
    const digest = await digestOfFile(target);
    if (digest === job.d) {
      recordState({ k: job.k, ts: job.ts, d: job.d, f: job.file,
                    size: stat.size, mtime: Math.round(stat.mtimeMs), ok: true });
      stats.verified++;
      return true;
    }
    return false;
  }

  async function handle(job) {
    const target = path.join(dirs.files, job.file);
    if (await alreadyCorrect(job, target)) return;

    if (skipFailed) {
      const known = state.get(job.k);
      if (known && !known.ok && known.d === job.d) { stats.failed++; return; }
    }
    if (dryRun) { stats.downloaded++; return; }

    let got;
    try {
      got = await retrieve(job);
    } catch (err) {
      stats.failed++;
      recordFailure(job, err.message);
      return;
    }

    let digest = digestOfBuffer(got.body);
    const matches = digest === job.d;

    // A mismatch usually means the stored original is damaged or the exact
    // snapshot cannot be replayed. If the archive offers a second route to
    // the page, take whichever gives us more of it.
    if (!matches && archive.buildFallback) {
      const fallback = archive.buildFallback(job);
      if (fallback) {
        try {
          const alt = await fetchRaw(fallback.u);
          if (alt.body.length > got.body.length) {
            got = { body: alt.body, meta: { ...got.meta, source: "rewritten" } };
            digest = digestOfBuffer(got.body);
            stats.recovered++;
          }
        } catch {
          // keep whatever the original endpoint gave us
        }
      }
    }

    ensureDirCached(path.dirname(target));
    const tmp = `${target}.part`;
    try {
      fs.writeFileSync(tmp, got.body);
      fs.renameSync(tmp, target);
    } catch (err) {
      stats.failed++;
      recordFailure(job, `write failed: ${err.message}`);
      try { fs.unlinkSync(tmp); } catch {}
      return;
    }

    const stat = statOf(target);
    if (got.meta.truncated) stats.truncated++;
    recordState({
      k: job.k, ts: job.ts, d: job.d, f: job.file,
      size: stat ? stat.size : got.body.length,
      mtime: stat ? Math.round(stat.mtimeMs) : Date.now(),
      ok: matches,
      ...got.meta,
      ...(matches ? {} : { verified: false, actual: digest }),
    });

    stats.bytes += got.body.length;
    if (matches) stats.downloaded++;
    else {
      stats.mismatched++;
      recordFailure(job, `digest mismatch: expected ${job.d}, got ${digest}`);
    }
  }

  let done = 0, lastPrint = 0;
  const started = Date.now();
  const progress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPrint < 2000) return;
    lastPrint = now;
    const elapsed = (now - started) / 1000;
    const rate = done / Math.max(elapsed, 0.001);
    const eta = rate > 0 ? (stats.total - done) / rate : 0;
    process.stdout.write(
      `\r   ${formatCount(done)}/${formatCount(stats.total)}  new ${formatCount(stats.downloaded)}  ` +
      `have ${formatCount(stats.cached + stats.verified)}  bad ${formatCount(stats.mismatched)}  ` +
      `fail ${formatCount(stats.failed)}  ${rate.toFixed(1)}/s  eta ${formatDuration(eta)}   `
    );
  };

  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!stopping) {
      const i = cursor++;
      if (i >= jobs.length) return;
      await handle(jobs[i]);
      done++;
      progress();
    }
  }));
  progress(true);
  process.stdout.write("\n");

  await new Promise((r) => stateOut.end(r));
  await new Promise((r) => failuresOut.end(r));

  const compacted = [...state.values()].map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(`${dirs.downloadState}.part`, compacted + (compacted ? "\n" : ""));
  fs.renameSync(`${dirs.downloadState}.part`, dirs.downloadState);

  releaseLock();
  return { stats, done, jobs: jobs.length };
}

async function main() {
  for (const archive of selectArchives(args.archive)) {
    console.log(`\n=== ${archive.label} ===`);
    let result;
    try {
      result = await runArchive(archive);
    } catch (err) {
      if (err.code === "ELOCKED") {
        console.log(`   skipped: ${err.message}`);
        continue;
      }
      throw err;
    }
    if (!result) continue;
    const { stats } = result;
    const have = stats.cached + stats.verified;
    console.log(
      `   already correct .. ${formatCount(have)} (${formatCount(stats.cached)} cached, ${formatCount(stats.verified)} re-hashed)\n` +
      `   downloaded ....... ${formatCount(stats.downloaded)}\n` +
      `   digest mismatch .. ${formatCount(stats.mismatched)}\n` +
      `   failed ........... ${formatCount(stats.failed)}\n` +
      (stats.recovered ? `   recovered whole .. ${formatCount(stats.recovered)} (via rewritten replay, not byte-verified)\n` : "") +
      (stats.truncated ? `   truncated by CC .. ${formatCount(stats.truncated)}\n` : "") +
      `   transferred ...... ${formatBytes(stats.bytes)}`
    );
    if (stopping && result.done < result.jobs) {
      console.log(`   interrupted at ${formatCount(result.done)}/${formatCount(result.jobs)} -- run again to continue`);
    }
    if (stopping) break;
  }
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
