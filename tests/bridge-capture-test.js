'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const capture = require('../tools/bridge-capture');
const root = '/storage/emulated/0/Download/autosgs-logs/capture';
const session = '20261127-235012-k7qx';
const dir = root + '/mail/' + session;
const manifest = { schema: 'sgs-workbench/capture-session', schemaVersion: 1, sceneId: 'mail', instanceId: 'ld-5554', sessionId: session, state: 'recording', frame: { width: 960, height: 540 }, frameCount: 0, frames: [] };
function adb(args) {
  if (args[2] === 'exec-out') return Buffer.from(JSON.stringify(manifest));
  const cmd = args[3];
  const real = /realpath '([^']+)'/.exec(cmd);
  if (real) return Buffer.from(real[1] + '\n');
  if (/^if \[ -d /.test(cmd)) return Buffer.from('yes\n');
  if (cmd === "ls -1a '" + root + "'") return Buffer.from('.\n..\n.nomedia\nmail\n');
  if (cmd === "ls -1a '" + root + "/mail'") return Buffer.from('.\n..\n' + session + '\n');
  if (cmd === "cat '" + dir + "/session-manifest.json'") return Buffer.from(JSON.stringify(manifest));
  throw new Error('unexpected shell command: ' + cmd);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-'));
const tool = capture.create(adb, 'emulator-5554', 'ld-5554', temp);
assert.strictEqual(tool.list()[0].manifest.state, 'recording');
assert.throws(() => tool.pull('mail', session), e => e.code === 11);
assert.throws(() => tool.pull('../mail', session), e => e.code === 2);
manifest.state = 'closed';
manifest.frameCount = 1; manifest.frames = [{seq: 1, file: '001.png', width: 960, height: 540, geometryMismatch: false}];
assert.throws(() => tool.pull('mail', session), e => e.code === 10);
const failedParent = path.join(temp, '_bridge', 'ld-5554', 'capture', 'mail');
assert.ok(!fs.existsSync(path.join(failedParent, session)));
assert.ok(!fs.readdirSync(failedParent).some(name => name.startsWith('.staging-pull-')));
manifest.frameCount = 0; manifest.frames = [];
const output = tool.pull('mail', session);
assert.strictEqual(output.frameCount, 0);
assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(output.directory, 'session-manifest.json'))), manifest);
assert.throws(() => tool.pull('mail', session), e => e.code === 10);
manifest.state = 'discarded';
// Explicit discard export uses a separate local path and cannot be mistaken for a closed session.
const discardedDir = root + '/mail/_discard/' + session;
function discardedAdb(args) {
  if (args[2] === 'exec-out') return Buffer.from(JSON.stringify(manifest));
  const cmd = args[3]; const real = /realpath '([^']+)'/.exec(cmd);
  if (real) return Buffer.from(real[1] + '\n');
  if (/^if \[ -d /.test(cmd)) return Buffer.from('yes\n');
  if (cmd === "cat '" + discardedDir + "/session-manifest.json'") return Buffer.from(JSON.stringify(manifest));
  throw new Error('unexpected: ' + cmd);
}
const discardedTool = capture.create(discardedAdb, 'emulator-5554', 'ld-5554', temp);
const discarded = discardedTool.pull('mail', session, true);
assert.ok(discarded.directory.includes(path.join('mail', '_discard', session)));
console.log('bridge capture read-only tests passed');
