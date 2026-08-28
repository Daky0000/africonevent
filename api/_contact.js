// Helpers for matching a self-service attendee against the contact details
// that were imported for them (CSV upload or manual entry).

// Reduce a phone number to comparable digits.
// Handles the common Ghana formats: 0244123456, +233244123456, 233244123456.
function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function phoneMatches(entered, stored) {
  const a = phoneDigits(entered);
  const b = phoneDigits(stored);
  if (!a || !b) return false;
  // Compare the national significant number so country code / leading zero
  // differences between what the attendee types and what was imported don't matter.
  if (a.length >= 9 && b.length >= 9) return a.slice(-9) === b.slice(-9);
  return a === b;
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

module.exports = { phoneMatches, emailMatches, checkContact, clientIp };
