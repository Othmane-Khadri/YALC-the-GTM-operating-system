/**
 * Tiny ICP scorer. Loads a rules JSON, runs a row through it, returns
 * { score, passed, reasons }.
 *
 * Rules schema (see config/icp.json):
 *   { name, threshold, rules: [{field, kind, ...rule, score, reason}], exclusions: [...] }
 *
 * Supported kinds:
 *   - "regex"        — { pattern } tested against row[field]
 *   - "contains_any" — { values: [string] } any case-insensitive substring of row[field]
 *   - "equals"       — { value } strict equality
 */

import fs from 'node:fs/promises';

export async function loadIcp(path) {
  const raw = await fs.readFile(path, 'utf8');
  return JSON.parse(raw);
}

function fieldValue(row, field) {
  const v = row[field];
  return v == null ? '' : String(v);
}

function compileRegex(pattern) {
  // Parse Perl-style inline flags like (?i) at the start of the pattern, since
  // JavaScript's RegExp doesn't support inline flag syntax — it expects flags
  // as a separate argument.
  const m = pattern.match(/^\(\?([imsu]+)\)/);
  if (m) return new RegExp(pattern.slice(m[0].length), m[1]);
  return new RegExp(pattern);
}

function ruleMatches(rule, value) {
  if (rule.kind === 'regex') return compileRegex(rule.pattern).test(value);
  if (rule.kind === 'contains_any') {
    const v = value.toLowerCase();
    return rule.values.some(s => v.includes(String(s).toLowerCase()));
  }
  if (rule.kind === 'equals') return value === rule.value;
  return false;
}

export function scoreRow(row, icp, opts = {}) {
  const threshold = opts.threshold ?? icp.threshold ?? 50;
  const reasons = [];
  let score = 0;
  let excluded = null;

  for (const exc of icp.exclusions || []) {
    if (ruleMatches(exc, fieldValue(row, exc.field))) {
      excluded = exc.reason;
      break;
    }
  }

  for (const rule of icp.rules || []) {
    if (ruleMatches(rule, fieldValue(row, rule.field))) {
      score += rule.score;
      reasons.push(`+${rule.score}: ${rule.reason}`);
    }
  }

  return {
    score: excluded ? 0 : score,
    passed: !excluded && score >= threshold,
    reasons: excluded ? [`EXCLUDED: ${excluded}`] : reasons,
  };
}
