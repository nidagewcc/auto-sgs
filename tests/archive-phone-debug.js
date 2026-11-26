// Safety checks use mock ADB only. No phone is contacted or deleted from.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tool = require('../tools/archive-phone-debug');
const root = path.resolve(__dirname, '..', '_shot', 'archive-tests-' + Date.now());
fs.mkdirSync(root, { recursive: true });
function chunk(type, data) {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(2772);
header.writeUInt32BE(1280, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', require('node:zlib').deflateSync(Buffer.alloc((2772 * 4 + 1) * 1280))),
    chunk('IEND', Buffer.alloc(0))
]);
const digest = crypto.createHash('sha256').update(png).digest('hex');
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS ' + name); }
function fixture(entries) {
    const dir = path.join(root, String(count));
    fs.mkdirSync(dir);
    const manifest = { version: 1, serial: 'authorized-device', remoteRoot: tool.ROOT, files: entries };
    for (const e of entries) if (!e.name.includes('/')) fs.writeFileSync(path.join(dir, e.name), png);
    const file = path.join(dir, 'manifest.json');
    fs.writeFileSync(file, JSON.stringify(manifest));
    return file;
}
function entry(name) { return { name, remotePath: tool.ROOT + name, sha256: digest, bytes: png.length, eligible: true, deleted: false }; }
function mockAdb(options = {}) {
    const removed = [];
    const calls = [];
    return {
        removed, calls,
        run(...args) {
            calls.push(args);
            if (args[1] === 'readlink') return args[3] === tool.ROOT ? '/storage/emulated/0/Download/autosgs-logs\n' : args[3].replace('/sdcard/', '/storage/emulated/0/') + '\n';
            if (args[1] === 'ls') return args[3] === tool.ROOT ? 'drwx------ directory\n' : '-rw------- file\n';
            if (args[1] === 'sha256sum') return (options.changed ? '0'.repeat(64) : digest) + '  file\n';
            if (args[1] === 'sh') {
                const script = args[3];
                assert.ok(script.includes('set -eu;'));
                assert.ok(script.includes('readlink -f'));
                assert.ok(script.includes('sha256sum'));
                const match = script.match(/rm -- "([^"]+)"/);
                assert.ok(match);
                removed.push(match[1]);
                return 'ABSENT\n';
            }
            throw new Error('Unexpected mock ADB command: ' + JSON.stringify(args));
        }
    };
}
test('rejects personal photo names, separators, paths and wrong extensions', () => {
    for (const name of ['IMG_20261126.jpg', 'photo.png', '../Pictures/a.png', '/sdcard/DCIM/a.png', 'shot_../a.png', 'shot_x.png/child', 'shot_x.jpg', 'shot_;rm.png', '.nomedia', 'run.log']) {
        assert.throws(() => tool.remotePath(name));
    }
    assert.equal(tool.remotePath('shot_tap_110x70.png'), tool.ROOT + 'shot_tap_110x70.png');
});
test('rejects truncated PNG headers even with matching screenshot dimensions', () => {
    const file = path.join(root, 'truncated.png');
    const truncated = Buffer.alloc(24);
    png.subarray(0, 24).copy(truncated);
    fs.writeFileSync(file, truncated);
    assert.equal(tool.isDeviceScreenshot(file), false);
});
test('rejects a debug root resolving to personal pictures', () => {
    assert.throws(() => tool.verifyRoot(() => '/storage/emulated/0/Pictures\n'));
});
test('rejects file symbolic links before hashing or deleting', () => {
    assert.throws(() => tool.verifyFile(() => '/storage/emulated/0/DCIM/private.png\n', 'shot_home.png'));
});
test('rejects a manifest for another device', () => {
    const file = fixture([entry('shot_one.png')]);
    const adb = mockAdb();
    assert.throws(() => tool.clean(adb.run, 'another-device', file));
    assert.equal(adb.calls.length, 0);
});
test('rejects a traversal entry without any deletion', () => {
    const file = fixture([entry('../shot_one.png')]);
    const adb = mockAdb();
    assert.throws(() => tool.clean(adb.run, 'authorized-device', file));
    assert.equal(adb.removed.length, 0);
});
test('validates all entries before deleting any file', () => {
    const good = entry('shot_one.png');
    const bad = entry('shot_two.png');
    bad.sha256 = '0'.repeat(64);
    const file = fixture([good, bad]);
    const adb = mockAdb();
    assert.throws(() => tool.clean(adb.run, 'authorized-device', file));
    assert.equal(adb.removed.length, 0);
});
test('preserves a file changed on the device after backup', () => {
    const file = fixture([entry('shot_one.png')]);
    const adb = mockAdb({ changed: true });
    assert.throws(() => tool.clean(adb.run, 'authorized-device', file));
    assert.equal(adb.removed.length, 0);
});
test('only deletes the individually verified absolute screenshot path', () => {
    const e = entry('shot_one.png');
    const file = fixture([e]);
    const adb = mockAdb();
    tool.clean(adb.run, 'authorized-device', file);
    assert.deepEqual(adb.removed, [e.remotePath.replace('/sdcard/', '/storage/emulated/0/')]);
    assert.equal(adb.calls.filter((c) => c[1] === 'rm').length, 0, 'deletion must use the guarded device command');
    assert.equal(adb.calls.filter((c) => c[1] === 'sh').length, 1);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).files[0].deleted, true);
});
console.log('archive safety: ' + count + ' tests passed (mock ADB only)');
