export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/status") {
      const data = await env.R2_BUCKET.get("status.json");
      return new Response(data? await data.text() : '{"monitors":[]}', {
        headers: {"content-type":"application/json","cache-control":"no-store"}
      });
    }

    if (url.pathname === "/") {
      const data = await env.R2_BUCKET.get("status.json");
      const {lastChecked, monitors=[]} = data? JSON.parse(await data.text()) : {};

      const rows = monitors.map(m => `
        <div class="flex items-center justify-between p-4 border-b border-zinc-800">
          <div><div class="font-medium">${m.name}</div><div class="text-xs text-zinc-500">${m.url}</div></div>
          <div class="flex gap-3 items-center"><span class="text-xs text-zinc-500">${m.responseTime}ms</span>
          <span class="px-2.5 py-1 rounded-full text-xs ${m.status==='up'?'bg-emerald-500/15 text-emerald-400':'bg-red-500/15 text-red-400'}">${m.status==='up'?'Operational':'Down'}</span></div>
        </div>`).join("");

      return new Response(`<!doctype html><html><head><title>Scii Status</title><script src="https://cdn.tailwindcss.com"></script><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-zinc-950 text-zinc-100"><div class="max-w-xl mx-auto p-6 pt-16"><h1 class="text-2xl font-semibold">Scii</h1><p class="text-zinc-500 mb-6">Last check: ${lastChecked?new Date(lastChecked).toLocaleTimeString():'—'}</p><div class="bg-zinc-900 rounded-2xl border border-zinc-800">${rows}</div><p class="text-xs text-zinc-600 mt-6 text-center"><a href="/status" class="underline">API</a> • fork on GitHub</p></div><script>setTimeout(()=>location.reload(),60000)</script></body></html>`, {headers:{"content-type":"text/html"}});
    }
    return new Response("Not found", {status:404});
  },

  async scheduled(event, env) {
    const monitorsUrl = env.MONITORS_URL; // e.g. https://raw.githubusercontent.com/you/scii-config/main/monitors.json
    const monitors = await fetch(monitorsUrl + "?t=" + Date.now(), {cf:{cacheTtl:0}}).then(r=>r.json()).catch(()=>[]);
    const results = [];
    for (const m of monitors) {
      const t = Date.now();
      let status="up", code=0;
      try { const r = await fetch(m.url, {cf:{cacheTtl:0}}); code=r.status; status=r.ok?"up":"down"; } catch { status="down"; }
      results.push({...m, status, code, responseTime:Date.now()-t, checkedAt:new Date().toISOString()});
    }
    await env.R2_BUCKET.put("status.json", JSON.stringify({lastChecked:new Date().toISOString(), monitors:results}));
  }
}
