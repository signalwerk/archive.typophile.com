// Step 8 -- clean up the stored HTML.
//
// This is a one-time transformation of the data set, run here and never again
// at page-render time: the result is written into the thread YAML as
// `html_clean`, and the site does nothing but hand that string to the browser.
// Everything the cleaning needs lives in this file, so what happens to a post
// can be read in one place.
//
// Three layers, smallest first:
//
//   addresses           what a URL in an archived page refers to
//   one post or comment the document walk that rewrites it
//   the corpus          the pass over every thread, and what it reports
//
// On a real parse of the document rather than by pattern-matching the markup:
//
//   * anything that would execute or fetch from elsewhere is removed,
//   * addresses the old site itself mangled are put back the way they were
//     written,
//   * links that point at a thread or member we recovered are repointed at our
//     copy of it,
//   * links and images pointing at a file we recovered are pointed at our copy
//     of the file, and
//   * every link is given a class saying where it leads, so a reader can see
//     before clicking whether it still leads anywhere.
//
// Only a link's address and its class change; its wording, its title and every
// other attribute are left alone, and a link to something we do not hold keeps
// its original address rather than pretending to lead somewhere.
//
// The captured `html` is never modified -- the result is stored beside it --
// so this pass can be re-run or extended without losing the original, which is
// what makes changing the cleaning cheap.
//
//   node src/008_cleanHtml.js
//   node src/008_cleanHtml.js --force     re-clean everything

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import YAML from "yaml";
import { DATA } from "./lib/config.js";
import { buildAssetIndex, makeAssetResolver, ASSETS_DIR } from "./lib/assets.js";
import { ensureDir, writeJson, parseArgs, formatCount } from "./lib/util.js";

const args = parseArgs();
const force = Boolean(args.force);
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;

const NODES_DIR = `${DATA}/parsed/nodes`;
const USERS_INDEX = `${DATA}/parsed/users/_index.jsonl`;
const STATE_FILE = `${DATA}/parsed/clean-state.json`;
const META_FILE = `${DATA}/parsed/clean.meta.json`;

// Changing the cleaner has to invalidate what it produced.
function cleanerVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const hash = crypto.createHash("sha1");
  for (const f of [`${here}/lib/assets.js`, `${here}/008_cleanHtml.js`]) {
    try { hash.update(fs.readFileSync(f)); } catch { /* ignore */ }
  }
  return hash.digest("hex").slice(0, 16);
}

// --- addresses ---------------------------------------------------------------
//
// What an address in an archived page refers to. Knows nothing about markup:
// it deals only in URLs.

// Replay wrappers, in case the copy we stored came from a rewritten page.
const REPLAY_PREFIXES = [
  /^https?:\/\/web\.archive\.org\/web\/\d{4,14}[a-z_]*\/(.+)$/i,
  /^\/web\/\d{4,14}[a-z_]*\/(.+)$/i,
  /^https?:\/\/arquivo\.pt\/(?:wayback|noFrame\/replay)\/\d{4,14}[a-z_]*\/(.+)$/i,
];

const TYPOPHILE_HOST = /^https?:\/\/(?:www\.)?typophile\.com(?::\d+)?(\/.*)?$/i;

// Addresses that name no page at all, and schemes that name one elsewhere.
const NO_PAGE = /^(mailto|javascript|data|tel|sms):/i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

// Addresses the old site mangled before we ever captured them.
//
// Typophile's wiki-link filter sometimes swallowed a URL somebody pasted and
// wrote it back out as the name of a wiki page, percent-encoding it one time
// too many on the way:
//
//   https://klim.co.nz/retail-fonts/karbon
//     was stored as  /wiki/https%3A/%252Fklim.co.nz/retail-fonts/karbon
//
// The encoding was applied one or two times too many, so the name is peeled a
// layer at a time until it stops changing, and only then do we ask whether what
// we are holding has become a URL. Some arrived with the `[[...]]` of the wiki
// syntax around them, or with spaces, so those are trimmed each round.
//
// It only ever answers for something that ends up looking like an address. A
// page really named `Psy%252FOps` peels to `Psy/Ops` -- the foundry -- matches
// nothing here, and is left alone, as are `/wiki/John%20Graham` and the tens of
// thousands of other genuine pages.

