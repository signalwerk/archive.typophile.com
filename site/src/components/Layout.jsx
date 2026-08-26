
export function Layout({ children, wide = false }) {
  return (
    <div className={wide ? "page" : "page page--reading"}>
      <header className="masthead">
        <h1 className="masthead__title">
          <a href="/">Typophile</a>
        </h1>
        <a className="masthead__about" href="/about/">about</a>
        <nav className="masthead__nav">
          <a href="/">threads</a>
          <a href="/#forums">forums</a>
        </nav>
      </header>
      {children}
    </div>
  );
}

export function formatDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
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
