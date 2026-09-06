const params = new URLSearchParams(window.location.search);

const pageMode = params.has("controller")
    ? "controller"
    : params.has("subtitle")
        ? "subtitle"
        : "full";

if (pageMode === "controller") {
    document.body.classList.add("controller-mode");
}

if (pageMode === "subtitle") {
    document.body.classList.add("subtitle-mode");
}

const BROADCAST_CHANNEL_NAME = "lrc-lyrics-controller";

const obs_ch = "BroadcastChannel" in window
    ? new BroadcastChannel(BROADCAST_CHANNEL_NAME)
    : null;

let broadcastConnected = false;

function setBroadcastStatus(connected) {
    broadcastConnected = connected;
    const element = document.getElementById("connectionStatus");

    if (!element) {
        return;
    }

    if (connected) {
        element.textContent = "OBS 已連線";
        element.classList.add("connected");
    } else {
        element.textContent = "OBS 等待中";
        element.classList.remove("connected");
    }
}

function broadcast(type, payload = {}) {
    if (!obs_ch) {
        return;
    }

    obs_ch.postMessage({
        type,
        ...payload
    });
}


class LRCParser {
    static parse(text) {
        const result = [];
        for (const line of text.split(/\r?\n/)) {
            const matches = [
                ...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)
            ];

            if (!matches.length) {
                continue;
            }

            const lyricText = line
                .replace(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g, "")
                .trim();

            for (const match of matches) {
                const minutes = Number(match[1]);
                const seconds = Number(match[2]);
                const milliseconds = match[3] ? Number(match[3].padEnd(3, "0")) : 0;

                result.push({
                    time: minutes * 60 + seconds + milliseconds / 1000,
                    text: lyricText || "♪"
                });
            }
        }

        result.sort((a, b) => a.time - b.time);

        return result;
    }
}

class LRCLIB {
    static baseURL = "https://lrclib.net/api";

    static async get(trackName, artistName = "") {
        const params = new URLSearchParams({ track_name: trackName });

        if (artistName) {
            params.set("artist_name", artistName);
        }

        const response = await fetch(`${this.baseURL}/get?${params}`);

        if (!response.ok) {
            throw new Error(`/get HTTP ${response.status}`);
        }
        return response.json();
    }

    static async search(query) {
        const params = new URLSearchParams({ q: query });

        const response = await fetch(`${this.baseURL}/search?${params}`);

        if (!response.ok) {
            throw new Error(`/search HTTP ${response.status}`);
        }

        return response.json();
    }
}


class LRCPlayer {
    constructor() {
        this.lyrics = [];
        this.currentTime = 0;
        this.offset = 0;
        this.playing = false;
        this.animationFrame = null;
        this.lastFrame = 0;
        this.lineHeight = 52;
        this.effect = "classic";
        this.fontSizeAdjust = 0;
        this.smokeIndex = -1;
        this.smokeDissolving = -1;
        this.smokeSplits = new Map();
        this.verticalIndex = -1;
        this.track = document.getElementById("lyricsTrack");
        this.emptyLyrics = document.getElementById("emptyLyrics");
        this.slots = [];
        this.render();
    }

    load(lrcText, shouldBroadcast = true) {
        this.pause(false);
        this.lyrics = LRCParser.parse(lrcText);
        this.currentTime = 0;
        this.render();
        this.update();
        updatePlayButton();

        if (shouldBroadcast && pageMode !== "subtitle") {
            broadcast("lyrics-load", { lrcText });
        }
    }

    render() {
        if (!this.track) {
            return;
        }

        this.smokeSplits = new Map();
        this.smokeIndex = -1;
        this.verticalIndex = -1;

        this.track.innerHTML = "";
        this.slots = [];
        if (!this.lyrics.length) {
            if (this.emptyLyrics) {
                this.emptyLyrics.style.display = "block";
            }
            return;
        }

        if (this.emptyLyrics) {
            this.emptyLyrics.style.display = "none";
        }

        for (let i = 0; i < this.lyrics.length; i++) {
            const element = document.createElement("div");
            element.className = "lyric-line";
            const text = this.lyrics[i].text;
            element.innerHTML = `
                <span class="lyric-text">
                    <span class="lyric-base">
                        ${escapeHTML(text)}
                    </span>
                    <span class="lyric-fill">
                        ${escapeHTML(text)}
                    </span>
                </span>
            `;

            element.style.top = `${i * this.lineHeight}px`;
            this.track.appendChild(element);
            this.slots.push(element);
        }

        this.track.style.height = `${this.lyrics.length * this.lineHeight}px`;
    }

    setTime(time, shouldBroadcast = true) {
        if (!this.lyrics.length) {
            return;
        }

        const duration = this.getDuration();

        this.currentTime = Math.max(0, Math.min(duration, Number(time) || 0));

        this.update();

        if (
            shouldBroadcast &&
            pageMode !== "subtitle"
        ) {
            broadcast("time", { time: this.currentTime });
        }
    }

    setOffset(value, shouldBroadcast = true) {
        this.offset = Number(value) || 0;
        const duration = this.getDuration();
        this.currentTime = Math.max(0, Math.min(duration, this.currentTime));
        this.update();

        if (shouldBroadcast && pageMode !== "subtitle") {
            broadcast("offset", { offset: this.offset });
        }
    }