const WIKI_PAGE = /^\/wiki\/(.+)$/i;
const MANGLED_URL = /^([a-z][a-z0-9+.-]*):\/{1,2}(.+)$/i;
// A hostname pasted with no scheme: `www.anything`, or any dotted host with a
// path after it. Requiring the path keeps a page named `Psy/Ops` out of it.
const BARE_HOST = /^(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+|[a-z0-9-]+(?:\.[a-z0-9-]+)+\/)/i;
const EMBEDDED_URL = /([a-z][a-z0-9+.-]*):\/{1,2}([a-z0-9-]+(?:\.[a-z0-9-]+)+\S*)/i;

function decodeOnce(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // a stray % that was never an escape
  }
}

// Peeling a layer too many turns an escaped space back into a real one, which
// is no longer an address. Put those back.
function tidy(url) {
  return url.trim().replace(/\s/g, "%20");
}

// Some were pasted with a letter lost or gained -- `ttp:`, `lhttp:`. An
// address whose scheme we cannot place is left alone rather than guessed at.
function knownScheme(scheme) {
  const s = scheme.toLowerCase();
  if (/^(https?|ftp|itms|itmss)$/.test(s)) return s;
  if (s.length < 2) return null;
  for (const known of ["https", "http"]) {
    if (known.endsWith(s) || s.endsWith(known)) return known;
  }
  return null;
}

// The address the author actually wrote, or null if there is nothing to mend.
function repairHref(rawHref) {
  if (!rawHref) return null;
  const page = WIKI_PAGE.exec(decodeEntities(String(rawHref).trim()));
  if (!page) return null;

  // Peel every layer off before asking what we are holding: the separators
  // that decide the answer -- the `//` of a scheme, a `#`, a `?` -- are
  // themselves encoded, and reading the shape too early gets `%2F` where the
  // second slash belongs.
  let name = page[1].replace(/^[\s[\]]+/, "").replace(/[\s[\]]+$/, "");
  for (let layer = 0; layer < 4; layer++) {
    const next = decodeOnce(name).replace(/^[\s[\]]+/, "").replace(/[\s[\]]+$/, "");
    if (next === name) break;
    name = next;
  }

  const url = MANGLED_URL.exec(name);
  if (url) {
    const scheme = knownScheme(url[1]);
    return scheme ? tidy(`${scheme}://${url[2]}`) : null;
  }
  if (BARE_HOST.test(name)) return tidy(`http://${name}`);

  // A few swallowed the words around the address as well -- `Link: http://...`,
  // `(http://...`, a whole `a href="http://...` fragment. Take the address out
  // of the middle of it.
  const buried = EMBEDDED_URL.exec(name);
  if (buried) {
    const scheme = knownScheme(buried[1]);
    if (scheme) return tidy(`${scheme}://${buried[2].replace(/[)\]"'.,]+$/, "")}`);
  }

  return null;
}

// Unwind any replay wrapper and give back the plain address the page meant.
function unwrap(rawHref) {
  if (!rawHref) return null;
  let href = decodeEntities(String(rawHref).trim());
  if (!href) return null;

  // Possibly nested, if a rewritten page was itself captured.
  for (let i = 0; i < 3; i++) {
    const hit = REPLAY_PREFIXES.map((re) => re.exec(href)).find(Boolean);
    if (!hit) break;
    href = hit[1];
  }
  return href;
}

// Where an address leads, before we know whether we hold the thing it names:
//
//   "site"  the old typophile.com -- named outright, or by a path, which in an
//           archived page could only ever have meant the old site
//   "away"  somewhere else on the web
//   null    nowhere to lead: a place on the same page, an address to write to,
//           a scheme with no page behind it
function linkScope(rawHref) {
  const href = unwrap(rawHref);
  if (!href || href.startsWith("#") || NO_PAGE.test(href)) return null;
  if (TYPOPHILE_HOST.test(href)) return "site";
  if (OTHER_SCHEME.test(href) || href.startsWith("//")) return "away";
  return "site";
}

// Reduce an address to the path it names on the old site, unwrapping any
// replay wrapper on the way. Returns null for anything that points elsewhere.
function sitePath(rawHref) {
  if (linkScope(rawHref) !== "site") return null;
  const href = unwrap(rawHref);

  let rest;
  const absolute = TYPOPHILE_HOST.exec(href);
  if (absolute) rest = absolute[1] || "/";
  else if (href.startsWith("/")) rest = href;
  else return null; // a bare relative path we cannot trust

  const hashAt = rest.indexOf("#");
  const hash = hashAt === -1 ? "" : rest.slice(hashAt);
  const withoutHash = hashAt === -1 ? rest : rest.slice(0, hashAt);

  const queryAt = withoutHash.indexOf("?");
  return {
    pathname: queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt),
    query: queryAt === -1 ? "" : withoutHash.slice(queryAt + 1),
    hash,
  };
}

