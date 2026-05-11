/**
 * Tiny CSV writer/reader. Zero deps. Handles quoting and embedded newlines.
 */

import fs from 'node:fs/promises';

function escape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows, headers) {
  if (!headers) headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) lines.push(headers.map(h => escape(row[h])).join(','));
  return lines.join('\n');
}

export async function writeCsv(path, rows, headers) {
  await fs.writeFile(path, toCsv(rows, headers));
}

/**
 * Minimal CSV parser. Assumes UTF-8, comma delimiter, RFC 4180 quoting.
 * Handles quoted fields with embedded commas, newlines, and escaped quotes.
 */
export async function readCsv(path) {
  const text = await fs.readFile(path, 'utf8');
  return parseCsv(text);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter(r => r.some(v => v !== '')).map(r => {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = r[idx] ?? '');
    return obj;
  });
}