    getDuration() {
        if (!this.lyrics.length) {
            return 0;
        }

        return Math.max(0, this.lyrics[this.lyrics.length - 1].time - this.offset);
    }

    getCurrentIndex(time) {
        const adjustedTime = time + this.offset;

        let index = -1;

        for (let i = 0; i < this.lyrics.length; i++) {
            if (this.lyrics[i].time <= adjustedTime) {
                index = i;
            } else {
                break;
            }
        }

        return index;
    }

    getScrollPosition() {
        if (!this.lyrics.length) {
            return 0;
        }

        const adjustedTime = this.currentTime + this.offset;

        if (adjustedTime < this.lyrics[0].time) {
            return 0;
        }

        const currentIndex = this.getCurrentIndex(this.currentTime);

        if (currentIndex < 0) {
            return 0;
        }

        if (currentIndex >= this.lyrics.length - 1) {
            return currentIndex * this.lineHeight;
        }

        const current = this.lyrics[currentIndex];
        const next = this.lyrics[currentIndex + 1];
        const duration = next.time - current.time;
        let progress = 0;
        if (duration > 0) {
            progress = (adjustedTime - current.time) / duration;
            progress = Math.max(0, Math.min(1, progress));
        }

        return (currentIndex + progress) * this.lineHeight;
    }

    update() {
        if (!this.lyrics.length) {
            return;
        }

        const stage = document.getElementById("lyrics");

        if (!stage) {
            return;
        }

        if (this.effect === "vertical") {
            this.track.style.transform = "translateY(0)";
            this.updateLineStylesVertical();
            this.updateTimeline();
            return;
        }

        const center = stage.clientHeight / 2;
        const scrollPosition = this.getScrollPosition();
        const translateY = center - this.lineHeight / 2 - scrollPosition;
        this.track.style.transform = `translateY(${translateY}px)`;
        this.updateLineStyles(scrollPosition);
        this.updateTimeline();
    }

    updateLineStyles(scrollPosition) {
        if (this.effect === "smoke") {
            this.updateLineStylesSmoke();
        } else {
            this.updateLineStylesClassic(scrollPosition);
        }
    }

    getLineProgress(index) {
        const current = this.lyrics[index];
        const next = this.lyrics[index + 1];
        if (!current) {
            return 0;
        }

        if (!next) {
            return 1;
        }

        const duration = next.time - current.time;
        if (duration <= 0) {
            return 1;
        }

        const p = (this.currentTime + this.offset - current.time) / duration;
        return Math.max(0, Math.min(1, p));
    }

    updateLineStylesClassic(scrollPosition) {
        const colorInput = document.getElementById("colorInput");
        const color = colorInput ? colorInput.value : "#7564a6";
        const currentIndex = this.getCurrentIndex(this.currentTime);
        const backgroundColorInput = document.getElementById("backgroundColorInput");
        const baseColor = backgroundColorInput ? backgroundColorInput.value : "#111111";

        for (let i = 0; i < this.slots.length; i++) {
            const element = this.slots[i];
            const position = i * this.lineHeight - scrollPosition;
            const distance = Math.abs(position / this.lineHeight);
            const opacity = Math.max(0.08, 1 - distance * 0.16);
            const blur = Math.min(3, distance * 0.45);
            const isCurrent = i === currentIndex;

            element.classList.remove("smoke-line");
            element.style.transform = "";
            element.style.setProperty("--smoke-blur", "0px");
            element.style.opacity = opacity;
            element.style.filter = `blur(${blur}px)`;

            const base = element.querySelector(".lyric-base");
            const fill = element.querySelector(".lyric-fill");

            if (isCurrent) {
                element.style.fontSize = `${30 + this.fontSizeAdjust}px`;
                element.style.fontWeight = "700";
                base.style.color = baseColor;
                fill.style.color = color;

                fill.style.width = `${this.getLineProgress(currentIndex) * 100}%`;
            } else {
                element.style.fontSize = `${21 + this.fontSizeAdjust}px`;
                element.style.fontWeight = "400";
                fill.style.width = "0%";
                base.style.color = baseColor;
            }
        }
    }

    ensureSmokeChars(index) {
        if (this.smokeSplits.has(index)) {
            return this.smokeSplits.get(index);
        }

        const element = this.slots[index];
        const base = element.querySelector(".lyric-base");
        const text = this.lyrics[index].text;

        base.innerHTML = "";
        const chars = [];
        for (const ch of text) {
            const span = document.createElement("span");
            span.className = "smoke-char";
            span.textContent = ch === " " ? "\u00a0" : ch;
            base.appendChild(span);
            chars.push(span);
        }

        this.smokeSplits.set(index, chars);
        return chars;
    }

    updateLineStylesSmoke() {
        const colorInput = document.getElementById("colorInput");
        const color = colorInput ? colorInput.value : "#000000";
        const currentIndex = this.getCurrentIndex(this.currentTime);

        for (let i = 0; i < this.slots.length; i++) {
            const element = this.slots[i];
            const base = element.querySelector(".lyric-base");
            const fill = element.querySelector(".lyric-fill");

            fill.style.width = "0%";
            base.style.color = color;
            element.classList.add("smoke-line");
            element.style.fontSize = `${34 + this.fontSizeAdjust}px`;
            element.style.fontWeight = "600";
            if (i !== currentIndex && i !== this.smokeDissolving) {
                element.style.opacity = "0";
                element.style.transform = "";
                element.style.setProperty("--smoke-blur", "0px");
            }
        }

        if (currentIndex !== this.smokeIndex) {
            const prev = this.smokeIndex;
            this.smokeIndex = currentIndex;
            this.animateSmokeTransition(prev, currentIndex);
        }
    }

