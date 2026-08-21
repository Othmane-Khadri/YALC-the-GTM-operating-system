import { Hono } from 'hono'
import { rawClient } from '../../db'
import {
  CampaignLinkService,
  defaultCampaignDiscovery,
  type CampaignDiscovery,
} from '../../outreach/campaign-links'
import type { OutreachProvider } from '../../outreach/contracts'
import { OutreachSyncCoordinator } from '../../outreach/sync.js'
import { resolveTenant } from '../../tenant'

const PROVIDERS = new Set<OutreachProvider>(['heyreach', 'instantly'])

type RouteOptions = {
  raw?: typeof rawClient
  discover?: CampaignDiscovery
  resolveTenant?: () => string
  sync?: OutreachSyncCoordinator
}

function providerFrom(value: unknown): OutreachProvider | null {
  return typeof value === 'string' && PROVIDERS.has(value as OutreachProvider)
    ? value as OutreachProvider
    : null
}

function requestedTenantMatches(activeTenant: string, requestedTenant: unknown): boolean {
  return typeof requestedTenant !== 'string' || requestedTenant === activeTenant
}

/**
 * Exact campaign-link API. The server-owned tenant resolver establishes the
 * scope; a tenant request parameter can only assert that same scope.
 */
export function createOutreachRoutes(options: RouteOptions = {}) {
  const routes = new Hono()
  const service = new CampaignLinkService(options.raw ?? rawClient, options.discover ?? defaultCampaignDiscovery)
  const sync = options.sync ?? new OutreachSyncCoordinator({ raw: options.raw ?? rawClient })
  const activeTenant = options.resolveTenant ?? (() => resolveTenant())

  routes.get('/provider-campaigns', async (c) => {
    const tenantId = activeTenant()
    if (!requestedTenantMatches(tenantId, c.req.query('tenant'))) {
      return c.json({ error: 'tenant_forbidden' }, 403)
    }
    const provider = providerFrom(c.req.query('provider'))
    if (!provider) return c.json({ error: 'invalid_provider' }, 400)

    try {
      const campaigns = await service.discover(tenantId, provider)
      return c.json({
        campaigns: campaigns.map((campaign) => ({
          provider,
          externalCampaignId: campaign.externalCampaignId,
          name: campaign.externalName,
          status: campaign.externalStatus,
          senderAccountIds: campaign.senderAccountIds,
          link: campaign.link,
          mappingLocked: campaign.mappingLocked,
        })),
      })
    } catch {
      return c.json({ error: 'provider_unavailable' }, 503)
    }
  })

  routes.post('/campaign-links', async (c) => {
    let parsed: unknown
    try {
      parsed = await c.req.json()
    } catch {
      return c.json({ error: 'bad_request' }, 400)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return c.json({ error: 'bad_request' }, 400)
    }
    const body = parsed as Record<string, unknown>
    const tenantId = activeTenant()
    if (!requestedTenantMatches(tenantId, body.tenant)) {
      return c.json({ error: 'tenant_forbidden' }, 403)
    }
    const provider = providerFrom(body.provider)
    if (!provider) return c.json({ error: 'invalid_provider' }, 400)
    if (typeof body.externalCampaignId !== 'string' || typeof body.campaignId !== 'string') {
      return c.json({ error: 'bad_request' }, 400)
    }

    try {
      const result = await service.link({
        tenantId,
        provider,
        externalCampaignId: body.externalCampaignId,
        campaignId: body.campaignId,
        senderAccountId: typeof body.senderAccountId === 'string' ? body.senderAccountId : null,
      })
      if (!result.ok) {
        const status = result.error === 'mapping_locked' || result.error === 'mapping_conflict'
          ? 409
          : result.error === 'campaign_not_found'
            ? 404
            : 400
        return c.json({ error: result.error }, status)
      }
      return c.json({ link: result.link }, result.created ? 201 : 200)
    } catch {
      return c.json({ error: 'provider_unavailable' }, 503)
    }
  })

  routes.post('/sync', async (c) => {
    let parsed: unknown
    try {
      parsed = await c.req.json()
    } catch {
      return c.json({ error: 'bad_request' }, 400)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return c.json({ error: 'bad_request' }, 400)
    const body = parsed as Record<string, unknown>
    const tenantId = activeTenant()
    if (!requestedTenantMatches(tenantId, body.tenant)) return c.json({ error: 'tenant_forbidden' }, 403)
    if (typeof body.campaignId !== 'string' || !body.campaignId.trim()) return c.json({ error: 'bad_request' }, 400)
    const providers = body.providers === undefined
      ? undefined
      : Array.isArray(body.providers) && body.providers.length > 0
        && body.providers.every((provider) => providerFrom(provider) !== null)
        ? body.providers as OutreachProvider[]
        : null
    if (providers === null) return c.json({ error: 'invalid_provider' }, 400)
    try {
      const runId = await sync.enqueue({ tenantId, campaignId: body.campaignId, providers })
      return c.json({ runId, status: 'queued', statusUrl: `/api/outreach/sync/${runId}` }, 202)
    } catch {
      return c.json({ error: 'campaign_not_found' }, 404)
    }
  })

  routes.get('/sync/:id', async (c) => {
    const tenantId = activeTenant()
    if (!requestedTenantMatches(tenantId, c.req.query('tenant'))) return c.json({ error: 'tenant_forbidden' }, 403)
    const status = await sync.getStatus(tenantId, c.req.param('id'))
    return status ? c.json(status) : c.json({ error: 'not_found' }, 404)
  })

  return routes
}

export const outreachRoutes = createOutreachRoutes()
