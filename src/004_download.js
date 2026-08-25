// Step 4 -- download the chosen captures.
//
// Safe to run as often as you like: a file is only fetched when it is missing
// or when what is on disk is not the exact capture we want. "Exact" is not a
// guess -- the CDX `digest` is the SHA-1 of the original response, and we ask
// the Wayback Machine for that same original (`id_`), so every file can be
// verified byte for byte.
//
//   node src/004_download.js
//   node src/004_download.js --concurrency=6
//   node src/004_download.js --dry-run
//   node src/004_download.js --verify        re-hash files instead of trusting the cache
//   node src/004_download.js --skip-failed   don't retry captures that failed before
//   node src/004_download.js --limit=500

import fs from "fs";
import path from "path";
import { DIRS, FILES, HTTP } from "./lib/config.js";
import { fetchRaw } from "./lib/http.js";
import {
  ensureDir,
  ensureDirCached,
  readJsonl,
  digestOfBuffer,
  digestOfFile,
  parseArgs,
  formatCount,
  formatBytes,
} from "./lib/util.js";

const args = parseArgs();
const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : HTTP.concurrency;
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
const dryRun = Boolean(args["dry-run"]);
const forceVerify = Boolean(args.verify);
const skipFailed = Boolean(args["skip-failed"]);

const stats = {
  total: 0,
  cached: 0,     // state says it is right, size+mtime unchanged
  verified: 0,   // hashed on disk, digest matched
  downloaded: 0,
  mismatched: 0, // downloaded, but not the capture the index promised
  failed: 0,
  bytes: 0,
};

let stopping = false;

// --- state -----------------------------------------------------------------
// Append-only log of what is on disk, compacted at the end of a run.

function loadState() {
  const state = new Map();
  if (!fs.existsSync(FILES.downloadState)) return state;
  for (const line of fs.readFileSync(FILES.downloadState, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const record = JSON.parse(line);
      state.set(record.k, record);
    } catch {
      // A run killed mid-write can leave one torn line; ignore it.
    }
  }
  return state;
}

let stateOut;
let failuresOut;

function recordState(record) {
  state.set(record.k, record);
  stateOut.write(JSON.stringify(record) + "\n");
}

function recordFailure(job, reason) {
  failuresOut.write(
    JSON.stringify({ k: job.k, url: job.url, ts: job.ts, reason, at: new Date().toISOString() }) + "\n"
  );
}

function compactState() {
  const lines = [...state.values()].map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(`${FILES.downloadState}.part`, lines + (lines ? "\n" : ""));
  fs.renameSync(`${FILES.downloadState}.part`, FILES.downloadState);
}

const state = loadState();

// --- per-job work ----------------------------------------------------------

