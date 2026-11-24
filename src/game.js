// game.js —— 游戏启动与主城检测
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.game = {
    PKG: "com.sanguosha.mjz.mi",

    /** 确保在游戏主城；返回 true/false */
    ensure: function (maxMs) {
        maxMs = maxMs || 120000;
        var v = sgs.vision;

        // 关键：游戏是横屏 app。必须先把游戏拉到前台再申请截图，
        // 否则脚本在 AutoX 竖屏界面启动，画布会被建成 1280x2772，之后永远错位。
        var cur = "";
        try { cur = currentPackage(); } catch (e) { cur = ""; }
        if (cur !== this.PKG) {
            sgs.log.i("前台 " + cur + "，先拉起游戏 " + this.PKG);
            try { app.launchPackage(this.PKG); } catch (e) { sgs.log.e("启动失败 " + e); }
            sleep(4000);
        }

        // 按当前（游戏横屏）方向重建画布
        v._capOk = false;
        v.reset();
        v._landForce = false;
        if (!v.init()) throw new Error("截图权限失败");

        var im = v.frame(true);
        if (im && v.isHome(im)) {
            sgs.log.i("已在主城，无需拉起");
            return true;
        }
        sgs.log.i("游戏已在前台，等待主城");
        return this.waitHome(maxMs);
    },

    waitHome: function (maxMs) {
        var v = sgs.vision;
        var t0 = new Date().getTime();
        var n = 0;
        var notLand = 0;
        while (new Date().getTime() - t0 < maxMs) {
            sleep(2500);
            n++;
            var im = v.frame(true);
            if (!im) {
                sgs.log.i("第" + n + "次 截图为空");
                continue;
            }
            var w = im.getWidth();
            var h = im.getHeight();
            if (w > h) {
                notLand = 0;
                var p = v.find(sgs.ANCHOR.image, 0.72, sgs.ANCHOR.region, im);
                if (p) {
                    sgs.log.i("到主城 " + Math.round((new Date().getTime() - t0) / 1000) + "s");
                    return true;
                }
                sgs.log.i("第" + n + "次 未命中锚点");
            } else {
                notLand++;
                sgs.log.i("第" + n + "次 竖屏画布 " + w + "x" + h + "（连续" + notLand + "）");
                if (notLand >= 3) {
                    sgs.log.i("重新申请横屏截图（强制横屏）");
                    v._capOk = false;
                    v.reset();
                    v._landForce = true;
                    v.init();
                    notLand = 0;
                }
            }
        }
        sgs.log.e("未见主城");
        return false;
    }
};
