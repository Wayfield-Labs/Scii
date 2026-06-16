# Scii — Consumer Setup Guide
### Deploy your own status page in ~10 minutes. No CLI, no servers.

**What you’ll have:** `status.yourdomain.com` showing green/red badges, updating every 60 seconds, free on Cloudflare.

---

## Part 1: Prerequisites (2 min)

1. **Cloudflare account** — free tier is enough
2. **GitHub account** — to store your config
3. **Your service URLs** — use a `/health` endpoint that returns HTTP 200 (no redirects, no auth)

---

## Part 2: Deploy Scii (7 steps)

### Step 1 — Create your config repo
1. Go to GitHub → New repository → name it `scii-config` (public)
2. Add file `monitors.json`:
```json
[
  {"id":"website","name":"Website","url":"https://yourdomain.com"},
  {"id":"api","name":"API","url":"https://api.yourdomain.com/health"}
]
```
3. Click the file → **Raw** → copy the URL. It looks like:
`https://raw.githubusercontent.com/YOURNAME/scii-config/main/monitors.json`
→ This is your **MONITORS_URL**

### Step 2 — Create R2 bucket
Cloudflare Dashboard → **R2** → **Create bucket** → name: `scii-status` → Create

### Step 3 — Create Worker
**Workers & Pages** → **Create** → **Worker** → name: `scii` → **Deploy** → **Edit code**
- Delete everything → paste `worker.js` from the Scii repo → **Deploy**

### Step 4 — Connect storage and config
Worker → **Settings** → **Variables**:
- **Add R2 Bucket Binding**: Variable name = `R2_BUCKET` → Bucket = `scii-status`
- **Add Environment Variable**: Variable name = `MONITORS_URL` → Value = your raw URL from Step 1
→ **Save**

### Step 5 — Turn on checks
Worker → **Triggers** → **Add Cron Trigger** → enter: `* * * * *` → **Add**

### Step 6 — Test
Open the Worker URL: `https://scii.YOURNAME.workers.dev`
You’ll see “Waiting for first check…” → wait 60 seconds → badges appear

### Step 7 — Add your domain (optional)
Triggers → **Custom Domains** → **Add** → `status.yourdomain.com`

Done. Your status page is live.

---

## Part 3: Updating your services
Edit `monitors.json` in GitHub → Commit. Scii picks up changes within 60 seconds. No redeploy needed.

---

## Part 4: How GitHub Issues works (for you and your users)

Scii uses GitHub Issues as your incident communication system. It’s free and emails users automatically.

### A. One-time setup (3 minutes)
In your `scii-config` repo (or your Scii fork), create folder `.github/ISSUE_TEMPLATE/`

Add file `incident.md`:
```markdown
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
1. Visit your status page → see red “Down” badge
2. Click footer link → **Issues** → **New Issue** → choose **Report an Outage**
3. Fill the 3 fields → **Submit**
4. Click **Subscribe** on the right → they get email updates

### C. What you do
1. Open issue → comment: “Investigating - 14:32 UTC”
2. Post updates as comments (users get emailed automatically)
3. When fixed, comment final update and **Close issue**
4. Closed issue = permanent public incident history

**You don’t need a separate status notification service.** GitHub handles all emails.

### Optional power-up: Show active incidents on your status page
Add to Worker → Settings → Variables:
- `GITHUB_REPO` = `YOURNAME/scii-config`
- `GITHUB_TOKEN` = create a fine-grained token with **Issues: Read** permission

Scii will now show a yellow banner with open `incident` issues at the top of your status page. Close the issue → banner disappears.

---

## Part 5: Customize branding
In `worker.js`, find:
```html
<span class="sora wayfield">WAYFIELD</span> / <a class="labs scii">Scii</a>
```
Change `WAYFIELD` to your name. Change color `#50c878` in CSS to your brand color. Redeploy.

---

## Troubleshooting

**“Waiting for first check…” forever**
- Check Worker → Triggers → Cron exists
- Check Variables → `MONITORS_URL` is the **raw** GitHub URL (must start with `https://raw.githubusercontent.com`)

**All services show Down but they’re up**
- Your health URL must return HTTP 200, not 301/302 redirect
- Test with: `curl -I https://your-url.com/health`

**Changes to monitors.json not showing**
- GitHub raw URLs cache for ~5 minutes. Wait, or add `?v=2` to the URL

**Custom domain error**
- Wait 2-3 minutes for DNS. Cloudflare provisions the certificate automatically.

---

## FAQ

**Cost?** $0. Cloudflare Workers free = 100k requests/day. Scii uses ~1,440/day.

**Do my users need GitHub?** Yes, free account to subscribe to issues. They can still view the status page without an account.

**Can I use this for clients?** Yes. MIT licensed. Keep the LICENSE file.

**How do I back up?** Your config is in GitHub. Status history is in R2 → `status.json` and in GitHub Issues.

---

© 2026 Wayfield Labs. Scii is MIT licensed.
