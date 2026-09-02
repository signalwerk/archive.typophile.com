// Where to see one capture on the archive that made it.
//
// Every parsed page records the archive that holds it, the timestamp of the
// capture and the address it was taken from. Those three are exactly what a
// replay service needs to address a single version, so a page can point at
// the copy it is actually showing rather than at the dead original.
//
// This is deliberately not the same as `buildFetch` in `lib/archives/`. Those
// URLs carry the `id_` modifier, which returns the untouched stored bytes,
// because the pipeline verifies them against the digest the archive recorded.
// A reader wants the ordinary replay instead: the page rendered, with the
// archive's own banner and date navigation around it.

// Captures made through port 80 are recorded with the port spelled out. Every
// replay service accepts either form, and the bare host is what the original
// address looked like, so that is what we show and link.
export function originalUrl(source) {
  const url = source?.url;
  if (!url) return null;
  return String(url).replace(/^(https?:\/\/[^/:]+):80(?=\/|$|\?)/, "$1");
}

// The address of this exact capture, or null where the archive publishes no
// such page. Callers fall back to the original address in that case.
export function captureUrl(source) {
  const url = originalUrl(source);
  if (!url || !source?.timestamp) return null;

  switch (source.archive) {
    case "web.archive.org":
      return `https://web.archive.org/web/${source.timestamp}/${url}`;
    case "arquivo.pt":
      return `https://arquivo.pt/wayback/${source.timestamp}/${url}`;
    // Common Crawl publishes WARC files and an index over them, not a replay
    // service: there is no address at which a reader can open one of its
    // captures. Saying so by returning null is honest; pointing at some other
    // archive's copy of the same page would not be the version shown here.
    default:
      return null;
  }
}
