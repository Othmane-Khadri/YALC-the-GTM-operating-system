import { lookup } from 'dns/promises'

const BLOCKED_IPV4_RANGES = [
  // Loopback
  { prefix: '127.', mask: 8 },
  // Private
  { prefix: '10.', mask: 8 },
  { prefix: '192.168.', mask: 16 },
  // 172.16.0.0 - 172.31.255.255
  { prefix: '172.', mask: 12, check: (ip: string) => {
    const second = parseInt(ip.split('.')[1], 10)
    return second >= 16 && second <= 31
  }},
  // Link-local
  { prefix: '169.254.', mask: 16 },
  // CGNAT
  { prefix: '100.64.', mask: 10, check: (ip: string) => {
    const second = parseInt(ip.split('.')[1], 10)
    return second >= 64 && second <= 127
  }},
  // Unspecified
  { prefix: '0.', mask: 8 },
]

const BLOCKED_IPV6_PREFIXES = [
  '::1',      // loopback
  'fc',       // unique local (fc00::/7)
  'fd',       // unique local
  'fe80:',    // link-local
  '::ffff:',  // IPv4-mapped (checked separately)
]

function isPrivateIPv4(ip: string): boolean {
  for (const range of BLOCKED_IPV4_RANGES) {
    if (ip.startsWith(range.prefix)) {
      if (range.check) return range.check(ip)
      return true
    }
  }
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  for (const prefix of BLOCKED_IPV6_PREFIXES) {
    if (lower.startsWith(prefix)) return true
  }
  // Check IPv4-mapped addresses (::ffff:x.x.x.x)
  const v4Match = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (v4Match) return isPrivateIPv4(v4Match[1])
  return false
}

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlValidationError'
  }
}

/**
 * Validates a URL is safe to fetch (not internal/private).
 * Resolves DNS and checks the resolved IP to prevent DNS rebinding.
 * Throws UrlValidationError if the URL is blocked.
 */
export async function validateUrl(url: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new UrlValidationError('Invalid URL')
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlValidationError(`Blocked protocol: ${parsed.protocol}`)
  }

  // Block URLs with credentials
  if (parsed.username || parsed.password) {
    throw new UrlValidationError('URLs with credentials are not allowed')
  }

  const hostname = parsed.hostname

  // Check if hostname is a raw IP
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      throw new UrlValidationError('Blocked: private/internal IP address')
    }
    return parsed
  }

  if (hostname.startsWith('[') || hostname.includes(':')) {
    const clean = hostname.replace(/^\[|\]$/g, '')
    if (isPrivateIPv6(clean)) {
      throw new UrlValidationError('Blocked: private/internal IPv6 address')
    }
    return parsed
  }

  // Block localhost variants
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UrlValidationError('Blocked: localhost')
  }

  // Resolve DNS and check the IP
  try {
    const result = await lookup(hostname, { all: true })
    for (const entry of result) {
      if (entry.family === 4 && isPrivateIPv4(entry.address)) {
        throw new UrlValidationError(
          `Blocked: ${hostname} resolves to private IP ${entry.address}`
        )
      }
      if (entry.family === 6 && isPrivateIPv6(entry.address)) {
        throw new UrlValidationError(
          `Blocked: ${hostname} resolves to private IPv6 ${entry.address}`
        )
      }
    }
  } catch (err) {
    if (err instanceof UrlValidationError) throw err
    throw new UrlValidationError(`DNS resolution failed for ${hostname}`)
  }

  return parsed
}
