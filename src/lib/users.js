// A post or comment references its author by one id and nothing else; the
// name, avatar and history live in that member's own file.
//
// Almost everyone has a numeric id. Where an observation has only an
// unresolved vanity profile path or a guest display name, it gets a stable
// slug so it can still be referenced rather than being dropped. Verified
// vanity-to-numeric relations are resolved by the page parser before this.

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
