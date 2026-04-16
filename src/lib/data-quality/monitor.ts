import { randomUUID } from 'crypto'
import { eq, ne } from 'drizzle-orm'
import { db } from '../db'
import { resultSets, resultRows, dataQualityLog } from '../db/schema'
import { ReviewQueue } from '../review/queue'
import type { QualityIssue, QualitySeverity } from './types'

const reviewQueue = new ReviewQueue()

export class DataQualityMonitor {
  async checkDedup(resultSetId: string): Promise<QualityIssue[]> {
    const issues: QualityIssue[] = []

    // Get rows from this result set
    const rows = await db
      .select()
      .from(resultRows)
      .where(eq(resultRows.resultSetId, resultSetId))

    if (rows.length === 0) return issues

    // Get rows from other result sets for cross-set dedup
    const otherSets = await db
      .select()
      .from(resultSets)
      .where(ne(resultSets.id, resultSetId))

    for (const otherSet of otherSets) {
      const otherRows = await db
        .select()
        .from(resultRows)
        .where(eq(resultRows.resultSetId, otherSet.id))

      // Build a normalized lookup from the other set
      const otherNormalized = new Map<string, typeof otherRows[0]>()
      for (const or of otherRows) {
        const data = or.data as Record<string, unknown> | null
        if (!data) continue
        const key = this.normalizeCompanyKey(data)
        if (key) otherNormalized.set(key, or)
      }

      // Check current rows against the other set
      let dupeCount = 0
      for (const row of rows) {
        const data = row.data as Record<string, unknown> | null
        if (!data) continue
        const key = this.normalizeCompanyKey(data)
        if (key && otherNormalized.has(key)) {
          dupeCount++
        }
      }

      if (dupeCount > 0) {
        issues.push(this.createIssue(resultSetId, null, 'duplicate', dupeCount > 5 ? 'warning' : 'info', {
          duplicateCount: dupeCount,
          otherResultSetId: otherSet.id,
          otherResultSetName: otherSet.name,
        }, `Found ${dupeCount} duplicates from "${otherSet.name}". Merge and use most recent data?`, {
          endpoint: `/api/data-quality/issues`,
          method: 'PATCH',
          body: { action: 'merge', sourceId: resultSetId, targetId: otherSet.id },
        }))
      }
    }

    return issues
  }

  async checkCompleteness(resultSetId: string): Promise<QualityIssue[]> {
    const issues: QualityIssue[] = []

    const rows = await db
      .select()
      .from(resultRows)
      .where(eq(resultRows.resultSetId, resultSetId))

    if (rows.length === 0) return issues

    let incompleteWarning = 0
    let incompleteCritical = 0
    const missingFields = new Map<string, number>()

    for (const row of rows) {
      const data = row.data as Record<string, unknown> | null
      if (!data) {
        incompleteCritical++
        continue
      }

      const keys = Object.keys(data)
      const total = keys.length || 1
      const filled = keys.filter(k => data[k] !== null && data[k] !== '' && data[k] !== undefined).length
      const ratio = filled / total

      if (ratio < 0.4) {
        incompleteCritical++
      } else if (ratio < 0.6) {
        incompleteWarning++
      }

      // Track which fields are most commonly missing
      for (const k of keys) {
        if (data[k] === null || data[k] === '' || data[k] === undefined) {
          missingFields.set(k, (missingFields.get(k) ?? 0) + 1)
        }
      }
    }

    const topMissing = [...missingFields.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([field, count]) => `${field} (${count} rows)`)

    if (incompleteCritical > 0) {
      issues.push(this.createIssue(resultSetId, null, 'completeness', 'critical', {
        incompleteCritical,
        incompleteWarning,
        topMissingFields: topMissing,
      }, `${incompleteCritical} rows are missing key fields: ${topMissing.join(', ')}. Enrich with a provider?`, {
        endpoint: `/api/workflows/execute`,
        method: 'POST',
        body: { action: 'enrich', resultSetId },
      }))
    } else if (incompleteWarning > 0) {
      issues.push(this.createIssue(resultSetId, null, 'completeness', 'warning', {
        incompleteWarning,
        topMissingFields: topMissing,
      }, `${incompleteWarning} rows have incomplete data. Consider enriching missing fields.`, null))
    }

    return issues
  }