    animateSmokeTransition(prevIndex, nextIndex) {
        const A = window.anime;
        if (A && prevIndex >= 0 && prevIndex < this.slots.length) {
            const chars = this.ensureSmokeChars(prevIndex);
            const dissolvingLine = prevIndex;
            this.smokeDissolving = dissolvingLine;
            this.slots[prevIndex].style.opacity = "1";

            A.animate(chars, {
                translateY: () => -25 - Math.random() * 35,
                translateX: () => (Math.random() - 0.5) * 14,
                scale: () => 1 + Math.random() * 0.12,
                rotate: () => (Math.random() - 0.5) * 12,
                filter: ["blur(0px)", "blur(2px)", "blur(8px)"],
                opacity: [1, 0.85, 0.45, 0],
                duration: 1500,
                delay: A.stagger(45),
                ease: "outQuad",
                onComplete: () => {
                    if (this.smokeDissolving === dissolvingLine) {
                        this.smokeDissolving = -1;
                    }
                    if (this.slots[dissolvingLine] && this.smokeIndex !== dissolvingLine) {
                        this.slots[dissolvingLine].style.opacity = "0";
                    }
                }
            });
        } else if (prevIndex >= 0 && prevIndex < this.slots.length) {
            this.slots[prevIndex].style.opacity = "0";
        }

        if (nextIndex >= 0 && nextIndex < this.slots.length) {
            const element = this.slots[nextIndex];
            const chars = this.ensureSmokeChars(nextIndex);

            element.style.opacity = "1";
            element.style.transform = "";
            element.style.setProperty("--smoke-blur", "0px");

            const hasDissolving = prevIndex >= 0 && prevIndex < this.slots.length;
            const startDelay = hasDissolving ? 500 : 0;

            if (A) {
                A.utils.remove(chars);
                A.animate(chars, {
                    translateY: [() => -20 - Math.random() * 40, 0],
                    translateX: [() => (Math.random() - 0.5) * 40, 0],
                    scale: [() => 1 + Math.random() * 0.4, 1],
                    rotate: [() => (Math.random() - 0.5) * 30, 0],
                    filter: ["blur(10px)", "blur(0px)"],
                    opacity: [0, 1],
                    duration: 900,
                    delay: A.stagger(35, { start: startDelay }),
                    ease: "outCubic"
                });
            } else {
                for (const span of chars) {
                    span.style.transform = "";
                    span.style.filter = "";
                    span.style.opacity = "1";
                }
            }
        }
    }

    updateLineStylesVertical() {
        const colorInput = document.getElementById("colorInput");
        const color = colorInput ? colorInput.value : "#000000";
        const currentIndex = this.getCurrentIndex(this.currentTime);

        for (let i = 0; i < this.slots.length; i++) {
            const element = this.slots[i];
            const base = element.querySelector(".lyric-base");
            const fill = element.querySelector(".lyric-fill");

            fill.style.width = "0%";
            base.style.color = color;

            element.classList.add("vertical-line");
            element.classList.remove("smoke-line");
            element.style.setProperty("--smoke-blur", "0px");
            element.style.fontSize = `${40 + this.fontSizeAdjust}px`;
            element.style.fontWeight = "";
            element.style.top = "";

            const side = i % 2 === 0 ? "right" : "left";
            element.classList.toggle("vertical-right", side === "right");
            element.classList.toggle("vertical-left", side === "left");

            if (i !== currentIndex) {
                element.style.opacity = "0";
                element.style.transform = "";
            }
        }

        if (currentIndex !== this.verticalIndex) {
            this.verticalIndex = currentIndex;
            this.animateVerticalType(currentIndex);
        }
    }

    ensureVerticalChars(index) {
        if (this.smokeSplits.has(index)) {
            return this.smokeSplits.get(index);
        }

        const element = this.slots[index];
        const base = element.querySelector(".lyric-base");
        const text = this.lyrics[index].text;

        const breakers = new Set([
            " ", "\u3000", ",", ".", "!", "?", ";", ":",
            "，", "。", "！", "？", "、", "；", "：", "…"
        ]);

        base.innerHTML = "";
        const chars = [];
        let col = null;
        let colIndex = 0;

        const newColumn = () => {
            col = document.createElement("span");
            col.className = "vertical-col";
            col.style.setProperty("--col-offset", `${colIndex * 34}px`);
            base.appendChild(col);
            colIndex++;
        };

        newColumn();

        for (const ch of text) {
            const span = document.createElement("span");
            span.className = "smoke-char";
            const isBreaker = breakers.has(ch);
            span.textContent = ch === " " || ch === "\u3000" ? "\u00a0" : ch;
            col.appendChild(span);
            chars.push(span);

            if (isBreaker) {
                newColumn();
            }
        }

        this.smokeSplits.set(index, chars);
        return chars;
    }

