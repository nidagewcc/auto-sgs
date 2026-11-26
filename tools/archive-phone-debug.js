// Archive/clean ONLY known historical screenshots in the fixed auto-sgs log directory.
// First --archive, inspect its manifest, then --clean --manifest <that manifest>.
// No recursive deletion, globs, MediaStore operations, or arbitrary device paths.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = '/sdcard/Download/autosgs-logs/';
const REAL_ROOT = '/storage/emulated/0/Download/autosgs-logs';
const LEGACY = /^(?:shot_[A-Za-z0-9_-]+\.png|s_(?:a[1-3]|aj|b[12]|c[1-7]|end|home2?|l[1-8]|m1|n[12]|now|ok|r[1-5]|sw2?|test|w|x|y|z)\.png|_(?:raw|norm)\.jpg|p2_raw\.jpg|codex-current\.png)$/;
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function remotePath(name) {
    if (typeof name !== 'string' || !LEGACY.test(name)) throw new Error('Not an approved legacy debug screenshot: ' + name);
    const p = ROOT + name;
    if (path.posix.dirname(p) + '/' !== ROOT) throw new Error('Unexpected device path');
    return p;
}
function screenshotDimensions(file) {
    const b = fs.readFileSync(file);
    if (b.length >= 33 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        // Reject a truncated/fake header: require a complete non-interlaced screenshot PNG.
        let offset = 8, dims = null, ended = false;
        const parts = [];
        while (offset + 12 <= b.length) {
            const size = b.readUInt32BE(offset);
            if (size > b.length - offset - 12) return null;
            const type = b.toString('ascii', offset + 4, offset + 8);
            if (type === 'IHDR') {
                if (offset !== 8 || size !== 13 || dims) return null;
                const width = b.readUInt32BE(offset + 8), height = b.readUInt32BE(offset + 12);
                const depth = b[offset + 16], color = b[offset + 17];
                if (depth !== 8 || ![2, 6].includes(color) || b[offset + 18] !== 0 || b[offset + 19] !== 0 || b[offset + 20] !== 0) return null;
                if (!((width === 2772 && height === 1280) || (width === 1280 && height === 2772))) return null;
                dims = [width, height, color === 6 ? 4 : 3];
            } else if (type === 'IDAT') parts.push(b.subarray(offset + 8, offset + 8 + size));
            else if (type === 'IEND') {
                if (size !== 0 || offset + 12 !== b.length) return null;
                ended = true;
                break;
            }
            offset += size + 12;
        }
        if (!dims || !ended || !parts.length) return null;
        try {
            const decoded = require('node:zlib').inflateSync(Buffer.concat(parts), { maxOutputLength: 32 * 1024 * 1024 });
            const stride = dims[0] * dims[2] + 1;
            if (decoded.length !== stride * dims[1]) return null;
            for (let row = 0; row < dims[1]; row++) if (decoded[row * stride] > 4) return null;
        } catch (_) { return null; }
        return dims.slice(0, 2);
    }
    if (b[0] === 255 && b[1] === 216 && b[b.length - 2] === 255 && b[b.length - 1] === 217) {
        let i = 2;
        while (i + 3 < b.length) {
            if (b[i++] !== 255) break;
            while (b[i] === 255) i++;
            const marker = b[i++];
            if (marker === 0xda || marker === 0xd9) break;
            const size = b.readUInt16BE(i);
            if (size < 2 || i + size > b.length) break;
            if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 7) return [b.readUInt16BE(i + 5), b.readUInt16BE(i + 3)];
            i += size;
        }
    }
    return null;
}
function isDeviceScreenshot(file) {
    const d = screenshotDimensions(file);
    return !!d && ((d[0] === 2772 && d[1] === 1280) || (d[0] === 1280 && d[1] === 2772));
}
function createAdb(adb, serial) {
    if (!serial || !/^[A-Za-z0-9_.:-]+$/.test(serial)) throw new Error('Specify the exact authorized --serial');
    return (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
}
function verifyRoot(adb) {
    const real = adb('shell', 'readlink', '-f', ROOT).trim();
    if (real !== REAL_ROOT) throw new Error('Debug directory resolves outside the expected location: ' + real);
    const stat = adb('shell', 'ls', '-ld', ROOT).trim();
    if (!stat.startsWith('d')) throw new Error('Expected a real debug directory');
}
function verifyFile(adb, name) {
    const p = remotePath(name);
    const real = adb('shell', 'readlink', '-f', p).trim();
    if (real !== REAL_ROOT + '/' + name) throw new Error('Screenshot is a symbolic link or has an unexpected path: ' + p);
    const stat = adb('shell', 'ls', '-ld', p).trim();
    if (!stat.startsWith('-')) throw new Error('Not a regular screenshot file: ' + p);
    const out = adb('shell', 'sha256sum', p);
    const m = out.match(/^([a-f0-9]{64})\s/);
    if (!m) throw new Error('Cannot verify device SHA256: ' + p);
    return m[1];
}
function writeManifest(file, manifest) {
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}
function archive(adb, serial) {
    verifyRoot(adb);
    const names = adb('shell', 'ls', '-1A', ROOT).split(/\r?\n/).filter((n) => LEGACY.test(n)).sort();
    const dir = path.resolve(__dirname, '..', '_shot', 'debug-archive-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.mkdirSync(dir, { recursive: false });
    const manifestFile = path.join(dir, 'manifest.json');
    const manifest = { version: 1, serial, remoteRoot: ROOT, createdAt: new Date().toISOString(), files: [] };
    writeManifest(manifestFile, manifest);
    for (const name of names) {
        const p = remotePath(name);
        const before = verifyFile(adb, name);
        const backup = path.join(dir, name);
        adb('pull', p, backup);
        const localHash = hash(backup);
        const after = verifyFile(adb, name);
        if (before !== localHash || after !== localHash) throw new Error('Screenshot changed during backup: ' + p);
        const eligible = isDeviceScreenshot(backup);
        manifest.files.push({ name, remotePath: p, sha256: localHash, bytes: fs.statSync(backup).size, dimensions: screenshotDimensions(backup), eligible, deleted: false });
        writeManifest(manifestFile, manifest);
        if (manifest.files.length % 10 === 0) console.log('Archived and hash-verified ' + manifest.files.length + '/' + names.length);
    }
    console.log(JSON.stringify({ manifest: manifestFile, archived: manifest.files.length, cleanupEligible: manifest.files.filter((f) => f.eligible).length, bytes: manifest.files.reduce((n, f) => n + f.bytes, 0) }));
    return manifestFile;
}
function clean(adb, serial, manifestFile) {
    manifestFile = path.resolve(manifestFile || '');
    const archiveRoot = path.resolve(__dirname, '..', '_shot');
    if (!manifestFile.startsWith(archiveRoot + path.sep) || path.basename(manifestFile) !== 'manifest.json') throw new Error('Expected a local archive manifest under _shot');
    const realRoot = fs.realpathSync(archiveRoot);
    const realManifest = fs.realpathSync(manifestFile);
    const relative = path.relative(realRoot, realManifest);
    if (relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(manifestFile).isSymbolicLink() || !fs.statSync(manifestFile).isFile()) throw new Error('Archive manifest is a link or outside the backup directory');
    if (fs.realpathSync(path.dirname(manifestFile)) !== path.dirname(manifestFile)) throw new Error('Archive directory must not be a symbolic link/junction');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest.version !== 1 || manifest.serial !== serial || manifest.remoteRoot !== ROOT || !Array.isArray(manifest.files)) throw new Error('Manifest/device mismatch');
    verifyRoot(adb);
    const pending = manifest.files.filter((f) => f.eligible === true && !f.deleted);
    const validated = [];
    // Validate every proposed absolute target and its backup before the first deletion.
    for (const entry of pending) {
        const p = remotePath(entry.name);
        if (p !== entry.remotePath) throw new Error('Manifest target mismatch');
        const backup = path.join(path.dirname(manifestFile), entry.name);
        if (fs.lstatSync(backup).isSymbolicLink() || fs.realpathSync(backup) !== backup || !fs.statSync(backup).isFile()) throw new Error('Backup is not an ordinary file in its archive directory');
        if (hash(backup) !== entry.sha256 || !isDeviceScreenshot(backup)) throw new Error('Backup is missing, modified, or not a device screenshot: ' + backup);
        if (verifyFile(adb, entry.name) !== entry.sha256) throw new Error('Device file changed; preserve it: ' + p);
        validated.push({ entry, p });
    }
    for (const { entry, p } of validated) {
        // Recheck immediately before removing this one exact file. Never use rm -r or a wildcard.
        if (verifyFile(adb, entry.name) !== entry.sha256) throw new Error('Device file changed; preserve it: ' + p);
        const physical = REAL_ROOT + '/' + entry.name;
        // Keep the final checks and exact-file deletion in one device shell invocation.
        // Names are allowlisted ASCII; the expected hash was verified against the local backup.
        const script = [
            'set -eu',
            '[ "$(readlink -f ' + ROOT + ')" = "' + REAL_ROOT + '" ]',
            '[ ! -L "' + REAL_ROOT + '" ]',
            '[ -f "' + physical + '" ]',
            '[ ! -L "' + physical + '" ]',
            '[ "$(readlink -f "' + physical + '")" = "' + physical + '" ]',
            'actual=$(sha256sum "' + physical + '")',
            '[ "${actual%% *}" = "' + entry.sha256 + '" ]',
            'rm -- "' + physical + '"',
            '[ ! -e "' + physical + '" ]',
            '[ ! -L "' + physical + '" ]',
            'printf ABSENT'
        ].join('; ');
        const remains = adb('shell', 'sh', '-c', "'" + script + "'").trim();
        if (remains !== 'ABSENT') throw new Error('Deletion could not be verified: ' + p);
        entry.deleted = true;
        entry.deletedAt = new Date().toISOString();
        writeManifest(manifestFile, manifest);
    }
    console.log(JSON.stringify({ manifest: manifestFile, removed: validated.length, bytes: validated.reduce((n, f) => n + f.entry.bytes, 0) }));
}
function main() {
    const args = process.argv.slice(2);
    const value = (key) => args[args.indexOf(key) + 1];
    const serial = args.includes('--serial') ? value('--serial') : '';
    const adbPath = args.includes('--adb') ? value('--adb') : path.resolve(__dirname, '..', '..', 'tools', 'platform-tools', 'adb.exe');
    const adb = createAdb(adbPath, serial);
    if (args.includes('--archive') && !args.includes('--clean')) archive(adb, serial);
    else if (args.includes('--clean') && !args.includes('--archive') && args.includes('--manifest')) clean(adb, serial, value('--manifest'));
    else throw new Error('Use --archive --serial DEVICE, then --clean --serial DEVICE --manifest FILE');
}
if (require.main === module) main();
module.exports = { ROOT, remotePath, screenshotDimensions, isDeviceScreenshot, verifyRoot, verifyFile, archive, clean };
