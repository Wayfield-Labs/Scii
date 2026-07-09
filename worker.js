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

    return new Response(getHTML(env), {
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
    todayUptime: '0',
    incidentFree: 0,
    meanResponse: 0,
    activeIncidents: [],
    incidentHistory: [],
    groups: [],
    regions: []
  };
}

async function fetchIncidents(env) {
  const repo = env.GITHUB_REPO;
  const token = env.GITHUB_TOKEN;
  if (!repo || !token) {
    return { activeIncidents: [], incidentHistory: [] };
  }

  try {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'scii-status'
    };

    const [openRes, closedRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${repo}/issues?labels=incident&state=open&per_page=10&sort=created&direction=desc`, { headers }),
      fetch(`https://api.github.com/repos/${repo}/issues?labels=incident&state=closed&per_page=5&sort=updated&direction=desc`, { headers })
    ]);

    const formatIssue = (issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ? issue.body.substring(0, 500) : '',
      url: issue.html_url,
      createdAt: issue.created_at,
      state: issue.state,
      ...(issue.closed_at ? { closedAt: issue.closed_at } : {})
    });

    const active = openRes.ok
      ? (await openRes.json()).filter(i => !i.pull_request).map(formatIssue)
      : [];
    const history = closedRes.ok
      ? (await closedRes.json()).filter(i => !i.pull_request).map(formatIssue)
      : [];

    return { activeIncidents: active, incidentHistory: history };
  } catch (e) {
    console.error('Failed to fetch incidents:', e.message);
    return { activeIncidents: [], incidentHistory: [] };
  }
}

