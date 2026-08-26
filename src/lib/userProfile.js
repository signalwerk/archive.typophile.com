// Parse a /user/<id> page.
//
// Profiles are a Drupal definition list inside .profile -- <dt> is the field
// label, <dd> its value. Labels are matched rather than positions, so a
// profile that omits half its fields still parses.

import * as cheerio from "cheerio";

// Label on the page -> field name we store.
const FIELDS = {
  "full name": "name",
  city: "city",
  "state/province": "state",
  state: "state",
  country: "country",
  "member for": "member_for",
  occupation: "occupation",
  "home page": "home_page",
  gender: "gender",
  quote: "quote",
  twitter: "twitter",
  facebook: "facebook",
  linkedin: "linkedin",
  "education: school": "education_school",
  "education: degree": "education_degree",
};

const DURATION = /(\d+)\s*(year|month|week|day)s?/gi;

// "11 years 3 weeks" -> how long before the capture they joined.
// Week granularity, so the result is approximate by design.
export function memberSince(memberFor, capturedAt) {
  if (!memberFor || !capturedAt) return null;
  const at = new Date(capturedAt);
  if (Number.isNaN(at.getTime())) return null;

  let days = 0;
  let matched = false;
  for (const m of String(memberFor).matchAll(DURATION)) {
    matched = true;
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === "year") days += n * 365.25;
    else if (unit === "month") days += n * 30.44;
    else if (unit === "week") days += n * 7;
    else days += n;
  }
  if (!matched) return null;

  const joined = new Date(at.getTime() - days * 86_400_000);
  return joined.toISOString().slice(0, 10);
}

export function parseUserProfile(html, { capturedAt } = {}) {
  const $ = cheerio.load(html);

  const block = $(".profile").first();
  if (block.length === 0) return null;

  const out = {};
  block.find("dt").each((i, el) => {
    const label = $(el).text().trim().replace(/\s+/g, " ").replace(/:\s*$/, "").toLowerCase();
    const key = FIELDS[label];
    if (!key) return;
    const value = $(el).next("dd").text().trim().replace(/\s+/g, " ");
    if (value) out[key] = value;
  });

  if (Object.keys(out).length === 0) return null;
  if (out.member_for) {
    const since = memberSince(out.member_for, capturedAt);
    if (since) out.member_since = since;
  }
  return out;
}
