// Long threads were split across pages: /node/123, /node/123?page=1, and so on,
// 50 comments each. A capture of one page holds only that page's comments, so
// a thread has to be reassembled from every page we managed to recover.
//
// The pager at the bottom of each page tells us how many pages the thread had
// in total -- the "last »" link points at the highest one -- which is how we
// can say a thread is incomplete rather than quietly showing a fifth of it.

const PAGE_IN_HREF = /[?&]page=(\d+)/;

// Total number of pages the thread had, or null when there is no pager
// (a thread short enough to fit on one page).
export function totalPagesFrom($) {
  const links = $(".pager a");
  if (links.length === 0) return null;

  let highest = 0;
  links.each((i, el) => {
    const m = PAGE_IN_HREF.exec($(el).attr("href") || "");
    if (m) highest = Math.max(highest, Number(m[1]));
  });
  // page=19 is the twentieth page.
  return highest + 1;
}

// Which page a capture is, taken from its URL key.
export function pageOfKey(urlkey) {
  const m = PAGE_IN_HREF.exec(urlkey);
  return m ? Number(m[1]) : 0;
}

export const NODE_PAGE_KEY = /^com,typophile\)\/node\/(\d+)(?:\?page=(\d+))?$/;
