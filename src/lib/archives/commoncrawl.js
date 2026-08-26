import fs from "fs";
import { DOMAIN, CUTOFF_FILE } from "../config.js";
import { fetchRaw, HttpError } from "../http.js";
import {
  readLines, writeFileAtomic, writeJson, readJson, ensureDir, formatCount, sleep,
} from "../util.js";

const COLLINFO = "https://index.commoncrawl.org/collinfo.json";
const DATA_HOST = "https://data.commoncrawl.org";

// The index backend times out (502/504) on big result streams, so we ask for
// the smallest page it will give us. More requests, but each one survives.
const PAGE_SIZE = 1;

const crawlDir = (dirs, id) => `${dirs.raw}/${id}`;
const crawlMetaFile = (dirs, id) => `${crawlDir(dirs, id)}/meta.json`;
const pageFile = (dirs, id, n) => `${crawlDir(dirs, id)}/page-${String(n).padStart(4, "0")}.jsonl`;

// The index answers in ndjson. Two failure modes look like success and must
// not be written to disk:
//   * an nginx error page (the backend gave up), and
//   * a chunked stream cut off mid-record, which ends in half a JSON object.
function parseIndexBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("<")) throw new Error("index server returned an HTML error page");
  const out = [];
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`truncated index stream near: ${line.slice(0, 60)}`);
    }
    out.push(record);
  }
  return out;
}

async function query(crawlId, extra) {
  const url =
    `https://index.commoncrawl.org/${crawlId}-index` +
    `?url=${encodeURIComponent(DOMAIN)}&matchType=domain&output=json&${extra}`;
  try {
    // This backend is slow and flaky; it gets more patience than usual.
    const res = await fetchRaw(url, { retries: 8 });
    return res.body.toString("utf8");
  } catch (err) {
    // 404 is how the index says "nothing here for that domain".
    if (err instanceof HttpError && err.status === 404) return "";
    throw err;
  }
}

