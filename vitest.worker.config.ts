import { pbkdf2Sync } from 'node:crypto';
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

function passwordHash(password: string): string {
  const salt = 'gakuyusai-worker-tests';
  const hash = pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$100000$${salt}$${hash}`;
}

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-08-28',
        compatibilityFlags: ['nodejs_compat'],
        cacheAPI: true,
        d1Databases: ['DB'],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.resolve('migrations')),
          SESSION_SECRET: 'worker-test-session-secret',
          STAFF_USERNAME: 'staff-test',
          STAFF_PASSWORD_HASH: passwordHash('staff-test-password'),
          ADMIN_USERNAME: 'admin-test',
          ADMIN_PASSWORD_HASH: passwordHash('admin-test-password'),
          OWNER_USERNAME: 'owner-test',
          OWNER_PASSWORD_HASH: passwordHash('owner-test-password'),
          PUBLIC_SHOP_NAME: 'Worker Test Shop',
        },
      },
    })),
  ],
  test: {
    include: ['tests/worker/**/*.test.ts'],
    setupFiles: ['tests/worker/setup.ts'],
  },
});
