// Moving between pages of a listing. Renders nothing when there is only one.
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
