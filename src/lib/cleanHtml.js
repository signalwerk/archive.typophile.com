// Clean the stored HTML of a post or comment.
//
// A few things happen here, all on a real parse of the document rather than by
// pattern-matching the markup:
//
//   * anything that would execute or fetch from elsewhere is removed,
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
// The captured HTML is never modified -- the result of this is stored beside
// it -- so the pass can be re-run or extended without losing the original.

import * as cheerio from "cheerio";
import { internalTarget, linkScope, sitePath } from "./links.js";

// What a link turned out to be. The page shows each as a small mark; nothing
// here decides how they look, only which of the three a link is.
export const LINK_CLASS = {
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

export function cleanHtml(html, have, asset) {
  const stats = {
    links: 0, internal: 0, rewritten: 0, missing: [],
    external: 0, kept: 0, lost: 0,
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
