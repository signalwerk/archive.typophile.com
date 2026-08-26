import { formatDate } from "./Layout.jsx";

export function ThreadList({ threads }) {
  return (
    <ul className="threads">
      {threads.map((t) => (
        <li key={t.id}>
          <a className="thread__title" href={`/node/${t.id}/`}>
            {t.title}
          </a>
          <div className="thread__meta">
            {t.author ? <span>{t.author}</span> : null}
            {t.date ? <span>{formatDate(t.date)}</span> : null}
            <span>
              {t.comments} {t.comments === 1 ? "reply" : "replies"}
            </span>
            {t.forumTitle ? <a href={`/forum/${t.forum}/`}>{t.forumTitle}</a> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