    animateVerticalType(index) {
        if (index < 0 || index >= this.slots.length) {
            return;
        }

        const A = window.anime;
        const element = this.slots[index];
        const chars = this.ensureVerticalChars(index);
        const jitterX = (Math.random() - 0.5) * 70;
        const jitterY = (Math.random() - 0.5) * 110;

        element.style.opacity = "1";
        element.style.transform = `translate(${jitterX}px, ${jitterY}px)`;

        if (A) {
            A.utils.remove(chars);
            A.utils.set(chars, { opacity: 0, translateY: 0, translateX: 0, scale: 1 });
            A.animate(chars, {
                opacity: [0, 1],
                duration: 90,
                delay: A.stagger(55),
                ease: "steps(1)"
            });
        } else {
            for (const span of chars) {
                span.style.opacity = "1";
            }
        }
    }

    play(shouldBroadcast = true) {
        if (!this.lyrics.length) {
            return;
        }

        if (this.playing) {
            return;
        }

        if (this.currentTime >= this.getDuration()) {
            this.currentTime = 0;
        }

        this.playing = true;
        this.lastFrame = performance.now();

        this.tick();

        updatePlayButton();

        if (shouldBroadcast && pageMode !== "subtitle") {
            broadcast("play");
        }
    }

    pause(shouldBroadcast = true) {
        this.playing = false;

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        updatePlayButton();

        if (shouldBroadcast && pageMode !== "subtitle") {
            broadcast("pause");
        }
    }

    tick() {
        if (!this.playing) {
            return;
        }

        const now = performance.now();
        const delta = (now - this.lastFrame) / 1000;

        this.lastFrame = now;
        this.currentTime += delta;

        const duration = this.getDuration();

        if (this.currentTime >= duration) {
            this.currentTime = duration;
            this.update();
            this.pause();
            return;
        }

        this.update();

        this.animationFrame = requestAnimationFrame(() => this.tick());
    }

    updateTimeline() {
        const timeline = document.getElementById("timeline");
        const thumb = document.getElementById("timelineThumb");
        const progress = document.getElementById("timelineProgress");
        const timeElement = document.getElementById("timelineTime");

        if (!timeline || !thumb || !progress || !timeElement) {
            return;
        }

        const duration = this.getDuration();
        const height = timeline.clientHeight;
        const usableHeight = Math.max(1, height - 60);
        const ratio = duration > 0 ? this.currentTime / duration : 0;
        const top = 30 + ratio * usableHeight;

        thumb.style.top = `${top}px`;
        progress.style.height = `${Math.max(0, top - 30)}px`;
        timeElement.style.top = `${top}px`;
        timeElement.textContent = this.formatTime(this.currentTime);
    }

    formatTime(seconds) {
        seconds = Math.max(0, seconds);

        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);

        return `${String(minutes).padStart(2, "0")}:` + `${String(secs).padStart(2, "0")}`;
    }
}


const player = new LRCPlayer();
const stage = document.getElementById("stage");
const backgroundColorInput = document.getElementById("backgroundColorInput");


if (backgroundColorInput) {
    backgroundColorInput.addEventListener("input", event => {
        const color = event.target.value;
        stage.style.setProperty("--lyrics-base-color", color);
        player.update();
        broadcast("background-color", { color });
    });
}

let playbackMode = "sync";

const modeButton = document.getElementById("modeButton");


function updatePlaybackModeUI() {
    if (!modeButton) {
        return;
    }

    modeButton.textContent = playbackMode === "sync" ? "同步播放" : "歌詞播放";

    updatePlayButton();
}


if (modeButton) {
    modeButton.addEventListener("click", () => {
        player.pause();

        if (playbackMode === "sync") {
            playbackMode = "lyrics";
        } else {
            playbackMode = "sync";
        }

        updatePlaybackModeUI();

        broadcast("playback-mode", { mode: playbackMode });
    });
}

const songInput = document.getElementById("songInput");
const searchButton = document.getElementById("searchButton");
const lyricResults = document.getElementById("lyricResults");


async function searchLyrics() {
    const query = songInput.value.trim();

    if (!query) {
        return;
    }

    searchButton.disabled = true;

    lyricResults.innerHTML = `
        <div style="color:#666;">
            搜尋中...
        </div>
    `;

    try {
        try {
            const result = await LRCLIB.get(query);

            if (result && result.syncedLyrics) {
                showLyricResults([result]);
                return;
            }
        } catch { }

        const results = await LRCLIB.search(query);

        showLyricResults(results);
    } catch (error) {
        console.error(error);

        lyricResults.innerHTML = `
            <div style="color:#777;">
                搜尋失敗
            </div>
        `;
    } finally {
        searchButton.disabled = false;
    }
}

if (searchButton) {
    searchButton.addEventListener("click", searchLyrics);
}

if (songInput) {
    songInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            searchLyrics();
        }
    });
}

const customLrcButton = document.getElementById("customLrcButton");
const customLrcInput = document.getElementById("customLrcInput");
const customLrcName = document.getElementById("customLrcName");


if (customLrcButton) {
    customLrcButton.addEventListener("click", () => {
        customLrcInput.click();
    });
}

if (customLrcInput) {
    customLrcInput.addEventListener("change", async event => {
        const file = event.target.files?.[0];

        if (!file) {
            return;
        }

        try {
            const lrcText = await file.text();
            const lyrics = LRCParser.parse(lrcText);

            if (!lyrics.length) {
                customLrcName.textContent = "無效的 LRC 檔案";
                return;
            }

            player.load(lrcText);

            customLrcName.textContent = file.name;

            document
                .querySelectorAll(".lyric-result")
                .forEach(item => item.classList.remove("active"));
        } catch (error) {
            console.error("LRC 讀取失敗：", error);

            customLrcName.textContent = "LRC 讀取失敗";
        }

        event.target.value = "";
    });
}

