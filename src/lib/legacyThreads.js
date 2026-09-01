// Parsers for the Discus forum that preceded Typophile's Drupal /node pages.
// Two templates survive: an early one with malformed single-hyphen markers
// (`<!-Post...-!>`) and a later one with proper HTML comments. The fields are
// otherwise the same, so both are handled here rather than as guessed dates.

import { load } from "cheerio";
import { userIdFor } from "./users.js";

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DATE_SOURCE = "(?:[A-Za-z]+,\\s*)?[A-Za-z]+\\s+\\d{1,2},\\s*\\d{4}\\s*-\\s*\\d{1,2}:\\d{2}\\s*(?:am|pm)";

export function htmlText(value) {
  if (!value) return "";
  return load(`<div id="value">${value}</div>`, null, false)("#value")
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseHtmlText(value) {
  return htmlText(value).toLowerCase();
}

// The pages record local wall time without a timezone. Keep it naive, exactly
// as the modern parser does, or equal posts would compare unequal.
export function parseLegacyDate(value) {
  const match = /(?:Posted on\s+)?(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(value);
  if (!match) return null;

  const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  let hour = Number(match[4]);
  const meridian = match[6].toLowerCase();
  if (meridian === "pm" && hour !== 12) hour += 12;
  if (meridian === "am" && hour === 12) hour = 0;

  const pad = (n) => String(n).padStart(2, "0");
  return `${match[3]}-${pad(month)}-${pad(match[2])}T${pad(hour)}:${match[5]}:00`;
}

function pageMeta(html, forum, filename, allowSublist) {
  const idMatch = /^(\d+)(?:__q_.+)?\.html$/i.exec(filename);
  const me = /<!--Me:\s*(\d+)\/(.*?)-->/i.exec(html);
  const param = /<!--Param:\s*(.*?)-->/i.exec(html);
  const accepted = allowSublist
    ? /^MessagesAdd(?:Sublist)?\s*$/i
    : /^MessagesAdd\s*$/i;
  if (!idMatch || !me || !accepted.test(param?.[1] ?? "")) return null;

  const thread = Number(idMatch[1]);
  if (Number(me[1]) !== thread) return null;
  const topic = /<!--Topic:\s*(\d+)\/(.*?)-->/i.exec(html);
  return {
    key: `${forum}/${thread}`,
    forum: Number(forum),
    forumTitle: topic ? htmlText(topic[2]) || null : null,
    thread,
    title: me[2].trim(),
    titleKey: normaliseHtmlText(me[2]),
    baseCapture: !filename.includes("__q_"),
    url: `http://www.typophile.com/forums/messages/${forum}/${thread}.html`,
  };
}

function postSegments(html) {
  const starts = [...html.matchAll(/<!-{1,2}Post:\s*(\d+)(?:-->|-!>)/gi)];
  return starts.map((start, i) => {
    const id = Number(start[1]);
    const rest = html.slice(start.index);
    const close = new RegExp(`<!-{1,2}\\/Post:\\s*${id}(?:-->|-!>)`, "i").exec(rest);
    const fallback = starts[i + 1] ? starts[i + 1].index - start.index : rest.length;
    return { id, html: rest.slice(0, close?.index ?? fallback) };
  });
}

function markerBody(segment, name) {
  const proper = new RegExp(`<!--${name}-->([\\s\\S]*?)<!--\\/${name}-->`, "i").exec(segment);
  if (proper) return proper[1];
  return new RegExp(`<!-${name}-!>([\\s\\S]*?)<!-\\/${name}-!>`, "i").exec(segment)?.[1] ?? "";
}

function visibleDate(segment) {
  const match = new RegExp(`(?:Posted on\\s+)?(${DATE_SOURCE})`, "i").exec(segment);
  return match ? htmlText(match[1]) || null : null;
}

function profilePath(segment) {
  const value = /[?&]profile=([^&"'<>\s]+)/i.exec(segment)?.[1];
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return value; }
}

export function parseLegacyPosts(html) {
  const posts = [];
  for (const segment of postSegments(html)) {
    const name = htmlText(markerBody(segment.html, "Name")) || null;
    const profile = profilePath(segment.html);
    const dateRaw = visibleDate(segment.html);
    const time = Number(/<!-{1,2}Time:\s*(\d+)(?:-->|-!>)/i.exec(segment.html)?.[1]) || null;
    const body = markerBody(segment.html, "Text").trim() || null;
    const score = /<!--p:score=(-?\d+)&votes=\d+-->/i.exec(segment.html)?.[1];
    posts.push({
      id: segment.id,
      user: userIdFor({ user_path: profile, user_name: name }),
      date: parseLegacyDate(dateRaw),
      date_raw: dateRaw,
      votes: score === undefined ? null : Number(score),
      html: body,
      // Used only to merge snapshots; not written into the node-shaped entry.
      _time: time,
      _user_name: name,
      _user_path: profile,
    });
  }
  return posts;
}

export function parseLegacyThread(html, forum, filename) {
  const meta = pageMeta(html, forum, filename, false);
  if (!meta) return null;
  const posts = parseLegacyPosts(html);
  if (posts.length === 0) return null;
  return {
    ...meta,
    date: posts[0].date,
    bodyKey: normaliseHtmlText(posts[0].html),
    posts: posts.length,
  };
}

export function parseLegacyCapture(html, forum, filename) {
  const meta = pageMeta(html, forum, filename, true);
  if (!meta) return null;
  const posts = parseLegacyPosts(html);
  if (posts.length === 0) return null;
  return { ...meta, posts };
}
