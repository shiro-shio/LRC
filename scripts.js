let lyrics = [];
let currentTime = 0;
let isPlaying = false;
let timer = null;

const lrcListEl = document.getElementById('lrc-list');
const timeDisplay = document.getElementById('time-display');
const progressEl = document.getElementById('progress');

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

function renderLyrics() {
    lrcListEl.innerHTML = lyrics.map((line, index) => 
        `<p class="lrc-line" id="line-${index}">${line.text}</p>`
    ).join('');
}

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

function updateSync() {
    progressEl.value = currentTime;
    const m = Math.floor(currentTime / 60).toString().padStart(2, '0');
    const s = Math.floor(currentTime % 60).toString().padStart(2, '0');
    timeDisplay.textContent = `${m}:${s}`;
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
    const index = lyrics.findIndex((item, i) => {
        return adjustedTime >= item.time && (!lyrics[i + 1] || adjustedTime < lyrics[i + 1].time);
    });

    if (index !== -1) {
        document.querySelectorAll('.lrc-line').forEach(el => el.classList.remove('active'));
        const activeLine = document.getElementById(`line-${index}`);
        
        if (activeLine) {
            activeLine.classList.add('active');
            const scrollPos = activeLine.offsetTop - 130;
            lrcListEl.style.transform = `translateY(${-scrollPos}px)`;
        }
    }
}

async function fetchLrc() {
    const url = document.getElementById('lrc-url').value;
    if (!url) return;
    try {
        const response = await fetch(url);
        const text = await response.text();
        parseLrc(text);
    } catch (err) {
        alert("URL 載入失敗");
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

const fontSizeInput = document.getElementById('fontSize');
const fontColorInput = document.getElementById('fontColor');
const activeColorInput = document.getElementById('activeColor');
const shadowColorInput = document.getElementById('shadowColor');
const sizeValDisplay = document.getElementById('size-val');

function updateRootVariable(property, value) {
    document.documentElement.style.setProperty(property, value);
}

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
    updateRootVariable('--lyrics-font-shadow-color', e.target.value + '94');
});