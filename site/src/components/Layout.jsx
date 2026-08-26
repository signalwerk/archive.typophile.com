
export function Layout({ children, wide = false }) {
  return (
    <div className={wide ? "page" : "page page--reading"}>
      <header className="masthead">
        <h1 className="masthead__title">
          <a href="/">Typophile</a>
        </h1>
        <nav className="masthead__nav">
          <a href="/">threads</a>
          <a href="/about/">about</a>
        </nav>
      </header>
      {children}
    </div>
  );
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export function formatDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// The stored date is naive local time, exactly as the page showed it, so it is
// printed as-is on a 24-hour clock rather than being converted to anything.
export function formatDateTime(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return formatDate(iso);
  return `${Number(m[3])} ${MONTHS_FULL[Number(m[2]) - 1]} ${m[1]} \u00B7 ${m[4]}:${m[5]}`;
}

export function Pager({ page, pages, hrefFor }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager">
      {page > 1 ? <a href={hrefFor(page - 1)}>&larr; newer</a> : <span className="pager__muted" />}
      {page < pages ? <a href={hrefFor(page + 1)}>older &rarr;</a> : null}
      <span className="pager__spacer">
        page {page} of {pages}
      </span>
    </nav>
  );
}
