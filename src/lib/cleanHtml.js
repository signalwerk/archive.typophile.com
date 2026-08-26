// Clean the stored HTML of a post or comment.
//
// Two things happen here, both on a real parse of the document rather than by
// pattern-matching the markup:
//
//   * anything that would execute or fetch from elsewhere is removed, and
//   * links that point at a thread or member we recovered are repointed at our
//     copy of it.
//
// Only the href of a link changes; its wording, its title and every other
// attribute are left alone, and a link to something we do not hold keeps its
// original address rather than pretending to lead somewhere.
//
// The captured HTML is never modified -- the result of this is stored beside
// it -- so the pass can be re-run or extended without losing the original.

import * as cheerio from "cheerio";
import { internalTarget } from "./links.js";

// Elements that run code, load from elsewhere, or collect input.
const DROP = [
  "script", "style", "iframe", "frame", "frameset", "object", "embed",
  "applet", "form", "input", "button", "select", "textarea", "link", "meta",
];

const EVENT_ATTR = /^on/i;
const URL_ATTR = /^(href|src|action|formaction|background|poster|data)$/i;
const JS_URL = /^\s*javascript:/i;

export function cleanHtml(html, have) {
  const stats = {
    links: 0, internal: 0, rewritten: 0, missing: [],
    dropped: 0, handlers: 0, jsUrls: 0,
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

  $("a[href]").each((i, el) => {
    stats.links++;
    const target = internalTarget(el.attribs.href);
    if (!target) return;

    stats.internal++;
    if (!have(target.type, target.id)) {
      stats.missing.push(`${target.type}/${target.id}`);
      return;
    }
    el.attribs.href = `/${target.type}/${target.id}/${target.hash}`;
    stats.rewritten++;
  });

  return { html: $.html(), stats };
}
