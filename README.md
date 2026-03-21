# Agent Tracker Cloudflare Worker

One-click deploy Cloudflare Worker for tracking AI agents visiting your site. Perfect for Framer, Carrd, Webflow, and static sites that don't support middleware.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/usesapient/agent-tracker-cloudflare-worker)

## How it works

This Worker sits in front of your site via Cloudflare's proxy. It:

1. Intercepts all incoming requests
2. Detects AI agents (Claude, ChatGPT, Perplexity, etc.)
3. Sends tracking data to Sapient
4. Passes the request through to your origin site

Your actual site doesn't need any code changes.

## Setup

### 1. Deploy the Worker

Click the deploy button above, or manually:

```bash
npm install
npm run deploy
```

### 2. Configure Environment Variables

In Cloudflare Dashboard → Workers → your worker → Settings → Variables:

| Variable | Description |
|----------|-------------|
| `SAPIENT_API_KEY` | Your API key from [usesapient.com](https://usesapient.com) |
| `ORIGIN_URL` | Your actual site URL (e.g., `https://yoursite.framer.website`) |

### 3. Add Worker Route

In Cloudflare Dashboard → Websites → your domain → Workers Routes:

1. Add route: `yourdomain.com/*`
2. Select the `agent-tracker` worker
3. Save

### 4. Ensure DNS is Proxied

Your domain's DNS record must have the orange cloud (Proxied) enabled for the Worker to intercept traffic.

## Tracked Agents

- Claude (claude-code, claude-web, claudebot)
- ChatGPT / GPT (chatgpt, gptbot, openai)
- Perplexity
- Cohere
- Googlebot
- Bingbot

## License

MIT
