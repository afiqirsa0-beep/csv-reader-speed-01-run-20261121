// Faster drop-in for csv-reader 1.0.0: same answer, found with indexOf and slice instead of a per-character build.
// State is module-level (reset by run) so the hot helpers need no closures; nothing survives from one call to the next.

const COMMA = 0, LINE_BREAK = 1, END = 2;

let text = '', n = 0, pos = 0, line = 1;
let errors = [], recordLine = 1, recordRow = null;
// next comma / LF / CR at or after a position (n: none); stale when below the read position, -1 forces a refresh
let nComma = -1, nLF = -1, nCR = -1;
let val = ''; // the field a reader just finished

function readUnquoted(value) {
  let start = pos;
  for (;;) {
    if (nComma < start) { nComma = text.indexOf(',', start); if (nComma < 0) nComma = n; }
    if (nLF < start) { nLF = text.indexOf('\n', start); if (nLF < 0) nLF = n; }
    if (nCR < start) { nCR = text.indexOf('\r', start); if (nCR < 0) nCR = n; }
    let e = nComma < nLF ? nComma : nLF;
    if (nCR < e) e = nCR;
    if (e >= n) {
      val = start === 0 && value === '' ? text : value + text.slice(start, n);
      pos = n;
      return END;
    }
    const c = text.charCodeAt(e);
    if (c === 44) { val = value + text.slice(start, e); pos = e + 1; return COMMA; }
    if (c === 10) { val = value + text.slice(start, e); pos = e + 1; line++; return LINE_BREAK; }
    if (text.charCodeAt(e + 1) === 10) { val = value + text.slice(start, e); pos = e + 2; line++; return LINE_BREAK; }
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    value += text.slice(start, e);
    start = e + 1;
  }
}

// The opening quote is at pos.
function readQuoted() {
  const open = pos;
  let p = open + 1, q, doubled = false;
  for (;;) {
    q = text.indexOf('"', p);
    if (q < 0 || text.charCodeAt(q + 1) !== 34) break;
    doubled = true;
    p = q + 2;
  }
  if (q < 0) {
    // never closes: the quote is a literal and the rest is read again as unquoted
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    pos = open + 1;
    nComma = nLF = nCR = -1;
    return readUnquoted('"');
  }
  let value = text.slice(open + 1, q);
  if (doubled) value = value.replaceAll('""', '"');
  if (value.indexOf('\r') >= 0) value = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  for (let k = value.indexOf('\n'); k >= 0; k = value.indexOf('\n', k + 1)) line++;
  pos = q + 1;
  if (pos >= n) { val = value; return END; }
  const c = text.charCodeAt(pos);
  if (c === 44) { val = value; pos++; return COMMA; }
  if (c === 10) { val = value; pos++; line++; return LINE_BREAK; }
  if (c === 13 && text.charCodeAt(pos + 1) === 10) { val = value; pos += 2; line++; return LINE_BREAK; }
  const ended = readUnquoted(value);
  if (val.length > value.length) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  return ended;
}

export function run(input) {
  text = String(input.text);
  n = text.length;
  const header = input.header === true;
  errors = [];
  const rows = [];
  let columns = null, width = -1;
  pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  line = 1;
  nComma = nLF = nCR = -1;

  for (;;) {
    // lines with no characters are no records
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos++; line++; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted, ended;
    do {
      quoted = text.charCodeAt(pos) === 34;
      ended = quoted ? readQuoted() : readUnquoted('');
      fields.push(val);
    } while (ended === COMMA);

    // a line of only stray CRs is no record (its errors stay)
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  const out = { columns: header ? (columns ?? []) : null, rows, errors };
  text = ''; errors = [];
  return out;
}
