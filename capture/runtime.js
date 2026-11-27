// 独立采集入口：不调用生产 lifecycle，也不操作生产引擎或生产控制文件。
(function () {
    var ROOT = '/storage/emulated/0/Download/autosgs-logs';
    var CAP = ROOT + '/capture', TASK = ROOT + '/capture-task.txt';
    var HEART = ROOT + '/capture-heartbeat.txt', INSTANCE = ROOT + '/instance.txt';
    var TX = ROOT + '/capture-tx.json', RECEIPTS = ROOT + '/capture-receipts';
    var current = null, dir = null, disposed = false, ball = null, stopView = null, boxView = null, recoveryLocked = false;
    var mutex = new java.util.concurrent.locks.ReentrantLock();
    var main = new android.os.Handler(android.os.Looper.getMainLooper());
    var wm = context.getSystemService(android.content.Context.WINDOW_SERVICE);
    var density = context.getResources().getDisplayMetrics().density;
    function px(n) { return Math.round(n * density); }
    function safe(p) {
        if (p !== ROOT && p.indexOf(ROOT + '/') !== 0) throw new Error('path outside project');
        if (String(new java.io.File(p).getCanonicalPath()) !== p) throw new Error('unsafe canonical path: ' + p);
        return p;
    }
    function mkdir(p) { safe(p); var f = new java.io.File(p); if (!f.isDirectory() && !f.mkdir()) throw new Error('mkdir failed: ' + p); safe(p); }
    function atomic(p, text) {
        safe(p); var tmp = p + '.tmp'; safe(tmp);
        if (new java.io.File(tmp).exists()) throw new Error('temporary file exists: ' + tmp);
        files.write(tmp, String(text));
        if (!new java.io.File(tmp).renameTo(new java.io.File(p))) throw new Error('rename failed: ' + p);
    }
    function save(m) { atomic(dir + '/session-manifest.json', JSON.stringify(m, null, 2) + '\n'); }
    function now() { return new Date().toISOString(); }
    function id() {
        var fmt = new java.text.SimpleDateFormat('yyyyMMdd-HHmmss');
        return String(fmt.format(new java.util.Date())) + '-' + ('0000' + Math.floor(Math.random() * 1679616).toString(36)).slice(-4);
    }
    function label() { return current ? current.sceneId + ' · ' + ('00' + current.frameCount).slice(-3) : '采集'; }
    function paint() { main.post(new java.lang.Runnable({run:function () {
        if (!ball || disposed) return;
        ball.setText(recoveryLocked || (current && current.state === 'failed') ? '失败' : label());
        ball.setBackgroundColor(android.graphics.Color.parseColor(recoveryLocked || (current && current.state === 'failed') ? '#a03030' : current ? '#375f4c' : '#444444'));
    }})); }
    function markFailed(reason) {
        if (current && current.state === 'recording') {
            current = captureState.fail(current, reason, now());
            try { save(current); } catch (e) { console.error('无法记录失败: ' + e); }
        }
        paint();
    }
    function start(scene) {
        if (current) throw new Error('already-recording');
        captureProtocol.sceneId(scene);
        var instance = String(files.read(safe(INSTANCE))).trim();
        if (!/^ld-\d+$/.test(instance)) throw new Error('invalid instance id');
        var scenePath = CAP + '/' + scene; mkdir(scenePath);
        var session = id(); dir = scenePath + '/' + session;
        safe(dir); if (new java.io.File(dir).exists()) throw new Error('session exists');
        mkdir(dir); current = captureState.start(scene, instance, session, now()); save(current); paint();
    }
    // The same mutex serializes screenshots, retry and stop. Transaction paths are
    // reconstructed from validated IDs; no arbitrary transaction path is trusted.
    function txOps() {
        function sessionId(s) { if (typeof s !== 'string' || !/^\d{8}-\d{6}-[a-z0-9]{4}$/.test(s)) throw new Error('invalid session id'); }
        function manifest(path, tx, expected) {
            safe(path); var m = JSON.parse(String(files.read(path + '/session-manifest.json')));
            if (m.schema !== 'sgs-workbench/capture-session' || m.schemaVersion !== 1 || m.sceneId !== tx.sceneId || m.sessionId !== expected || m.instanceId !== tx.instanceId || !Array.isArray(m.frames) || m.frameCount !== m.frames.length) throw new Error('invalid transaction manifest');
            return m;
        }
        return {
            validate: function (tx) {
                captureProtocol.sceneId(tx.sceneId); sessionId(tx.oldSessionId); sessionId(tx.newSessionId);
                var request = captureProtocol.parse(tx.token);
                if (!request || request.command !== 'retry' || request.scene !== tx.sceneId || request.rid !== tx.rid) throw new Error('invalid transaction request');
                if (tx.oldSessionId === tx.newSessionId || !/^ld-\d+$/.test(tx.instanceId)) throw new Error('invalid transaction identity');
                var base = CAP + '/' + tx.sceneId;
                if (tx.oldDir !== base + '/' + tx.oldSessionId || tx.discardDir !== base + '/_discard/' + tx.oldSessionId || tx.newDir !== base + '/' + tx.newSessionId) throw new Error('invalid transaction paths');
                safe(tx.oldDir); safe(tx.discardDir); safe(tx.newDir);
            },
            exists: function (p) { safe(p); return new java.io.File(p).isDirectory(); },
            hasUnexpected: function (tx) {
                var names = files.listDir(CAP + '/' + tx.sceneId) || [];
                for (var i = 0; i < names.length; i++) {
                    var name = String(names[i]);
                    if (!/^\d{8}-\d{6}-[a-z0-9]{4}$/.test(name) || name === tx.oldSessionId || name === tx.newSessionId) continue;
                    var path = CAP + '/' + tx.sceneId + '/' + name; safe(path);
                    var m = JSON.parse(String(files.read(path + '/session-manifest.json')));
                    if (m.state === 'recording' || m.state === 'failed') return true;
                }
                return false;
            },
            saveTx: function (tx) { tx.updatedAt = now(); atomic(TX, JSON.stringify(tx, null, 2) + '\n'); },
            removeTx: function () { safe(TX); if (new java.io.File(TX).exists() && !new java.io.File(TX).delete()) throw new Error('transaction removal failed'); },
            move: function (from, to) { safe(from); safe(to); if (new java.io.File(to).exists() || !new java.io.File(from).renameTo(new java.io.File(to))) throw new Error('discard move failed'); },
            validateOld: function (tx) { var m = manifest(tx.discardDir, tx, tx.oldSessionId); if (['recording', 'failed', 'discarded'].indexOf(m.state) < 0) throw new Error('invalid old state'); },
            validateNew: function (tx) { var m = manifest(tx.newDir, tx, tx.newSessionId); if (m.state !== 'recording' || m.frameCount !== 0) throw new Error('invalid new state'); },
            finishDiscard: function (tx) {
                var m = manifest(tx.discardDir, tx, tx.oldSessionId);
                if (m.state !== 'discarded') atomic(tx.discardDir + '/session-manifest.json', JSON.stringify(captureState.discard(m, now()), null, 2) + '\n');
            },
            createNew: function (tx) {
                mkdir(tx.newDir);
                atomic(tx.newDir + '/session-manifest.json', JSON.stringify(captureState.start(tx.sceneId, tx.instanceId, tx.newSessionId, now()), null, 2) + '\n');
            },
            finishNew: function (tx) { this.validateNew(tx); },
            complete: function (tx) {
                var path = RECEIPTS + '/' + tx.rid + '.json'; safe(path);
                if (new java.io.File(path).exists()) {
                    var existing = JSON.parse(String(files.read(path)));
                    if (existing.rid !== tx.rid || existing.token !== tx.token || existing.result !== 'ok' || existing.oldSessionId !== tx.oldSessionId || existing.newSessionId !== tx.newSessionId) throw new Error('conflicting retry receipt');
                    return;
                }
                atomic(path, JSON.stringify({rid:tx.rid, token:tx.token, command:'retry', sceneId:tx.sceneId, result:'ok', state:'recording', oldSessionId:tx.oldSessionId, newSessionId:tx.newSessionId, time:now(), error:null, recoveryRequired:false, transactionPath:null}) + '\n');
            },
            loadNew: function (tx) { return manifest(tx.newDir, tx, tx.newSessionId); }
        };
    }
    function retry(scene, parsed, token) {
        if (recoveryLocked || !current || current.sceneId !== scene || ['recording', 'failed'].indexOf(current.state) < 0) throw new Error('no retryable session');
        var base = CAP + '/' + scene, discard = base + '/_discard'; mkdir(discard);
        var freshId = id();
        var tx = { schema: 'sgs-workbench/capture-transaction', schemaVersion: 1, sceneId: scene, instanceId: current.instanceId,
            oldSessionId: current.sessionId, newSessionId: freshId, oldDir: dir,
            discardDir: discard + '/' + current.sessionId, newDir: base + '/' + freshId, rid: parsed.rid, token: token, updatedAt: now() };
        var ops = txOps();
        captureRetryTransaction.runDurable(ops, tx);
        dir = tx.newDir; current = ops.loadNew(tx);
        paint(); return current;
    }
    function reconcileTx() {
        safe(TX); if (!new java.io.File(TX).exists()) return false;
        var tx = JSON.parse(String(files.read(TX))), ops = txOps();
        if (tx.schema !== 'sgs-workbench/capture-transaction' || tx.schemaVersion !== 1) throw new Error('invalid transaction schema');
        var result = captureRetryTransaction.reconcile(ops, tx);
        if (result) { dir = result; current = ops.loadNew(tx); return true; }
        return false;
    }
    function stop() {
        if (!current) return;
        if (current.state === 'failed') { paint(); return; } // Keep the failed session addressable for retry.
        if (current.state === 'recording') { current = captureState.close(current, now()); save(current); }
        current = null; dir = null; paint();
    }
    function pngValid(file) {
        var f = new java.io.RandomAccessFile(safe(file), 'r');
        try {
            if (f.length() < 24) return false;
            var sig = [137,80,78,71,13,10,26,10];
            for (var i = 0; i < sig.length; i++) if (f.readUnsignedByte() !== sig[i]) return false;
            f.seek(12); if (f.readInt() !== 0x49484452) return false;
            return f.readInt() === 960 && f.readInt() === 540;
        } finally { f.close(); }
    }
    function shot() {
        if (!mutex.tryLock()) return;
        try {
            if (recoveryLocked || !current || current.state !== 'recording') return;
            var next = captureState.append(current, now());
            var target = dir + '/' + next.frames[next.frames.length - 1].file;
            safe(target); if (new java.io.File(target).exists()) throw new Error('frame exists');
            var result = shell('screencap -p ' + target, true);
            if (result.code !== 0) { markFailed('capture'); return; }
            if (!pngValid(target)) { markFailed('geometry'); return; }
            save(next); current = next; paint(); toast('已存 ' + ('00' + current.frameCount).slice(-3));
        } catch (e) { console.error('采集失败: ' + e); markFailed('io'); }
        finally { mutex.unlock(); }
    }
    function cleanReceipts() {
        safe(RECEIPTS);
        var names = (files.listDir(RECEIPTS) || []).filter(function (n) { return /^r\d{13}[0-9a-f]{4}\.json$/.test(String(n)); }).sort();
        while (names.length > 50) {
            var p = RECEIPTS + '/' + names.shift(), f = new java.io.File(p);
            try { safe(p); if (f.isFile() && !f.delete()) console.warn('无法清理旧回执: ' + p); }
            catch (e) { console.warn('跳过不安全回执: ' + p); }
        }
    }
    function receipt(parsed, token, result, oldId, error) {
        if (!parsed) return;
        var p = RECEIPTS + '/' + parsed.rid + '.json'; safe(p);
        if (new java.io.File(p).exists()) throw new Error('receipt already exists');
        atomic(p, JSON.stringify({rid:parsed.rid, token:token, command:parsed.command, sceneId:parsed.scene, result:result,
            state:result === 'ok' ? (current ? current.state : 'closed') : 'failed', oldSessionId:oldId,
            newSessionId:current ? current.sessionId : null, time:now(), error:error ? String(error) : null,
            recoveryRequired:recoveryLocked, transactionPath:recoveryLocked ? TX : null}) + '\n');
        cleanReceipts();
    }
    function poll() {
        if (!mutex.tryLock()) return;
        var parsed = null, token = null, requestSessionId = current ? current.sessionId : null;
        try {
            atomic(HEART, String(new Date().getTime()));
            safe(TASK);
            if (!new java.io.File(TASK).exists()) return;
            token = String(files.read(TASK));
            parsed = captureProtocol.parse(token);
            if (!parsed) { console.warn('删除无效采集令牌'); if (!new java.io.File(TASK).delete()) throw new Error('无法删除无效令牌'); return; }
            if (recoveryLocked && parsed.command !== 'stop') { if (!new java.io.File(TASK).delete()) throw new Error('无法删除令牌'); throw new Error('需要人工恢复'); }
            if (!new java.io.File(TASK).delete()) throw new Error('无法消费令牌');
            if (parsed.command === 'start') start(parsed.scene);
            else if (parsed.command === 'stop') stop();
            else if (parsed.command === 'retry') retry(parsed.scene, parsed, token);
            if (parsed.command !== 'retry') receipt(parsed, token, 'ok', requestSessionId, null);
        } catch (e) {
            console.error('采集轮询异常: ' + e);
            if (new java.io.File(TX).exists()) { recoveryLocked = true; console.error('需人工恢复: ' + TX); paint(); }
            else markFailed('io');
            // A retained transaction may already be committed; only reconciliation
            // can decide its outcome. Never publish an error that contradicts it.
            if (!new java.io.File(TX).exists()) {
                try { receipt(parsed, token, 'error', requestSessionId, e); }
                catch (receiptError) { console.error('无法写入采集失败回执: ' + receiptError); }
            }
        }
        finally { mutex.unlock(); }
    }
    function recoverInterrupted() {
        var scenes = files.listDir(CAP) || [], recovered = [];
        for (var i = 0; i < scenes.length; i++) {
            var scene = String(scenes[i]);
            try { captureProtocol.sceneId(scene); } catch (ignored) { continue; }
            var scenePath = CAP + '/' + scene; safe(scenePath);
            if (!new java.io.File(scenePath).isDirectory()) continue;
            var sessions = files.listDir(scenePath) || [];
            for (var j = 0; j < sessions.length; j++) {
                var session = String(sessions[j]);
                if (!/^\d{8}-\d{6}-[a-z0-9]{4}$/.test(session)) continue;
                var path = scenePath + '/' + session, manifestPath = path + '/session-manifest.json';
                safe(path); safe(manifestPath);
                if (!new java.io.File(manifestPath).isFile()) continue;
                var m = JSON.parse(String(files.read(manifestPath)));
                if (m.schema !== 'sgs-workbench/capture-session' || m.sceneId !== scene || m.sessionId !== session) throw new Error('invalid session manifest');
                if (m.state === 'recording') recovered.push({ manifest: m, path: path });
            }
        }
        if (recovered.length > 1) throw new Error('multiple interrupted sessions; inspect manually');
        if (recovered.length === 1) {
            dir = recovered[0].path; current = recovered[0].manifest;
            markFailed('interrupted');
        }
    }
    function show() {
        var latch = new java.util.concurrent.CountDownLatch(1), error = null;
        main.post(new java.lang.Runnable({run:function () { try {
            var box = new android.widget.LinearLayout(context);
            box.setTag('auto-sgs-capture:ball'); box.setOrientation(android.widget.LinearLayout.HORIZONTAL);
            ball = new android.widget.TextView(context); ball.setText('采集'); ball.setTextColor(android.graphics.Color.WHITE);
            ball.setGravity(android.view.Gravity.CENTER); ball.setTextSize(12);
            box.addView(ball, new android.widget.LinearLayout.LayoutParams(px(95), px(48)));
            stopView = new android.widget.TextView(context); stopView.setText('结束'); stopView.setTextColor(android.graphics.Color.WHITE);
            stopView.setBackgroundColor(android.graphics.Color.DKGRAY); stopView.setGravity(android.view.Gravity.CENTER);
            box.addView(stopView, new android.widget.LinearLayout.LayoutParams(px(38), px(48)));
            ball.setOnClickListener(new android.view.View.OnClickListener({onClick:function () { threads.start(shot); }}));
            stopView.setOnClickListener(new android.view.View.OnClickListener({onClick:function () { threads.start(function () { mutex.lock(); try { stop(); } finally { mutex.unlock(); } }); }}));
            var lp = new android.view.WindowManager.LayoutParams();
            lp.type = android.os.Build.VERSION.SDK_INT >= 26 ? 2038 : android.view.WindowManager.LayoutParams.TYPE_PHONE;
            lp.format = android.graphics.PixelFormat.RGBA_8888; lp.flags = android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
            lp.width = -2; lp.height = -2; lp.gravity = android.view.Gravity.TOP | android.view.Gravity.LEFT; lp.x = px(4); lp.y = px(100);
            lp.setTitle('auto-sgs-capture:ball'); wm.addView(box, lp); boxView = box;
        } catch (e) { error = e; } finally { latch.countDown(); } }}));
        if (!latch.await(3, java.util.concurrent.TimeUnit.SECONDS) || error) throw new Error('无法显示悬浮球: ' + error);
    }
    safe(ROOT); mkdir(CAP);
    var noMedia = CAP + '/.nomedia'; safe(noMedia); if (!new java.io.File(noMedia).exists()) files.write(noMedia, '');
    // 锁只属于采集进程，确保同入口重复启动时不会出现两个令牌消费者。
    var lockFile = new java.io.RandomAccessFile(safe(CAP + '/engine.lock'), 'rw');
    var engineLock = lockFile.getChannel().tryLock(); if (!engineLock) throw new Error('采集引擎已运行');
    mkdir(RECEIPTS); cleanReceipts();
    try { if (!reconcileTx()) recoverInterrupted(); } catch (e) { recoveryLocked = true; console.error('需人工恢复，检查事务及相关路径: ' + TX + '；' + e); }
    show(); paint();
    events.on('exit', function () { disposed = true; try { main.post(new java.lang.Runnable({run:function () { try { if (boxView) wm.removeViewImmediate(boxView); } catch (e) { console.error('悬浮窗清理失败: ' + e); } }})); } catch (e) { console.error('无法调度悬浮窗清理: ' + e); } try { engineLock.release(); lockFile.close(); } catch (e) {} });
    setInterval(poll, 3000); poll();
})();