// Work out whether a href points at one of our pages.
function internalTarget(rawHref) {
  const parts = sitePath(rawHref);
  if (!parts) return null;
  const { pathname, query, hash } = parts;

  // /node/123, /cms/node/123, and the same for members.
  let m = /^\/(?:cms\/)?(node|user)\/(\d+)(?:\/.*)?$/i.exec(pathname);
  if (m) return { type: m[1].toLowerCase(), id: Number(m[2]), hash };

  // Drupal without clean URLs: index.php?q=node/123
  m = /(?:^|&)q=\/?(node|user)\/(\d+)/i.exec(query);
  if (m) return { type: m[1].toLowerCase(), id: Number(m[2]), hash };

  return null;
}

// --- one post or comment -----------------------------------------------------

// What a link turned out to be. The page shows each as a small mark; nothing
// here decides how they look, only which of the three a link is.
const LINK_CLASS = {
  away: "link-external", // somewhere else on the web
  kept: "link-kept",     // the old site, and we hold it -- repointed at our copy
  lost: "link-lost",     // the old site, and we never recovered it
};

// Elements that run code, load from elsewhere, or collect input.
const DROP = [
  "script", "style", "iframe", "frame", "frameset", "object", "embed",
  "applet", "form", "input", "button", "select", "textarea", "link", "meta",
];

const EVENT_ATTR = /^on/i;
const URL_ATTR = /^(href|src|action|formaction|background|poster|data)$/i;
const JS_URL = /^\s*javascript:/i;

