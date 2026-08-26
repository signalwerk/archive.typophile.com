import fs from "fs";
import { DOMAIN } from "../config.js";
import { fetchRaw } from "../http.js";
import { readLines, writeFileAtomic, writeJson, ensureDir, formatCount, formatBytes } from "../util.js";

const FIELDS = "urlkey,timestamp,original,mimetype,statuscode,digest,length";
const BASE = "https://web.archive.org/cdx/search/cdx";

const base = (extra) =>
  `${BASE}?url=${encodeURIComponent(DOMAIN)}&matchType=domain&${extra}`;

// Capture rows need the field list; the page count must NOT have it. The CDX
// server applies `fl` to the showNumPages reply too, so asking for seven
// fields returns "- - - - - - -" instead of a number.
const query = (extra) => base(`fl=${FIELDS}&${extra}`);
const countQuery = () => base("showNumPages=true");

const pageFile = (dirs, n) => `${dirs.raw}/page-${String(n).padStart(4, "0")}.cdx`;

function validate(text) {
  const lines = text.split("\n").filter((l) => l.length);
  for (const line of lines.slice(0, 5)) {
    if (line.split(" ").length !== 7) return { ok: false, reason: `bad line: ${line.slice(0, 120)}` };
  }
  return { ok: true, lines: lines.length };
}

export default {
  id: "web.archive.org",
  label: "Internet Archive Wayback Machine",

  async fetchIndex({ dirs, args, log }) {
    ensureDir(dirs.raw);

    let total;
    if (args.pages) {
      total = parseInt(args.pages, 10);
    } else {
      const res = await fetchRaw(countQuery());
      const text = res.body.toString("utf8").trim();
      total = parseInt(text, 10);
      if (!Number.isInteger(total) || total <= 0) {
        throw new Error(`unexpected page count from the CDX server: ${JSON.stringify(text.slice(0, 120))}`);
      }
    }
    log(`${total} index pages`);

    let fetched = 0;
    let skipped = 0;
    for (let page = 0; page < total; page++) {
      const file = pageFile(dirs, page);
      if (!args.force && fs.existsSync(file) && fs.statSync(file).size > 0) {
        skipped++;
        continue;
      }
      const res = await fetchRaw(query(`page=${page}`), {
        onRetry: (err, attempt, wait) =>
          log(`   page ${page}: ${err.message} -- retry ${attempt} in ${Math.round(wait / 1000)}s`),
      });
      const text = res.body.toString("utf8");
      const check = validate(text);
      if (!check.ok) throw new Error(`page ${page} looks malformed (${check.reason})`);
      writeFileAtomic(file, text);
      fetched++;
      log(`   page ${page + 1}/${total}: ${formatCount(check.lines)} lines (${formatBytes(res.body.length)})`);
    }

    writeJson(`${dirs.raw}/meta.json`, {
      archive: this.id,
      pages: total,
      fields: FIELDS.split(","),
      fetchedAt: new Date().toISOString(),
    });
    log(`pages fetched: ${fetched}, already on disk: ${skipped}`);
  },

  async *streamCaptures({ dirs }) {
    const files = fs.existsSync(dirs.raw)
      ? fs.readdirSync(dirs.raw).filter((f) => f.endsWith(".cdx")).sort()
      : [];
    for (const name of files) {
      for await (const line of readLines(`${dirs.raw}/${name}`)) {
        const [k, ts, url, m, s, d, len] = line.split(" ");
        if (!k || !ts) continue;
        yield { k, ts, url, m, s, d, len: Number(len) || 0 };
      }
    }
  },

  // The `id_` modifier returns the untouched original response rather than the
  // rewritten replay page -- which is what the digest describes.
  buildFetch(capture) {
    return { t: "replay", u: `https://web.archive.org/web/${capture.ts}id_/${capture.url}` };
  },

  // Some stored records are damaged: the original response declared
  // `Content-Encoding: gzip`, and `id_` serves decompressed bytes cut off at
  // the *compressed* Content-Length, so the HTML stops mid-tag and can never
  // match its digest. The ordinary (rewritten) replay reconstructs the whole
  // page, so it is worth having even though its URLs have been rewritten and
  // it can no longer be verified byte for byte.
  buildFallback(capture) {
    return { t: "replay", u: `https://web.archive.org/web/${capture.ts}/${capture.url}` };
  },
};