function showLyricResults(results) {
    lyricResults.innerHTML = "";

    const validResults = results.filter(item => item.syncedLyrics);

    if (!validResults.length) {
        lyricResults.innerHTML = `
            <div style="color:#666;">
                找不到同步歌詞
            </div>
        `;

        return;
    }

    validResults.forEach(item => {
        const element = document.createElement("div");

        element.className = "lyric-result";

        element.innerHTML = `
                <div class="lyric-result-title">
                    ${escapeHTML(item.trackName || "Unknown")}
                </div>

                <div class="lyric-result-artist">
                    ${escapeHTML(item.artistName || "Unknown")}
                </div>
            `;

        element.addEventListener("click", () => {
            document
                .querySelectorAll(".lyric-result")
                .forEach(item => item.classList.remove("active"));

            element.classList.add("active");

            player.load(item.syncedLyrics);

            if (
                playbackMode === "sync" &&
                youtubePlayer &&
                youtubeReady &&
                youtubeHasVideo
            ) {
                player.setTime(youtubePlayer.getCurrentTime());
            }
        });

        lyricResults.appendChild(element);

        if (validResults.length === 1) {
            element.click();
        }
    });
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function hexToRGB(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);

    if (!match) {
        return null;
    }

    return {
        r: parseInt(match[1], 16),
        g: parseInt(match[2], 16),
        b: parseInt(match[3], 16)
    };
}


const fontSelect = document.getElementById("fontSelect");
const GOOGLE_FONTS = {
    "Noto Sans TC": "Noto+Sans+TC:wght@400;700",
    "Noto Serif TC": "Noto+Serif+TC:wght@400;700",
    "Noto Sans HK": "Noto+Sans+HK:wght@400;700",
    "Noto Serif HK": "Noto+Serif+HK:wght@400;700",
    "LXGW WenKai TC": "LXGW+WenKai+TC",
    "LXGW WenKai Mono TC": "LXGW+WenKai+Mono+TC",
    "Cactus Classical Serif": "Cactus+Classical+Serif",
    "Ma Shan Zheng": "Ma+Shan+Zheng",
    "Liu Jian Mao Cao": "Liu+Jian+Mao+Cao",
    "Long Cang": "Long+Cang",
    "Zhi Mang Xing": "Zhi+Mang+Xing",
    "ZCOOL KuaiLe": "ZCOOL+KuaiLe",
    "ZCOOL XiaoWei": "ZCOOL+XiaoWei",
    "ZCOOL QingKe HuangYou": "ZCOOL+QingKe+HuangYou"
};

const loadedGoogleFonts = new Set();
function ensureGoogleFont(fontFamily) {
    if (!fontFamily) {
        return;
    }

    const first = fontFamily.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    const query = GOOGLE_FONTS[first];

    if (!query || loadedGoogleFonts.has(first)) {
        return;
    }

    loadedGoogleFonts.add(first);

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
    document.head.appendChild(link);
}

if (fontSelect) {
    fontSelect.addEventListener("change", event => {
        const font = event.target.value;

        ensureGoogleFont(font);
        document.getElementById("lyrics").style.fontFamily = font;

        broadcast("font", { font });
    });
}

const fontSizeMinus = document.getElementById("fontSizeMinus");
const fontSizePlus = document.getElementById("fontSizePlus");

function setFontSizeAdjust(value, shouldBroadcast = true) {
    const adjust = Math.max(-20, Math.min(40, Math.round(Number(value) || 0)));
    player.fontSizeAdjust = adjust;
    player.update();

    if (shouldBroadcast && pageMode !== "subtitle") {
        broadcast("font-size", { adjust });
    }
}

if (fontSizeMinus) {
    fontSizeMinus.addEventListener("click", () => {
        setFontSizeAdjust(player.fontSizeAdjust - 1);
    });
}

if (fontSizePlus) {
    fontSizePlus.addEventListener("click", () => {
        setFontSizeAdjust(player.fontSizeAdjust + 1);
    });
}

const colorInput = document.getElementById("colorInput");

if (colorInput) {
    colorInput.addEventListener("input", () => {
        player.update();

        broadcast("color", { color: colorInput.value });
    });
}

const effectSelect = document.getElementById("effectSelect");

if (effectSelect) {
    effectSelect.addEventListener("change", () => {
        player.effect = effectSelect.value;
        player.render();
        player.update();
        broadcast("effect", { effect: effectSelect.value });
    });
}

const offsetSlider = document.getElementById("offsetSlider");
const offsetValue = document.getElementById("offsetValue");

if (offsetSlider) {
    offsetSlider.addEventListener("input", event => {
        const value = Number(event.target.value);
        player.setOffset(value);
        offsetValue.textContent = `${value > 0 ? "+" : ""}${value.toFixed(1)}s`;
    });
}

const timeline = document.getElementById("timeline");
const timelineThumb = document.getElementById("timelineThumb");
let draggingTimeline = false;

