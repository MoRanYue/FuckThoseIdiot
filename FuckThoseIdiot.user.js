// ==UserScript==
// @name         Fuck Those Idiot
// @namespace    http://tampermonkey.net/
// @version      0.5.0
// @description  Block UGC which those idiots you hate and feel annoying posted
// @author       MoRanYue
// @license      MIT
// @downloadURL  https://github.com/MoRanYue/FuckThoseIdiot/raw/main/FuckThoseIdiot.user.js
// @updateURL    https://github.com/MoRanYue/FuckThoseIdiot/raw/main/FuckThoseIdiot.user.js
// @supportURL   https://github.com/MoRanYue/FuckThoseIdiot/issues
// @match        *://*.bilibili.com/*
// @match        *://steamcommunity.com/*
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

    const STATES = {
        filtering: false
    }

    const CLASSNAME_FLAGS = {
        filteredComment: "fti-filtered-comment",
        blockedComment: "fti-blocked-comment",
        blockingTip: "fti-blocking-tip",

        menu: "fti-menu",
        titleCont: "fti-title",
        menuContent: "fti-content",
        optionSection: "fti-option-section",
        switchOption: "fti-switch-option",
        textOption: "fti-text-option"
    }
    const LOCALES = {
        settings: {
            title: "FuckThoseIdiot",
            replaceBlockingWordsToSymbols: "仅屏蔽匹配的文本",
            replaceBlockingWordsToSymbolsDesc: "当开启时，若用户发布的评论中检测到应被屏蔽的文本，不再整个评论完全隐藏，而是仅替换被屏蔽内容为“*”字符。",
            commentBlockingWords: "评论屏蔽词",
            bulletBlockingWords: "弹幕屏蔽词",
            yes: "是",
            no: "否"
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

    class OptionManager {
        getDefaultConfig(platform) {
            switch (platform) {
                case SUPPORTED_PLATFORMS.bilibili:
                    return {
                        filter: {
                            replaceBlockingWordsToSymbols: true, // Only for comments, other UGC (such as video, game addons) will still being hidden
                            doNotLookAnyComment: false,
                            doNotLookAnyBullet: false
                        }
                    }
                
                case SUPPORTED_PLATFORMS.steam:
                    return {
                        community: {
                        }
                    }

                default:
                    const config = {}
                    for (const platform in SUPPORTED_PLATFORMS) {
                        if (Object.prototype.hasOwnProperty.call(SUPPORTED_PLATFORMS, platform) && platform != SUPPORTED_PLATFORMS.unknown) {
                            config[platform] = this.getDefaultConfig(SUPPORTED_PLATFORMS[platform])
                        }
                    }
                    return config
            }
        }

        getOptions(platform) {
            if (platform == SUPPORTED_PLATFORMS.unknown) {
                throw new Error("unknown platform, config cannot be created")
            }

            return GM_getValue("Fti_" + platform)
        }
        setOptions(platform, options) {
            if (platform == SUPPORTED_PLATFORMS.unknown) {
                throw new Error("unknown platform, config cannot be created")
            }

            return GM_setValue("Fti_" + platform, options)
        }

        createOptions(platform, doNothingIfExists = false) {
            if (platform == SUPPORTED_PLATFORMS.unknown) {
                throw new Error("unknown platform, config cannot be created")
            }

            if (doNothingIfExists && this.getOptions(platform)) {
                return
            }

            const options = this.getDefaultConfig(platform)
            this.setOptions(platform, options)
            return options
        }
    }
    const optionManager = new OptionManager()

    class FilterError extends Error {
        constructor(startLine, endLine, startPos, endPos, message) {
            super(message)

            this.startLine = startLine
            this.endLine = endLine
            this.startPos = startPos
            if (this.startPos) {
                this.startPos++
            }
            this.endPos = endPos
            if (this.endPos) {
                this.endPos++
            }
        }

        toString() {
            let str = ""
            if (this.startLine) {
                str += this.startLine.toString()
                if (this.startPos) {
                    str += "-" + this.startPos.toString()
                }

                if (this.endLine) {
                    str += " to " + this.endLine.toString()
                    if (this.endPos) {
                        str += "-" + this.endPos.toString()
                    }
                }

                str += ": "
            }
            return str + this.message
        }
    }
    class FilterParser {
        BLANKS = "\t\n "

        init(content) {
            this.line = 1
            this.pos = -1
            this.char = null
            this.content = content
            
            this.advance()
        }

        back() {
            this.pos--
            this.char = this.content[this.pos]
            if (this.char == "\n") {
                this.line--
            }
        }
        advance() {
            this.pos++
            this.char = this.content[this.pos]
            if (this.char == "\n") {
                this.line++
            }
        }

        isBlanks(char) {
            return this.BLANKS.includes(char) || !char
        }
        skipBlanks() {
            while (this.char && this.isBlanks(this.char)) {
                this.advance()
            }
        }

        checkError(maybeError) {
            if (typeof maybeError == "object") {
                if (maybeError instanceof FilterError) {
                    return { passed: false, data: maybeError }
                }
                else {
                    for (const k in maybeError) {
                        if (Object.prototype.hasOwnProperty.call(maybeError, k)) {
                            const result = this.checkError(maybeError[k])
                            if (!result.passed) {
                                return { passed: false, data: result.maybeError }
                            }
                        }
                    }
                }
            }
            return { passed: true, data: maybeError }
        }
        handleError(o, key, maybeError) {
            const result = this.checkError(maybeError)
            if (result.passed) {
                o[key] = maybeError
                return o
            }
            return result.data
        }

        parseToken(returnedValueType = "raw") {
            let output
            let isEnclosed

            let startLine = this.line
            let startPos = this.pos
            
            switch (returnedValueType) {
                case "group":
                    output = []
                    let elem = null
                    isEnclosed = this.char == "["
                    if (isEnclosed) {
                        this.advance()
                    }
                    const parseOpenString = () => {
                        const str = this.parseToken(",]\n")
                        if (this.char == ",") {
                            return [1, str]
                        }
                        else if (isEnclosed && this.char == "]") {
                            return [0, str]
                        }
                        else if (!isEnclosed && this.char == "\n") {
                            return [0, str]
                        }

                        const nextStr = parseOpenString()
                        return [nextStr[0], str + "]" + nextStr[1]]
                    }
                    while (this.char) {
                        if (isEnclosed) {
                            if (this.char == ']') {
                                this.advance()
                                return output
                            }
                        }
                        else {
                            if (this.char == "\n") {
                                return output
                            }
                        }

                        this.skipBlanks()

                        if (this.char == "[") {
                            elem = this.parseToken("group")
                            output.push(elem)
                        }
                        else if (this.char == '"') {
                            elem = this.parseToken("string")
                            output.push(elem)
                        }
                        else {
                            const str = parseOpenString()
                            elem = str[1]
                            output.push(elem)
                            if (str[0]) {
                                this.advance()
                            }
                        }
                    }

                    if (isEnclosed) {
                        return new FilterError(startLine, this.line, startPos, this.pos, "group is enclosed but nothing remains")
                    }
                    return output

                case "string":
                    output = ""
                    isEnclosed = this.char == '"'
                    if (isEnclosed) {
                        this.advance()
                    }
                    while (this.char) {
                        if (isEnclosed) {
                            if (this.char == '"') {
                                this.advance()
                                return output
                            }
                        }
                        else {
                            if (this.char == "\n") {
                                return output
                            }
                        }

                        if (this.char == "\\") {
                            this.advance()
                            if (['"', "\\"].includes(this.char)) {
                                output += this.char
                            }
                            else {
                                output += "\\" + this.char
                            }
                        }
                        else {
                            output += this.char
                        }
                        this.advance()
                    }

                    if (isEnclosed) {
                        return new FilterError(startLine, this.line, startPos, this.pos, "string is enclosed but nothing remains")
                    }
                    return output

                case "boolean":
                    const value = this.parseToken().toLowerCase()
                    if (value == "true") {
                        return true
                    }
                    else if (value == "false") {
                        return false
                    }
                    return new FilterError(startLine, this.line, startPos, this.pos, "expected Boolean but got " + value)
            
                case "raw":
                    output = ""
                    while (!this.isBlanks(this.char)) {
                        output += this.char
                        this.advance()

                        if (this.char == "#") {
                            while (this.char && char != "\n") {
                                this.advance()
                            }
                        }
                    }
                    return output
                
                default:
                    const escapeChars = []
                    const stoppingChars = []
                    for (let i = 0; i < returnedValueType.length; i++) {
                        if (returnedValueType[i] == "\\") {
                            i++
                            escapeChars.push(returnedValueType[i])
                        }
                        else {
                            stoppingChars.push(returnedValueType[i])
                        }
                    }

                    output = ""
                    while (this.char && !stoppingChars.includes(this.char)) {
                        if (this.char == "\\") {
                            this.advance()
                            if (escapeChars.includes(this.char)) {
                                output += this.char
                            }
                            else {
                                output += "\\" + this.char
                            }
                        }
                        else {
                            output += this.char
                        }
                        this.advance()

                        if (this.char == "#") {
                            while (this.char && char != "\n") {
                                this.advance()
                            }
                        }
                    }
                    return output.trim()
            }
        }

        parseValue(expectedType) {
            if (expectedType == "string") {
                return this.parseToken("string")
            }
            else if (expectedType == "group") {
                return this.parseToken("group")
            }
            else {
                return new FilterError(this.pos, undefined, this.pos, undefined, "unknown data type " + expectedType)
            }
        }
        processRegexExpression(value) {
            let nonInsertionValue = ""
            let isInInsertion = false
            let insertions = []
            let insertion = ""
            for (let i = 0; i < value.length; i++) {
                if (isInInsertion) {
                    if (value[i] == "}") {
                        i++
                        if (value[i] == "}") {
                            insertions.push({
                                insertion,
                                position: nonInsertionValue.length
                            })
                            isInInsertion = false
                            insertion = ""
                        }
                        else {
                            return new FilterError(startLine, this.line, startPos, this.pos, "missing value")
                        }
                    }
                    else if (!this.isBlanks(value[i])) {
                        insertion += value[i]
                    }
                }
                else if (value[i] == "{") {
                    i++
                    if (value[i] == "{") {
                        isInInsertion = true
                    }
                    else {
                        nonInsertionValue += "{" + value[i]
                    }
                }
                else if (value[i] == "\\") {
                    i++
                    if (value[i] == "{") {
                        nonInsertionValue += "{"
                    }
                    else {
                        nonInsertionValue += "\\" + value[i]
                    }
                }
                else {
                    nonInsertionValue += value[i]
                }
            }

            return { nonInsertionValue, insertions }
        }
        parseProperty() {
            const startPos = this.pos
            const startLine = this.line
            const type = this.parseToken()
            const lowerCaseType = type.toLowerCase()
            if (lowerCaseType == "attr") {
                const name = this.parseToken("=")
                if (name == "=") {
                    return new FilterError(startLine, this.line, startPos, this.pos, "missing name")
                }

                if (this.char == "=") {
                    this.advance()
                    this.skipBlanks()
                    let value
                    switch (name.toLowerCase()) {
                        case "name":
                        case "version":
                            value = this.parseValue("string")
                            break

                        case "language":
                        case "platform":
                        case "enableon":
                        case "imports":
                            value = this.parseValue("group")
                            break
                    
                        default:
                            value = this.parseValue("string")
                    }

                    return this.handleError({ type, name }, "value", value)
                }
                return new FilterError(startLine, this.line, startPos, this.pos, "missing value")
            }
            else if (lowerCaseType == "charset") {
                const name = this.parseToken("=")
                if (name == "=") {
                    return new FilterError(startLine, this.line, startPos, this.pos, "missing name")
                }

                if (this.char == "=") {
                    this.advance()
                    this.skipBlanks()
                    const value = this.parseValue("string")
                    const processedValue = this.processRegexExpression(value)
                    if (!this.checkError(processedValue).passed) {
                        return processedValue
                    }

                    return { type, name, value: { value: processedValue.nonInsertionValue, insertions: processedValue.insertions } }
                }
                return new FilterError(startLine, this.line, startPos, this.pos, "missing value")
            }
            else if (lowerCaseType == "rule") {
                this.skipBlanks()
                const name = this.parseToken("=")
                if (this.char == "=") {
                    this.advance()
                    this.skipBlanks()
                    const value = this.parseToken("string")
                    const processedValue = this.processRegexExpression(value)
                    if (!this.checkError(processedValue).passed) {
                        return processedValue
                    }

                    this.skipBlanks()
                    const flags = []
                    while (this.char == "$") {
                        this.advance()
                        const flag = this.parseToken("\n=$")
                        let value = true

                        if (this.char == "=") {
                            this.advance()
                            this.skipBlanks()
                            switch (flag.toLowerCase()) {
                                case "forceblocking":
                                case "forcehide":
                                case "regexless":
                                case "secondarymatching":
                                    value = this.parseToken("boolean")
                                    break

                                default:
                                    value = this.parseToken("$\n\\$")
                            }
                        }

                        flags.push(this.handleError({ name: flag }, "value", value))
                    }

                    return { type, value: { value: processedValue.nonInsertionValue, insertions: processedValue.insertions }, name: name ? name : null, flags }
                }
                return new FilterError(startLine, this.line, startPos, this.pos, "missing value")
            }
            else {
                return new FilterError(startLine, this.line, startPos, this.pos, "illegal type " + type)
            }
        }

        serialize(content) {
            this.init(content)

            const tree = []
            while (this.char) {
                if (!this.isBlanks(this.char)) {
                    const prop = this.parseProperty()
                    if (prop instanceof FilterError) {
                        console.error("filter parsing error:\n", prop)
                        console.warn("tree structure:\n", tree)
                        return null
                    }
                    tree.push(prop)
                }

                this.advance()
            }

            return tree
        }
    }
    const testParser = new FilterParser()
    console.log(JSON.stringify(testParser.serialize(String.raw`
Attr Name = Bilibili Official Rules
Attr Version = 1.0.0
Attr Language = zh-CN
Attr Platform = Bilibili
Attr Imports = ./charset.filter

Charset Shit = [屎使石史]|[答大][便变遍辩辨]
Rule = "^(\[.+\])+$" $Reason = T
Rule = "^.$" $Reason = T
Rule = "[神蛇深][经井金][病冰]?|神秘的金[属子]" $Reason = Fl, O
Rule = "[草操艹去糙日囸c]{{ ChineseProns }}[吗嘛码妈玛马m]" $Reason = Fl, O
Rule = "[他它她你tn][吗嘛码妈玛马m]" $Reason = Fl
Rule = "mdzz|妈的(智障|制杖|纸杖)" $Reason = Fl
Rule Idiot = "[傻杀沙啥煞砂煞鲨2s][逼比币哔笔b]" $Reason = Fl, O
Rule = "不就是?纯?{{ Idiot }}[嘛吗]" $Reason = Fl, O $ForceBlocking
Rule Jb = "([机鸡几集寄姬])(\1|[把吧八8巴霸扒])" $Reason = P, Fl
Rule = "[吃赤]{{ Shit }}" $Reason = O
Rule = "(去|弄|必须)死|杀了{{ ChineseProns }}|[死似司].{0,2}(爸|妈|爹|娘|全家|户口本|马|🐎)" $Reason = O, Fl $ForceBlocking
Rule = "就[是像向象]?(依托|一?坨|[个歌哥])({{ Shit }}|{{ Jb }})" $Reason = Eac, Fl, O $ForceBlocking
Rule = "饭圈" $Reason = Al $ForceBlocking $Regexless $EnableOn = *

Attr EnableOn = VideoCommentUsername, ArticleCommentUsername, LivestreamBulletUsername
Rule AwfulAi = "机器工具人|有趣的程序员|木几萌Moe|AI视频|AI笔记侠|AI.*总结|哔哩哔理点赞姬|课代表猫|AI课代表|星崽丨StarZai|AI沈阳美食家|AI识片酱|AI头脑风暴|GPT_5|Juice_AI" $Reason = AI总结

Attr EnableOn = VideoCommentUserId, ArticleCommentUserId, LivestreamBulletUserId
Rule = "8455326|234978716|439438614|473018527|622347713|437175450|3546618932496589|1692825065|3494380876859618|3546376048741135|1835753760|9868463|358243654|393788832" $Reason = AI总结

Attr EnableOn = VideoComment, ArticleComment
Rule = "并?不是知道?错.*而是知道?自己[快要将]要?死了?" $Reason = Ms, Al, T $ForceBlocking $EnableOn = VideoBullet, LivestreamBullet
Rule = "如果(其[它他她]|别)人没.*那么请问.*谁知道?你" $Reason = Al, Sp, Wac, Lous $ForceBlocking
Rule = "经典的?自以为是" $Reason = Fe $ForceBlocking
Rule = "[一义][眼看](就是)?ai" $Reason = Eac $ForceBlocking
Rule = "凭什么[他她它].*我?们?[就便]?要[体原]谅[？\?]?" $Reason = Al, Sp, O $ForceBlocking
Rule = "^通用模板" $Reason = Lous $ForceBlocking
Rule = "素质(令人)?堪忧" $Reason = Lous, Ms
Rule = "(强行)?([带搞].*节奏|引战)" $Reason = Al, Lous
Rule = "[键件剑贱建见]人" $Reason = O
Rule = "又蠢又坏(说的)?就?是这[种样]" $Reason = O
Rule = "(感觉|我?认为)(真的|就是)唐" $Reason = O, B $ForceBlocking
Rule = "(无脑的?)?(喷子?|键盘侠)" $Reason = Al
Rule = "不是?.+[而却]是.+[， ](拉满了)+" $Reason = Al $ForceBlocking
Rule = "(简直)?无敌了" $Reason = T
Rule = "巅峰(产生|出现)虚伪的拥护|黄昏见证虔诚的信徒" $Reason = T $ForceBlocking
Rule = "节奏(不[断停]|很?大)" $Reason = 舆论评价
Rule = "戾气好?重" $Reason = 舆论评价
Rule = "[铭鸣][式试]|.+只需?[要用].+[就便]可以了.{1,3}但.+需?要?考虑的?就多了" $Reason = Al $ForceBlocking
Rule = "魔怔了?是?吧" $Reason = O
Rule = "@{{ AwfulAi }}" $Reason = T $ForceHide

Attr EnableOn = VideoBullet, LivestreamBullet
Rule = "([好豪太][烫热早])+" $Reason = T $ForceBlocking
Rule = "^([来看好]|这么)[早完晚]了?" $Reason = T
Rule = "^(好?[烫冷凉热]+手?|热乎)$" $Reason = T
Rule = "^第{{ SpecialIntNumber }}个?[看康][玩丸完]" $Reason = T $ForceBlocking
Rule = "[前钱]排" $Reason = T $ForceBlocking
Rule = "^(暂停|截图)(成功|失败|学表情)$" $Reason = T
Rule = "我?出息了.?" $Reason = T $ForceBlocking
Rule = "({{ \d+ }}|.{1,3}时代|前来)考古" $Reason = T $ForceBlocking
Charset One = [一1①１]
Rule = "热{{ One }}?热还能吃" $Reason = T $ForceBlocking
Rule = "^刚刚$" $Reason = T
Rule = "^(最|比?较)([早晚爱好]|喜欢|好看)的?{{ One }}[集次期]$" $Reason = T
Charset NumberPlus = {{ SpecialFloatNumber }}[\+加＋架多]?
Rule = "^{{ NumberPlus }}$" $Reason = T
Rule = "^[<《]?{{ NumberPlus }}[》>]?$" $Reason = T
Rule = "^{{ NumberPlus }}[个的号](人|粉丝?|硬?币|点?赞|)" $Reason = T $ForceBlocking
Rule = "{{ NumberPlus }}[个的号]?(人|粉丝?)?([在再]看|(你们|大家)好|合影|([给和]我)?(出来|[看康])|(别|不要)再?躲了)" $Reason = T $ForceBlocking
Rule = "屏蔽" $Reason = Lous $ForceBlocking $Regexless
Rule = "高能" $Reason = T $ForceBlocking $Regexless
Rule = "(◣◥)+(danger|drangr|warning)?" $Reason = T $ForceBlocking
Rule = "^借[你您]吉言$" $Reason = T $ForceBlocking
Rule = "此生无悔|来世[愿原]做" $Reason = T $ForceBlocking
Rule = "^(你品)?.?你细?品$" $Reason = Lous
Rule = "^oh{2,}$" $Reason = T
Rule = "空[平瓶屏贫凭]" $Reason = T $ForceBlocking
Rule = "举[报办]" $Reason = Al $ForceBlocking
Rule = "弹幕礼仪" $Reason = Lous $ForceBlocking $Regexless
Rule = "保护" $Reason = T $ForceBlocking $Regexless
Rule = "(请|不[愿想]?看|马上|快点?)([滚滾]蛋?|撤退?|离开|走|右上角?)|散了吧?|洗洗睡|不喜欢?([别勿]|不要)" $Reason = Lous, O $ForceBlocking
Rule = "引战|闭嘴|打脸|素质|[键鍵][盘盤](侠|大手|斗士|[黨党])|喷子|吵架|[撕逼b][逼b]" $Reason = O, Fl $ForceBlocking
Rule = "[火][前钳]|[流留刘][名铭明]|要火|万火留" $Reason = T $ForceBlocking
Rule = "[由有]我来?[组租]成" $Reason = T $ForceBlocking
Rule = "^(.+[—\-_]*)+$" $Reason = T
Rule = "完结.*[撒撤散]花" $Reason = T $ForceBlocking
Rule = "某些?人|有些人" $Reason = 通常的讽刺隐喻 $ForceBlocking
Rule = "非战斗人员.*([迅讯快]速|马上)撤离|fbi ?warning|不是演习" $Reason = T $ForceBlocking
Rule = "小鬼" $Reason = Ms, Al $Regexless
Rule = "ጿኈቼዽጿ" $Reason = T $ForceBlocking $Regexless
Rule = "架好机枪，准备战斗" $Reason = T, Ooc
Rule = "▄︻┻┳═一" $Reason = T $ForceBlocking $Regexless
Rule = "■{3,}" $Reason = T $ForceBlocking $Regexless`)))

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
        platform = null

        getInnerElemText(elem, selector) {
            return elem.querySelector(selector).innerText.trim()
        }

        getPlatform() {
            if (this.platform) {
                return this.platform
            }

            const host = location.host.toLowerCase()
            if (host.endsWith("bilibili.com")) {
                this.platform = SUPPORTED_PLATFORMS.bilibili
            }
            else if (host == "steamcommunity.com" || host == "steampowered.com") {
                this.platform = SUPPORTED_PLATFORMS.steam
            }
            else {
                this.platform = SUPPORTED_PLATFORMS.unknown
            }

            return this.platform
        }

        regexMatch(str, matcher) {
            switch (typeof matcher) {
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

        randomString(length, charset = "0123456789abcdef") {
            let str = ""
            for (let i = 0; i < length; i++) {
                str += charset.charAt(Math.floor(Math.random() * charset.length))
            }
            return str
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

                    const blockingMatches = ftiUtils.regexListMatch(text, optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.blockingWords.comments)

                    let shouldBlock = false

                    if (
                        optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.blockingUsers.comments.includes(username) ||
                        level < optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.blockingUsers.levelLowerThan
                    ) {
                        elem.classList.add(CLASSNAME_FLAGS.blockedComment)
                        shouldBlock = true
                    }

                    if (!elem.className.includes(CLASSNAME_FLAGS.blockedComment) && blockingMatches.length != 0) {
                        if (optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.replaceBlockingWordsToSymbols) {
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

                    const blockingMatches = ftiUtils.regexListMatch(text, optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.blockingWords.comments)

                    let shouldBlock = false

                    if (
                        optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.blockingUsers.comments.includes(username) ||
                        level < optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.blockingUsers.levelLowerThan
                    ) {
                        elem.classList.add(CLASSNAME_FLAGS.blockedComment)
                        shouldBlock = true
                    }

                    if (!elem.className.includes(CLASSNAME_FLAGS.blockedComment) && blockingMatches.length != 0) {
                        if (optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.replaceBlockingWordsToSymbols) {
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
                    
                    const blockingMatches = ftiUtils.regexListMatch(text, optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.blockingWords.bullets)

                    if (blockingMatches.length != 0) {
                        if (optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.replaceBlockingWordsToSymbols) {
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
            exitBtn.appendChild(this.createIcon("x"))
            exitBtn.onclick = () => this.hide()

            titleCont.appendChild(title)
            titleCont.appendChild(exitBtn)

            this.menu.appendChild(titleCont)

            const content = document.createElement("div")
            content.className = CLASSNAME_FLAGS.menuContent

            this.setupOptions(content)

            this.menu.appendChild(content)

            document.body.appendChild(this.menu)
            this.hide()
        }

        createIcon(name) {
            const icon = document.createElement("i")
            icon.className = "bi-" + name
            return icon
        }
        createOptionSection(title, options) {
            const section = document.createElement("div")
            section.className = CLASSNAME_FLAGS.optionSection
            options.forEach(option => section.appendChild(option))
            return section
        }
        createSwitchOption(title, desc, states, onApplying) {
            const option = document.createElement("li")
            option.classList = CLASSNAME_FLAGS.switchOption
            option.title = desc

            const titleElem = document.createElement("span")
            titleElem.appendChild(document.createTextNode(title))

            option.appendChild(titleElem)

            const id = ftiUtils.randomString(6)
            const stateSwitchCont = document.createElement("div")
            if (states == "YesOrNo") {
                states = {
                    "true": LOCALES.settings.yes,
                    "false": LOCALES.settings.no
                }
            }
            for (const value in states) {
                if (Object.prototype.hasOwnProperty.call(states, value)) {
                    const stateCont = document.createElement("div")

                    const stateRadio = document.createElement("input")
                    stateRadio.type = "radio"
                    stateRadio.name = id
                    stateRadio.value = value
                    stateRadio.onchange = () => onApplying(value)

                    stateCont.appendChild(stateRadio)

                    const label = document.createElement("label")
                    label.htmlFor = id
                    label.appendChild(document.createTextNode(states[value]))

                    stateCont.appendChild(label)

                    stateSwitchCont.appendChild(stateCont)
                }
            }

            option.appendChild(stateSwitchCont)

            return option
        }

        setupOptions(parent) {
            switch (ftiUtils.getPlatform()) {
                case SUPPORTED_PLATFORMS.bilibili:
                    this.createOptionSection(LOCALES.settings.commentBlockingWords, [
                        this.createSwitchOption(
                            LOCALES.settings.replaceBlockingWordsToSymbols, 
                            LOCALES.settings.replaceBlockingWordsToSymbolsDesc, 
                            "YesOrNo",
                            status => GM_setValue(OPTION_KEYS.replaceBlockingWordsToSymbols, status)
                        )
                    ])

                    break

                default:
                    ftiUtils.warn("there is not any option for the platform")
            }
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
        ftiUtils.log("current platform:", platform)
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
                        if (optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.doNotLookAnyComment) {
                            comments.remove()
                            return
                        }
                        commentObserver.observe(comments.shadowRoot, { childList: true, subtree: true });
                    }

                    const player = document.querySelector('#bilibili-player')
                    if (player) {
                        const bullets = player.querySelector('.bpx-player-row-dm-wrap')
                        if (bullets) {
                            if (optionManager.getOptions(SUPPORTED_PLATFORMS.bilibili).filter.doNotLookAnyBullet) {
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
            ftiUtils.warn("Current platform is not supported. If you see this message, this script probably mistakes an incorrect website, please tell the developer.")
        }

        ftiUtils.log("checking config")
        optionManager.createOptions(ftiUtils.getPlatform(), true)

        let openMenuId = null
        const domObserver = new MutationObserver(() => {
            if (document.body && !openMenuId) {
                const menu = new FtiMenu()
                openMenuId = GM_registerMenuCommand("⚙| 设置/Settings", () => {
                    menu.show()
                })

                ftiUtils.log("menu has been created")
            }

            // observeUgc()
        })
        domObserver.observe(document, { childList: true, subtree: true })

        // Attach CSS
        const style = `
            @import url("https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css");

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
                background-color: rgba(168, 168, 168, 0.6);
                backdrop-filter: blur(30px);
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
                user-select: none;
            }
            .${CLASSNAME_FLAGS.titleCont} h3 {
                font-size: 1.4rem;
                margin: 0;
                flex-grow: 1;
            }
            .${CLASSNAME_FLAGS.titleCont} button {
                color: black;
                padding: 4px;
                width: 2.4em;
                height: 2.4em;
                border-radius: 50%;
                transition-duration: 0.2s;
                background-color: transparent;
                border: none;
            }
            .${CLASSNAME_FLAGS.titleCont} button i {
                font-size: 1.2rem;
            }
            .${CLASSNAME_FLAGS.titleCont} button:hover {
                background-color: rgba(255, 255, 255, 0.6);
            }
            .${CLASSNAME_FLAGS.titleCont} button:active {
                background-color: rgba(255, 255, 255, 0.85);
            }
        `
        let styleElem = document.createElement("style");
        document.head.appendChild(styleElem);
        styleElem.appendChild(document.createTextNode(style))

        ftiUtils.log("ready")
    }
    init()
})(unsafeWindow);