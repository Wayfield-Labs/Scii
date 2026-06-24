export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/status') {
      return handleAPI(env);
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wayfield Labs Status</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body { font-family: 'Inter', sans-serif; background: #050507; }
 .ambient { background: radial-gradient(600px 300px at 50% -50px, rgba(80,200,120,0.06), transparent 60%), #050507; }
 .card { background: rgba(17,17,20,0.9); border: 1px solid #27272a; box-shadow: 0 4px 16px rgba(0,0,0,0.3); transition: all 0.2s; }
 .card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
 .pulse-dot { position: relative; }
 .pulse-dot::before { content: ''; position: absolute; inset: -3px; border-radius: 50%; background: currentColor; opacity: 0.3; animation: ping 2s infinite; }
  @keyframes ping { 75%,100% { transform: scale(1.6); opacity: 0; } }
 .bar { width: 3px; height: 20px; background: #27272a; border-radius: 2px; transition: all 0.15s; }
 .bar-up { background: #22c55e; }
 .bar-down { background: #ef4444; }
 .bar:hover { transform: scaleY(1.3); filter: brightness(1.2); }
 .big-num { background: linear-gradient(180deg, #fff, #a1a1aa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
 .banner { background: linear-gradient(90deg, rgba(34,197,94,0.1), transparent); border-left: 3px solid #22c55e; }
</style>
</head>
<body class="ambient text-zinc-100">
<div class="max-w-5xl mx-auto p-6">
  <header class="flex justify-between items-center mb-6">
    <div>
      <h1 class="text-2xl font-semibold" style="letter-spacing:-0.02em">WAYFIELD <span class="text-zinc-600">/</span> Labs</h1>
      <p class="text-sm text-zinc-400 flex items-center gap-2 mt-1">
        <span class="pulse-dot w-2 h-2 rounded-full bg-green-500"></span>
        System status • <span id="updated">loading...</span>
      </p>
    </div>
  </header>

  <div class="banner card rounded-xl p-4 mb-8 flex items-center gap-3">
    <div class="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
      <svg width="20" height="20" fill="none" stroke="#22c55e" stroke-width="2"><path d="M5 10l3 3 7-7"/></svg>
    </div>
    <div>
      <div class="font-medium">All Systems Operational</div>
      <div class="text-sm text-zinc-400">All services running normally</div>
    </div>
  </div>

  <div class="grid lg:grid-cols-3 gap-6">
    <div class="lg:col-span-2 space-y-6" id="services"></div>
    <div class="space-y-4">
      <div class="card rounded-xl p-5">
        <div class="text-4xl font-bold big-num" id="uptime">99.98%</div>
        <div class="text-sm text-green-400 -mt-1">uptime</div>
        <div class="text-xs text-zinc-500 mt-1">Last 90 days</div>
        <div class="mt-4 space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-zinc-400">Incident-free</span><span id="incident-free">47 days</span></div>
          <div class="flex justify-between"><span class="text-zinc-400">Mean response</span><span id="mean-response">28ms</span></div>
        </div>
      </div>
      <div class="card rounded-xl p-5">
        <h3 class="font-medium mb-3 text-sm">Regions</h3>
        <div class="space-y-2" id="regions"></div>
      </div>
    </div>
  </div>
</div>

<script>
async function loadStatus() {
  const res = await fetch('/api/status');
  const d = await res.json();
  document.getElementById('updated').textContent = 'updated ' + d.lastUpdated;
  document.getElementById('uptime').textContent = d.uptime + '%';
  document.getElementById('incident-free').textContent = d.incidentFree + ' days';
  document.getElementById('mean-response').textContent = d.meanResponse + 'ms';

  document.getElementById('services').innerHTML = d.groups.map(g => \`
    <div>
      <h2 class="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-3">\${g.name}</h2>
      <div class="card rounded-xl divide-y divide-zinc-800/60">
        \${g.services.map(s => \`
          <div class="p-4 hover:bg-zinc-900/40 transition">
            <div class="flex justify-between items-start">
              <div>
                <div class="flex items-center gap-2">
                  <span class="pulse-dot w-2 h-2 rounded-full bg-green-500"></span>
                  <span class="font-medium">\${s.name}</span>
                </div>
                <div class="text-xs text-zinc-500 mt-1">\${s.url}</div>
              </div>
              <div class="flex gap-2">
                <span class="text-xs px-2 py-1 bg-zinc-800 rounded">\${s.ms}ms</span>
                <span class="text-xs px-2.5 py-1 bg-green-500/15 text-green-400 rounded-full">Operational</span>
              </div>
            </div>
            <div class="mt-3 flex gap-">
              \${s.history.map((h,i) => \`<div class="bar \${h?'bar-up':'bar-down'}" title="Day \${90-i}"></div>\`).join('')}
            </div>
          </div>
        \`).join('')}
      </div>
    </div>
  \`).join('');

  document.getElementById('regions').innerHTML = d.regions.map(r => \`
    <div class="flex justify-between items-center p-2.5 bg-zinc-900/50 rounded-lg hover:bg-zinc-800/50">
      <div class="flex items-center gap-2">
        <span class="w-1.5 h-1.5 rounded-full bg-green-500" style="box-shadow:0 0 6px #22c55e"></span>
        <span class="text-sm">\${r.name}</span>
      </div>
      <span class="text-xs text-zinc-400">\${r.ms}ms</span>
    </div>
  \`).join('');
}
loadStatus();
setInterval(loadStatus, 60000);
</script>
</body>
</html>`;

    return new Response(html, {
      headers: { 'content-type': 'text/html;charset=UTF-8' }
    });
  }
}

async function handleAPI(env) {
  // TODO: Replace with real KV reads or UptimeRobot
  const data = {
    lastUpdated: '2m ago',
    uptime: '99.98',
    incidentFree: 47,
    meanResponse: 28,
    groups: [
      {
        name: 'Core Services',
        services: [
          { name: 'API', url: 'api.wayfield.dev', ms: 31, history: Array(90).fill(1) },
          { name: 'Database', url: 'db.wayfield.dev', ms: 18, history: Array(90).fill(1) }
        ]
      },
      {
        name: 'Wayfield Apps',
        services: [
          { name: 'Dashboard', url: 'app.wayfield.dev', ms: 42, history: Array(90).fill(1) }
        ]
      }
    ],
    regions: [
      { name: 'US East', ms: 34 },
      { name: 'EU', ms: 42 }
    ]
  };
  return Response.json(data, { headers: { 'cache-control': 'public, max-age=60' } });
}
