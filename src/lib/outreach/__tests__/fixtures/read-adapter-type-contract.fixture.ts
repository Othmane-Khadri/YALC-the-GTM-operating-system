import type { OutreachReadAdapter } from '../../contracts'

declare const adapter: OutreachReadAdapter

// @ts-expect-error provider identity must not be mutable by read consumers.
adapter.provider = 'instantly'

// @ts-expect-error Read adapters cannot expose a generic transport escape hatch.
void adapter.request
// @ts-expect-error Read adapters cannot send messages.
void adapter.send
// @ts-expect-error Read adapters cannot reply to messages.
void adapter.reply
// @ts-expect-error Read adapters cannot activate campaigns.
void adapter.activate
// @ts-expect-error Read adapters cannot pause campaigns.
void adapter.pause
// @ts-expect-error Read adapters cannot add leads.
void adapter.addLead
// @ts-expect-error Read adapters cannot delete provider records.
void adapter.delete
