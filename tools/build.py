"""把 src 下所有模块拼成一个单文件 bundle.js。

为什么拼：AutoX 的 eval() 出来的函数脱离脚本引擎绑定，floaty / threads / ui 一调就
java.lang.NullPointerException: RhinoJavaScriptEngine.getRuntime() on null object。
所以代码必须落成手机上的真实文件，用 engines.execScriptFile 运行。
"""
import io
import os

# 项目根 = 本文件所在目录的上一级（tools/build.py -> 项目根），换机器不用改路径
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "build")
OUT = os.path.join(OUT_DIR, "bundle.js")

HEADER = u"""// ===== bundle 引导：eval 环境自动落地为文件并重启 =====
var __SELF = "/storage/emulated/0/脚本/auto-sgs/_main.js";
var __SRC = String(engines.myEngine().getSource());

if (__SRC.indexOf("_main.js") < 0) {
    // 第一遍（由 bootstrap eval 进来）：把完整代码写进手机文件，然后交给新引擎，自己自然结束
    try {
        var __r = http.get("http://192.168.2.250:8099/src/main.js?t=" + new Date().getTime(), { timeout: 20000 });
        var __code = __r.body.string();
        files.createWithDirs(__SELF);
        files.write(__SELF, __code);
        toast("已落地到手机，正在启动");
        sleep(400);
        engines.execScriptFile(__SELF);
    } catch (__e) {
        toast("落地失败 " + __e);
        log("落地失败 " + __e);
    }
} else {
"""

LOGBLOCK = u"""// ===== 日志与回传 =====
sgs = (typeof sgs === "undefined") ? {} : sgs;
var LOGS = [];
var pushedIdx = 0;

sgs.log = {
    i: function (m) { var s = "[I] " + m; LOGS.push(s); log(s); },
    w: function (m) { var s = "[W] " + m; LOGS.push(s); log(s); },
    e: function (m) { var s = "[E] " + m; LOGS.push(s); log(s); }
};

sgs.pushLog = function () {
    if (pushedIdx >= LOGS.length) return;
    var chunk = LOGS.slice(pushedIdx).join("\\n");
    pushedIdx = LOGS.length;
    try { http.post(sgs.PC + "/log", chunk, { timeout: 15000 }); } catch (e) { log("pushLog 失败 " + e); }
};

sgs.pushShot = function () {
    try {
        var im = sgs.vision ? sgs.vision.frame(true) : null;
        if (!im) return;
        var b64 = images.toBase64(im, "jpg", 55);
        http.post(sgs.PC + "/shot", b64, { timeout: 180000 });
    } catch (e) {
        sgs.log.e("截图回传失败 " + e);
    }
};
"""