async function fetchPage(crawlId, page, attempts = 4) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return parseIndexBody(await query(crawlId, `pageSize=${PAGE_SIZE}&page=${page}`));
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) await sleep(5000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export default {
  id: "commoncrawl.org",
  label: "Common Crawl",

  async fetchIndex({ dirs, args, log }) {
    ensureDir(dirs.raw);

    const listRes = await fetchRaw(COLLINFO);
    let crawls = JSON.parse(listRes.body.toString("utf8")).map((c) => c.id);
    const all = crawls.length;

    if (args.crawls) {
      const wanted = String(args.crawls).split(",").map((s) => s.trim());
      crawls = crawls.filter((id) => wanted.some((w) => id.includes(w)));
    } else if (!args["all-crawls"]) {
      // Crawls that ran entirely after the site died only hold the parked
      // domain, and step 2 discards those captures anyway. Querying them is
      // pure cost against a fragile server.
      const cutoff = readJson(CUTOFF_FILE)?.cutoff;
      if (cutoff && String(cutoff).length >= 4) {
        const cutoffYear = Number(String(cutoff).slice(0, 4));
        crawls = crawls.filter((id) => {
          const year = Number(/CC-MAIN-(\d{4})/.exec(id)?.[1]);
          return !Number.isFinite(year) || year <= cutoffYear;
        });
        log(`skipping crawls after ${cutoffYear} -- pass --all-crawls to include them`);
      }
    }
    log(`${crawls.length} of ${all} crawl indexes to check`);

    const summary = { complete: 0, partial: 0, skipped: 0, empty: 0, captures: 0 };
    const incomplete = [];

    for (const crawlId of crawls) {
      const meta = readJson(crawlMetaFile(dirs, crawlId));
      if (meta?.complete && !args.force) {
        summary.skipped++;
        summary.captures += meta.captures ?? 0;
        continue;
      }

      ensureDir(crawlDir(dirs, crawlId));

      // How many pages does this crawl have for our domain?
      let pages = meta?.pages;
      if (pages === undefined || args.force) {
        let head;
        try {
          head = await query(crawlId, `showNumPages=true&pageSize=${PAGE_SIZE}`);
        } catch (err) {
          log(`   ${crawlId}: cannot read page count -- ${err.message}`);
          incomplete.push({ crawlId, reason: err.message });
          continue;
        }
        if (!head.trim()) {
          writeJson(crawlMetaFile(dirs, crawlId), { crawlId, pages: 0, captures: 0, complete: true });
          summary.empty++;
          continue;
        }
        try {
          pages = JSON.parse(head).pages ?? 0;
        } catch {
          log(`   ${crawlId}: unreadable page count`);
          incomplete.push({ crawlId, reason: "unreadable page count" });
          continue;
        }
      }

      // Fetch page by page. A page that fails is left missing so the next run
      // retries just that page -- the pages that did come back are kept.
      let got = 0;
      let missing = 0;
      let captures = 0;
      for (let page = 0; page < pages; page++) {
        const file = pageFile(dirs, crawlId, page);
        if (fs.existsSync(file) && !args.force) {
          const text = fs.readFileSync(file, "utf8").trim();
          captures += text ? text.split("\n").length : 0;
          got++;
          continue;
        }
        try {
          const records = await fetchPage(crawlId, page);
          const text = records.map((r) => JSON.stringify(r)).join("\n");
          writeFileAtomic(file, text ? text + "\n" : "");
          captures += records.length;
          got++;
        } catch (err) {
          missing++;
          log(`   ${crawlId} page ${page}/${pages}: ${err.message}`);
        }
      }

      const complete = missing === 0;
      writeJson(crawlMetaFile(dirs, crawlId), {
        crawlId, pages, pageSize: PAGE_SIZE, pagesOnDisk: got, captures, complete,
        fetchedAt: new Date().toISOString(),
      });

      summary.captures += captures;
      if (complete) {
        summary.complete++;
        log(`   ${crawlId}: ${formatCount(captures)} captures (${pages} page${pages === 1 ? "" : "s"})`);
      } else {
        summary.partial++;
        incomplete.push({ crawlId, reason: `${missing} of ${pages} pages missing` });
        log(`   ${crawlId}: PARTIAL -- ${got}/${pages} pages, ${formatCount(captures)} captures so far`);
      }
    }

    writeJson(`${dirs.raw}/meta.json`, {
      archive: this.id,
      crawlsChecked: crawls.length,
      complete: summary.complete,
      partial: summary.partial,
      alreadyOnDisk: summary.skipped,
      empty: summary.empty,
      captures: summary.captures,
      incomplete,
      fetchedAt: new Date().toISOString(),
    });

    log(
      `crawls complete: ${summary.complete}, partial: ${summary.partial}, ` +
      `on disk: ${summary.skipped}, empty: ${summary.empty}, captures: ${formatCount(summary.captures)}`
    );
    if (incomplete.length) {
      log(`${incomplete.length} crawl(s) incomplete -- run again to fill the gaps`);
    }
  },

  async *streamCaptures({ dirs }) {
    if (!fs.existsSync(dirs.raw)) return;
    const crawls = fs.readdirSync(dirs.raw, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    for (const crawl of crawls) {
      const dir = `${dirs.raw}/${crawl}`;
      const pages = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
      for (const name of pages) {
        for await (const line of readLines(`${dir}/${name}`)) {
          let r;
          try { r = JSON.parse(line); } catch { continue; }
          if (!r.urlkey || !r.timestamp) continue;
          yield {
            k: r.urlkey, ts: r.timestamp, url: r.url, m: r.mime, s: r.status,
            d: r.digest, len: Number(r.length) || 0,
            extra: {
              crawl, filename: r.filename,
              offset: Number(r.offset), length: Number(r.length),
            },
          };
        }
      }
    }
  },

  // No replay service: pull the exact byte range of the WARC record straight
  // out of the crawl archive and unwrap it ourselves.
  buildFetch(capture) {
    return {
      t: "warc",
      u: `${DATA_HOST}/${capture.extra.filename}`,
      o: capture.extra.offset,
      l: capture.extra.length,
    };
  },
};