  async checkAnomaly(resultSetId: string, icpMatchRate: number): Promise<QualityIssue[]> {
    const issues: QualityIssue[] = []

    if (icpMatchRate < 15) {
      issues.push(this.createIssue(resultSetId, null, 'anomaly', 'critical', {
        icpMatchRate,
        expectedRange: '30-60%',
      }, `ICP match rate is ${icpMatchRate}% (usually 30-60%). Search criteria may be too broad.`, {
        endpoint: `/api/tables/${resultSetId}`,
        method: 'GET',
        body: null,
      }))
    } else if (icpMatchRate < 30) {
      issues.push(this.createIssue(resultSetId, null, 'anomaly', 'warning', {
        icpMatchRate,
        expectedRange: '30-60%',
      }, `ICP match rate is ${icpMatchRate}%. Consider refining your search criteria.`, null))
    }

    return issues
  }

  async checkFreshness(resultSetId: string): Promise<QualityIssue[]> {
    const issues: QualityIssue[] = []

    const sets = await db
      .select()
      .from(resultSets)
      .where(eq(resultSets.id, resultSetId))

    if (sets.length === 0) return issues

    const set = sets[0]
    const createdAt = set.createdAt instanceof Date ? set.createdAt : new Date(set.createdAt as unknown as string)
    const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24))

    if (ageDays > 60) {
      issues.push(this.createIssue(resultSetId, null, 'freshness', 'critical', {
        ageDays,
        createdAt: createdAt.toISOString(),
      }, `Data is ${ageDays} days old. Re-enrich to get current information?`, {
        endpoint: `/api/workflows/execute`,
        method: 'POST',
        body: { action: 're-enrich', resultSetId },
      }))
    } else if (ageDays > 30) {
      issues.push(this.createIssue(resultSetId, null, 'freshness', 'warning', {
        ageDays,
        createdAt: createdAt.toISOString(),
      }, `Data is ${ageDays} days old. Consider re-enriching for accuracy.`, null))
    }

    return issues
  }

  async runAll(resultSetId: string): Promise<QualityIssue[]> {
    const [dedup, completeness, freshness] = await Promise.all([
      this.checkDedup(resultSetId),
      this.checkCompleteness(resultSetId),
      this.checkFreshness(resultSetId),
    ])

    const allIssues = [...dedup, ...completeness, ...freshness]

    // Persist issues to DB
    for (const issue of allIssues) {
      await db.insert(dataQualityLog).values({
        id: issue.id,
        resultSetId: issue.resultSetId,
        rowId: issue.rowId,
        checkType: issue.checkType,
        severity: issue.severity,
        details: JSON.stringify(issue.details),
        nudge: issue.nudge,
        action: issue.action ? JSON.stringify(issue.action) : null,
        resolved: 0,
        resolvedAt: null,
      })
    }

    // Create review requests for critical issues
    for (const issue of allIssues.filter(i => i.severity === 'critical')) {
      await reviewQueue.create({
        type: 'data_quality',
        title: `Data Quality: ${issue.checkType} — ${issue.severity}`,
        description: issue.nudge,
        sourceSystem: 'data_quality_monitor',
        sourceId: issue.resultSetId,
        priority: 'high',
        payload: { issue },
        action: issue.action,
        nudgeEvidence: null,
        reviewedAt: null,
        reviewNotes: null,
        expiresAt: null,
      })
    }

    return allIssues
  }

  private normalizeCompanyKey(data: Record<string, unknown>): string | null {
    const name = (data.company_name ?? data.company ?? data.companyName ?? '') as string
    const website = (data.website ?? data.url ?? data.domain ?? '') as string

    if (!name && !website) return null

    const normalizedName = name
      .toLowerCase()
      .replace(/\b(inc|ltd|llc|gmbh|corp|co|sa|ag|plc)\b\.?/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim()

    let domain = ''
    if (website) {
      try {
        domain = new URL(website.startsWith('http') ? website : `https://${website}`).hostname
          .replace(/^www\./, '')
      } catch {
        // Malformed URL — skip domain for dedup key
      }
    }

    const key = `${normalizedName}|${domain}`
    return normalizedName || domain ? key : null
  }

  private createIssue(
    resultSetId: string,
    rowId: string | null,
    checkType: QualityIssue['checkType'],
    severity: QualitySeverity,
    details: Record<string, unknown>,
    nudge: string,
    action: QualityIssue['action'],
  ): QualityIssue {
    return {
      id: randomUUID(),
      resultSetId,
      rowId,
      checkType,
      severity,
      details,
      nudge,
      action,
      resolved: false,
      createdAt: new Date().toISOString(),
    }
  }
}