function updateTimeFromPointer(clientY) {
    if (!player.lyrics.length) {
        return;
    }
    const rect = timeline.getBoundingClientRect();
    const height = rect.height;
    const usableHeight = Math.max(1, height - 60);
    const y = Math.max(30, Math.min(height - 30, clientY - rect.top));
    const ratio = (y - 30) / usableHeight;
    const time = player.getDuration() * ratio;
    player.setTime(time);

    if (
        playbackMode === "sync" &&
        youtubePlayer &&
        youtubeReady &&
        youtubeHasVideo
    ) {
        youtubePlayer.seekTo(time, true);
    }
}


if (timelineThumb) {
    timelineThumb.addEventListener("pointerdown", event => {
        draggingTimeline = true;
        timelineThumb.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    timelineThumb.addEventListener("pointermove", event => {
        if (!draggingTimeline) {
            return;
        }
        updateTimeFromPointer(event.clientY);
    });

    timelineThumb.addEventListener("pointerup", event => {
        draggingTimeline = false;
        timelineThumb.releasePointerCapture?.(event.pointerId);
    });
}

if (timeline) {
    timeline.addEventListener("pointerdown", event => {
        if (event.target === timelineThumb) {
            return;
        }
        updateTimeFromPointer(event.clientY);
    });
}

const playButton = document.getElementById("playButton");
if (playButton) {
    playButton.addEventListener("click", () => {
        if (playbackMode === "sync") {
            if (youtubePlayer && youtubeReady && youtubeHasVideo) {
                const state = youtubePlayer.getPlayerState();

                if (state === YT.PlayerState.PLAYING) {
                    youtubePlayer.pauseVideo();
                } else {
                    const currentTime = youtubePlayer.getCurrentTime();

                    if (Number.isFinite(currentTime)) {
                        player.setTime(currentTime);
                    }

                    youtubePlayer.playVideo();
                }
                return;
            }

            if (player.playing) {
                player.pause();
            } else {
                player.play();
            }
            updatePlayButton();
            return;
        }

        if (player.playing) {
            player.pause();
        } else {
            player.play();
        }
        updatePlayButton();
    });
}

function updatePlayButton() {
    if (!playButton) {
        return;
    }

    if (playbackMode === "lyrics") {
        playButton.textContent = player.playing ? "⏸" : "▶";
        updateControllerYouTubeButton();
        return;
    }

    if (youtubePlayer && youtubeReady && youtubeHasVideo) {
        const state = youtubePlayer.getPlayerState();
        playButton.textContent = state === YT.PlayerState.PLAYING ? "⏸" : "▶";
    } else {
        playButton.textContent = player.playing ? "⏸" : "▶";
    }

    updateControllerYouTubeButton();
}

const resetButton = document.getElementById("resetButton");

if (resetButton) {
    resetButton.addEventListener("click", () => {
        player.pause();
        player.setTime(0);

        if (
            playbackMode === "sync" &&
            youtubePlayer &&
            youtubeReady &&
            youtubeHasVideo
        ) {
            youtubePlayer.seekTo(0, true);
        }

        updateYouTubeTime();
        updatePlayButton();
        broadcast("reset");
    });
}

const sidebar = document.getElementById("sidebar");
const sidebarResizer = document.getElementById("sidebarResizer");
const app = document.querySelector(".app");
let resizingSidebar = false;

if (sidebarResizer) {
    sidebarResizer.addEventListener("pointerdown", event => {
        resizingSidebar = true;
        sidebarResizer.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    sidebarResizer.addEventListener("pointermove", event => {
        if (!resizingSidebar) {
            return;
        }

        const rect = app.getBoundingClientRect();
        let width = event.clientX - rect.left;
        width = Math.max(180, Math.min(500, width));

        if (pageMode === "controller") {
            app.style.gridTemplateColumns = `${width}px minmax(420px, 1fr) 70px`;
        } else {
            app.style.gridTemplateColumns = `${width}px minmax(0, 1fr) 70px`;
        }

        player.update();
    });

    sidebarResizer.addEventListener("pointerup", () => {
        resizingSidebar = false;
    });

    sidebarResizer.addEventListener("pointercancel", () => {
        resizingSidebar = false;
    });
}

window.addEventListener("resize", () => {
    player.update();
});

let youtubePlayer = null;
let youtubeReady = false;
let youtubeHasVideo = false;
let youtubeSyncTimer = null;
let youtubePlayerCreated = false;

const controllerYoutubeInput = document.getElementById("controllerYoutubeInput");
const controllerYoutubeLoadButton = document.getElementById("controllerYoutubeLoadButton");
const controllerYoutubePlayButton = document.getElementById("controllerYoutubePlayButton");
const controllerYoutubeTime = document.getElementById("controllerYoutubeTime");
const youtubeVideoInfo = document.getElementById("youtubeVideoInfo");


function createYouTubePlayer() {

    if (youtubePlayerCreated) {
        return;
    }

    if (
        typeof YT === "undefined" ||
        typeof YT.Player === "undefined"
    ) {

        return;
    }

    youtubePlayerCreated = true;
    const target = pageMode === "controller" ? "controllerYoutubePlayer" : "youtubePlayer";

    youtubePlayer = new YT.Player(target, {
        width: "100%",
        height: "100%",
        playerVars: {
            playsinline: 1,
            controls: 1,
            rel: 0,
            origin: window.location.origin
        },

        events: {
            onReady: onYouTubeReady,
            onStateChange: onYouTubeStateChange,
            onError: onYouTubeError
        }
    });
}

window.onYouTubeIframeAPIReady = () => {
    createYouTubePlayer();
};

function onYouTubeReady() {
    youtubeReady = true;
    updatePlayButton();
}

function onYouTubeError(event) {
    console.error("YouTube Player Error:", event.data);
    youtubeHasVideo = false;
    stopYouTubeSync();
    updatePlayButton();
}

function onYouTubeStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
        youtubeHasVideo = true;
        if (playbackMode === "sync") {
            startYouTubeSync();
        } else {
            stopYouTubeSync();
        }

        broadcast("youtube-state", { state: "playing" });
        updatePlayButton();
        return;
    }

    if (event.data === YT.PlayerState.PAUSED) {
        stopYouTubeSync();
        if (playbackMode === "sync") {
            player.pause();
        }
        broadcast("youtube-state", { state: "paused" });
        updatePlayButton();
        return;
    }

    if (event.data === YT.PlayerState.ENDED) {
        stopYouTubeSync();
        if (playbackMode === "sync") {
            player.pause();
        }
        broadcast("youtube-state", { state: "ended" });
        updatePlayButton();
        return;
    }

    if (event.data === YT.PlayerState.CUED) {
        youtubeHasVideo = true;
        updateYouTubeTime();
        if (playbackMode === "sync") {
            player.setTime(0);
        }
        updatePlayButton();
    }
}

function startYouTubeSync() {
    stopYouTubeSync();
    if (playbackMode !== "sync") {
        return;
    }

    youtubeSyncTimer = setInterval(syncYouTubeTime, 30);
    syncYouTubeTime();
}

function stopYouTubeSync() {
    if (youtubeSyncTimer) {
        clearInterval(youtubeSyncTimer);
        youtubeSyncTimer = null;
    }
}

function syncYouTubeTime() {
    if (playbackMode !== "sync") {
        stopYouTubeSync();
        return;
    }

    if (!youtubePlayer || !youtubeReady || !youtubeHasVideo) {
        return;
    }
    const currentTime = youtubePlayer.getCurrentTime();

    if (!Number.isFinite(currentTime)) {
        return;
    }
    player.setTime(currentTime);
    updateYouTubeTime();
}

function updateYouTubeTime() {
    if (!youtubePlayer || !youtubeReady) {
        return;
    }
    const current = youtubePlayer.getCurrentTime();
    const duration = youtubePlayer.getDuration();

    if (!Number.isFinite(current) || !Number.isFinite(duration)) {
        return;
    }

    const text = `${formatYouTubeTime(current)} / ${formatYouTubeTime(duration)}`;
    const element = document.getElementById("youtubeTime");

    if (element) {
        element.textContent = text;
    }

    if (controllerYoutubeTime) {
        controllerYoutubeTime.textContent = text;
    }
}


function formatYouTubeTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:` + `${String(secs).padStart(2, "0")}`;
}

function getYouTubeVideoId(value) {
    const input = value.trim();
    if (!input) {
        return null;
    }

    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
        return input;
    }

    try {
        const url = new URL(input);
        const hostname = url.hostname.toLowerCase();

        if (
            hostname === "www.youtube.com" ||
            hostname === "youtube.com" ||
            hostname === "m.youtube.com"
        ) {
            const id = url.searchParams.get("v");

            if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
                return id;
            }

            const embedMatch = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
            if (embedMatch) {
                return embedMatch[1];
            }

            const shortsMatch = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
            if (shortsMatch) {
                return shortsMatch[1];
            }
        }

        if (hostname === "youtu.be") {
            const id = url.pathname.slice(1).split("/")[0];
            if (/^[a-zA-Z0-9_-]{11}$/.test(id)) {
                return id;
            }
        }
    } catch { }

    return null;
}

function loadYouTubeVideo(inputValue) {
    if (!youtubePlayer || !youtubeReady) {
        return;
    }

    const videoId = getYouTubeVideoId(inputValue);
    if (!videoId) {
        return;
    }

    youtubeHasVideo = false;
    stopYouTubeSync();
    youtubePlayer.cueVideoById(videoId);
    if (youtubeVideoInfo) {
        youtubeVideoInfo.textContent = videoId;
    }

    broadcast("youtube-load", { videoId });
}

const youtubeInput = document.getElementById("youtubeInput");
const youtubeLoadButton = document.getElementById("youtubeLoadButton");

if (youtubeLoadButton) {
    youtubeLoadButton.addEventListener("click", () => {
        loadYouTubeVideo(youtubeInput.value);
    });
}

if (youtubeInput) {
    youtubeInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            youtubeLoadButton.click();
        }
    });
}

const youtubePlayButton = document.getElementById("youtubePlayButton");
if (youtubePlayButton) {
    youtubePlayButton.addEventListener("click", () => {
        if (!youtubePlayer || !youtubeReady) {
            return;
        }

        const state = youtubePlayer.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
            youtubePlayer.pauseVideo();
        } else {
            youtubePlayer.playVideo();
        }
    });
}

if (controllerYoutubeLoadButton) {
    controllerYoutubeLoadButton.addEventListener("click", () => {
        loadYouTubeVideo(controllerYoutubeInput.value);
    });
}

if (controllerYoutubeInput) {
    controllerYoutubeInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            controllerYoutubeLoadButton.click();
        }
    });
}

if (controllerYoutubePlayButton) {
    controllerYoutubePlayButton.addEventListener("click", () => {
        if (!youtubePlayer || !youtubeReady || !youtubeHasVideo) {
            return;
        }

        const state = youtubePlayer.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
            youtubePlayer.pauseVideo();
        } else {
            youtubePlayer.playVideo();
        }
    });
}


function updateControllerYouTubeButton() {
    if (!controllerYoutubePlayButton) {
        return;
    }

    if (youtubePlayer && youtubeReady && youtubeHasVideo) {
        const state = youtubePlayer.getPlayerState();
        controllerYoutubePlayButton.textContent = state === YT.PlayerState.PLAYING ? "⏸" : "▶";
    } else {
        controllerYoutubePlayButton.textContent = "▶";
    }
}

if (typeof YT !== "undefined" && typeof YT.Player !== "undefined") {
    createYouTubePlayer();
}

if (obs_ch) {
    obs_ch.onmessage = event => {
        const message = event.data;
        if (!message || typeof message.type !== "string") {
            return;
        }
        setBroadcastStatus(true);
        switch (message.type) {
            case "lyrics-load":
                if (pageMode === "subtitle") {
                    player.load(message.lrcText, false);
                }
                break;

            case "time":
                if (pageMode === "subtitle") {
                    player.setTime(Number(message.time), false);
                }
                break;

            case "play":
                if (pageMode === "subtitle") {
                    player.play(false);
                }
                break;

            case "pause":
                if (pageMode === "subtitle") {
                    player.pause(false);
                }
                break;

            case "offset":
                if (pageMode === "subtitle") {
                    player.setOffset(Number(message.offset), false);
                }
                break;

            case "font":
                if (pageMode === "subtitle") {
                    ensureGoogleFont(message.font);
                    const lyrics = document.getElementById("lyrics");
                    lyrics.style.fontFamily = message.font;
                }
                break;

            case "font-size":
                if (pageMode === "subtitle") {
                    setFontSizeAdjust(Number(message.adjust), false);
                }
                break;

            case "effect":
                if (pageMode === "subtitle") {
                    player.effect = message.effect;

                    if (effectSelect) {
                        effectSelect.value = message.effect;
                    }
                    player.render();
                    player.update();
                }
                break;

            case "color":
                if (pageMode === "subtitle") {
                    if (colorInput) {
                        colorInput.value = message.color;
                    }
                    player.update();
                }
                break;

            case "background-color":
                if (pageMode === "subtitle") {
                    if (backgroundColorInput) {
                        backgroundColorInput.value = message.color;
                    }
                    player.update();
                }
                break;

            case "playback-mode":
                if (pageMode === "subtitle") {
                    playbackMode = message.mode;

                    updatePlaybackModeUI();
                }
                break;

            case "youtube-load":
                break;

            case "reset":
                if (pageMode === "subtitle") {
                    player.pause(false);
                    player.setTime(0, false);
                }
                break;

            case "request-state":
                if (pageMode !== "subtitle") {
                    broadcast("state", {
                        lrcText: buildCurrentLRC(),
                        time: player.currentTime,
                        offset: player.offset,
                        color: colorInput ? colorInput.value : "#7564a6",
                        backgroundColor: backgroundColorInput
                            ? backgroundColorInput.value
                            : "#111111",
                        font: fontSelect ? fontSelect.value : "Arial",
                        fontSizeAdjust: player.fontSizeAdjust,
                        effect: effectSelect ? effectSelect.value : "classic",
                        mode: playbackMode,
                        playing: player.playing
                    });
                }
                break;

            case "state":
                if (pageMode === "subtitle") {
                    applyRemoteState(message);
                }
                break;
        }
    };

    setBroadcastStatus(false);
}

function buildCurrentLRC() {
    if (!player.lyrics.length) {
        return "";
    }
    return player.lyrics
        .map(line => `[${formatLRCTime(line.time)}]${line.text}`)
        .join("\n");
}

function formatLRCTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds - minutes * 60;
    return `${String(minutes).padStart(2, "0")}:` + `${remaining.toFixed(3).padStart(6, "0")}`;
}

function applyRemoteState(state) {
    if (state.lrcText) {
        player.load(state.lrcText, false);
    }

    if (Number.isFinite(Number(state.offset))) {
        player.setOffset(Number(state.offset), false);
    }

    if (state.color && colorInput) {
        colorInput.value = state.color;
        player.update();
    }

    if (state.backgroundColor) {
        if (backgroundColorInput) {
            backgroundColorInput.value = state.backgroundColor;
        }
        player.update();
    }

    if (state.font) {
        ensureGoogleFont(state.font);
        document.getElementById("lyrics").style.fontFamily = state.font;
        if (fontSelect) {
            fontSelect.value = state.font;
        }
    }

    if (Number.isFinite(Number(state.fontSizeAdjust))) {
        setFontSizeAdjust(Number(state.fontSizeAdjust), false);
    }

    if (state.effect) {
        player.effect = state.effect;
        if (effectSelect) {
            effectSelect.value = state.effect;
        }
    }

    if (state.mode) {
        playbackMode = state.mode;
        updatePlaybackModeUI();
    }

    if (Number.isFinite(Number(state.time))) {
        player.setTime(Number(state.time), false);
    }

    if (state.playing) {
        player.play(false);
    } else {
        player.pause(false);
    }
}


if (pageMode === "subtitle") {
    setTimeout(() => {
        broadcast("request-state");
    }, 200);
}

updatePlaybackModeUI();

