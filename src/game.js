// game.js —— 游戏启动与主城检测
sgs = (typeof sgs === "undefined") ? {} : sgs;

sgs.game = {
    PKG: "com.sanguosha.mjz.mi",

    /** 确保在游戏主城；返回 true/false */
    ensure: function (maxMs) {
        maxMs = maxMs || 120000;
        var v = sgs.vision;
        if (!v.init()) throw new Error("截图权限失败");

        // 先探一帧：已经在主城就直接返回（currentPackage 在该机上不可靠）
        var im = v.frame(true);
        if (im && v.isHome(im)) {
            sgs.log.i("已在主城，无需拉起");
            return true;
        }

        var cur = "";
        try { cur = currentPackage(); } catch (e) { cur = ""; }
        sgs.log.i("前台 " + cur + "，拉起游戏 " + this.PKG);
        try { app.launchPackage(this.PKG); } catch (e) { sgs.log.e("启动失败 " + e); }
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
                    sgs.log.i("重新申请横屏截图");
                    v._capOk = false;
                    v.reset();
                    v.init();
                    notLand = 0;
                }
            }
        }
        sgs.log.e("未见主城");
        return false;
    }
};
