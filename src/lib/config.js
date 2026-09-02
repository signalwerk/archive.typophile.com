// Central configuration for the typophile.com archive pipeline.

export const DOMAIN = "typophile.com";

export const DATA = "data";

// The final cutoff is global, not per-archive. Typophile had an earlier outage
// and later returned, so step 1 distinguishes temporary placeholders from the
// terminal maintenance period rather than treating the first outage as death.
export const CUTOFF_FILE = "data/cutoff.json";

// Every archive gets the same layout under its own folder.
export function archiveDirs(archiveId) {
  const root = `${DATA}/archives/${archiveId}`;
  return {
    root,
    raw: `${root}/raw`,
    index: `${root}/index`,
    files: `${root}/files`,
    state: `${root}/state`,
    latest: `${root}/index/latest.jsonl`,
    latestMeta: `${root}/index/latest.meta.json`,
    downloads: `${root}/index/downloads.jsonl`,
    downloadsMeta: `${root}/index/downloads.meta.json`,
    downloadState: `${root}/state/downloads.jsonl`,
    failures: `${root}/state/failures.jsonl`,
  };
}

// Checksums of captures that show a placeholder instead of real content.
// These are base32 SHA-1 payload digests, which every archive reports in the
// same format -- so the same list identifies the same pages everywhere.
export const OFFLINE_HASHES = {
  LAQLAMRVDS5VQFZECJLHS3S7MOTE3HBU: "Typophile turned 15 years old this month. Time for a reboot.",
  "3COOZZTE4S6HH7QGZF7AHHQ5ETTXVPA3": "Typophile turned 15 years old this month. Time for a reboot.",
  FOTMZZTR5CDCUTIR6IINFKBBM3KY7PDJ: "Site off-line",
  "6FSTKSIHOGPKWOUZ72R7WHAU4YTIGVKV": "Site off-line",
  JK6WPGOR6SZJFUVHUYQXIAEKJ4U7TKDJ: "Typophile is temporarily down for maintenance.",
};

// The first observation of one of these pages begins the final outage. Other
// OFFLINE_HASHES are still rejected, but do not end the usable timeline.
export const TERMINAL_OFFLINE_HASHES = new Set([
  "JK6WPGOR6SZJFUVHUYQXIAEKJ4U7TKDJ",
]);

// Same-origin 2xx responses that are neither forum content nor useful files.
// The 2019 PHP failure was served for more than a thousand distinct node URLs,
// so rejecting its shared digest lets step 2 fall back to an earlier capture.
export const BAD_PAGE_HASHES = {
  NRHQDL7WLG76PDGM5DK2XIX5FL4RK2N4: "PHP fatal error: missing sites/default/files/a.jpg",
};

// Set to a 14-digit timestamp to override the detected cutoff entirely.
export const CUTOFF_OVERRIDE = null;

export const HTTP = {
  userAgent:
    "archive.typophile.com/1.0 (personal archival project; +https://github.com/signalwerk/archive.typophile.com)",
  concurrency: 4,
  timeoutMs: 90_000,
  retries: 5,
  backoffBaseMs: 2_000,
  maxBackoffMs: 120_000,
  minRequestIntervalMs: 100,
};
