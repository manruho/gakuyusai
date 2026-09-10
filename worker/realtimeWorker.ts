import { RealtimeHub } from './realtimeHub';
import { publishRealtimeEvent } from './realtimeHub';
import { expireCheckoutDrafts } from './services/checkoutDraftService';
import { createId } from '../src/lib/ids';

export { RealtimeHub };

type RealtimeEnv = { DB: D1Database; REALTIME_HUB: DurableObjectNamespace<RealtimeHub> };

export default {
  fetch(): Response {
    return new Response('gakuyusai realtime worker', { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: RealtimeEnv, ctx: ExecutionContext): Promise<void> {
    const expired = await expireCheckoutDrafts(env.DB);
    for (const draft of expired) {
      ctx.waitUntil(publishRealtimeEvent(env.REALTIME_HUB, {
        eventId: createId('event'), type: 'order.expired', stationId: draft.station_id,
        occurredAt: new Date().toISOString(),
        data: { draftId: draft.id, pickupCode: draft.pickup_code, status: draft.status, cancelReason: draft.cancel_reason },
      }));
    }
  },
} satisfies ExportedHandler<RealtimeEnv>;
