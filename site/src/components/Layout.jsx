
export function Layout({ children, wide = false }) {
  return (
    <div className={wide ? "page" : "page page--reading"}>
      <header className="masthead">
        <h1 className="masthead__title">
          <a href="/">Typophile</a>
        </h1>
        <nav className="masthead__nav">
          <a href="/about/">about</a>
        </nav>
      </header>
      {children}
    </div>
  );
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