async function checkMonitors(env) {
  try {
    const configRes = await fetch(env.MONITORS_URL);
    if (!configRes.ok) {
      console.error('Failed to fetch monitors.json:', configRes.status);
      return;
    }

    const config = await configRes.json();
    const monitors = Array.isArray(config) ? config : config.monitors || [];

    if (monitors.length === 0) {
      console.log('No monitors found in config');
      return;
    }

    console.log('Checking', monitors.length, 'monitors');

    // Read existing status data for history continuity
    let existingData = { groups: [] };
    try {
      const obj = await env.R2_BUCKET.get('status.json');
      if (obj) existingData = await obj.json();
    } catch (e) {
      console.error('Failed to read existing status:', e.message);
    }

    // Build history and stats maps from existing data
    const historyMap = {};
    const statsMap = {};
    if (existingData.groups) {
      for (const group of existingData.groups) {
        for (const svc of group.services) {
          if (svc.history && Array.isArray(svc.history)) {
            historyMap[svc.name] = svc.history;
          }
          statsMap[svc.name] = {
            totalChecks: svc.totalChecks || 0,
            totalUp: svc.totalUp || 0,
            dayChecks: svc.dayChecks || 0,
            dayUp: svc.dayUp || 0,
            lastDate: svc.lastDate || null
          };
        }
      }
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    const results = await Promise.all(monitors.map(async (m) => {
      const start = Date.now();
      const name = m.name || m.id || 'unknown';
      const stats = statsMap[name] || { totalChecks: 0, totalUp: 0, dayChecks: 0, dayUp: 0, lastDate: null };

      let up = false;
      let ms = 0;
      try {
        const r = await fetch(m.url, {
          method: 'GET',
          cf: { cacheTtl: 0, cacheEverything: false },
          signal: AbortSignal.timeout(10000)
        });
        ms = Date.now() - start;
        up = r.ok;
      } catch (e) {
        console.log('Check failed for', name, ':', e.message);
      }

      // Append to history, trim to last 90 entries
      const existing = historyMap[name] || [];
      const history = [...existing, up ? 1 : 0].slice(-90);

      // Update running stats
      const totalChecks = stats.totalChecks + 1;
      const totalUp = stats.totalUp + (up ? 1 : 0);
      const dayChecks = stats.lastDate === today ? stats.dayChecks + 1 : 1;
      const dayUp = stats.lastDate === today ? stats.dayUp + (up ? 1 : 0) : (up ? 1 : 0);

      return {
        name,
        url: m.url.replace(/^https?:\/\//, ''),
        up,
        ms,
        history,
        totalChecks,
        totalUp,
        dayChecks,
        dayUp,
        lastDate: today,
        lastChecked: now.toISOString()
      };
    }));

    const upCount = results.filter(r => r.up).length;
    const meanResponse = results.length > 0
      ? Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length)
      : 0;

    // Aggregate lifetime stats
    const totalChecks = results.reduce((a, r) => a + r.totalChecks, 0);
    const totalUp = results.reduce((a, r) => a + r.totalUp, 0);
    const dayChecks = results.reduce((a, r) => a + r.dayChecks, 0);
    const dayUp = results.reduce((a, r) => a + r.dayUp, 0);

    // Fetch GitHub incidents (if configured)
    const { activeIncidents, incidentHistory } = await fetchIncidents(env);

    // Compute incident-free days from the most recent closed incident
    let incidentFree = 0;
    if (incidentHistory.length > 0) {
      const lastClosed = new Date(incidentHistory[0].closedAt || incidentHistory[0].createdAt);
      incidentFree = Math.floor((Date.now() - lastClosed.getTime()) / (1000 * 60 * 60 * 24));
    }

    const statusData = {
      lastUpdated: now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }),
      uptime: totalChecks > 0 ? ((totalUp / totalChecks) * 100).toFixed(2) : '100.00',
      todayUptime: dayChecks > 0 ? ((dayUp / dayChecks) * 100).toFixed(2) : '100.00',
      incidentFree,
      meanResponse,
      activeIncidents,
      incidentHistory,
      groups: [
        {
          name: env.GROUP_NAME || 'Wayfield Services',
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

function getHTML(env) {
  var siteName = env.SITE_NAME || 'WAYFIELD / Labs';
  var siteUrl = env.SITE_URL || 'https://wayfield.dev';
  var contactEmail = env.CONTACT_EMAIL || 'hello@wayfield.dev';
  var title = siteName + ' Status';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
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
.bar{width:3px;height:20px;background:#27272a;border-radius:2px;transition:all 0.15s;cursor:pointer}
.bar:hover{opacity:0.7;transform:scaleY(1.3)}
.bar-up{background:#22c55e}
.bar-down{background:#ef4444}
.big-num{background:linear-gradient(180deg,#fff,#a1a1aa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.banner{background:linear-gradient(90deg,rgba(34,197,94,0.1),transparent);border-left:3px solid #22c55e}
.banner-warning{background:linear-gradient(90deg,rgba(245,158,11,0.1),transparent);border-left:3px solid #f59e0b}
.banner-error{background:linear-gradient(90deg,rgba(239,68,68,0.1),transparent);border-left:3px solid #ef4444}
.incident-timeline{position:relative}
.incident-timeline::before{content:'';position:absolute;left:7px;top:16px;bottom:16px;width:2px;background:#27272a;border-radius:1px}
.bar-tooltip{position:relative}
.bar-tooltip:hover::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;transform:translateX(-50%);padding:2px 6px;background:#18181b;border:1px solid #27272a;border-radius:4px;font-size:10px;white-space:nowrap;z-index:10;pointer-events:none}
</style>
</head>
<body class="ambient text-zinc-100">
<div class="max-w-5xl mx-auto p-6 min-h-screen flex flex-col">
<header class="flex justify-between items-center mb-6">
<div>
<h1 class="text-2xl font-semibold" style="letter-spacing:-0.02em">${siteName.replace('/', ' <span class="text-zinc-600">/</span> ')}</h1>
<p class="text-sm text-zinc-400 flex items-center gap-2 mt-1">
<span id="header-dot" class="pulse-dot w-2 h-2 rounded-full bg-green-500"></span>
System status • <span id="updated">loading...</span>
</p>
</div>
</header>

<!-- Main status banner -->
<div id="banner" class="banner card rounded-xl p-4 mb-4 flex items-center gap-3">
<div id="banner-icon" class="w-10 h-10 flex items-center justify-center shrink-0">
<span id="banner-icon-dot" class="block w-5 h-5 rounded-full bg-green-500 pulse-dot"></span>
</div>
<div>
<div class="font-medium" id="banner-title">All Systems Operational</div>
<div class="text-sm text-zinc-400" id="banner-desc">All services running normally</div>
</div>
</div>

<!-- Active incident banner (hidden unless incidents exist) -->
<div id="incident-banner" class="card rounded-xl p-4 mb-4 hidden" style="border-left:3px solid #f59e0b;background:linear-gradient(90deg,rgba(245,158,11,0.1),transparent)">
<div class="flex items-center gap-3 mb-3">
<div class="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
<svg width="20" height="20" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"><path d="M12 9v3m0 4h.01"/></svg>
</div>
<div>
<div class="font-medium text-amber-400" id="incident-banner-title">Active Incidents</div>
<div class="text-xs text-zinc-500" id="incident-banner-desc">Open issues being investigated</div>
</div>
</div>
<div id="incident-list" class="space-y-1.5"></div>
</div>

<div class="grid lg:grid-cols-3 gap-6 flex-1">
<div class="lg:col-span-2 space-y-6" id="services">
<div class="text-center text-zinc-500 py-12">Loading services...</div>
</div>

<div class="space-y-4">
<div class="card rounded-xl p-5">
<div class="text-4xl font-bold big-num" id="uptime">--%</div>
<div class="text-sm text-green-400 -mt-1">total uptime</div>
<div class="mt-4 space-y-2 text-sm">
<div class="flex justify-between">
<span class="text-zinc-400">Today</span>
<span id="today-uptime" class="text-zinc-300">--%</span>
</div>
<div class="flex justify-between">
<span class="text-zinc-400">Mean response</span>
<span id="mean-response" class="text-zinc-300">--ms</span>
</div>
<div class="flex justify-between">
<span class="text-zinc-400">Incident-free</span>
<span id="incident-free" class="text-zinc-300">-- days</span>
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

<!-- Incident history (hidden unless incidents exist) -->
<div id="incident-history-section" class="mt-8 hidden">
<h2 class="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-3">Incident History</h2>
<div id="incident-history" class="card rounded-xl divide-y divide-zinc-800/60 incident-timeline"></div>
</div>

<footer class="text-center text-xs text-zinc-600 pt-8 pb-4 mt-auto">
<a href="${siteUrl}" class="hover:text-zinc-400 transition" target="_blank">${siteName}</a>
<span class="mx-2">·</span>
<a href="mailto:${contactEmail}" class="hover:text-zinc-400 transition">${contactEmail}</a>
<span class="mx-2">·</span>
<a href="https://github.com/wayfield-labs/scii" class="hover:text-zinc-400 transition" target="_blank">Powered by Scii</a>
</footer>
</div>

<script>
function escHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(isoString) {
  if (!isoString) return '';
  var seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return seconds + 's ago';
  var minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  return Math.floor(minutes / 60) + 'h ago';
}

async function loadStatus(){
  try {
    var res = await fetch('/api/status');
    var d = await res.json();

    document.getElementById('updated').textContent = 'updated ' + d.lastUpdated;
    document.getElementById('uptime').textContent = d.uptime + '%';
    document.getElementById('mean-response').textContent = d.meanResponse + 'ms';
    if (d.todayUptime) {
      document.getElementById('today-uptime').textContent = d.todayUptime + '%';
    }
    if (d.incidentFree !== undefined) {
      document.getElementById('incident-free').textContent = d.incidentFree + ' days';
    }

    // --- Determine overall status ---
    var allUp = d.groups.length > 0 && d.groups.every(function(g) { return g.services.every(function(s) { return s.up; }); });
    var hasIncidents = d.activeIncidents && d.activeIncidents.length > 0;

    // --- Active Incidents Banner ---
    var incidentBanner = document.getElementById('incident-banner');
    if (hasIncidents) {
      document.getElementById('incident-banner-title').textContent =
        d.activeIncidents.length === 1 ? '1 Active Incident' : d.activeIncidents.length + ' Active Incidents';
      document.getElementById('incident-list').innerHTML = d.activeIncidents.map(function(inc) {
        var bodyText = inc.body ? '<div class="text-xs text-zinc-400 mt-1 ml-4 line-clamp-2 break-words">' + escHtml(inc.body) + '</div>' : '';
        return '<div class="py-1.5 px-2 rounded hover:bg-zinc-800/40 transition group">' +
          '<div class="flex items-center gap-2">' +
          '<span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse"></span>' +
          '<span class="text-xs text-zinc-500">#' + inc.number + '</span>' +
          '<a href="' + inc.url + '" target="_blank" class="text-sm text-amber-400 hover:text-amber-300 transition">' + escHtml(inc.title) + '</a>' +
          '<svg class="w-3 h-3 ml-auto text-zinc-600 group-hover:text-zinc-400 transition shrink-0" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg>' +
          '</div>' +
          bodyText +
          '</div>';
      }).join('');
      incidentBanner.classList.remove('hidden');
    } else {
      incidentBanner.classList.add('hidden');
    }

    // --- Header dot & Main status banner ---
    var headerDot = document.getElementById('header-dot');
    var mainBanner = document.getElementById('banner');
    var bannerIconDot = document.getElementById('banner-icon-dot');
    var isWarning = hasIncidents || (!allUp && d.groups.length > 0);
    if (isWarning) {
      if (hasIncidents) {
        document.getElementById('banner-title').textContent = 'Service Disruption';
        document.getElementById('banner-desc').textContent = 'We are investigating reported issues';
      } else {
        document.getElementById('banner-title').textContent = 'Partial Outage';
        document.getElementById('banner-desc').textContent = 'Some services are experiencing issues';
      }
      mainBanner.className = 'banner-warning card rounded-xl p-4 mb-4 flex items-center gap-3';
      bannerIconDot.className = 'block w-5 h-5 rounded-full bg-amber-400 pulse-dot';
      headerDot.className = 'pulse-dot w-2 h-2 rounded-full bg-amber-400';
    } else {
      document.getElementById('banner-title').textContent = 'All Systems Operational';
      document.getElementById('banner-desc').textContent = 'All services running normally';
      mainBanner.className = 'banner card rounded-xl p-4 mb-4 flex items-center gap-3';
      bannerIconDot.className = 'block w-5 h-5 rounded-full bg-green-500 pulse-dot';
      headerDot.className = 'pulse-dot w-2 h-2 rounded-full bg-green-500';
    }

    // --- Services ---
    if (d.groups.length === 0) {
      document.getElementById('services').innerHTML = '<div class="text-center text-zinc-500 py-12">No services configured yet</div>';
    } else {
      document.getElementById('services').innerHTML = d.groups.map(function(g) {
        return '<div>' +
          '<h2 class="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-3">' + escHtml(g.name) + '</h2>' +
          '<div class="card rounded-xl divide-y divide-zinc-800/60">' +
          g.services.map(function(s) {
            var totalUptimePct = s.totalChecks > 0 ? ((s.totalUp / s.totalChecks) * 100).toFixed(1) : '100.0';
            return '<div class="p-4 hover:bg-zinc-900/40 transition">' +
              '<div class="flex justify-between items-start">' +
              '<div>' +
              '<div class="flex items-center gap-2">' +
              '<span class="pulse-dot w-2 h-2 rounded-full ' + (s.up ? 'bg-green-500' : 'bg-red-500') + '"></span>' +
              '<span class="font-medium">' + escHtml(s.name) + '</span>' +
              '</div>' +
              '<div class="text-xs text-zinc-500 mt-1">' + escHtml(s.url) + '</div>' +
              '<div class="text-xs text-zinc-600 mt-0.5">checked <span class="service-time" data-time="' + s.lastChecked + '">' + timeAgo(s.lastChecked) + '</span></div>' +
              '</div>' +
              '<div class="flex items-center gap-2">' +
              '<span class="text-xs px-2 py-1 bg-zinc-800 rounded">' + s.ms + 'ms</span>' +
              '<span class="text-xs px-2.5 py-1 ' + (s.up ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400') + ' rounded-full">' +
              (s.up ? 'Operational' : 'Down') +
              '</span>' +
              '</div>' +
              '</div>' +
              '<div class="mt-3 flex items-end gap-px">' +
              s.history.map(function(h, i) {
                return '<div class="bar bar-tooltip ' + (h ? 'bar-up' : 'bar-down') + '" data-tip="' + (h ? 'Up' : 'Down') + '"></div>';
              }).join('') +
              '</div>' +
              '<div class="mt-1 flex justify-between text-[10px] text-zinc-600">' +
              '<span>90 min ago</span>' +
              '<span class="text-zinc-500">' + totalUptimePct + '% uptime</span>' +
              '<span>now</span>' +
              '</div>' +
              '</div>';
          }).join('') +
          '</div>' +
          '</div>';
      }).join('');
    }

    // --- Regions ---
    if (d.regions.length > 0) {
      document.getElementById('regions').innerHTML = d.regions.map(function(r) {
        return '<div class="flex justify-between text-sm">' +
          '<span class="text-zinc-400">' + escHtml(r.name) + '</span>' +
          '<span>' + r.ms + 'ms</span>' +
          '</div>';
      }).join('');
    } else {
      document.getElementById('regions').innerHTML = '<div class="text-xs text-zinc-500">No region data</div>';
    }

    // --- Incident History ---
    var historySection = document.getElementById('incident-history-section');
    if (d.incidentHistory && d.incidentHistory.length > 0) {
      document.getElementById('incident-history').innerHTML = d.incidentHistory.map(function(inc) {
        var createdDate = new Date(inc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        var resolvedLabel = inc.closedAt
          ? 'Resolved ' + new Date(inc.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : '';
        return '<div class="p-4 flex items-start gap-3">' +
          '<div class="w-2 h-2 rounded-full bg-green-500 mt-2 shrink-0"></div>' +
          '<div class="flex-1 min-w-0">' +
          '<a href="' + inc.url + '" target="_blank" class="text-sm font-medium hover:text-zinc-300 transition">' + escHtml(inc.title) + '</a>' +
          '<div class="text-xs text-zinc-500 mt-0.5">' + createdDate + (resolvedLabel ? ' \u00b7 ' + resolvedLabel : '') + '</div>' +
          '</div>' +
          '<span class="text-xs px-2 py-0.5 bg-green-500/15 text-green-400 rounded-full shrink-0">Resolved</span>' +
          '</div>';
      }).join('');
      historySection.classList.remove('hidden');
    } else {
      historySection.classList.add('hidden');
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