function statOf(file) {
  try {
    const s = fs.statSync(file);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

// Is the correct capture already sitting on disk?
async function alreadyCorrect(job, target) {
  const known = state.get(job.k);
  const stat = statOf(target);

  if (!stat) return false;

  // Fast path: we checked this exact file before and nothing has touched it.
  if (
    !forceVerify &&
    known &&
    known.ok &&
    known.d === job.d &&
    known.f === job.file &&
    known.size === stat.size &&
    known.mtime === Math.round(stat.mtimeMs)
  ) {
    stats.cached++;
    return true;
  }

  // Slow path: hash whatever is there. This also rescues a lost state file.
  const digest = await digestOfFile(target);
  if (digest === job.d) {
    recordState({
      k: job.k,
      ts: job.ts,
      d: job.d,
      f: job.file,
      size: stat.size,
      mtime: Math.round(stat.mtimeMs),
      ok: true,
    });
    stats.verified++;
    return true;
  }

  return false;
}

async function handle(job) {
  const target = path.join(DIRS.files, job.file);

  if (await alreadyCorrect(job, target)) return;

  if (skipFailed) {
    const known = state.get(job.k);
    if (known && !known.ok && known.d === job.d) {
      stats.failed++;
      return;
    }
  }

  if (dryRun) {
    stats.downloaded++;
    return;
  }

  let res;
  try {
    res = await fetchRaw(job.replay);
  } catch (err) {
    stats.failed++;
    recordFailure(job, err.message);
    return;
  }

  const digest = digestOfBuffer(res.body);
  const matches = digest === job.d;

  ensureDirCached(path.dirname(target));
  const tmp = `${target}.part`;
  try {
    fs.writeFileSync(tmp, res.body);
    fs.renameSync(tmp, target);
  } catch (err) {
    // e.g. a path component already exists as a file, or the name is illegal
    stats.failed++;
    recordFailure(job, `write failed: ${err.message}`);
    try { fs.unlinkSync(tmp); } catch {}
    return;
  }

  const stat = statOf(target);
  recordState({
    k: job.k,
    ts: job.ts,
    d: job.d,
    f: job.file,
    size: stat ? stat.size : res.body.length,
    mtime: stat ? Math.round(stat.mtimeMs) : Date.now(),
    ok: matches,
    ...(matches ? {} : { actual: digest }),
  });

  stats.bytes += res.body.length;

  if (matches) {
    stats.downloaded++;
  } else {
    // Kept anyway -- it is still a real capture, just not the one the index
    // pointed at (the Wayback Machine substitutes a neighbour when the exact
    // snapshot cannot be replayed).
    stats.mismatched++;
    recordFailure(job, `digest mismatch: expected ${job.d}, got ${digest}`);
  }
}

// --- progress --------------------------------------------------------------

let done = 0;
const started = Date.now();
let lastPrint = 0;

function progress(force = false) {
  const now = Date.now();
  if (!force && now - lastPrint < 2000) return;
  lastPrint = now;

  const elapsed = (now - started) / 1000;
  const rate = done / Math.max(elapsed, 0.001);
  const left = stats.total - done;
  const eta = rate > 0 ? left / rate : 0;

  process.stdout.write(
    `\r  ${formatCount(done)}/${formatCount(stats.total)}  ` +
      `new ${formatCount(stats.downloaded)}  ` +
      `have ${formatCount(stats.cached + stats.verified)}  ` +
      `bad ${formatCount(stats.mismatched)}  ` +
      `fail ${formatCount(stats.failed)}  ` +
      `${rate.toFixed(1)}/s  eta ${formatDuration(eta)}   `
  );
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "?";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

// --- main ------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(FILES.downloads)) {
    throw new Error(`missing ${FILES.downloads} -- run step 003 first`);
  }

  ensureDir(DIRS.files);
  ensureDir(DIRS.state);

  const jobs = [];
  for await (const job of readJsonl(FILES.downloads)) {
    jobs.push(job);
    if (jobs.length >= limit) break;
  }
  stats.total = jobs.length;

  console.log(
    `${formatCount(jobs.length)} captures to reconcile into ${DIRS.files}/` +
      `${dryRun ? "  [dry run]" : ""}`
  );
  console.log(`concurrency ${concurrency}, ${state.size ? formatCount(state.size) + " known files" : "no previous state"}\n`);

  stateOut = fs.createWriteStream(FILES.downloadState, { flags: "a" });
  failuresOut = fs.createWriteStream(FILES.failures, { flags: "a" });

  const onStop = () => {
    if (stopping) return;
    stopping = true;
    process.stdout.write("\n\nstopping -- letting in-flight downloads finish ...\n");
  };
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);

  let cursor = 0;
  async function worker() {
    while (!stopping) {
      const index = cursor++;
      if (index >= jobs.length) return;
      await handle(jobs[index]);
      done++;
      progress();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  progress(true);
  process.stdout.write("\n");

  await new Promise((r) => stateOut.end(r));
  await new Promise((r) => failuresOut.end(r));
  compactState();

  const have = stats.cached + stats.verified;
  console.log(`
already correct ..... ${formatCount(have)}  (${formatCount(stats.cached)} cached, ${formatCount(stats.verified)} re-hashed)
downloaded .......... ${formatCount(stats.downloaded)}
digest mismatch ..... ${formatCount(stats.mismatched)}  (kept, will be retried next run)
failed .............. ${formatCount(stats.failed)}
transferred ......... ${formatBytes(stats.bytes)}`);

  if (stats.failed || stats.mismatched) {
    console.log(`\nproblem captures are listed in ${FILES.failures}`);
  }
  if (stopping && done < jobs.length) {
    console.log(`\ninterrupted at ${formatCount(done)}/${formatCount(jobs.length)} -- run again to continue`);
  }
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
