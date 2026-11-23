#!/usr/bin/env node
// Live agent-control smoke: drives the real macOS app (WKWebView, real control socket) through `hmb`, the way an
// agent does. It only ever touches the dev app from scripts/dev-app.mjs, never the owner's installed copy.
//
//   node scripts/hmb-smoke.mjs [--build] [--gui] [--keep] [--json]
//
//   --build  build the dev app first (otherwise dist-dev/ must exist)
//   --gui    also select text and press Send selection to agent with System Events keystrokes. Needs Accessibility
//            permission for the terminal or process running this; without it that check is reported as skipped.
//   --keep   leave the dev app running at the end (the follow-and-quit check is skipped)
//   --json   print the results as JSON on stdout
//
// Every run starts from an empty dev data folder. Exit code 0 when every check passed or was skipped, 1 otherwise.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pagedPdf } from '../e2e/paged-pdf.ts';
import { HMB, build, devEnv, devPid, hmb, reset, start, stop } from './dev-app.mjs';

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = line => { if (!asJson) console.log(line); };

async function check(name, fn) {
  try {
    const detail = await fn();
    if (detail && typeof detail === 'object' && detail.skipped) {
      results.push({ name, result: 'skipped', detail: detail.skipped });
      say(`- ${name}: skipped (${detail.skipped})`);
    } else {
      results.push({ name, result: 'ok', detail: detail ?? '' });
      say(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
    }
  } catch (e) {
    results.push({ name, result: 'failed', detail: e.message });
    say(`✗ ${name} — ${e.message}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
/** `hmb … --json`, failing the check on a non-zero exit or an `ok: false` reply. */
function call(argv, opts) {
  const r = hmb([...argv, '--json'], opts);
  if (r.status !== 0 || r.json?.ok === false) throw new Error(`hmb ${argv.join(' ')}: exit ${r.status} ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.json;
}
/** Events after `since`, waiting up to `wait` seconds for at least one. */
const events = (since, wait = 3) => call(['events', '--since', String(since), '--wait', String(wait), '--limit', '256']);
async function eventMatching(since, pred, what, seconds = 6) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const found = events(since, 1).events.find(pred);
    if (found) return found;
  }
  throw new Error(`no ${what} event within ${seconds} s`);
}

const dir = mkdtempSync(join(tmpdir(), 'hmb-smoke-'));
const md = join(dir, 'notes.md');
const pdf = join(dir, 'six-pages.pdf');
writeFileSync(md, '# Smoke notes\n\nThe quick brown fox gives the agent something to read.\n');
writeFileSync(pdf, pagedPdf(6));

try {
  if (args.has('--build')) build();
  await reset();
  await check('launch: control socket answers', async () => `pid ${await start({ visible: args.has('--gui') })}`);
  if (!devPid()) throw new Error('The dev app is not running; nothing else can be checked.');

  await check('show a Markdown file', () => {
    const r = call(['show', md]);
    expect(r.path === md || r.path?.endsWith('/notes.md'), `reply path ${r.path}`);
    return r.title;
  });
  // While the screen is locked WebKit renders nothing, and a PDF never finishes opening (a document that needs no
  // rendering pass, like Markdown or a brief, still does). Those checks are skipped then, never failed: the loop runs
  // its smoke when the screen is unlocked, and an unattended worker reports them as skipped.
  const locked = /CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(spawnSync('ioreg', ['-n', 'Root', '-d1', '-a'], { encoding: 'utf8' }).stdout ?? '');
  const unlocked = fn => () => (locked ? { skipped: 'the screen is locked, and WebKit renders nothing until it is unlocked' } : fn());
  await check('show a PDF at page 3', unlocked(() => {
    const r = call(['show', pdf, '--page', '3']);
    expect(/\b3\b/.test(r.position ?? ''), `position "${r.position}"`);
    return r.position;
  }));
  let seq = events(0, 0).next;
  await check('goto records a page event', unlocked(async () => {
    call(['goto', '5']);
    const e = await eventMatching(seq, x => x.type === 'page' && /\b5\b/.test(x.position ?? ''), 'page 5');
    return e.position;
  }));
  await check('tab events for the opened documents', () => {
    const shown = events(0, 0).events.filter(e => e.type === 'tab' && e.action === 'shown').map(e => e.path);
    expect(shown.some(p => p.endsWith('notes.md')) && (locked || shown.some(p => p.endsWith('six-pages.pdf'))), `shown: ${shown.join(', ')}`);
    return `${shown.length} shown${locked ? ' (PDF skipped: screen locked)' : ''}`;
  });

  await check('split refused in a narrow window is reported', () => {
    call(['cmd', '--compact']);
    const r = call(['brief', '--id', 'smoke-split', '--text', '# Split\n\nbody', '--split', 'right']);
    call(['cmd', '--reading']);
    expect(typeof r.splitRefused === 'string' && r.splitRefused.length > 0, `reply has no splitRefused: ${JSON.stringify(r)}`);
    return r.splitRefused;
  });
  await check('cmd reply lists the pin change', () => {
    const on = call(['cmd', '--pin']), off = call(['cmd', '--unpin']);
    expect(on.done?.some(d => /top on/i.test(d)) && on.status?.window?.pinned === true, `pin: ${JSON.stringify(on.done)}`);
    expect(off.done?.some(d => /top off/i.test(d)) && off.status?.window?.pinned === false, `unpin: ${JSON.stringify(off.done)}`);
    return `${on.done.join(', ')} / ${off.done.join(', ')}`;
  });
  await check('brief --append appends exactly once', () => {
    call(['brief', '--id', 'smoke-append', '--text', '# Append\n\nfirst']);
    const r = call(['brief', '--id', 'smoke-append', '--append', '--text', '\nAPPEND-MARK']);
    expect(r.updated === true, 'second call did not update the same tab');
    const text = call(['read']).text ?? '';
    const n = text.split('APPEND-MARK').length - 1;
    expect(n === 1, `marker appears ${n} times`);
    return 'once';
  });
  await check('chart with a numeric title opens', () => {
    const chart = '# Chart\n\n```chart\n{"type":"bar","title":42,"unit":"lines","data":[{"label":"a","value":510},{"label":"b","value":120}]}\n```\n';
    const r = call(['brief', '--id', 'smoke-chart', '--text', chart]);
    expect(call(['status']).active?.path === r.path, 'the chart brief is not the active document');
    return r.title;
  });
  // Sanitizing is covered by tests/svg-sanitize.test.ts; `hmb` cannot see the DOM, so this only proves an SVG brief opens.
  await check('SVG brief opens', () => {
    const r = call(['brief', '--id', 'smoke-svg', '--format', 'svg', '--text',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>window.SMOKE_PWNED=1</script><rect width="10" height="10" fill="var(--accent)"/></svg>']);
    expect(call(['status']).active?.path === r.path, 'the SVG brief is not the active document');
    return r.title;
  });

  await check('Send selection to agent (GUI)', async () => {
    if (!args.has('--gui')) return { skipped: 'needs --gui' };
    call(['show', md, '--focus']);
    const since = events(0, 0).next;
    // By pid: the owner's app and the dev app share the process name `hold-my-brief`, so a name could pick either.
    const r = spawnSync('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${devPid()}) to true`, '-e', 'delay 0.5',
      '-e', 'tell application "System Events" to keystroke "a" using command down', '-e', 'delay 1.5',
      '-e', 'tell application "System Events" to key code 36 using {command down, shift down}'], { encoding: 'utf8' });
    if (r.status !== 0) return { skipped: `System Events refused (${r.stderr.trim().slice(0, 120)}); grant Accessibility` };
    const sent = await eventMatching(since, e => e.type === 'send', 'send');
    expect(sent.text.includes('quick brown fox'), `send text: ${JSON.stringify(sent.text)}`);
    expect(!/[←→]|position/.test(sent.text), `send text includes reader chrome: ${JSON.stringify(sent.text)}`);
    return 'document text only';
  });

  await check('hmb mcp: 5 tools and hmb_events answers', async () => {
    const lines = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hmb-smoke', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hmb_events', arguments: { since: 0, wait: 1, types: ['tab'] } } },
    ].map(l => JSON.stringify(l)).join('\n') + '\n';
    const r = hmb(['mcp'], { input: lines, timeout: 15_000 });
    const replies = r.stdout.split('\n').filter(Boolean).map(l => JSON.parse(l));
    const tools = replies.find(x => x.id === 2)?.result?.tools?.map(t => t.name) ?? [];
    expect(tools.length === 5 && tools.includes('hmb_events'), `tools: ${tools.join(', ')}`);
    const reply = JSON.parse(replies.find(x => x.id === 3)?.result?.content?.[0]?.text ?? '{}');
    expect(reply.events?.some(e => e.type === 'tab'), `hmb_events: ${JSON.stringify(reply).slice(0, 200)}`);
    return tools.join(', ');
  });

  await check('close --briefs closes every brief', () => {
    call(['close', '--briefs']);
    const tabs = call(['status']).panes.flatMap(p => p.tabs);
    expect(!tabs.some(t => t.brief), `briefs left: ${tabs.filter(t => t.brief).map(t => t.title).join(', ')}`);
    return `${tabs.length} documents left`;
  });

  await check('events --follow ends when the app quits, without relaunching it', async () => {
    if (args.has('--keep')) return { skipped: '--keep' };
    // No --no-launch here: the bug this guards against is a relaunch. HMB_APP_BIN points any relaunch at the dev app.
    const follow = spawn(HMB, ['events', '--follow'], { env: devEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise(r => follow.on('exit', code => r(code)));
    await sleep(1500);
    await stop();
    const code = await Promise.race([exited, sleep(10_000).then(() => 'timeout')]);
    if (code === 'timeout') follow.kill('SIGKILL');
    await sleep(3000);
    const relaunched = devPid();
    if (relaunched) await stop();
    expect(code === 1, `follow exit: ${code}`);
    expect(!relaunched, `the app was relaunched (pid ${relaunched})`);
    return 'exit 1, not relaunched';
  });
} catch (e) {
  // A build or launch failure ends the run; it is still reported like any check, so --json stays parseable.
  results.push({ name: 'run', result: 'failed', detail: e.message });
  say(`✗ run — ${e.message}`);
} finally {
  if (!args.has('--keep')) await stop();
  rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter(r => r.result === 'failed');
if (asJson) console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
else console.log(`\n${results.length - failed.length}/${results.length} passed or skipped${failed.length ? `, ${failed.length} failed` : ''}`);
process.exit(failed.length ? 1 : 0);
