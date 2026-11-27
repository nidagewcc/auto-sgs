'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const control = require('../tools/bridge-capture-control');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-control-'));
let heartbeat = String(Date.now()), slot = null, writes = 0, sessions = [], mode = 'missing', token = '', deletes = [];
function adb(args) {
  const cmd = args[3];
  if (cmd.includes("elif [ -d '") && cmd.includes('realpath')) return Buffer.from('/storage/emulated/0/Download/autosgs-logs\n');
  if (cmd.includes('capture-receipts/') && cmd.includes('cat')) {
    const rid = /capture-receipts\/(r\d{13}[0-9a-f]{4})\.json/.exec(cmd)[1];
    if (mode === 'missing' || mode === 'old') return Buffer.from('');
    const match = /^capture:([^:]+):([^:]+):(.+)$/.exec(token);
    return Buffer.from(JSON.stringify({rid,token,command:match[2],sceneId:match[1],result:mode === 'failure' ? 'error' : 'ok',error:'disk full',oldSessionId:'old',newSessionId:'new'}));
  }
  if (cmd.includes('capture-receipts/') && cmd.includes('rm ')) { deletes.push(cmd); return Buffer.from('OK\n'); }
  if (cmd.includes("if [ -L '")) return Buffer.from('OK\n');
  if (cmd.includes('capture-heartbeat.txt') && cmd.includes('cat')) return Buffer.from(heartbeat);
  if (cmd.includes("printf 'PRESENT:'")) return Buffer.from(slot === null ? 'EMPTY' : 'PRESENT:' + slot);
  if (cmd.includes('capture-task.publish-lock')) { writes++; const m = /printf '%s' '(capture:[^']+)'/.exec(cmd); assert(m); token = m[1]; assert.ok(cmd.includes("mv '") && cmd.includes("mkdir '")); return Buffer.from('WRITTEN\n'); }
  throw new Error('unexpected: ' + cmd);
}
const c = control.create(adb, 'emulator-5554', 'ld-5554', tmp, { list: () => sessions });
heartbeat = '0'; assert.throws(() => c.run('start', 'mail'), e => e.code === 9); assert.strictEqual(writes, 0);
heartbeat = String(Date.now()); slot = 'capture:mail:start:r1234567890123abcd'; assert.throws(() => c.run('start', 'mail'), e => e.code === 2); assert.strictEqual(writes, 0);
slot = null; sessions = [{discarded:false, manifest:{state:'recording'}}]; assert.throws(() => c.run('start', 'mail'), e => e.code === 8);
sessions = []; const originalNow = Date.now, originalWait = Atomics.wait; let clock = originalNow();
Date.now = () => clock; Atomics.wait = () => { clock += 500; };
try { mode='old'; assert.throws(() => c.run('start', 'mail'), e => e.code === 4 && e.message.includes('超时')); }
finally { Date.now = originalNow; Atomics.wait = originalWait; }
mode='failure'; assert.throws(() => c.run('start', 'mail'), e => e.code === 4 && e.message.includes('disk full'));
mode='ok'; sessions=[{discarded:false,manifest:{sceneId:'mail',sessionId:'old',state:'recording'}}];
const receipt = c.run('retry','mail');
assert.strictEqual(receipt.oldSessionId,'old'); assert.strictEqual(receipt.newSessionId,'new');
assert.match(receipt.rid, /^r\d{13}[0-9a-f]{4}$/); assert.strictEqual(deletes.length,2);
assert.ok(deletes[1].includes(receipt.rid + '.json'));
console.log('capture control request receipts: OK');
