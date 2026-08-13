import { Hono } from 'hono'
import { rawClient } from '../../db'
import {
  CampaignLinkService,
  defaultCampaignDiscovery,
  type CampaignDiscovery,
} from '../../outreach/campaign-links'
import type { OutreachProvider } from '../../outreach/contracts'
import { resolveTenant } from '../../tenant'

const PROVIDERS = new Set<OutreachProvider>(['heyreach', 'instantly'])

type RouteOptions = {
  raw?: typeof rawClient
  discover?: CampaignDiscovery
  resolveTenant?: () => string
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
        })),
      })
    } catch {
      return c.json({ error: 'provider_unavailable' }, 503)
    }
  })

  routes.post('/campaign-links', async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.json() as Record<string, unknown>
    } catch {
      return c.json({ error: 'bad_request' }, 400)
    }
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
        const status = result.error === 'mapping_locked' ? 409 : result.error === 'campaign_not_found' ? 404 : 400
        return c.json({ error: result.error }, status)
      }
      return c.json({ link: result.link }, result.created ? 201 : 200)
    } catch {
      return c.json({ error: 'provider_unavailable' }, 503)
    }
  })

  return routes
}

export const outreachRoutes = createOutreachRoutes()
