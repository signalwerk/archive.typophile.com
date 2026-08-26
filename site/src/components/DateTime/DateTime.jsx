// One place that knows how a date is written, so a thread and a listing can
// never drift apart.
//
// Stored dates are naive local time -- exactly what the page displayed, with
// no timezone recorded anywhere on the site -- so they are printed as-is on a
// 24-hour clock rather than converted to anything.

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

// "20 October 2003 · 16:03"
export function formatDateTime(iso) {
  if (!iso) return null;
  const m = PARTS.exec(iso);
  if (!m) return iso;
  const day = `${Number(m[3])} ${MONTHS_FULL[Number(m[2]) - 1]} ${m[1]}`;
  return m[4] ? `${day} · ${m[4]}:${m[5]}` : day;
}

// "20 Oct 2003" -- for places with no room for the long form.
export function formatDate(iso) {
  if (!iso) return null;
  const m = PARTS.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

// `dateOnly` drops the clock, for places where the time says nothing useful --
// the span a member was active, for instance.
export function DateTime({ value, dateOnly = false }) {
  if (!value) return null;
  return <time dateTime={value}>{dateOnly ? formatDate(value) : formatDateTime(value)}</time>;
}
