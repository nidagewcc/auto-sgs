// main.js —— 远程进入点：加载模块 → 显示悬浮面板并常驻
var PC_BASE = "http://192.168.2.250:8099";
var LOGS = [];
var pushedIdx = 0;
sgs = {};

sgs.log = {
    i: function (m) { var s = "[I] " + m; LOGS.push(s); log(s); },
    e: function (m) { var s = "[E] " + m; LOGS.push(s); log(s); }
};

function fetchSrc(p) {
    var r = http.get(PC_BASE + "/src/" + p, { timeout: 15000 });
    if (!r || r.statusCode != 200) throw new Error("拉取失败 " + p);
    return r.body.string();
}

function loadMod(p) {
    sgs.log.i("加载 " + p);
    eval(fetchSrc(p));
}

function post(path, body, timeout) {
    try {
        http.post(PC_BASE + path, body, { timeout: timeout || 15000 });
    } catch (e) {
        log("post " + path + " failed: " + e);
    }
}

/** 增量推送日志 */
sgs.pushLog = function () {
    if (pushedIdx >= LOGS.length) return;
    var chunk = LOGS.slice(pushedIdx).join("\n");
    pushedIdx = LOGS.length;
    post("/log", chunk, 15000);
};

/** 推送当前屏幕截图 */
sgs.pushShot = function () {
    try {
        var im = sgs.vision ? sgs.vision.frame() : null;
        if (!im) return;
        var b64 = images.toBase64(im, "jpg", 55);
        post("/shot", b64, 180000);
    } catch (e) {
        sgs.log.e("截图回传失败 " + e);
    }
};

// ---------- 启动 ----------
try {
    sgs.log.i("=== 悬浮面板启动 " + new Date().toTimeString().substring(0, 8) + " ===");
    sgs.log.i(device.brand + " " + device.model + " Android " + device.release);

    loadMod("src/config.js");
    loadMod("src/vision.js");
    loadMod("src/game.js");
    loadMod("src/tasks/playerinfo.js");
    loadMod("src/ui.js");

    sgs.vision.init();
    sgs.ui.showBall();
    sgs.pushLog();
    toast("悬浮球已就绪");
} catch (e) {
    sgs.log.e("启动失败 " + e);
    sgs.pushLog();
    toast("启动失败: " + e);
    exit();
}

// 常驻：定时推送日志，保持脚本不退出
while (true) {
    sleep(4000);
    sgs.pushLog();
}