function cleanHtml(html, have, asset) {
  const stats = {
    links: 0, internal: 0, rewritten: 0, missing: [],
    external: 0, kept: 0, lost: 0, repaired: 0,
    dropped: 0, handlers: 0, jsUrls: 0,
    assets: 0, assetsRewritten: 0,
  };
  if (!html) return { html, stats };

  // A fragment, not a document: without this cheerio would wrap every post in
  // <html><head></head><body>.
  const $ = cheerio.load(html, null, false);

  $(DROP.join(",")).each((i, el) => {
    stats.dropped++;
    $(el).remove();
  });

  $("*").each((i, el) => {
    const attribs = el.attribs;
    if (!attribs) return;
    for (const name of Object.keys(attribs)) {
      if (EVENT_ATTR.test(name)) {
        delete attribs[name];
        stats.handlers++;
      } else if (URL_ATTR.test(name) && JS_URL.test(attribs[name] ?? "")) {
        delete attribs[name];
        stats.jsUrls++;
      }
    }
  });

  // Every link at once: where it leads, whether we hold what it names, and
  // the class that says so. Both kinds of target -- a thread or member, and a
  // file -- are settled here, so a link is classed exactly once.
  $("a[href]").each((i, el) => {
    stats.links++;

    // Mended before anything else looks at it, so where it leads is worked
    // out from the address the author wrote rather than the wreck of it.
    const repaired = repairHref(el.attribs.href);
    if (repaired) {
      el.attribs.href = repaired;
      stats.repaired++;
    }

    const scope = linkScope(el.attribs.href);
    if (!scope) return; // a place on this page, or an address to write to
    if (scope === "away") {
      stats.external++;
      $(el).addClass(LINK_CLASS.away);
      return;
    }

    let held = false;
    const target = internalTarget(el.attribs.href);

    if (target) {
      stats.internal++;
      if (have(target.type, target.id)) {
        el.attribs.href = `/${target.type}/${target.id}/${target.hash}`;
        stats.rewritten++;
        held = true;
      } else {
        stats.missing.push(`${target.type}/${target.id}`);
      }
    } else if (asset) {
      // An image people embedded, or a specimen they attached.
      const parts = sitePath(el.attribs.href);
      if (parts && /^\/files\//i.test(parts.pathname)) {
        stats.assets++;
        const href = asset(parts.pathname);
        if (href) {
          el.attribs.href = href + parts.hash;
          stats.assetsRewritten++;
          held = true;
        }
      }
    }

    // Anything else on the old site -- a wiki page, a forum listing, a search
    // -- we do not hold either, so it is marked lost like the rest.
    stats[held ? "kept" : "lost"]++;
    $(el).addClass(held ? LINK_CLASS.kept : LINK_CLASS.lost);
  });

  // Images are pointed at our copy the same way, but carry no mark: a picture
  // that failed to load says plainly enough that we do not have it.
  if (asset) {
    $("img[src]").each((i, el) => {
      const parts = sitePath(el.attribs.src);
      if (!parts || !/^\/files\//i.test(parts.pathname)) return;

      stats.assets++;
      const href = asset(parts.pathname);
      if (!href) return;

      el.attribs.src = href + parts.hash;
      stats.assetsRewritten++;
    });
  }

  return { html: $.html(), stats };
}

// --- the corpus --------------------------------------------------------------

function main() {
  if (!fs.existsSync(NODES_DIR)) throw new Error(`missing ${NODES_DIR} -- run step 006 first`);

  // What we actually hold, and can therefore link to.
  const nodes = new Set(
    fs.readdirSync(NODES_DIR)
      .filter((f) => /^\d+\.yaml$/.test(f))
      .map((f) => Number(f.slice(0, -5)))
  );
  const users = new Set();
  if (fs.existsSync(USERS_INDEX)) {
    for (const line of fs.readFileSync(USERS_INDEX, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const u = JSON.parse(line);
        if (typeof u.id === "number") users.add(u.id);
      } catch { /* torn line */ }
    }
  }
  const have = (type, id) => (type === "node" ? nodes.has(id) : users.has(id));

  const assetIndex = buildAssetIndex();
  const assetStats = { copied: 0 };
  const asset = makeAssetResolver(assetIndex, assetStats);
  console.log(
    `can link to ${formatCount(nodes.size)} threads, ${formatCount(users.size)} members ` +
    `and ${formatCount(assetIndex.size)} file(s)`
  );

  const version = cleanerVersion();
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { /* first run */ }
  const nextState = {};

  const counts = {
    threads: 0, cleaned: 0, unchanged: 0, entries: 0,
    links: 0, internal: 0, rewritten: 0, missing: 0,
    external: 0, kept: 0, lost: 0, repaired: 0,
    dropped: 0, handlers: 0, jsUrls: 0, assets: 0, assetsRewritten: 0,
  };
  const missingCounts = new Map();

  const files = fs.readdirSync(NODES_DIR).filter((f) => /^\d+\.yaml$/.test(f));
  let n = 0;

  for (const name of files) {
    if (n >= limit) break;
    n++;
    counts.threads++;

    const file = path.join(NODES_DIR, name);
    const node = Number(name.slice(0, -5));
    const stat = fs.statSync(file);
    const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;

    const known = state[node];
    if (!force && known && known.stamp === stamp && known.version === version) {
      counts.unchanged++;
      nextState[node] = known;
      // Keep the totals describing the whole corpus, not just this run.
      counts.links += known.links ?? 0;
      counts.internal += known.internal ?? 0;
      counts.rewritten += known.rewritten ?? 0;
      counts.external += known.external ?? 0;
      counts.kept += known.kept ?? 0;
      counts.lost += known.lost ?? 0;
      counts.repaired += known.repaired ?? 0;
      counts.entries += known.entries ?? 0;
      counts.dropped += known.dropped ?? 0;
      counts.handlers += known.handlers ?? 0;
      counts.jsUrls += known.jsUrls ?? 0;
      counts.assets += known.assets ?? 0;
      counts.assetsRewritten += known.assetsRewritten ?? 0;
      for (const miss of known.missing ?? []) {
        missingCounts.set(miss, (missingCounts.get(miss) || 0) + 1);
      }
      continue;
    }

    let doc;
    try { doc = YAML.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    if (!doc) continue;

    const totals = { links: 0, internal: 0, rewritten: 0, external: 0, kept: 0, lost: 0, repaired: 0, entries: 0, dropped: 0, handlers: 0, jsUrls: 0, assets: 0, assetsRewritten: 0 };
    const missedHere = [];

    const clean = (entry) => {
      if (!entry) return entry;
      totals.entries++;
      const { html: cleaned, stats } = cleanHtml(entry.html, have, asset);
      totals.links += stats.links;
      totals.internal += stats.internal;
      totals.rewritten += stats.rewritten;
      totals.external += stats.external;
      totals.kept += stats.kept;
      totals.lost += stats.lost;
      totals.repaired += stats.repaired;
      totals.dropped += stats.dropped;
      totals.handlers += stats.handlers;
      totals.jsUrls += stats.jsUrls;
      totals.assets += stats.assets;
      totals.assetsRewritten += stats.assetsRewritten;
      for (const miss of stats.missing) {
        missingCounts.set(miss, (missingCounts.get(miss) || 0) + 1);
        missedHere.push(miss);
      }
      // Rebuilt so html_clean sits next to the original it came from.
      return {
        id: entry.id, user: entry.user, date: entry.date, date_raw: entry.date_raw,
        votes: entry.votes, html: entry.html, html_clean: cleaned,
      };
    };

    doc.post = clean(doc.post);
    doc.comments = (doc.comments ?? []).map(clean);

    const out = YAML.stringify(doc, { lineWidth: 0, blockQuote: "literal" });
    if (fs.readFileSync(file, "utf8") !== out) {
      fs.writeFileSync(`${file}.part`, out);
      fs.renameSync(`${file}.part`, file);
      counts.cleaned++;
    } else {
      counts.unchanged++;
    }

    const after = fs.statSync(file);
    nextState[node] = {
      stamp: `${after.size}:${Math.round(after.mtimeMs)}`,
      version, ...totals,
      ...(missedHere.length ? { missing: missedHere } : {}),
    };
    counts.links += totals.links;
    counts.internal += totals.internal;
    counts.rewritten += totals.rewritten;
    counts.external += totals.external;
    counts.kept += totals.kept;
    counts.lost += totals.lost;
    counts.repaired += totals.repaired;
    counts.entries += totals.entries;
    counts.dropped += totals.dropped;
    counts.handlers += totals.handlers;
    counts.jsUrls += totals.jsUrls;
    counts.assets += totals.assets;
    counts.assetsRewritten += totals.assetsRewritten;

    if (counts.threads % 2000 === 0) process.stdout.write(`\r  ${formatCount(counts.threads)} threads ...`);
  }
  process.stdout.write("\r");

  fs.writeFileSync(`${STATE_FILE}.part`, JSON.stringify(nextState));
  fs.renameSync(`${STATE_FILE}.part`, STATE_FILE);

  const missing = [...missingCounts.entries()].sort((a, b) => b[1] - a[1]);
  counts.missing = missing.reduce((sum, [, c]) => sum + c, 0);

  ensureDir(`${DATA}/parsed`);
  writeJson(META_FILE, {
    ...counts, cleaner: version,
    linkableThreads: nodes.size, linkableMembers: users.size,
    // What people linked to that we have not recovered -- a map of the gaps.
    topMissingTargets: Object.fromEntries(missing.slice(0, 40)),
    distinctMissingTargets: missing.length,
    generatedAt: new Date().toISOString(),
  });

  console.log(`threads ............. ${formatCount(counts.threads)}`);
  console.log(`  rewritten ......... ${formatCount(counts.cleaned)}`);
  console.log(`  already clean ..... ${formatCount(counts.unchanged)}`);
  console.log(`links seen .......... ${formatCount(counts.links)}`);
  console.log(`  point at us ....... ${formatCount(counts.internal)}`);
  console.log(`  repointed ......... ${formatCount(counts.rewritten)}`);
  console.log(`  target not held ... ${formatCount(counts.missing)} (${formatCount(missing.length)} distinct)`);
  console.log(`marked .............. ${formatCount(counts.external)} off site, ${formatCount(counts.kept)} we hold, ${formatCount(counts.lost)} gone`);
  console.log(`mended addresses .... ${formatCount(counts.repaired)} the old site had mangled`);
  console.log(`removed ............. ${formatCount(counts.dropped)} element(s), ${formatCount(counts.handlers)} inline handler(s), ${formatCount(counts.jsUrls)} javascript: address(es)`);
  console.log(`files referenced .... ${formatCount(counts.assets)}`);
  console.log(`  pointed at ours ... ${formatCount(counts.assetsRewritten)}`);
  console.log(`  copied ............ ${formatCount(assetStats.copied)} -> ${ASSETS_DIR}/`);
  console.log(`\nstored as html_clean alongside the captured html`);
}

try { main(); } catch (err) {
  console.error(`\nfailed: ${err.message}`);
  process.exit(1);
}
