// 模拟器设备发现、采帧及配方包部署桥接。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const BASE = path.resolve(__dirname, '..');
const DEFAULT_ADB = 'D:\\develops\\tools\\platform-tools\\adb.exe';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function adbPath() {
  const config = path.join(__dirname, 'bridge-instances.json');
  const settings = fs.existsSync(config) ? JSON.parse(fs.readFileSync(config, 'utf8')) : {};
  return process.env.AUTOSGS_ADB || settings.adb || DEFAULT_ADB;
}
function adb(args) { return execFileSync(adbPath(), args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }); }
function idFor(serial) {
  const match = /^emulator-(\d+)$/.exec(serial || '');
  if (!match) throw new Error('必须指定 emulator-<端口> serial');
  return 'ld-' + match[1];
}
function frame(serial) {
  idFor(serial);
  const data = adb(['-s', serial, 'exec-out', 'screencap', '-p']);
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG) || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG 文件头无效');
  return { data, width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
function instances() {
  const lines = adb(['devices', '-l']).toString('utf8').split(/\r?\n/);
  let failed = false;
  let count = 0;
  for (const line of lines) {
    const match = /^(emulator-\d+)\s+(\S+)/.exec(line);
    if (!match) continue;
    count++;
    const item = { serial: match[1], instanceId: idFor(match[1]), state: match[2] };
    if (item.state === 'device') {
      try { const f = frame(item.serial); item.width = f.width; item.height = f.height; if (f.width !== 960 || f.height !== 540) failed = true; }
      catch (error) { item.error = error.message; failed = true; }
    } else failed = true;
    console.log(JSON.stringify(item));
  }
  if (!count) { console.error('bridge: 未发现模拟器'); failed = true; }
  if (failed) process.exitCode = 1;
}
function shot(serial, tag) {
  const id = idFor(serial);
  if (!tag || !/^[\p{L}\p{N}_-]{1,80}$/u.test(tag)) throw new Error('tag 仅允许字母、数字、下划线和连字符');
  const f = frame(serial);
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const dir = path.join(BASE, '_bridge', id, 'frames', timestamp);
  fs.mkdirSync(dir, { recursive: false });
  const name = '001_' + tag + '.png';
  const mismatch = f.width !== 960 || f.height !== 540;
  fs.writeFileSync(path.join(dir, name), f.data, { flag: 'wx' });
  const manifest = { serial, instanceId: id, timestamp: now.toISOString(), frames: [{ file: name, width: f.width, height: f.height, orientation: f.width > f.height ? 'landscape' : 'portrait', geometryMismatch: mismatch }] };
  fs.writeFileSync(path.join(dir, 'frames-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ directory: dir, ...manifest }));
  if (mismatch) {
    console.error('bridge: 帧尺寸不符：期望 960x540，实际 ' + f.width + 'x' + f.height);
    process.exitCode = 1;
  }
}
try {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (command === 'instances' && args.length === 0) instances();
  else if (command === 'shot') {
    const options = {};
    while (args.length) {
      const key = args.shift();
      if (!['--serial', '--tag'].includes(key) || !args.length || options[key]) throw new Error('参数错误');
      options[key] = args.shift();
    }
    const serial = options['--serial'];
    const id = idFor(serial);
    fs.mkdirSync(path.join(BASE, '_bridge', id, 'frames'), { recursive: true });
    shot(serial, options['--tag']);
  } else if (command === 'capture') {
    const action = args.shift(), options = {};
    while (args.length) {
      const key = args.shift();
      if (key === '--include-discard' && !options[key]) { options[key] = true; continue; }
      if (!['--serial', '--scene', '--session'].includes(key) || !args.length || options[key]) { const e = new Error('采集参数错误'); e.code = 2; throw e; }
      options[key] = args.shift();
    }
    let id;
    try { id = idFor(options['--serial']); } catch (e) { e.code = 2; throw e; }
    const capture = require('./bridge-capture').create(adb, options['--serial'], id, BASE);
    if (action === 'list' && !options['--scene'] && !options['--session'] && !options['--include-discard']) {
      const recovery = capture.recovery();
      if (recovery) console.log(JSON.stringify({ recovery }));
      for (const item of capture.list()) console.log(JSON.stringify({ discarded: item.discarded, ...item.manifest }));
    } else if (action === 'pull' && options['--scene'] && options['--session']) {
      console.log(JSON.stringify(capture.pull(options['--scene'], options['--session'], options['--include-discard'])));
    } else if (((action === 'start' || action === 'retry') && options['--scene'] || action === 'stop' && !options['--scene']) && !options['--session'] && !options['--include-discard']) {
      const control = require('./bridge-capture-control').create(adb, options['--serial'], id, BASE, capture);
      console.log(JSON.stringify(control.run(action, options['--scene'])));
    } else { const e = new Error('采集命令支持 start、stop、retry、list 或 pull --scene <id> --session <id>'); e.code = 2; throw e; }
  } else if (command === 'deploy' || command === 'rollback') {
    const options = {};
    while (args.length) {
      const key = args.shift();
      if (!['--serial', '--package'].includes(key) || !args.length || options[key]) { const e = new Error('参数错误'); e.code = 2; throw e; }
      options[key] = args.shift();
    }
    const serial = options['--serial'];
    let id;
    try { id = idFor(serial); } catch (e) { e.code = 2; throw e; }
    if ((command === 'deploy' && !options['--package']) || (command === 'rollback' && options['--package'])) { const e = new Error('deploy 需要 --package；rollback 不接受 --package'); e.code = 2; throw e; }
    let validated;
    if (command === 'deploy') {
      try { validated = require('./bridge-package').validate(options['--package']); }
      catch (e) { e.code = 3; throw e; }
      for (const warning of validated.warnings) console.error('警告: ' + warning);
      console.log('manifest sha256: ' + validated.manifestSha256);
    }
    try {
      const devices = adb(['devices', '-l']).toString('utf8');
      if (!devices.split(/\r?\n/).some(line => line.split(/\s+/)[0] === serial && line.split(/\s+/)[1] === 'device')) throw new Error('设备未连接或不可用');
      const f = frame(serial);
      if (f.width !== 960 || f.height !== 540) throw new Error('设备画面不是 960x540');
    } catch (e) { e.code = 4; throw e; }
    const locks = path.join(BASE, '_bridge', id); fs.mkdirSync(locks, { recursive: true });
    const lockPath = path.join(locks, 'deploy.lock'); let fd;
    try { fd = fs.openSync(lockPath, 'wx'); }
    catch (e) { e.code = 10; throw e; }
    try {
      const device = require('./bridge-device').create(adb, serial, id);
      if (command === 'deploy') device.deploy(path.resolve(options['--package']), validated);
      else device.rollback();
    } finally { fs.closeSync(fd); fs.unlinkSync(lockPath); }
  } else { const e = new Error('未知命令'); e.code = 2; throw e; }
} catch (error) { console.error('bridge: ' + error.message); process.exitCode = typeof error.code === 'number' ? error.code : 1; }
