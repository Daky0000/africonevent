// Helpers for matching a self-service attendee against the contact details
// that were imported for them (CSV upload or manual entry).

// Canonical storage format for Ghana numbers is the local trunk form:
// +233 24 412 3456, 00233244123456 and 244123456 all become 0244123456.
// Anything that isn't recognisably Ghanaian is left exactly as given.
function toLocalPhone(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (!d) return raw;
  if (/^00233\d{9}$/.test(d)) return '0' + d.slice(5);
  if (/^233\d{9}$/.test(d))   return '0' + d.slice(3);
  if (/^0\d{9}$/.test(d))     return d;       // already local — just stripped of spacing
  if (/^\d{9}$/.test(d))      return '0' + d; // missing the trunk prefix
  return raw;
}

function phoneMatches(entered, stored) {
  const a = toLocalPhone(entered);
  const b = toLocalPhone(stored);
  if (!a || !b) return false;
  if (a === b) return true;
  // Fallback for numbers we don't canonicalise (foreign lines, odd lengths):
  // compare the national significant digits so formatting can't cause a false miss.
  const da = a.replace(/\D/g, '');
  const db = b.replace(/\D/g, '');
  if (!da || !db) return false;
  if (da.length >= 9 && db.length >= 9) return da.slice(-9) === db.slice(-9);
  return da === db;
}

function emailMatches(entered, stored) {
  const a = String(entered || '').trim().toLowerCase();
  const b = String(stored || '').trim().toLowerCase();
  return !!a && a === b;
}

// Returns 'ok' when the value matches, 'mismatch' when it doesn't, and
// 'unavailable' when the attendee has no detail of that kind on file.
function checkContact(attendee, method, value) {
  if (method === 'phone') {
    if (!attendee.phone) return 'unavailable';
    return phoneMatches(value, attendee.phone) ? 'ok' : 'mismatch';
  }
  if (method === 'email') {
    if (!attendee.email) return 'unavailable';
    return emailMatches(value, attendee.email) ? 'ok' : 'mismatch';
  }
  return 'mismatch';
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 45);
  return (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : 'unknown').slice(0, 45);
}

module.exports = { toLocalPhone, phoneMatches, emailMatches, checkContact, clientIp };
