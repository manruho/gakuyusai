/// <reference types="@cloudflare/vitest-plugin/types" />

import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      SESSION_SECRET: string;
      STAFF_USERNAME: string;
      STAFF_PASSWORD_HASH: string;
      ADMIN_USERNAME: string;
      ADMIN_PASSWORD_HASH: string;
      OWNER_USERNAME: string;
      OWNER_PASSWORD_HASH: string;
      PUBLIC_SHOP_NAME: string;
    }
  }
}

export {};
