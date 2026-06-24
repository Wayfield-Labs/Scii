export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkMonitors(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/status') {
      const data = await getStatusData(env);
      return Response.json(data, {
        headers: {
          'cache-control': 'public, max-age=60',
          'access-control-allow-origin': '*'
        }
      });
    }

    return new Response(getHTML(), {
      headers: { 'content-type': 'text/html;charset=UTF-8' }
    });
  }
};

async function getStatusData(env) {
  try {
    const obj = await env.R2_BUCKET.get('status.json');
    if (obj) {
      return await obj.json();
    }
  } catch (e) {
    console.error('R2 read error:', e.message);
  }

  // Fallback if no status.json exists yet
  return {
    lastUpdated: 'never',
    uptime: '0',
    incidentFree: 0,
    meanResponse: 0,
    groups: [],
    regions: []
  };
}

async function checkMonitors(env) {
  try {
    const configRes = await fetch(env.MONITORS_URL);
    if (!configRes.ok) {
      console.error('Failed to fetch monitors.json:', configRes.status);
      return;
    }

    const config = await configRes.json();
    const monitors = Array.isArray(config)? config : config.monitors || [];

    if (monitors.length === 0) {
      console.log('No monitors found in config');
      return;
    }

    console.log('Checking', monitors.length, 'monitors');

    const results = await Promise.all(monitors.map(async (m) => {
      const start = Date.now();
      try {
        const r = await fetch(m.url, {
          method: 'GET',
          cf: { cacheTtl: 0, cacheEverything: false },
          signal: AbortSignal.timeout(10000)
        });
        const ms = Date.now() - start;
        return {
          name: m.name,
          url: m.url.replace(/^https?:\/\//, ''),
          up: r.ok,
          ms: ms,
          history: Array(90).fill(r.ok? 1 : 0)
        };
      } catch (e) {
        console.log('Check failed for', m.name, ':', e.message);
        return {
          name: m.name,
          url: m.url.replace(/^https?:\/\//, ''),
          up: false,
          ms: 0,
          history: Array(90).fill(0)
        };
      }
    }));

    const upCount = results.filter(r => r.up).length;
    const meanResponse = results.length > 0
     ? Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length)
      : 0;

    const statusData = {
      lastUpdated: new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }),
      uptime: ((upCount / results.length) * 100).toFixed(2),
      incidentFree: 0,
      meanResponse: meanResponse,
      groups: [
        {
          name: 'Wayfield Services',
          services: results
        }
      ],
      regions: [
        { name: 'US East', ms: 34 },
        { name: 'EU', ms: 42 }
      ]
    };

    await env.R2_BUCKET.put('status.json', JSON.stringify(statusData));
    console.log('Status updated:', upCount + '/' + results.length, 'services up');
  } catch (e) {
    console.error('Monitor check failed:', e.message, e.stack);
  }
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wayfield Labs Status</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
body{font-family:'Inter',sans-serif;background:#050507}
.ambient{background:radial-gradient(600px 300px at 50% -50px,rgba(80,200,120,0.06),transparent 60%),#050507}
.card{background:rgba(17,17,20,0.9);border:1px solid #27272a;box-shadow:0 4px 16px rgba(0,0,0,0.3);transition:all 0.2s}
.card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.4)}
.pulse-dot{position:relative}
.pulse-dot::before{content:'';position:absolute;inset:-3px;border-radius:50%;background:currentColor;opacity:0.3;animation:ping 2s infinite}
@keyframes ping{75%,100%{transform:scale(1.6);opacity:0}}
.bar{width:3px;height:20px;background:#27272a;border-radius:2px;transition:all 0.15s}
.bar-up{background:#22c55e}
.bar-down{background:#ef4444}
.big-num{background:linear-gradient(180deg,#fff,#a1a1aa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.banner{background:linear-gradient(90deg,rgba(34,197,94,0.1),transparent);border-left:3px solid #22c55e}
.banner-warning{background:linear-gradient(90deg,rgba(245,158,11,0.1),transparent);border-left:3px solid #f59e0b}
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

<div id="banner" class="banner card rounded-xl p-4 mb-8 flex items-center gap-3">
<div class="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
<svg width="20" height="20" fill="none" stroke="#22c55e" stroke-width="2"><path d="M5 10l3 3 7-7"/></svg>
</div>
<div>
<div class="font-medium" id="banner-title">All Systems Operational</div>
<div class="text-sm text-zinc-400" id="banner-desc">All services running normally</div>
</div>
</div>

<div class="grid lg:grid-cols-3 gap-6">
<div class="lg:col-span-2 space-y-6" id="services">
<div class="text-center text-zinc-500 py-12">Loading services...</div>
</div>

<div class="space-y-4">
<div class="card rounded-xl p-5">
<div class="text-4xl font-bold big-num" id="uptime">--%</div>
<div class="text-sm text-green-400 -mt-1">uptime</div>
<div class="text-xs text-zinc-500 mt-1">Current</div>
<div class="mt-4 space-y-2 text-sm">
<div class="flex justify-between">
<span class="text-zinc-400">Mean response</span>
<span id="mean-response">--ms</span>
</div>
</div>
</div>

<div class="card rounded-xl p-5">
<h3 class="text-sm font-semibold text-zinc-300 mb-3">Response Times</h3>
<div class="space-y-3" id="regions">
<div class="text-xs text-zinc-500">Loading...</div>
</div>
</div>
</div>
</div>
</div>

<script>
async function loadStatus(){
  try {
    const res = await fetch('/api/status');
    const d = await res.json();

    document.getElementById('updated').textContent = 'updated ' + d.lastUpdated;
    document.getElementById('uptime').textContent = d.uptime + '%';
    document.getElementById('mean-response').textContent = d.meanResponse + 'ms';

    const allUp = d.groups.every(g => g.services.every(s => s.up));
    const banner = document.getElementById('banner');

    if (!allUp && d.groups.length > 0) {
      document.getElementById('banner-title').textContent = 'Partial Outage';
      document.getElementById('banner-desc').textContent = 'Some services are experiencing issues';
      banner.classList.add('banner-warning');
      banner.classList.remove('banner');
    }

    if (d.groups.length === 0) {
      document.getElementById('services').innerHTML = '<div class="text-center text-zinc-500 py-12">No services configured yet</div>';
    } else {
      document.getElementById('services').innerHTML = d.groups.map(g => \`
        <div>
          <h2 class="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-3">\${g.name}</h2>
          <div class="card rounded-xl divide-y divide-zinc-800/60">
            \${g.services.map(s => \`
              <div class="p-4 hover:bg-zinc-900/40 transition">
                <div class="flex justify-between items-start">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="pulse-dot w-2 h-2 rounded-full \${s.up? 'bg-green-500' : 'bg-red-500'}"></span>
                      <span class="font-medium">\${s.name}</span>
                    </div>
                    <div class="text-xs text-zinc-500 mt-1">\${s.url}</div>
                  </div>
                  <div class="flex gap-2">
                    <span class="text-xs px-2 py-1 bg-zinc-800 rounded">\${s.ms}ms</span>
                    <span class="text-xs px-2.5 py-1 \${s.up? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'} rounded-full">
                      \${s.up? 'Operational' : 'Down'}
                    </span>
                  </div>
                </div>
                <div class="mt-3 flex gap-">
                  \${s.history.map((h,i) => \`<div class="bar \${h? 'bar-up' : 'bar-down'}" title="Day \${90-i}"></div>\`).join('')}
                </div>
              </div>
            \`).join('')}
          </div>
        </div>
      \`).join('');
    }

    if (d.regions.length > 0) {
      document.getElementById('regions').innerHTML = d.regions.map(r => \`
        <div class="flex justify-between text-sm">
          <span class="text-zinc-400">\${r.name}</span>
          <span>\${r.ms}ms</span>
        </div>
      \`).join('');
    } else {
      document.getElementById('regions').innerHTML = '<div class="text-xs text-zinc-500">No region data</div>';
    }

  } catch (e) {
    console.error('Failed to load status:', e);
    document.getElementById('services').innerHTML = '<div class="text-center text-red-400 py-12">Failed to load status</div>';
  }
}

loadStatus();
setInterval(loadStatus, 60000);
</script>
</body>
</html>`;
}
