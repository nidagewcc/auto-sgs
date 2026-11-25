// tasks/playerinfo.js —— 玩家信息读取（AutoX 移植版）
// 稳定性改造：一个字段连取多帧 OCR 后投票，解决 level 偶发读成 920/20、昵称「血→合」这类抖动
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.playerinfo = {
    id: "playerinfo",
    name: "玩家信息读取",

    // 主城可直接读到的 7 个字段
    FIELDS: [
        { key: "nickname", parser: "text" },
        { key: "level", parser: "level" },
        { key: "combat_power", parser: "power" },
        { key: "physical", parser: "fraction" },
        { key: "energy", parser: "fraction" },
        { key: "sycee", parser: "int" },
        { key: "jade", parser: "int" }
    ],

    // 这些字段历史上抖动过，多帧投票；其余单帧即可
    UNSTABLE: { level: 1, nickname: 1, physical: 1, energy: 1 },

    SAMPLES: 3,

    run: function () {
        var v = sgs.vision;
        var roi = sgs.ROI.playerInfo;
        var out = {};

        if (!v.init()) throw new Error("截图权限获取失败");

        // 先连取 SAMPLES 帧：第 1 帧给所有字段，后两帧只补不稳定字段
        var imgs = [];
        for (var k = 0; k < this.SAMPLES; k++) {
            var f = v.frame(true);
            if (f) imgs.push(f);
            if (k < this.SAMPLES - 1) sleep(220);
        }
        if (!imgs.length) throw new Error("截图失败");
        var img = imgs[0];
        sgs.log.i("画面 " + img.getWidth() + "x" + img.getHeight() + " / 取帧 " + imgs.length);

        for (var i = 0; i < this.FIELDS.length; i++) {
            var fd = this.FIELDS[i];
            var rect = roi[fd.key];
            var tries = this.UNSTABLE[fd.key] ? imgs.length : 1;
            var raws = [];
            var vals = [];
            for (var t = 0; t < tries; t++) {
                var raw = v.ocrRect(rect, imgs[t]);
                raws.push(raw);
                vals.push(this._parse(fd.parser, raw));
            }
            var chosen = this._pick(fd.parser, vals, raws);
            out[fd.key] = { raw: chosen.raw, value: chosen.value, samples: raws };
            if (chosen.value === null) {
                sgs.log.e(fd.key + " 解析失败 原文=" + JSON.stringify(raws));
            } else {
                sgs.log.i(fd.key + " = " + JSON.stringify(chosen.value) + " 原文=" + JSON.stringify(raws));
            }
        }
        return out;
    },

    /** 多帧投票选值：票多者胜；level 平票时取位数多的 */
    _pick: function (type, vals, raws) {
        var cnt = {}, first = {};
        for (var i = 0; i < vals.length; i++) {
            if (vals[i] === null) continue;
            var key = JSON.stringify(vals[i]);
            cnt[key] = (cnt[key] || 0) + 1;
            if (!first[key]) first[key] = { value: vals[i], raw: raws[i] };
        }
        var keys = [];
        for (var kk in cnt) { if (cnt.hasOwnProperty(kk)) keys.push(kk); }
        if (!keys.length) return { value: null, raw: raws.length ? raws[0] : "" };

        var bestKey = keys[0];
        for (var j = 1; j < keys.length; j++) {
            var kj = keys[j];
            if (cnt[kj] > cnt[bestKey]) { bestKey = kj; continue; }
            if (cnt[kj] < cnt[bestKey]) continue;
            if (type === "level") {
                var lj = String(first[kj].value).length;
                var lb = String(first[bestKey].value).length;
                if (lj > lb) bestKey = kj;
            }
        }
        var pick = first[bestKey];
        if (type === "level") {
            // 等级只会被 OCR 吃掉前导位（「120级」→「20级」「A20级」），不会凭空多一位。
            // 若众数是某个更长候选的后缀，取更长的那个。
            var bv = pick.value, br = pick.raw;
            for (var k3 in first) {
                if (!first.hasOwnProperty(k3)) continue;
                var v3 = first[k3].value;
                if (v3 === null || v3 === undefined) continue;
                var s3 = String(v3), sb = String(bv);
                if (s3.length > sb.length && s3.substring(s3.length - sb.length) === sb) {
                    bv = v3; br = first[k3].raw;
                }
            }
            return { value: bv, raw: br };
        }
        return pick;
    },

    _parse: function (type, raw) {
        var s = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "");
        if (type === "text") return s === "" ? null : s;

        if (type === "level") {
            // 「120级」常被认成 920 / 20 / 12093：去空白、统一「級」、只取首段 1~4 位数字再截 3 位
            var t0 = s.replace(/\s+/g, "").replace(/級/g, "级");
            var m0 = t0.match(/(\d{1,4})/);
            if (!m0) return null;
            var n0 = m0[1];
            if (n0.length > 3) n0 = n0.substring(0, 3);
            var i0 = parseInt(n0, 10);
            if (isNaN(i0) || i0 <= 0) return null;
            return i0;
        }

        if (type === "power") {
            // 「1271037万」容易被 OCR 读成「1271037万万」，先把重复单位压成一个
            var p = s.replace(/[,\s]/g, "").replace(/万{2,}/g, "万");
            var m3 = p.match(/(\d+(?:\.\d+)?)\s*(亿|万|千)?/);
            if (!m3) return null;
            var n3 = parseFloat(m3[1]);
            if (isNaN(n3)) return null;
            var u3 = m3[2] || "";
            if (u3 === "亿") n3 *= 100000000;
            else if (u3 === "万") n3 *= 10000;
            else if (u3 === "千") n3 *= 1000;
            return n3;
        }

        if (type === "int") {
            var m1 = s.replace(/[,\s]/g, "").match(/(\d+)/);
            return m1 ? parseInt(m1[1], 10) : null;
        }

        if (type === "fraction") {
            // 「精力32/30」这类前后带字的原文也能取到数字对
            var m2 = s.replace(/\s+/g, "").match(/(\d+)\s*\/\s*(\d+)/);
            return m2 ? { current: parseInt(m2[1], 10), max: parseInt(m2[2], 10) } : null;
        }

        return s === "" ? null : s;
    }
};
