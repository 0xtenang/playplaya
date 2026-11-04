// Load test against a real server process with realistic mid-game saves.
// Usage: node test/load.mjs [players] [seconds]
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === 'server') {
  const { createApp } = await import('../server/app.mjs');
  const { T } = await import('../server/game.mjs');
  const open = [1e9, 1e9];
  const app = createApp({ dbPath: process.argv[3], rates: { auth: open, guest: open, action: open, sync: open, read: open } });
  const port = await app.listen(0, '127.0.0.1');
  process.send({ port });
  process.on('message', msg => {
    if (msg === 'fatten') {
      // Every player becomes a mid-game save: full crew, 120 items, stage 30.
      app.store.tx(() => {
        for (const row of app.store.allPlayers()) {
          const G = JSON.parse(row.g);
          G.talents.slot = 2; G.party = ['warden', 'mender', 'fletcher'];
          G.stage = 29; G.maxStage = 29;
          for (const k of G.party) G.heroes[k].lvl = 30;
          for (let i = G.items.length; i < 120; i++) G.items.push(T.makeItem(G, T.SLOTS[i % 6], 25, i % 3));
          for (const k of G.party) T.equipBest(G, k);
          const B = T.newBattle(G);
          app.store.savePlayer(row.account_id, JSON.stringify(G), JSON.stringify(B), row.sim_at, row.seen_at, 30, G.crew);
        }
      });
      process.send({ fattened: true });
    }
    if (msg === 'stats') process.send({ cpu: process.cpuUsage(), rss: process.memoryUsage().rss, size: JSON.stringify(JSON.parse(app.store.allPlayers()[0].g)).length });
    if (msg === 'stop') app.close().then(() => process.exit(0));
  });
} else {
  const players = Number(process.argv[2] || 1000), seconds = Number(process.argv[3] || 30);
  const dir = mkdtempSync(join(tmpdir(), 'trayfarers-load-'));
  const child = fork(fileURLToPath(import.meta.url), ['server', join(dir, 'load.db')], { execArgv: ['--disable-warning=ExperimentalWarning'] });
  const once = pred => new Promise(res => { const f = m => { if (pred(m)) { child.off('message', f); res(m); } }; child.on('message', f); });
  const { port } = await once(m => m.port);
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body, cookie) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });

  const cookies = [];
  for (let start = 0; start < players; start += 50) {
    await Promise.all(Array.from({ length: Math.min(50, players - start) }, async () => {
      const res = await post('/api/guest', {});
      await res.arrayBuffer();
      cookies.push(res.headers.get('set-cookie').split(';')[0]);
    }));
  }
  child.send('fatten');
  await once(m => m.fattened);

  // Each player sends a heartbeat every 10 seconds, the same as the real client,
  // and takes an action about every 30 seconds.
  const latencies = [];
  let errors = 0, inFlightPeak = 0, inFlight = 0;
  const cpu0 = await (child.send('stats'), once(m => m.cpu));
  const t0 = Date.now(), endAt = t0 + seconds * 1000;
  const timers = cookies.map((cookie, i) => {
    const offset = (i / cookies.length) * 10e3;
    const run = async () => {
      const act = Math.random() < 1 / 3;
      const started = performance.now();
      inFlight++; inFlightPeak = Math.max(inFlightPeak, inFlight);
      try {
        const res = act ? await post('/api/action', { type: 'hold', args: { on: false } }, cookie) : await post('/api/sync', {}, cookie);
        await res.arrayBuffer();
        if (!res.ok) errors++;
      } catch { errors++; }
      inFlight--;
      latencies.push(performance.now() - started);
    };
    return setTimeout(() => {
      run();
      const iv = setInterval(() => { if (Date.now() < endAt) run(); else clearInterval(iv); }, 10e3);
    }, offset);
  });
  await new Promise(r => setTimeout(r, seconds * 1000 + 3000));
  timers.forEach(clearTimeout);
  const cpu1 = await (child.send('stats'), once(m => m.cpu));
  const elapsed = (Date.now() - t0) / 1000;
  const cpuSec = (cpu1.cpu.user - cpu0.cpu.user + cpu1.cpu.system - cpu0.cpu.system) / 1e6;
  latencies.sort((a, b) => a - b);
  const pct = p => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]?.toFixed(1);
  console.log(`${players} players | ${(latencies.length / elapsed).toFixed(0)} req/s | p50 ${pct(.5)} ms | p95 ${pct(.95)} ms | p99 ${pct(.99)} ms | max ${latencies.at(-1)?.toFixed(0)} ms | errors ${errors} | server CPU ${(cpuSec / elapsed * 100).toFixed(0)}% of a core | memory ${(cpu1.rss / 1048576).toFixed(0)} MB | save ${(cpu1.size / 1024).toFixed(0)} KB | peak in flight ${inFlightPeak}`);
  child.send('stop');
  await new Promise(r => child.on('exit', r));
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
