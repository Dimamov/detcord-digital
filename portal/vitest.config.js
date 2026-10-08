import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

const migrations = await readD1Migrations(new URL('./migrations', import.meta.url).pathname);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations, RESEND_API_KEY: '', CLOVER_MERCHANT_ID: 'TESTMERCHANT', CLOVER_PRIVATE_TOKEN: 'test-private-token', CLOVER_WEBHOOK_SECRET: 'test-webhook-secret', CLOVER_API_BASE: 'https://apisandbox.dev.clover.com',
        GOOGLE_API_KEY: 'test-google-key', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_API_KEY_SID: 'SKtest', TWILIO_API_KEY_SECRET: 'test-secret', TWILIO_MESSAGING_SERVICE_SID: 'MGtest', TWILIO_AUTH_TOKEN: 'test-auth-token', DEEPGRAM_API_KEY: 'test-deepgram-key',
        GOOGLE_ADS_DEVELOPER_TOKEN: 'test-dev-token', GOOGLE_ADS_CLIENT_ID: 'test-client', GOOGLE_ADS_CLIENT_SECRET: 'test-secret', GOOGLE_ADS_REFRESH_TOKEN: 'test-refresh',
        ZERNIO_API_KEY: 'test-zernio-key' } },
    }),
  ],
  test: { setupFiles: ['./test/apply-migrations.js'], include: ['test/**/*.test.js'] },
});
