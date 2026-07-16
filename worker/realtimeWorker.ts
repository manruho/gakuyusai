import { RealtimeHub } from './realtimeHub';

export { RealtimeHub };

export default {
  fetch(): Response {
    return new Response('gakuyusai realtime worker', { status: 404 });
  },
};
