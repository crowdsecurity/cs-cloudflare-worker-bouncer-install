# CrowdSec Cloudflare Bouncer GUI

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/crowdsecurity/cs-cloudflare-worker-bouncer-install/tree/main)


A web-based GUI for configuring and deploying the [CrowdSec Cloudflare Worker Bouncer](https://github.com/crowdsecurity/cs-cloudflare-worker-bouncer) in autonomous mode.

## Features

- Deploy bouncer infrastructure to Cloudflare zones
- Select which zones to protect
- Real-time progress streaming
- Clear/remove all bouncer infrastructure
- No external dependencies - uses Cloudflare API directly

## Usage

1. **Select Action**: Choose Deploy or Clear
2. **Enter Credentials**: Provide Cloudflare API token and CrowdSec blocklist mirror credentials
3. **Select Zones**: Choose which Cloudflare zones to protect
4. **Deploy**: Watch real-time output as infrastructure is created

### Deployed Resources

When you deploy, the following resources are created in your Cloudflare account:

- **KV Namespace**: `CROWDSECCFBOUNCERNS` - stores decisions and configuration
- **D1 Database**: `CROWDSECCFBOUNCERDB` - stores metrics (optional)
- **Main Worker**: `crowdsec-cloudflare-worker-bouncer` - handles incoming requests
- **Sync Worker**: `crowdsec-decisions-sync-worker` - syncs decisions from CrowdSec
- **Worker Routes**: Routes traffic through the bouncer for selected zones
- **Turnstile Widgets**: For captcha challenges (one per zone)

## License

MIT