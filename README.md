# Scii — Setup Guide

Deploy your own status page in ~10 minutes. No CLI, no servers.

## What you'll have
- `status.yourdomain.com` showing green/red badges
- Updates every 60 seconds
- Free on Cloudflare
- GitHub Issues as incident management with active incident banner
- Incident history timeline on your status page
- 90-minute check history with per-service uptime bars
- All data stored in git and R2

## Table of Contents
- [Part 1: Prerequisites (2 min)](#part-1-prerequisites-2-min)
- [Part 2: Deploy Scii (7 steps)](#part-2-deploy-scii-7-steps)
- [Part 3: Updating your services](#part-3-updating-your-services)
- [Part 4: How GitHub Issues works](#part-4-how-github-issues-works)
- [Part 5: Customize branding](#part-5-customize-branding)
- [Part 6: Advanced customization](#part-6-advanced-customization)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Next Steps](#next-steps)

---

## Part 1: Prerequisites (2 min)

### What you'll need
1. **Cloudflare account** — Free tier is sufficient (100k requests/day)
2. **GitHub account** — To store your configuration and manage incidents
3. **Your service URLs** — Each service needs a `/health` endpoint that returns HTTP 200
   - No redirects (301/302)
   - No authentication required
   - Returns within 30 seconds

### Test your health endpoints
```bash
curl -I https://yourdomain.com/health
# Should return: HTTP/1.1 200 OK
```

---

## Part 2: Deploy Scii (7 steps)

### Step 1 — Create your config repo

1. Go to GitHub → New repository
2. Name it `scii-config` (public recommended for transparency)
3. Create file `monitors.json`:

```json
[
  {
    "id": "website",
    "name": "Website",
    "url": "https://yourdomain.com"
  },
  {
    "id": "api",
    "name": "API",
    "url": "https://api.yourdomain.com/health"
  }
]
```

4. Commit the file
5. Click the file → Raw → copy the URL
   - Format: `https://raw.githubusercontent.com/YOURNAME/scii-config/main/monitors.json`
   - **This is your `MONITORS_URL`**

### Step 2 — Create R2 bucket

1. Cloudflare Dashboard → R2 → Create bucket
2. Name: `scii-status`
3. Click Create

**What is R2?** Cloudflare's S3-compatible object storage. Scii stores status history here.

### Step 3 — Create Worker

1. Cloudflare Dashboard → Workers & Pages → Create → Worker
2. Name: `scii`
3. Click Deploy → Edit code

**What is a Worker?** Cloudflare's serverless compute platform. Scii runs here.

4. Delete all existing code
5. Get `worker.js` from: https://github.com/wayfield-labs/scii/blob/main/worker.js
6. Paste the code into the editor
7. Click Deploy

### Step 4 — Connect storage and config

1. Go to Worker → Settings → Variables
2. Add R2 Bucket Binding:
   - Variable name: `R2_BUCKET`
   - Bucket: `scii-status`
3. Add Environment Variable:
   - Variable name: `MONITORS_URL`
   - Value: Your raw GitHub URL from Step 1
4. Click Save

### Step 5 — Turn on checks

1. Worker → Triggers → Add Cron Trigger
2. Enter: `* * * * *` (runs every minute)
3. Click Add

**Why every minute?** This gives you 60-second update intervals. Change to `*/5 * * * *` for 5-minute intervals.

### Step 6 — Test

1. Open your Worker URL: `https://scii.YOURNAME.workers.dev`
2. You'll see "Waiting for first check…"
3. Wait 60 seconds
4. Refresh — badges should appear

### Step 7 — Add your domain (optional)

1. Worker → Triggers → Custom Domains → Add
2. Enter: `status.yourdomain.com`
3. Click Add
4. Wait 2-3 minutes for DNS propagation and SSL certificate

**Done.** Your status page is live.

---

## Part 3: Updating your services

Edit `monitors.json` in GitHub → Commit. Scii picks up changes within 60 seconds. No redeploy needed.

**Note:** GitHub raw URLs cache for ~5 minutes. If changes don't appear immediately, add `?v=2` to your `MONITORS_URL` to bypass cache.

---

## Part 4: How GitHub Issues works

Scii uses GitHub Issues as your incident communication system. It's free and emails users automatically.

### A. One-time setup (3 minutes)

1. In your `scii-config` repo, create folder `.github/ISSUE_TEMPLATE/`
2. Add file `incident.md`:

```yaml
---
name: 🚨 Report an Outage
about: Report a service problem
title: "[INCIDENT] "
labels: ["incident"]
---

**Service:**
**When did it start (UTC):**
**What happens:**
```

### B. What your users do

1. Visit your status page → see red "Down" badge
2. Click footer link → Issues → New Issue → choose "Report an Outage"
3. Fill the 3 fields → Submit
4. Click "Subscribe" on the right → they get email updates

### C. What you do

1. Open issue → comment: "Investigating - 14:32 UTC"
2. Post updates as comments (users get emailed automatically)
3. When fixed, comment final update and Close issue
4. Closed issue = permanent public incident history

**You don't need a separate status notification service. GitHub handles all emails.**

### Optional: Show active incidents on your status page

1. Create a GitHub fine-grained token:
   - Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained token
   - Repository access: Select your `scii-config` repo
   - Permissions: Issues → Read only
   - Generate and copy the token

2. Add to Worker → Settings → Variables:
   - `GITHUB_REPO` = `YOURNAME/scii-config`
   - `GITHUB_TOKEN` = Your fine-grained token

3. Save and redeploy

Scii will now show a yellow banner with open incident issues at the top of your status page. Close the issue → banner disappears.

---

## Part 5: Customize branding

In `worker.js`, find the `<h1>` tag inside the `<header>`:

```html
<h1 class="text-2xl font-semibold" style="letter-spacing:-0.02em">WAYFIELD <span class="text-zinc-600">/</span> Labs</h1>
```

Change `WAYFIELD` and `Labs` to your brand name.

To change the accent color, replace `#22c55e` (green) and `#f59e0b` (amber) in the CSS with your brand colors. The green is used for "Operational" status, amber for active incidents.

Redeploy the Worker.

---

## Part 6: Advanced customization

### Change check interval

Edit the cron trigger:
- Every minute: `* * * * *`
- Every 5 minutes: `*/5 * * * *`
- Every hour: `0 * * * *`

### Custom health check timeout

In `worker.js`, modify the timeout value in the fetch call (default is 30 seconds).

### Multiple environments

Create separate Workers for dev/staging/prod:
- `scii-dev.yourdomain.com`
- `scii-staging.yourdomain.com`
- `status.yourdomain.com`

Each with its own config repo and R2 bucket.

### Custom status messages

Add custom messages in `monitors.json`:

```json
{
  "id": "website",
  "name": "Website",
  "url": "https://yourdomain.com",
  "message": "Main landing page"
}
```

---

## Troubleshooting

### Setup issues

**"Waiting for first check…" forever**
- Check Worker → Triggers → Cron trigger exists
- Check Variables → `MONITORS_URL` is the raw GitHub URL (must start with `https://raw.githubusercontent.com`)
- Check Worker Logs for errors

**Worker deployment fails**
- Ensure you copied the entire `worker.js` file
- Check for syntax errors in the code
- Try deploying a simple "Hello World" Worker first

**R2 bucket binding fails**
- Verify bucket name matches exactly: `scii-status`
- Check you have R2 permissions in your Cloudflare account

### Runtime issues

**All services show Down but they're up**
- Your health URL must return HTTP 200, not 301/302 redirect
- Test with: `curl -I https://your-url.com/health`
- Check if your health endpoint requires authentication

**Changes to monitors.json not showing**
- GitHub raw URLs cache for ~5 minutes. Wait, or add `?v=2` to the URL
- Check Worker Logs to see if it's fetching the new config

**Custom domain error**
- Wait 2-3 minutes for DNS propagation
- Cloudflare provisions the SSL certificate automatically
- Check your DNS settings point to Cloudflare

**GitHub Issues not showing**
- Verify `GITHUB_REPO` format: `owner/repo`
- Check `GITHUB_TOKEN` has Issues: Read permission
- Ensure the repo has the `incident` label

### Performance issues

**Worker hitting rate limits**
- Free tier: 100k requests/day (Scii uses ~1,440/day)
- If monitoring many services frequently, consider upgrading to Paid tier
- Increase check interval to reduce requests

**Slow page loads**
- Check R2 bucket location (choose region closest to your users)
- Consider enabling Cloudflare caching for static assets

---

## FAQ

**Cost?**
$0. Cloudflare Workers free = 100k requests/day. Scii uses ~1,440/day. R2 free tier = 10GB storage/month.

**Do my users need GitHub?**
Yes, for subscribing to incident updates (free account). They can still view the status page without an account.

**Can I use this for clients?**
Yes. MIT licensed. Keep the LICENSE file. You can customize branding for each client.

**How do I back up?**
Your config is in GitHub. Status history is in R2 (`status.json`) and in GitHub Issues. Both are automatically versioned.

**What if Cloudflare goes down?**
Your status page will be unavailable, but your monitoring history in R2 and GitHub Issues remains intact.

**Can I monitor services behind authentication?**
Not directly. Create a public health endpoint that checks the authenticated service internally.

**How many services can I monitor?**
Practically unlimited. Each check is a single HTTP request. With 1-minute intervals, 100 services = 100k requests/day (free tier limit).

**Can I get alerts beyond GitHub Issues?**
You can add webhooks to GitHub Issues to send alerts to Slack, Discord, etc. via third-party services.

**Is my data private?**
- Config repo: Public by default (can be private)
- R2 bucket: Private by default
- GitHub Issues: Public by default (can be private repo)

---

## Next Steps

### Security considerations
- Use a private config repo if services are sensitive
- Rotate GitHub tokens periodically
- Enable 2FA on your Cloudflare and GitHub accounts
- Consider IP whitelisting for your health endpoints

### Monitoring the monitoring
- Set up a separate external monitor to check your status page
- Create a GitHub Action to alert if Scii Worker stops running
- Monitor R2 storage usage

### Scaling
- For enterprise needs, consider Cloudflare Workers Paid tier for higher limits
- Use Cloudflare Durable Objects for real-time updates
- Add analytics to track status page visitors

### Integration ideas
- Add uptime percentage calculations
- Create weekly/monthly incident reports
- Integrate with PagerDuty or other on-call systems
- Add SMS alerts via GitHub Issue webhooks

---

## Need help?

- GitHub: https://github.com/wayfield-labs/scii
- Issues: https://github.com/wayfield-labs/scii/issues
- Email: hello@wayfield.dev

---

© 2026 Wayfield Labs. Scii is MIT licensed.
