#!/usr/bin/env node
// A second, separate Hold My Brief for agents and the loop to drive on a Mac where the owner's copy is running.
//
// The dev build only differs in its bundle identifier (`xyz.rpayton.holdmybrief.dev`) and name ("Hold My Brief
// Dev"). The identifier gives it its own data folder (state, library, control socket), its own WebKit storage and its
// own single-instance lock, so starting, driving, resetting or quitting it never touches the installed app.
//
//   node scripts/dev-app.mjs build    build dist-dev/Hold My Brief Dev.app (macOS only)
//   node scripts/dev-app.mjs start    launch it hidden in the background and wait until `hmb ping` answers
//   node scripts/dev-app.mjs stop     quit it
//   node scripts/dev-app.mjs reset    stop it and delete its data folder and WebKit storage
//   node scripts/dev-app.mjs env      print the exports that point `hmb` at it: eval "$(node scripts/dev-app.mjs env)"
//
// CARGO_TARGET_DIR is honoured, so a long-lived checkout can keep its Rust build cache between runs.
//
// HMB_DEV_SUFFIX (lowercase letters and digits) gives a run its own identity, `xyz.rpayton.holdmybrief.dev-<suffix>`,
// so several worktrees can each run a dev app at once without sharing a data folder or a single-instance lock.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const suffix = process.env.HMB_DEV_SUFFIX?.trim() ?? '';
if (suffix && !/^[a-z0-9]{1,12}$/.test(suffix)) throw new Error(`HMB_DEV_SUFFIX must be 1-12 lowercase letters or digits, not "${suffix}".`);
export const DEV_ID = `xyz.rpayton.holdmybrief.dev${suffix ? `-${suffix}` : ''}`;
export const DEV_NAME = `Hold My Brief Dev${suffix ? ` ${suffix}` : ''}`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const APP = join(ROOT, 'dist-dev', `${DEV_NAME}.app`);
export const BIN = join(APP, 'Contents', 'MacOS', 'hold-my-brief');
export const HMB = join(APP, 'Contents', 'MacOS', 'hmb');
export const DATA = join(homedir(), 'Library', 'Application Support', DEV_ID);
const WEBKIT = join(homedir(), 'Library', 'WebKit', DEV_ID);
const CACHES = join(homedir(), 'Library', 'Caches', DEV_ID);

/**
 * The environment every `hmb` call against the dev app runs with. HMB_CONTROL_FILE pins it to the dev socket, and
 * HMB_APP_BIN makes any auto-launch start the dev binary: without it `hmb` falls back to `open -a "Hold My Brief"`,
 * which is the owner's copy.
 */
export const devEnv = () => ({ ...process.env, HMB_CONTROL_FILE: join(DATA, 'control.json'), HMB_APP_BIN: BIN });

/** Runs the dev `hmb` with `--no-launch` unless `launch` is set; returns `{ status, stdout, stderr, json }`. */
export function hmb(args, { launch = false, input, timeout = 30_000 } = {}) {
  const r = spawnSync(HMB, [...args, ...(launch ? [] : ['--no-launch'])], { env: devEnv(), encoding: 'utf8', input, timeout });
  let json;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', json };
}

/** The dev app's pid, or 0 when it does not answer. */
export function devPid() {
  const r = hmb(['ping', '--json'], { timeout: 5_000 });
  return r.status === 0 && r.json?.ready ? Number(r.json.pid) : 0;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
function requireMac() {
  if (platform() !== 'darwin') throw new Error('The dev app is macOS only (Windows has `npm run test:native` against WebView2).');
}

export function build() {
  requireMac();
  const config = JSON.stringify({ identifier: DEV_ID, productName: DEV_NAME });
  // Build output goes to stderr, so `hmb-smoke.mjs --build --json` keeps stdout to its JSON report.
  const r = spawnSync('npx', ['tauri', 'build', '--bundles', 'app', '--no-sign', '--config', config], { cwd: ROOT, stdio: ['ignore', 2, 2] });
  if (r.status !== 0) throw new Error(`tauri build failed (exit ${r.status}).`);
  const target = process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(ROOT, 'src-tauri', 'target');
  const built = join(target, 'release', 'bundle', 'macos', `${DEV_NAME}.app`);
  if (!existsSync(built)) throw new Error(`The bundler did not produce ${built}.`);
  rmSync(APP, { recursive: true, force: true });
  mkdirSync(dirname(APP), { recursive: true });
  cpSync(built, APP, { recursive: true });
  if (!existsSync(HMB)) cpSync(join(target, 'release', 'hmb'), HMB);
  // --no-sign leaves only the linker's ad-hoc signature, which does not seal the bundle.
  spawnSync('codesign', ['--force', '--deep', '--sign', '-', APP], { stdio: ['ignore', 2, 2] });
  console.error(`Built ${APP}`);
}

export async function start({ visible = false } = {}) {
  requireMac();
  if (!existsSync(BIN)) throw new Error(`No dev app at ${APP}. Run: node scripts/dev-app.mjs build`);
  if (devPid()) return devPid();
  // An explicit bundle path, never `-a <name>`, so LaunchServices cannot pick the owner's copy. -g keeps focus where
  // it is; -j starts it hidden unless the caller needs to see or type into it.
  // The app writes its control.json wherever HMB_CONTROL_FILE says, and `open` passes the caller's environment on.
  // Pin it to the dev path so a shell that exported another value (even the owner's) cannot redirect it.
  const env = { ...process.env };
  delete env.HMB_CONTROL_FILE;
  delete env.HMB_APP_BIN;
  spawnSync('open', ['-g', ...(visible ? [] : ['-j']), '-n', '--env', `HMB_CONTROL_FILE=${devEnv().HMB_CONTROL_FILE}`, APP], { env });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const pid = devPid();
    if (pid) return pid;
  }
  throw new Error('The dev app did not answer `hmb ping` within 30 s (is Agent control on in its Settings?).');
}

export async function stop() {
  const pid = devPid();
  if (!pid) return false;
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 40 && alive(pid); i++) await sleep(250);
  if (alive(pid)) process.kill(pid, 'SIGKILL');
  return true;
}

export async function reset() {
  await stop();
  for (const dir of [DATA, WEBKIT, CACHES]) {
    if (!dir.endsWith(DEV_ID)) throw new Error(`Refusing to delete ${dir}: not a dev folder.`);
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'build') build();
    else if (cmd === 'start') console.log(`Dev app running, pid ${await start({ visible: process.argv.includes('--visible') })}`);
    else if (cmd === 'stop') console.log((await stop()) ? 'Dev app stopped' : 'Dev app was not running');
    else if (cmd === 'reset') { await reset(); console.log(`Dev app stopped and ${DATA} removed`); }
    else if (cmd === 'env') console.log(`export HMB_CONTROL_FILE=${JSON.stringify(join(DATA, 'control.json'))}\nexport HMB_APP_BIN=${JSON.stringify(BIN)}\nalias hmb-dev=${JSON.stringify(HMB)}`);
    else { console.error('usage: node scripts/dev-app.mjs build | start [--visible] | stop | reset | env'); process.exit(2); }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
