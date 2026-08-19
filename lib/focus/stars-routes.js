// The star query surface behind the calendar (3.10). Pure: given a star store and a parsed query,
// it returns { status, body }. The server routes are thin wrappers over this so the shape and the
// error handling are testable without a socket, and the same logic is what the HTTP test drives.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** @returns {{status:number, body:object}} */
export function starsHandler(store, kind, value) {
  if (kind === 'day') {
    if (!DAY.test(String(value || ''))) {
      return { status: 400, body: { error: 'bad_date', detail: `day must be YYYY-MM-DD, got ${JSON.stringify(value)}` } };
    }
    return { status: 200, body: { day: value, stars: store.starsForDay(value) } };
  }
  if (kind === 'month') {
    if (!MONTH.test(String(value || ''))) {
      return { status: 400, body: { error: 'bad_date', detail: `month must be YYYY-MM, got ${JSON.stringify(value)}` } };
    }
    return { status: 200, body: { month: value, stars: store.starsForMonth(value) } };
  }
  return { status: 404, body: { error: 'not_found' } };
}
