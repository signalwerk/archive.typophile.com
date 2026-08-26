// A post or comment references its author by one id and nothing else; the
// name, avatar and history live in that member's own file.
//
// Almost everyone has a numeric id. A few members only ever appear with a
// vanity profile path (/readthetype) and guests appear with a display name
// alone -- those get a stable slug so they can still be referenced, and still
// get a page, rather than being dropped.

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function userIdFor(entry) {
  if (!entry) return null;
  if (entry.user_id != null) return entry.user_id;
  if (entry.user_path) {
    const slug = slugify(entry.user_path);
    if (slug) return slug;
  }
  if (entry.user_name) {
    const slug = slugify(entry.user_name);
    if (slug) return slug;
  }
  return null;
}

// Numeric ids stay numbers so they sort and compare naturally.
export function normaliseId(id) {
  if (id === null || id === undefined) return null;
  return /^\d+$/.test(String(id)) ? Number(id) : String(id);
}