RUNNER = u"""// ===== 启动（分步执行，每步单独 catch，便于定位）=====
sgs.log.i("=== 悬浮面板启动 " + new Date().toTimeString().substring(0, 8) + " ===");
try { sgs.log.i(device.brand + " " + device.model + " / Android " + device.release); } catch (e0) { }

// step1 清理残留引擎：重复 bootstrap 会留下多个引擎抢 /cmd，只保留自己
try {
    var __mine = engines.myEngine();
    var __all = engines.all();
    var __killed = 0;
    for (var __i = 0; __i < __all.length; __i++) {
        try {
            var __en = __all[__i].getEngine();
            if (__en && __en.getId() != __mine.getId()) { __en.forceStop(); __killed++; }
        } catch (__eq) { }
    }
    sgs.log.i("step1 清理引擎：停掉 " + __killed + " 个 / 共 " + __all.length + " 个");
} catch (__ec) { }

sgs.log.i("step2 截图权限");
try {
    // 画布方向只在进程内「首次」申请时生效（之后重复 requestScreenCapture 会忽略方向参数），
    // 所以必须先让横屏的游戏进入前台，再申请截图。
    var __cur = "";
    try { __cur = currentPackage(); } catch (__e0) { __cur = ""; }
    if (__cur !== "com.sanguosha.mjz.mi") {
        sgs.log.i("前台 " + __cur + "，先拉起游戏再申请截图");
        try { app.launchPackage("com.sanguosha.mjz.mi"); } catch (__e1) { }
    }
    var __land = false;
    for (var __i = 0; __i < 6 && !__land; __i++) {
        sleep(2000);
        try {
            __land = (context.getResources().getConfiguration().orientation
                == android.content.res.Configuration.ORIENTATION_LANDSCAPE);
        } catch (__e2) { __land = (device.width > device.height); }
    }
    sgs.log.i("横屏确认 land=" + __land);
    var okCap = sgs.vision.init();
    sgs.log.i("截图权限 " + okCap);
} catch (e2) {
    sgs.log.e("vision.init 失败 " + e2);
}

sgs.log.i("step3 悬浮球");
try {
    sgs.ui.showBall();
} catch (e3) {
    sgs.log.e("showBall 失败 " + e3);
}

sgs.pushLog();
toast("启动完成");

sgs.log.i("step4 截图自检");
try { sleep(4000); sgs.pushShot(); } catch (e4) { sgs.log.e("pushShot 失败 " + e4); }

// 常驻心跳：推日志 + 拉电脑端指令（3 秒一次），这样电脑可以直接指挥手机，不用人点
var __hb = 0;
threads.start(function () {
  while (true) {
    sleep(3000);
    __hb++;
    if (__hb % 20 == 0) {
        try { sgs.log.i("♥ 心跳 " + __hb + " 次"); sgs.pushLog(); } catch (e) { }
    }
    try { sgs.pushLog(); } catch (e) { }
    try {
        var cr = http.get(sgs.PC + "/cmd", { timeout: 8000 });
        var cmd = String(cr.body.string()).replace(/[ \\r\\n\\t]+/g, "");
        if (cmd && cmd != "none") {
            sgs.log.i("[cmd] " + cmd);
            if (cmd.indexOf("run:") == 0) {
                var tid = cmd.substring(4);
                sgs.ui._t0 = 0;
                sgs.ui.runTask(tid, "远程-" + tid);
            } else if (cmd.indexOf("stop") == 0) {
                sgs.ui.stopAll();
            } else if (cmd.indexOf("shot") == 0) {
                sgs.pushShot();
            } else if (cmd.indexOf("diag") == 0) {
                try { sgs.tasks.diag.run(); } catch (ed) { sgs.log.e("diag 失败 " + ed); }
                sgs.pushLog();
            } else if (cmd.indexOf("ball") == 0) {
                sgs.ui.ballView = null;
                sgs.ui.showBall();
            } else if (cmd.indexOf("clean") == 0) {
                // 停掉除自己以外的所有脚本引擎（多次 bootstrap 会留下僵尸引擎抢指令）
                var killed = 0;
                try {
                    var mine = engines.myEngine();
                    var all = engines.all();
                    for (var qi = 0; qi < all.length; qi++) {
                        try {
                            var en = all[qi].getEngine();
                            if (en && en.getId() != mine.getId()) {
                                en.forceStop();
                                killed++;
                            }
                        } catch (eq) { }
                    }
                } catch (qc) { sgs.log.e("clean 失败 " + qc); }
                sgs.log.i("clean 完成，停掉 " + killed + " 个引擎");
                sgs.pushLog();
            } else if (cmd.indexOf("panel") == 0) {
                sgs.ui.showPanel();
            } else if (cmd.indexOf("closepanel") == 0) {
                sgs.ui.hidePanel();
            } else if (cmd.indexOf("reload") == 0) {
                try {
                    sgs.log.i("reload step1 拉取代码");
                    sgs.pushLog();
                    var nr = http.get(sgs.PC + "/src/main.js?t=" + new Date().getTime(), { timeout: 25000 });
                    var ncode = nr.body.string();
                    sgs.log.i("reload step2 拿到 " + ncode.length + " 字节");
                    sgs.pushLog();
                    if (ncode.length < 5000) throw new Error("代码过短，放弃");
                    files.write("/storage/emulated/0/脚本/auto-sgs/_main.js", ncode);
                    sgs.log.i("reload step3 已落盘，清理其它引擎");
                    sgs.pushLog();
                    // 先清僵尸引擎，否则新旧两个引擎会抢 /cmd
                    try {
                        var mine2 = engines.myEngine();
                        var all2 = engines.all();
                        for (var ri = 0; ri < all2.length; ri++) {
                            try {
                                var en2 = all2[ri].getEngine();
                                if (en2 && en2.getId() != mine2.getId()) en2.forceStop();
                            } catch (re) { }
                        }
                    } catch (rc) { }
                    toast("代码已更新，重启中");
                    sleep(400);
                    engines.execScriptFile("/storage/emulated/0/脚本/auto-sgs/_main.js");
                    sgs.log.i("reload step4 新引擎已拉起");
                    sgs.pushLog();
                    sleep(1500);
                    try { engines.myEngine().forceStop(); } catch (er) {
                        sgs.log.e("reload 停旧引擎失败 " + er);
                    }
                } catch (er2) {
                    sgs.log.e("reload 失败 " + er2);
                    sgs.pushLog();
                }
            }
            sgs.pushLog();
        }
    } catch (e) { }
  }
});
}
"""

MODS = [
    "src/config.js",
    "src/vision.js",
    "src/game.js",
    "src/tasks/playerinfo.js",
    "src/tasks/mail.js",
    "src/tasks/xiaoqiao.js",
    "src/ui.js",
]


def read(rel):
    p = os.path.join(BASE, rel)
    with io.open(p, "r", encoding="utf-8") as f:
        return f.read()


def main():
    parts = [HEADER, LOGBLOCK]
    for rel in MODS:
        parts.append(u"\n// ===== %s =====\n" % rel)
        parts.append(read(rel))
    parts.append(RUNNER)
    code = u"\n".join(parts)

    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(code)
    print("bundle -> %s  (%d bytes)" % (OUT, len(code.encode("utf-8"))))
    return OUT


if __name__ == "__main__":
    main()
