// ==UserScript==
// @name         Fuck Those Idiot
// @namespace    http://tampermonkey.net/
// @version      0.3.0
// @description  Block UGC which those idiot you hate posted
// @author       MoRanYue
// @license      MIT
// @downloadURL  https://github.com/MoRanYue/FuckThoseIdiot/raw/main/FuckThoseIdiot.user.js
// @updateURL    https://github.com/MoRanYue/FuckThoseIdiot/raw/main/FuckThoseIdiot.user.js
// @supportURL   https://github.com/MoRanYue/FuckThoseIdiot/issues
// @match        *://*.bilibili.com/*
// @match        *://steamcommunity.com/app/*/workshop/*
// @exclude      *://api.bilibili.com
// @exclude      *://data.bilibili.com
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function(window) {
    'use strict';

    // Override attachShadow() to avoid #shadow-root (closed)
    let _attachShadow = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (...args) {
        args[0].mode = "open";
        return _attachShadow.call(this, ...args);
    }

    const OPTIONS = {
        bilibili: {
            filter: {
                replaceBlockingWordsToSymbols: true, // Only for comments, other UGC (such as video, game addons) will still being hidden
                doNotLookAnyComment: false,
                doNotLookAnyBullet: false,
            }
        }
    }

    const STATES = {
        filtering: false
    }

    const CLASSNAME_FLAGS = {
        filteredComment: "fti-filtered-comment",
        blockedComment: "fti-blocked-comment",
        blockingTip: "fti-blocking-tip",

        menu: "fti-menu",
        titleCont: "fti-title"
    }
    const LOCALES = {
        settings: {
            title: "FuckThoseIdiot"
        },
        bilibili: {
            commentBlockingTip: "该评论已经过屏蔽处理",
            bulletBlockingTip: "!!"
        },
        steam: {}
    }
    const SUPPORTED_PLATFORMS = {
        bilibili: "bilibili",
        steam: "steam",
        unknown: "unknown"
    }

    const BLOCKING_WORDS = {
        bilibili: {
            comments: [
                /[他它她你tn][吗嘛码妈玛马m]/,
                /[傻杀沙啥煞砂煞鲨2s][逼比币哔笔b]/,
                /就[是像向象]?(依托|一?坨)([屎使石史]|答辩|大便)/,
                /([机鸡几集寄])(\1|[把吧八8巴霸扒])/,
                /[吃赤][屎石实史]/,
                /[草操艹去糙日囸c][他它她你tn][吗嘛码妈玛马m]/,
                /如果(其[它他她]|别)人没.*那么请问.*谁知道?你/,
                /并?不是知道?错.*而是知道?自己[快要将]要?死了?/,
                /饭圈化?/,
                /经典的?自以为是/,
                /凭什么[他她它].*我?们?[就便]?要[体原]谅[？\?]?/,
                "通用模板",
                /素质(令人)?堪忧/,
                /(强行)?([带搞].*节奏|引战)/,
                /[神蛇深][经井][病冰]/,
                /(去|弄|必须)死|杀了[你我他她它泥尼拟]|死.{0,2}(爸|妈|爹|娘|全家|户口本)|司马$/,
                /[键件剑贱建见]人/,
                /^\[.+\]$/, // 单个表情
                /又蠢又坏(说的)?就?是这[种样]/,
                /(感觉|我?认为)(真的|就是)唐/,
                /我?(就是)?[在再]攻击[她他它]/,
                /[一亿义][眼看](就是)?ai/,
                /(无脑的?)?(喷子|键盘侠)/,
                /不是?.*[而却]是[， ](拉满了)+/,
                /(简直)?无敌了/,
                "黄昏见证虔诚的信徒",
                "巅峰产生虚伪的拥护",
                /节奏(不[断停]|很?大)/,
                /戾气好?重/,
                /[铭鸣][式试]|.+只需?[要用].+[就便]可以了.{1,3}但.+需?要?考虑的?就多了/,
                /魔怔是?吧/
            ],
            bullets: [
                /([好豪太][烫热早])+/,
                /^([来看好]|这么)[早完晚]了?/,
                /^.$/,
                /^(好?[烫冷凉热]+手?|热乎)$/,
                /^第[①②③④⑤⑥⑦⑧⑨０１２３４５６７８９0-9〇一二两俩三仨四五六七八九十零百千万亿几Ww]+个?[看康][玩丸完]/,
                /[①②③④⑤⑥⑦⑧⑨０１２３４５６７８９0-9〇一二两俩三仨四五六七八九十零百千万亿几半Ww]+([秒妙]钟?|分钟?|小?时|[日天月年])之?前/,
                /[前钱]排/,
                /(暂停|截图)(成功|失败|学表情)/,
                "我?出息了.?",
                "前来考古",
                /热[一1①１]?热还能吃/,
                /^刚刚$/,
                /^(最|比?较)([早晚爱]|喜欢)的?[一1①１][集次期].?/,
                /^[<《]?[①②③④⑤⑥⑦⑧⑨０１２３４５６７８９0-9〇一二两俩三仨四五六七八九十零百千万亿几Ww]+[\+加＋架多]?[》>]?$/,
                /^[①②③④⑤⑥⑦⑧⑨０１２３４５６７８９0-9〇一二两俩三仨四五六七八九十零百千万亿几Ww]+[\+加＋架多]?[个的号]?(人|粉丝|硬?币|点?赞|)?$/,
                /[①②③④⑤⑥⑦⑧⑨０１２３４５６７８９0-9〇一二两俩三仨四五六七八九十零百千万亿几Ww]+[\+加＋架多]?[个的号]?(人|粉丝?)?([在再]看|(你们|大家)好|合影|(给我)?出来|和我看|(别|不要再?)躲了)/,
                /(\u25e3\u25e5)+(danger|drangr)?/, // ◣◥WARNING
                /^借[你您]吉言$/,
                /此生无悔|来世[愿原]做/,
                /^(你品)?.?你细?品$/,
                /^[Oo][Hh]{2,}$/,
                /空[平瓶屏贫凭]/,
                /点点?举[报办]/,
                "下次一定",
                "弹幕礼仪",
                "热乎",
                "保护",
                /(请|不[愿想]看)([滚滾]|撤退?|离开|右上角?)|散了吧?|洗洗睡|不喜欢(别|不要)/,
                /^(求|祝|保佑).*[考上].*|保佑.*[我前不挂]$/,
                /引战|闭嘴|打脸|素质|[键鍵][盘盤](侠|大手|斗士|[黨党])|喷子|吵架|[撕逼][逼b]/,
                /[神蛇深][经井][病冰]/,
                /[火][前钳]|[流留刘][名铭明]|要火|万火留/,
                "^前方高能$",
                "假高能",
                "mdzz",
                /智[商障]/,
                /(去|弄|必须)死|杀了[你我他她它泥尼拟]|死.{0,2}(爸|妈|爹|娘|全家|户口本)|司马$/,
                /[由有]我(来){0,}[组租]成/,
                /是(精日|日杂|汉[奸J])/,
                /^(.+[—\-_]+)+$/,
                /完结.*[撒撤散]花/,
                /某些?人|有些人/, // 讽刺隐喻
                /非战斗人员.*迅速撤离|fbi ?warning/,
                /这不是演习[，,！!]/,
                "小鬼",
                "跳街舞",
                /ጿ(\s?)ኈ\1ቼ\1ዽ\1ጿ\1/,
                /高能(列车|[均军君菌])/,
                "架好机枪，准备战斗",
                "▄︻┻┳═一",
                /■{3,}/,
                "屏蔽词"
            ],
            videoTitle: []
        },
        steam: {
            community: {
                workshop: {
                    title: [],
                    description: [],
                    comments: []
                }
            }
        }
    }
    const BLOCKING_USERS = {
        bilibili: {
            levelLowerThan: 3,
            comments: [
                "机器工具人",
                "有趣的程序员",
                "AI视频小助理",
                "AI视频小助理总结一下",
                "AI笔记侠",
                "AI视频助手",
                "哔哩哔理点赞姬",
                "课代表猫",
                "AI课代表呀",
                "木几萌Moe",
                "星崽丨StarZai",
                "AI沈阳美食家",
                "AI识片酱",
                "AI头脑风暴",
                "GPT_5",
                "Juice_AI",
                "AI全文总结",
                "AI视频总结",
                "AI总结视频"
            ]
        }
    }

    class BilibiliRouter {
        isMainDomain() {
            return location.host == "www.bilibili.com"
        }
        isDynamicDomain() {
            return location.host == "t.bilibili.com"
        }
        isProfileDomain() {
            return location.host == "space.bilibili.com"
        }
        isLiveDomain() {
            return location.host == "live.bilibili.com"
        }
        isVideoPage() {
            return this.isMainDomain() && location.pathname.startsWith("/video/")
        }
        isArticlePage() {
            return this.isMainDomain() && location.pathname.startsWith("/read/")
        }
        isDynamicPage() {
            return this.isDynamicDomain() && location.pathname.startsWith("/opus/")
        }
    }
    class SteamRouter {
        isMainDomain() {
            return location.host == "steampowered.com"
        }
        isCommunityDomain() {
            return location.host == "steamcommunity.com"
        }
        isWorkshopHomePage() {
            return this.isCommunityDomain() && /^\/app\/\d+\/workshop/i.test(location.pathname)
        }
        isWorkshopBrowserPage() {
            return this.isCommunityDomain() && /^\/workshop\/browse/i.test(location.pathname)
        }
        isWorkshopItemPage() {
            return this.isCommunityDomain() && /^\/sharedfiles\/filedetails/i.test(location.pathname)
        }
    }

    class FtiUtils {
        regexCache = {}

        getInnerElemText(elem, selector) {
            return elem.querySelector(selector).innerText.trim()
        }

        getPlatform() {
            const host = location.host.toLowerCase()
            if (host.endsWith("bilibili.com")) {
                return SUPPORTED_PLATFORMS.bilibili
            }
            else if (host == "steamcommunity.com" || host == "steampowered.com") {
                return SUPPORTED_PLATFORMS.steam
            }
            else {
                return SUPPORTED_PLATFORMS.unknown
            }
        }

        regexMatch(str, matcher) {
            switch (typeof(matcher)) {
                case "string":
                    if (!Object.prototype.hasOwnProperty.call(this.regexCache, matcher)) {
                        this.regexCache[matcher] = new RegExp(matcher, "gi")
                    }
                    return str.matchAll(this.regexCache[matcher])

                default:
                    const key = matcher.toString()
                    if (!Object.prototype.hasOwnProperty.call(this.regexCache, key)) {
                        this.regexCache[key] = new RegExp(matcher, "gi")
                    }
                    return str.matchAll(this.regexCache[key])
            }
        }
        regexListMatch(str, matchers) {
            const list = []
            for (let i = 0; i < matchers.length; i++) {
                const matches = this.regexMatch(str, matchers[i])
                if (matches) {
                    list.push(...matches)
                }
            }
            return list
        }

        removePunctuationSymbols(text) {
            return text.replaceAll(/[\s！\!@#￥%…&\*（）\(\)‘’“”"';:；：，。\/,\.、\?？《》<>~`·—\-\+=\{\}\|\\【】\[\]]/gi, "")
        }

        log(...content) {
            console.log('[FTI]', ...content)
        }
        warn(...content) {
            console.warn('[FTI]', ...content)
        }
        error(...content) {
            console.error('[FTI]', ...content)
        }
    }
    const ftiUtils = new FtiUtils()

    class BilibiliUtils {
        getLevelFromImgUrl(imgUrl) {
            return parseInt(imgUrl[imgUrl.lastIndexOf("/") + 7])
        }
    }
    class SteamUtils {
        getWorkshopItemId() {
            return new URLSearchParams(location.search).get("id")
        }
    }

    class BilibiliFilter {
        comments = []
        bullets = []
        utils = new BilibiliUtils()

        constructor(router) {
            this.router = router
        }

        static getMainContent(commentElem) {
            const renderer = commentElem.shadowRoot.querySelector("bili-comment-renderer");
            if (renderer && renderer.shadowRoot) {
                return renderer.shadowRoot;
            }
            ftiUtils.warn("'bili-comment-renderer' not found");
            return null
        }

        static getUserInfo(commentElem, isReply = false) {
            if (isReply) {
                return commentElem.shadowRoot.querySelector("bili-comment-user-info").shadowRoot
            }
            const main = BilibiliFilter.getMainContent(commentElem)
            if (main) {
                return main.querySelector("#header").querySelector("bili-comment-user-info").shadowRoot
            }
            return null
        }

        static getContent(commentElem, isReply = false) {
            return isReply ? commentElem.shadowRoot.querySelector("bili-rich-text").shadowRoot : BilibiliFilter.getMainContent(commentElem).querySelector("bili-rich-text").shadowRoot
        }

        static getReplies(commentElem) {
            return commentElem.shadowRoot.querySelector("bili-comment-replies-renderer").shadowRoot.querySelectorAll(`bili-comment-reply-renderer:not(.${CLASSNAME_FLAGS.blockedComment})`)
        }

        addCommentBlockingTip(commentElem, isReply = false) {
            const blockingTip = document.createElement("span")
            BilibiliFilter.getUserInfo(commentElem, isReply).querySelector("#info").appendChild(blockingTip)
            blockingTip.innerHTML = LOCALES.bilibili.commentBlockingTip
            blockingTip.className = CLASSNAME_FLAGS.blockingTip
        }
        addBulletBlockingTip(bulletElem) {
            const blockingTip = document.createElement("span")
            const text = bulletElem.innerText
            bulletElem.innerHTML = ""
            bulletElem.appendChild(blockingTip)
            bulletElem.appendChild(document.createTextNode(text))
            blockingTip.innerHTML = LOCALES.bilibili.bulletBlockingTip
            blockingTip.className = CLASSNAME_FLAGS.blockingTip
        }

        filterReplies(commentElem) {
            let replyCounter = 0

            if (this.router.isVideoPage()) {
                if (!commentElem.shadowRoot.querySelector("bili-comment-replies-renderer")) {
                    return
                }

                const replies = BilibiliFilter.getReplies(commentElem)
                replies.forEach(elem => {
                    if (elem.className.includes(CLASSNAME_FLAGS.filteredComment)) {
                        return
                    }

                    const userInfo = BilibiliFilter.getUserInfo(elem, true)
                    if (!userInfo) {
                        return
                    }
                    const username = ftiUtils.getInnerElemText(userInfo, "#user-name")
                    const level = this.utils.getLevelFromImgUrl(userInfo.querySelector("#user-level").querySelector("img").src)

                    const content = BilibiliFilter.getContent(elem, true)
                    let text = ftiUtils.getInnerElemText(content, "#contents")

                    const blockingMatches = ftiUtils.regexListMatch(text, BLOCKING_WORDS.bilibili.comments)

                    let shouldBlock = false

                    if (
                        BLOCKING_USERS.bilibili.comments.includes(username) ||
                        level < BLOCKING_USERS.bilibili.levelLowerThan
                    ) {
                        elem.classList.add(CLASSNAME_FLAGS.blockedComment)
                        shouldBlock = true
                    }

                    if (!elem.className.includes(CLASSNAME_FLAGS.blockedComment) && blockingMatches.length != 0) {
                        if (OPTIONS.bilibili.filter.replaceBlockingWordsToSymbols) {
                            blockingMatches.forEach(match => {
                                const start = match.index;
                                const end = start + match[0].length;
                                const replacement = "*".repeat(match[0].length);
                                text = text.slice(0, start) + replacement + text.slice(end);
                            })
                            content.querySelector("#contents").textContent = text

                            if (text == "*".repeat(text.length)) {
                                elem.classList.add(CLASSNAME_FLAGS.blockedComment)
                            }
                        }
                        else {
                            elem.classList.add(CLASSNAME_FLAGS.blockedComment)
                        }

                        shouldBlock = true
                    }

                    if (shouldBlock) {
                        this.addCommentBlockingTip(elem, true)
                        replyCounter++
                    }

                    elem.classList.add(CLASSNAME_FLAGS.filteredComment)
                })
            }

            return replyCounter
        }

        filter() {
            if (this.router.isVideoPage()) {
                let commentCounter = 0
                let replyCounter = 0
                let bulletCounter = 0

                this.comments.forEach(elem => {
                    replyCounter += this.filterReplies(elem)
                    if (elem.className.includes(CLASSNAME_FLAGS.filteredComment)) {
                        return
                    }

                    const userInfo = BilibiliFilter.getUserInfo(elem)
                    if (!userInfo) {
                        return
                    }
                    const username = ftiUtils.getInnerElemText(userInfo, "#user-name")
                    const level = this.utils.getLevelFromImgUrl(userInfo.querySelector("#user-level").querySelector("img").src)

                    const content = BilibiliFilter.getContent(elem)
                    let text = ftiUtils.getInnerElemText(content, "#contents")

                    const blockingMatches = ftiUtils.regexListMatch(text, BLOCKING_WORDS.bilibili.comments)

                    let shouldBlock = false

                    if (
                        BLOCKING_USERS.bilibili.comments.includes(username) ||
                        level < BLOCKING_USERS.bilibili.levelLowerThan
                    ) {
                        elem.classList.add(CLASSNAME_FLAGS.blockedComment)
                        shouldBlock = true
                    }

                    if (!elem.className.includes(CLASSNAME_FLAGS.blockedComment) && blockingMatches.length != 0) {
                        if (OPTIONS.bilibili.filter.replaceBlockingWordsToSymbols) {
                            blockingMatches.forEach(match => {
                                const start = match.index;
                                const end = start + match[0].length;
                                const replacement = "*".repeat(match[0].length);
                                text = text.slice(0, start) + replacement + text.slice(end);
                            })
                            content.querySelector("#contents").textContent = text

                            if (text == "*".repeat(text.length)) {
                                elem.classList.add(CLASSNAME_FLAGS.blockedComment)
                            }
                        }
                        else {
                            elem.classList.add(CLASSNAME_FLAGS.blockedComment)
                        }

                        shouldBlock = true
                    }

                    if (shouldBlock) {
                        this.addCommentBlockingTip(elem)
                        commentCounter++
                    }

                    elem.classList.add(CLASSNAME_FLAGS.filteredComment)
                })

                this.bullets.forEach(elem => {
                    let text = elem.innerText.trim()
                    
                    const blockingMatches = ftiUtils.regexListMatch(text, BLOCKING_WORDS.bilibili.bullets)

                    if (blockingMatches.length != 0) {
                        if (OPTIONS.bilibili.filter.replaceBlockingWordsToSymbols) {
                            blockingMatches.forEach(match => {
                                const start = match.index;
                                const end = start + match[0].length;
                                const replacement = "*".repeat(match[0].length);
                                text = text.slice(0, start) + replacement + text.slice(end);
                            })
                            elem.textContent = text

                            text = ftiUtils.removePunctuationSymbols(text)

                            if (text == "*".repeat(text.length)) {
                                elem.classList.add(CLASSNAME_FLAGS.blockedComment)
                            }
                        }
                        else {
                            elem.classList.add(CLASSNAME_FLAGS.blockedComment)
                        }

                        this.addBulletBlockingTip(elem)
                        bulletCounter++
                    }

                    elem.classList.add(CLASSNAME_FLAGS.filteredBullet)
                })
                
                if (commentCounter || replyCounter) {
                    ftiUtils.log(`评论区已刷新，共有 ${commentCounter} 个评论与 ${replyCounter} 个回复被进行屏蔽处理`)
                }
                if (bulletCounter) {
                    ftiUtils.log(`共有 ${bulletCounter} 条弹幕被进行屏蔽处理`)
                }
            }
            else if (this.router.isDynamicPage() || this.router.isArticlePage()) {
                
            }
        }

        setup() {
            if (this.router.isVideoPage()) {
                const comments = document.querySelector('bili-comments')
                if (comments && comments.shadowRoot) {
                    this.comments = comments.shadowRoot.querySelectorAll(`bili-comment-thread-renderer:not(.${CLASSNAME_FLAGS.blockedComment})`)
                }

                const player = document.querySelector('#bilibili-player')
                if (player) {
                    this.bullets = player.querySelectorAll(`.bili-danmaku-x-dm.bili-danmaku-x-show:not(${CLASSNAME_FLAGS.filteredBullet})`)
                }
            }
            else if (this.router.isDynamicPage() || this.router.isArticlePage()) {
                
            }
        }
    }

    class FtiMenu {
        constructor() {
            this.menu = document.createElement("section")
            this.menu.className = CLASSNAME_FLAGS.menu

            const titleCont = document.createElement("div")
            titleCont.className = CLASSNAME_FLAGS.titleCont
            titleCont.dataset.isDragging = ""
            titleCont.onmousedown = ev => {
                titleCont.dataset.isDragging = "true"
                titleCont.dataset.originX = ev.pageX.toString()
                titleCont.dataset.originY = ev.pageY.toString()
                titleCont.dataset.menuX = this.menu.offsetLeft.toString()
                titleCont.dataset.menuY = this.menu.offsetTop.toString()
            }
            titleCont.onmousemove = ev => {
                if (titleCont.dataset.isDragging == "true") {
                    this.menu.style.left = (ev.pageX - parseInt(titleCont.dataset.originX) + parseInt(titleCont.dataset.menuX)).toString() + "px"
                    this.menu.style.top = (ev.pageY - parseInt(titleCont.dataset.originY) + parseInt(titleCont.dataset.menuY)).toString() + "px"
                }
            }
            titleCont.onmouseup = ev => {
                titleCont.dataset.isDragging = "false"
            }
            titleCont.onmouseleave = ev => {
                titleCont.dataset.isDragging = "false"
            }

            const title = document.createElement("h3")
            title.appendChild(document.createTextNode(LOCALES.settings.title))
            const exitBtn = document.createElement("button")
            exitBtn.appendChild(document.createTextNode("×"))
            exitBtn.onclick = () => this.hide()

            titleCont.appendChild(title)
            titleCont.appendChild(exitBtn)

            this.menu.appendChild(titleCont)

            document.body.appendChild(this.menu)
            this.hide()
        }

        show() {
            this.menu.style.display = ""
            this.menu.style.top = "0"
            this.menu.style.left = "0"
        }
        hide() {
            this.menu.style.display = "none"
        }
    }

    async function init() {
        ftiUtils.log("waiting for document to be received completely")

        let observeUgc = () => ftiUtils.error("ugc observer is not setup yet")
        const platform = ftiUtils.getPlatform()
        if (platform == SUPPORTED_PLATFORMS.bilibili) {
            const router = new BilibiliRouter()
            const filter = new BilibiliFilter(router)

            const commentObserver = new MutationObserver(() => {
                if (!STATES.filtering) {
                    STATES.filtering = true
                    setTimeout(() => {
                        filter.setup()
                        try {
                            filter.filter()
                        }
                        catch (err) {
                            ftiUtils.error("caught error while filtering: ", err)
                            filter.filter()
                        }
                        STATES.filtering = false
                    }, 100)
                }
            })
            const bulletObserver = new MutationObserver(() => {
                if (!STATES.filtering) {
                    STATES.filtering = true
                    filter.setup()
                    try {
                        filter.filter()
                    }
                    catch (err) {
                        ftiUtils.error("caught error while filtering: ", err)
                        filter.filter()
                    }
                    STATES.filtering = false
                }
            })

            observeUgc = () => {
                if (router.isVideoPage()) {
                    const comments = document.querySelector('bili-comments');
                    if (comments && comments.shadowRoot) {
                        if (OPTIONS.bilibili.filter.doNotLookAnyComment) {
                            comments.remove()
                            return
                        }
                        commentObserver.observe(comments.shadowRoot, { childList: true, subtree: true });
                    }

                    const player = document.querySelector('#bilibili-player')
                    if (player) {
                        const bullets = player.querySelector('.bpx-player-row-dm-wrap')
                        if (bullets) {
                            if (OPTIONS.bilibili.filter.doNotLookAnyBullet) {
                                bullets.remove()
                                return
                            }
                            bulletObserver.observe(bullets, { childList: true, subtree: true })
                        }
                    }
                }
            }
        }
        else {
            ftiUtils.warn("Current platform is not supported. If you see this message, script probably matched incorrect website, please tell the developer.")
        }

        let openMenuId = null
        const domObserver = new MutationObserver(() => {
            if (document.body && !openMenuId) {
                const menu = new FtiMenu()
                openMenuId = GM_registerMenuCommand("⚙| 设置/Settings", () => {
                    menu.show()
                })

                ftiUtils.log("menu has been created")
            }

            observeUgc()
        })
        domObserver.observe(document, { childList: true, subtree: true })

        // Attach CSS
        const style = `
            .${CLASSNAME_FLAGS.blockedComment} {
                display: none !important;
            }
            .${CLASSNAME_FLAGS.blockingTip} {
                background-color: red;
                color: white;
                padding: 2px 1px;
                border-radius: 5px;
                font-size: 75%;
            }

            .${CLASSNAME_FLAGS.menu} * {
                box-sizing: border-box;
            }
            .${CLASSNAME_FLAGS.menu} {
                position: fixed;
                top: 0;
                left: 0;
                background-color: rgba(255, 255, 255, 0.6);
                backdrop-filter: brightness(0.75) blur(30px);
                width: 25%;
                height: 65%;
                border-radius: 12px;
                z-index: 99999;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                border: 2px solid brown;
            }
            .${CLASSNAME_FLAGS.menu} .${CLASSNAME_FLAGS.titleCont} {
                background-color: #FB8CAB;
                padding: 10px;
                color: white;
                cursor: move;
                display: flex;
                align-items: center;
            }
            .${CLASSNAME_FLAGS.titleCont} h3 {
                font-size: 1.4rem;
                margin: 0;
                user-select: none;
                flex-grow: 1;
            }
        `
        let styleElem = document.createElement("style");
        document.head.appendChild(styleElem);
        styleElem.appendChild(document.createTextNode(style))

        ftiUtils.log("ready")
    }
    init()
})(unsafeWindow);