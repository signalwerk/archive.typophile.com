import fs from "fs";
import { DOMAIN, CUTOFF_FILE } from "../config.js";
import { fetchRaw, HttpError } from "../http.js";
import { readLines, writeFileAtomic, writeJson, readJson, ensureDir, formatCount, sleep } from "../util.js";

const COLLINFO = "https://index.commoncrawl.org/collinfo.json";
const DATA_HOST = "https://data.commoncrawl.org";

const crawlFile = (dirs, id) => `${dirs.raw}/${id}.jsonl`;

// The index server answers broad queries with a 504 or an HTML error page.
// Anything that is not JSON lines has to be rejected rather than parsed.
function parseIndexBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("<")) throw new Error("index server returned HTML (overloaded)");
  const out = [];
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`malformed index line: ${line.slice(0, 100)}`);
    }
    out.push(record);
  }
  return out;
}

async function queryCrawl(crawlId, extra) {
  const url =
    `https://index.commoncrawl.org/${crawlId}-index` +
    `?url=${encodeURIComponent(DOMAIN)}&matchType=domain&output=json&${extra}`;
  try {
    // The index server is frequently overloaded and answers 503/504, so it
    // gets more patience than a normal request.
    const res = await fetchRaw(url, { retries: 8 });
    return res.body.toString("utf8");
  } catch (err) {
    // 404 is how the index says "this crawl has nothing for that domain".
    if (err instanceof HttpError && err.status === 404) return "";
    throw err;
  }
}

// One index page, validated. A body that stops mid-line means the connection
// was cut while the server was still streaming results -- that is a transport
// failure, not bad data, so it is worth asking again.
async function fetchIndexPage(crawlId, extra, log, attempts = 4) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let text;
    try {
      text = await queryCrawl(crawlId, extra);
    } catch (err) {
      lastErr = err;
      if (attempt === attempts - 1) break;
      await sleep(5000 * (attempt + 1));
      continue;
    }
    try {
      return parseIndexBody(text);
    } catch (err) {
      lastErr = err;
      if (attempt === attempts - 1) break;
      log(`      ${crawlId}: ${err.message} -- refetching`);
      await sleep(5000 * (attempt + 1));
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
      // domain, and step 2 would discard every one of those captures anyway.
      // Querying them is pure cost -- the index server is slow and fragile --
      // so skip them once the cutoff is known.
      const cutoff = readJson(CUTOFF_FILE)?.cutoff;
      if (cutoff && String(cutoff).length >= 4) {
        const cutoffYear = Number(String(cutoff).slice(0, 4));
        crawls = crawls.filter((id) => {
          const year = Number(/CC-MAIN-(\d{4})/.exec(id)?.[1]);
          return !Number.isFinite(year) || year <= cutoffYear;
        });
        log(`skipping crawls after ${cutoffYear} (site died ${cutoffYear}) -- pass --all-crawls to include them`);
      }
    }

    log(`${crawls.length} of ${all} crawl indexes to check`);

    let done = 0;
    let skipped = 0;
    let withData = 0;
    let records = 0;
    const failed = [];

    for (const crawlId of crawls) {
      const file = crawlFile(dirs, crawlId);
      if (!args.force && fs.existsSync(file)) {
        skipped++;
        const n = fs.readFileSync(file, "utf8").trim();
        if (n) { withData++; records += n.split("\n").length; }
        continue;
      }

      try {
        const head = await queryCrawl(crawlId, "showNumPages=true");
        let pages = 1;
        if (head.trim()) {
          try { pages = JSON.parse(head).pages ?? 1; } catch { pages = 1; }
        } else {
          // no captures at all in this crawl
          writeFileAtomic(file, "");
          done++;
          continue;
        }

        const lines = [];
        for (let page = 0; page < pages; page++) {
          for (const record of await fetchIndexPage(crawlId, `page=${page}`, log)) {
            lines.push(JSON.stringify(record));
          }
        }

        writeFileAtomic(file, lines.length ? lines.join("\n") + "\n" : "");
        done++;
        if (lines.length) { withData++; records += lines.length; }
        log(`   ${crawlId}: ${formatCount(lines.length)} captures${pages > 1 ? ` (${pages} pages)` : ""}`);
      } catch (err) {
        // Leave no file behind so the next run retries this crawl.
        failed.push({ crawlId, error: err.message });
        log(`   ${crawlId}: FAILED -- ${err.message}`);
      }
    }

    writeJson(`${dirs.raw}/meta.json`, {
      archive: this.id,
      crawlsChecked: crawls.length,
      crawlsFetched: done,
      crawlsAlreadyOnDisk: skipped,
      crawlsWithCaptures: withData,
      captures: records,
      failed,
      fetchedAt: new Date().toISOString(),
    });

    log(`crawls fetched: ${done}, on disk: ${skipped}, with captures: ${withData}, total captures: ${formatCount(records)}`);
    if (failed.length) log(`${failed.length} crawl(s) failed -- run again to retry them`);
  },

  async *streamCaptures({ dirs }) {
    const files = fs.existsSync(dirs.raw)
      ? fs.readdirSync(dirs.raw).filter((f) => f.endsWith(".jsonl")).sort()
      : [];
    for (const name of files) {
      const crawl = name.replace(/\.jsonl$/, "");
      for await (const line of readLines(`${dirs.raw}/${name}`)) {
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        if (!r.urlkey || !r.timestamp) continue;
        yield {
          k: r.urlkey,
          ts: r.timestamp,
          url: r.url,
          m: r.mime,
          s: r.status,
          d: r.digest,
          len: Number(r.length) || 0,
          extra: {
            crawl,
            filename: r.filename,
            offset: Number(r.offset),
            length: Number(r.length),
          },
        };
      }
    }
  },

  // Common Crawl has no replay service: we pull the exact byte range of the
  // WARC record straight out of the crawl archive and unwrap it ourselves.
  buildFetch(capture) {
    return {
      t: "warc",
      u: `${DATA_HOST}/${capture.extra.filename}`,
      o: capture.extra.offset,
      l: capture.extra.length,
    };
  },
};
