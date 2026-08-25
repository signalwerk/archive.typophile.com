// Step 0 -- fetch the CDX index for the whole domain.
//
// The index is far too big for a single request, so we page through it and
// keep every page on disk. Re-running only fetches pages we are missing.
//
//   node src/000_fetchCDX.js [--force] [--pages=N]

import fs from "fs";
import { DOMAIN, DIRS, FILES } from "./lib/config.js";
import { fetchRaw } from "./lib/http.js";
import {
  ensureDir,
  writeJson,
  writeFileAtomic,
  parseArgs,
  formatCount,
  formatBytes,
} from "./lib/util.js";

const args = parseArgs();
const FIELDS = "urlkey,timestamp,original,mimetype,statuscode,digest,length";
const BASE = "https://web.archive.org/cdx/search/cdx";

const query = (extra) =>
  `${BASE}?url=${encodeURIComponent(DOMAIN)}&matchType=domain&fl=${FIELDS}&${extra}`;

const pageFile = (n) => `${DIRS.cdxPages}/page-${String(n).padStart(4, "0")}.cdx`;

// A page is only trustworthy if every line has the shape we asked for.
function validate(text) {
  const lines = text.split("\n").filter((l) => l.length);
  if (lines.length === 0) return { ok: true, lines: 0 };
  for (const line of lines.slice(0, 5)) {
    if (line.split(" ").length !== 7) return { ok: false, reason: `bad line: ${line.slice(0, 120)}` };
  }
  return { ok: true, lines: lines.length };
}

async function numPages() {
  const res = await fetchRaw(query("showNumPages=true"));
  const n = parseInt(res.body.toString("utf8").trim(), 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`unexpected page count: ${res.body.toString("utf8").slice(0, 200)}`);
  return n;
}

async function main() {
  ensureDir(DIRS.cdxPages);

  const total = args.pages ? parseInt(args.pages, 10) : await numPages();
  console.log(`CDX index for *.${DOMAIN}: ${total} pages`);

  let fetched = 0;
  let skipped = 0;

  for (let page = 0; page < total; page++) {
    const file = pageFile(page);

    if (!args.force && fs.existsSync(file) && fs.statSync(file).size > 0) {
      skipped++;
      continue;
    }

    const res = await fetchRaw(query(`page=${page}`), {
      onRetry: (err, attempt, wait) =>
        console.log(`   page ${page}: ${err.message} -- retry ${attempt} in ${Math.round(wait / 1000)}s`),
    });

    const text = res.body.toString("utf8");
    const check = validate(text);
    if (!check.ok) throw new Error(`page ${page} looks malformed (${check.reason})`);

    writeFileAtomic(file, text);
    fetched++;
    console.log(
      `   page ${page + 1}/${total}: ${formatCount(check.lines)} lines (${formatBytes(res.body.length)})`
    );
  }

  console.log(`pages fetched: ${fetched}, already on disk: ${skipped}`);

  // Concatenate into one file for the streaming passes that follow.
  console.log("concatenating pages ...");
  const out = fs.createWriteStream(`${FILES.cdx}.part`);
  let lines = 0;
  for (let page = 0; page < total; page++) {
    const file = pageFile(page);
    if (!fs.existsSync(file)) continue;
    let text = fs.readFileSync(file, "utf8");
    if (text.length && !text.endsWith("\n")) text += "\n";
    lines += text.split("\n").length - 1;
    if (!out.write(text)) await new Promise((r) => out.once("drain", r));
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(`${FILES.cdx}.part`, FILES.cdx);

  writeJson(FILES.cdxMeta, {
    domain: DOMAIN,
    fields: FIELDS.split(","),
    pages: total,
    lines,
    fetchedAt: new Date().toISOString(),
  });

  console.log(`wrote ${FILES.cdx} -- ${formatCount(lines)} captures`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
});
