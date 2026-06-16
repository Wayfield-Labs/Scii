# Scii — self-hosted status page
Fork this repo + fork scii-config
Edit monitors.json in your config repo
npm i -g wrangler && wrangler login
wrangler r2 bucket create scii-status
wrangler deploy
Set MONITORS_URL in wrangler.toml to your raw GitHub URL
Add your domain in Cloudflare
Done. Edit monitors.json, commit, page updates in 60s.
