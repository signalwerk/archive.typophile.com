import fs from "fs";
import { DOMAIN } from "../config.js";
import { fetchRaw } from "../http.js";
import { readLines, writeFileAtomic, writeJson, ensureDir, formatCount } from "../util.js";

const BASE = "https://arquivo.pt/wayback/cdx";
const RAW = (dirs) => `${dirs.raw}/captures.jsonl`;

export default {
  id: "arquivo.pt",
  label: "Arquivo.pt (Portuguese Web Archive)",

  async fetchIndex({ dirs, args, log }) {
    ensureDir(dirs.raw);
    const file = RAW(dirs);

    if (!args.force && fs.existsSync(file) && fs.statSync(file).size > 0) {
      log(`already on disk (${formatCount(fs.readFileSync(file, "utf8").trim().split("\n").length)} records) -- use --force to refetch`);
      return;
    }

    const url = `${BASE}?url=${encodeURIComponent(DOMAIN)}&matchType=domain&output=json`;
    const res = await fetchRaw(url, {
      onRetry: (err, attempt, wait) =>
        log(`   ${err.message} -- retry ${attempt} in ${Math.round(wait / 1000)}s`),
    });

    const text = res.body.toString("utf8").trim();
    const lines = text ? text.split("\n") : [];

    // A truncated response would silently lose captures, so insist that every
    // line is complete JSON before we accept the file.
    let bad = 0;
    for (const line of lines) {
      try { JSON.parse(line); } catch { bad++; }
    }
    if (bad) throw new Error(`${bad} malformed line(s) in the arquivo.pt response -- try again`);

    writeFileAtomic(file, text + (text ? "\n" : ""));
    writeJson(`${dirs.raw}/meta.json`, {
      archive: this.id,
      records: lines.length,
      fetchedAt: new Date().toISOString(),
    });
    log(`${formatCount(lines.length)} captures`);
  },

  async *streamCaptures({ dirs }) {
    const file = RAW(dirs);
    if (!fs.existsSync(file)) return;
    for await (const line of readLines(file)) {
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
        extra: { collection: r.collection ?? null, filename: r.filename ?? null },
      };
    }
  },

  // Same `id_` convention as the Wayback Machine. The `/noFrame/replay/` and
  // plain `/wayback/<ts>/` endpoints return rewritten pages that do not verify.
  buildFetch(capture) {
    return { t: "replay", u: `https://arquivo.pt/wayback/${capture.ts}id_/${capture.url}` };
  },
};
