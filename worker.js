export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkMonitors(env));
  },

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
      <h1 class="text-2xl font-semibold" style="letter
