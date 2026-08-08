import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Default OpenNext Cloudflare config — no incremental cache / queue overrides
// needed for the walking skeleton (page is force-dynamic, no ISR).
export default defineCloudflareConfig();
