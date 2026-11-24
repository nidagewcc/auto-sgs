// tasks/mail.js —— 邮件全部领取（AutoX 版，流程与 EC 版一致）
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.mail = {
    id: "mail",
    name: "邮件全部领取",

    ENTRY: "daily_task/youjian.png",
    ENTRY_REGION: [60, 150, 520, 400],
    CLAIM: "daily_task/quanbulingqu.png",
    CLAIM_REGION: [400, 900, 1000, 1200],
    CLOSE: "daily_task/close.png",
    CLOSE_REGION: [2200, 80, 2500, 360],
    REWARD: "daily_task/reward_popup.png",
    REWARD_REGION: [900, 80, 1900, 330],
    DISMISS: [1386, 1180],

    run: function () {
        var v = sgs.vision;

        // 1) 打开邮件弹窗
        var opened = false;
        for (var i = 1; i <= 3; i++) {
            if (v.tapImage(this.ENTRY, 0.8, this.ENTRY_REGION)) {
                sgs.log.i("点击邮件入口（第 " + i + " 轮）");
                if (v.waitImage(this.CLOSE, sgs.TIMEOUT.page, this.CLOSE_REGION, 0.8)) {
                    opened = true;
                    break;
                }
            }
            sleep(600);
        }
        if (!opened) throw new Error("未找到邮件入口或弹窗未打开");
        sgs.log.i("邮件弹窗已打开");

        // 2) 全部领取
        var claim = v.find(this.CLAIM, 0.8, this.CLAIM_REGION, v.frame(true));
        if (claim) {
            v.clickRect(claim);
            sgs.log.i("已点击全部领取");

            // 领到附件会弹「恭喜获得」浮层，必须先点掉，否则会截获后面的关闭点击
            if (v.waitImage(this.REWARD, 1500, this.REWARD_REGION, 0.75)) {
                v.clickPointAt(this.DISMISS[0], this.DISMISS[1], 8);
                sgs.log.i("已点掉奖励浮层");
                sleep(400);
            }
            if (!v.waitImage(this.CLOSE, sgs.TIMEOUT.ui, this.CLOSE_REGION, 0.8)) {
                throw new Error("点击全部领取后弹窗状态异常");
            }
        } else {
            sgs.log.i("未检测到全部领取按钮，无可领取内容");
        }

        // 3) 关闭弹窗，确认回主城
        var closed = false;
        for (var j = 1; j <= 3; j++) {
            if (v.tapImage(this.CLOSE, 0.8, this.CLOSE_REGION)) {
                var t0 = new Date().getTime();
                while (new Date().getTime() - t0 < sgs.TIMEOUT.ui) {
                    if (!v.hasImage(this.CLOSE, this.CLOSE_REGION, 0.8)) {
                        closed = true;
                        break;
                    }
                    sleep(600);
                }
                if (closed) break;
            }
        }
        if (!closed) throw new Error("邮件弹窗未能关闭");

        var home = v.waitImage(sgs.ANCHOR.image, sgs.TIMEOUT.ui, sgs.ANCHOR.region, 0.72);
        if (!home) throw new Error("关闭弹窗后未确认回到主城");
        sgs.log.i("邮件任务完成");
    }
};
