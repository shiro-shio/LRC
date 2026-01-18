let lyrics = [];
let currentTime = 0;
let isPlaying = false;
let timer = null;

const lrcListEl = document.getElementById('lrc-list');
const timeDisplay = document.getElementById('time-display');
const progressEl = document.getElementById('progress');

/** 1. 解析 LRC 字串 **/
function parseLrc(content) {
    lyrics = content.split('\n').map(line => {
        const match = line.match(/\[(\d+):(\d+\.\d+)\](.*)/);
        if (match) {
            return { 
                time: parseInt(match[1]) * 60 + parseFloat(match[2]), 
                text: match[3].trim() 
            };
        }
        return null;
    }).filter(item => item && item.text);

    if (lyrics.length > 0) {
        progressEl.max = lyrics[lyrics.length - 1].time + 5;
        renderLyrics();
    }
}

/** 2. 渲染到 HTML **/
function renderLyrics() {
    lrcListEl.innerHTML = lyrics.map((line, index) => 
        `<p class="lrc-line" id="line-${index}">${line.text}</p>`
    ).join('');
}

/** 3. 播放控制 **/
function togglePlay() {
    isPlaying = !isPlaying;
    const btn = document.getElementById('play-btn');
    btn.textContent = isPlaying ? "暫停" : "播放";
    
    if (isPlaying) {
        timer = setInterval(() => {
            currentTime += 0.1;
            if (currentTime > progressEl.max) {
                currentTime = 0;
                togglePlay();
            }
            updateSync();
        }, 100);
    } else {
        clearInterval(timer);
    }
}

function seek(val) {
    currentTime = parseFloat(val);
    updateSync();
}

/** 4. 同步滾動邏輯 **/
function updateSync() {
    // 更新介面數值
    progressEl.value = currentTime;
    const m = Math.floor(currentTime / 60).toString().padStart(2, '0');
    const s = Math.floor(currentTime % 60).toString().padStart(2, '0');
    timeDisplay.textContent = `${m}:${s}`;

    // 套用偏移植計算
    const offset = parseFloat(document.getElementById('offset').value) || 0;

    const offsetInput = document.getElementById('offset');
    const offsetRInput = document.getElementById('offset-r');
    offsetInput.addEventListener('input', () => {
        offsetRInput.value = offsetInput.value;
    });
    offsetRInput.addEventListener('input', () => {
        offsetInput.value = offsetRInput.value;
    });

    const adjustedTime = currentTime + parseFloat(offsetInput.value) || 0;

    // 找出目前應該高亮的歌詞索引
    const index = lyrics.findIndex((item, i) => {
        return adjustedTime >= item.time && (!lyrics[i + 1] || adjustedTime < lyrics[i + 1].time);
    });

    if (index !== -1) {
        // 更新高亮類名
        document.querySelectorAll('.lrc-line').forEach(el => el.classList.remove('active'));
        const activeLine = document.getElementById(`line-${index}`);
        
        if (activeLine) {
            activeLine.classList.add('active');
            // 核心滾動計算：讓 active 行保持在容器中心 (160px 為偏移量)
            const scrollPos = activeLine.offsetTop - 130;
            lrcListEl.style.transform = `translateY(${-scrollPos}px)`;
        }
    }
}
//https://raw.githubusercontent.com/shiro-shio/LRC/refs/heads/main/zh/%E5%8C%BF%E5%90%8D%E7%9A%84%E5%A5%BD%E5%8F%8B
/** 5. 外部資料載入 **/
async function fetchLrc() {
    const url = document.getElementById('lrc-url').value;
    if (!url) return;
    try {
        const response = await fetch(url);
        const text = await response.text();
        parseLrc(text);
    } catch (err) {
        alert("URL 載入失敗。請確認 URL 支援 CORS 或改用本地上傳。");
    }
}

function loadLocalLrc(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        parseLrc(e.target.result);
        currentTime = 0;
        updateSync();
    };
    reader.readAsText(file);
}
// 取得控制元件
const fontSizeInput = document.getElementById('fontSize');
const fontColorInput = document.getElementById('fontColor');
const activeColorInput = document.getElementById('activeColor');
const shadowColorInput = document.getElementById('shadowColor');
const sizeValDisplay = document.getElementById('size-val');

// 更新 CSS 變數的函式
function updateRootVariable(property, value) {
    document.documentElement.style.setProperty(property, value);
}

// 監聽事件
fontSizeInput.addEventListener('input', (e) => {
    const val = e.target.value + 'rem';
    updateRootVariable('--lyrics-font-size', val);
    sizeValDisplay.textContent = e.target.value;
});

fontColorInput.addEventListener('input', (e) => {
    updateRootVariable('--lyrics-font-color', e.target.value);
});

activeColorInput.addEventListener('input', (e) => {
    updateRootVariable('--lyrics-font-color-active', e.target.value);
});

shadowColorInput.addEventListener('input', (e) => {
    // 為了保持陰影的透明度效果，我們可以在顏色後方加上透明度 HEX
    updateRootVariable('--lyrics-font-shadow-color', e.target.value + '94');
});