// --- 1. 设置与常量 ---
const SETTINGS_KEY = "music_tagger_settings";

const LIBS = {
    id3: "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js",
    wavesurfer: "https://unpkg.com/wavesurfer.js@7.7.1/dist/wavesurfer.min.js",
    regions: "https://unpkg.com/wavesurfer.js@7.7.1/dist/plugins/regions.min.js",
    timeline: "https://unpkg.com/wavesurfer.js@7.7.1/dist/plugins/timeline.min.js"
};

let wavesurfer = null;
let wsRegions = null;

// --- 2. 样式注入 (修复滚动条的关键) ---
function injectStyles() {
    if (document.getElementById('mt-custom-styles')) return;
    const style = document.createElement('style');
    style.id = 'mt-custom-styles';
    style.textContent = `
        .mt-modal {
            background-color: var(--SmartThemeBlur, #1a1b1e);
            padding: 15px;
            display: flex;
            flex-direction: column;
            gap: 15px;
            height: 80vh; /* 固定高度 */
            max-height: 800px;
            border: 1px solid #444;
            border-radius: 8px;
            color: #eee;
        }
        
        /* 修复：确保编辑器区域能撑满剩余空间，但限制高度以触发子元素滚动 */
        #mt-editor-area {
            display: none; /* 初始隐藏 */
            flex-direction: column;
            gap: 10px;
            flex: 1; /* 占据剩余空间 */
            min-height: 0; /* 【关键】防止 flex 子项溢出容器 */
            overflow: hidden; /* 防止自身出现滚动条 */
        }

        /* 修复：滚动区域 */
        .mt-scroll-area {
            flex: 1; /* 占据编辑器内的剩余空间 */
            overflow-y: auto; /* 垂直滚动 */
            min-height: 0; /* 【关键】配合 flex 使用 */
            padding-right: 5px;
            border: 1px solid var(--SmartThemeBorderColor, #444);
            border-radius: 5px;
            padding: 10px;
            background: rgba(0, 0, 0, 0.2);
        }

        /* 自定义滚动条样式 */
        .mt-scroll-area::-webkit-scrollbar { width: 8px; }
        .mt-scroll-area::-webkit-scrollbar-track { background: #222; }
        .mt-scroll-area::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
        .mt-scroll-area::-webkit-scrollbar-thumb:hover { background: #777; }

        .mt-row { display: flex; gap: 8px; margin-bottom: 5px; align-items: center; }
        .mt-time {
            width: 90px; font-family: monospace;
            background: var(--SmartThemeInputBackground, #222);
            color: var(--SmartThemeInputColor, #8eff8e);
            border: 1px solid var(--SmartThemeBorderColor, #444);
            padding: 5px; border-radius: 4px;
        }
        .mt-text {
            flex-grow: 1;
            background: var(--SmartThemeInputBackground, #222);
            color: var(--SmartThemeInputColor, #fff);
            border: 1px solid var(--SmartThemeBorderColor, #444);
            padding: 5px; border-radius: 4px;
        }
        .mt-btn {
            padding: 8px 15px;
            background: var(--SmartThemeQuoteColor, #2b5e99);
            color: white; border: none; border-radius: 5px;
            cursor: pointer; font-weight: bold; transition: 0.2s;
            white-space: nowrap;
        }
        .mt-btn:hover { filter: brightness(1.2); }
        .mt-label { display: block; margin-bottom: 5px; font-weight: bold; opacity: 0.8; }
        .mt-input { width: 100%; box-sizing: border-box; padding: 8px; background: #333; color: #fff; border: 1px solid #555; }
        
        #mt-waveform-container {
            background: #000;
            padding: 10px 10px 0 10px;
            border: 1px solid #444;
            border-radius: 5px;
            display: flex; 
            flex-direction: column;
            flex-shrink: 0; /* 防止波形图被挤压 */
        }
        #wave-timeline { height: 20px; width: 100%; margin-top: -5px; } 
        
        .wavesurfer-region {
            opacity: 0.8 !important;
            border-bottom: 2px solid #fff !important;
            z-index: 10 !important;
        }
        .wavesurfer-region:before {
            content: attr(data-region-label);
            position: absolute; top: 0; left: 5px;
            color: #fff; font-size: 11px; text-shadow: 1px 1px 2px #000;
            white-space: nowrap; overflow: hidden; max-width: 95%;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}

// --- 3. 基础功能 ---
function getSettings() {
    if (window.extension_settings && window.extension_settings[SETTINGS_KEY]) {
        return window.extension_settings[SETTINGS_KEY];
    }
    const local = localStorage.getItem(SETTINGS_KEY);
    return local ? JSON.parse(local) : { apiKey: "" };
}

function saveSettings(newSettings) {
    if (window.extension_settings) {
        window.extension_settings[SETTINGS_KEY] = newSettings;
        if (window.saveSettingsDebounced) window.saveSettingsDebounced();
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
}

async function loadScript(url) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
        const script = document.createElement("script");
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function loadAllLibraries() {
    try {
        if (!window.ID3Writer) await loadScript(LIBS.id3);
        if (!window.WaveSurfer) await loadScript(LIBS.wavesurfer);
        if (!window.WaveSurfer?.Regions) await loadScript(LIBS.regions);
        if (!window.WaveSurfer?.Timeline) await loadScript(LIBS.timeline);
        return true;
    } catch (e) {
        alert("组件加载失败，请检查网络");
        return false;
    }
}

// --- 4. 界面构建 ---
function createCustomPopup(htmlContent) {
    const old = document.getElementById('mt-custom-overlay');
    if (old) old.remove();

    injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'mt-custom-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        zIndex: 20000,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '50px', backdropFilter: 'blur(5px)'
    });

    const container = document.createElement('div');
    container.className = 'mt-modal';
    Object.assign(container.style, {
        width: '1000px', maxWidth: '95%',
    });

    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '❌';
    Object.assign(closeBtn.style, {
        position: 'absolute', top: '15px', right: '15px',
        cursor: 'pointer', fontSize: '18px', zIndex: 10, color: '#fff'
    });
    
    const closeAction = () => {
        if(wavesurfer) { wavesurfer.destroy(); wavesurfer = null; }
        overlay.remove();
    };
    closeBtn.onclick = closeAction;

    container.innerHTML = htmlContent;
    container.appendChild(closeBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeAction();
    });
}

// --- 5. 插件入口 ---
jQuery(async () => {
    console.log("🎵 Music Tagger Pro (Fix Scroll & ID3) Loaded");
    setTimeout(addMusicTaggerButton, 1000);
});

function addMusicTaggerButton() {
    if (document.getElementById("open-music-tagger-btn")) return;
    const btn = document.createElement("div");
    btn.id = "open-music-tagger-btn";
    btn.innerHTML = "🎵";
    Object.assign(btn.style, {
        position: "fixed", top: "60px", right: "55px", zIndex: "2000",
        cursor: "pointer", fontSize: "24px", 
        background: "var(--SmartThemeQuoteColor, #007bff)", color: "white", 
        padding: "8px", borderRadius: "50%", boxShadow: "0 2px 5px rgba(0,0,0,0.5)"
    });
    btn.onclick = openTaggerModal;
    document.body.appendChild(btn);
}

// --- 6. HTML 结构 ---
function openTaggerModal() {
    const settings = getSettings();
    
    const html = `
        <h3 style="margin:0; border-bottom:1px solid #555; padding-bottom:10px; color:#fff;">🎵 MP3 歌词可视化剪辑 Pro</h3>
        
        <div style="display:flex; gap:20px;">
            <div style="flex:1;">
                <label class="mt-label" style="color:#ccc;">1. API Key:</label>
                <input type="password" id="mt-key" class="text_pole mt-input" value="${settings.apiKey || ''}" placeholder="gsk_..." />
            </div>
            <div style="flex:1;">
                <label class="mt-label" style="color:#ccc;">2. MP3 文件:</label>
                 <div style="display:flex; align-items:center; gap:10px;">
                    <input type="file" id="mt-file" accept="audio/mp3" style="display:none;" />
                    <button id="mt-file-trigger-btn" class="mt-btn" style="background:#444;">📂 点击选择文件</button>
                    <span id="mt-file-name-display" style="color:#aaa; font-size:0.9em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px;">未选择</span>
                </div>
            </div>
        </div>

        <div>
            <label class="mt-label" style="color:#ccc;">3. 纯文本歌词 (一行一句):</label>
            <textarea id="mt-lyrics-raw" class="text_pole mt-input" rows="2" placeholder="粘贴歌词..."></textarea>
        </div>

        <button id="mt-process-btn" class="mt-btn" style="width:100%;">⚡ 开始 AI 识别 & 剪辑</button>
        <div id="mt-status" style="color:cyan; font-weight:bold; height:20px; font-size:14px;"></div>

        <!-- 剪辑工作区：ID 由 display:none 改为 flex 控制 -->
        <div id="mt-editor-area">
            
            <!-- 可视化轨道区域 -->
            <div id="mt-waveform-container">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span style="color:#aaa; font-size:12px;">🎧 拖动下方绿色色块边缘调整时间 | 点击刻度线跳转</span>
                    <div style="display:flex; gap:10px;">
                        <button id="mt-zoom-out" style="background:none; color:#fff; border:none; cursor:pointer;">🔍 -</button>
                        <button id="mt-zoom-in" style="background:none; color:#fff; border:none; cursor:pointer;">🔍 +</button>
                    </div>
                </div>
                
                <div id="waveform" style="width:100%;"></div>
                <div id="wave-timeline"></div>
            </div>
            
            <div style="display:flex; justify-content:center; gap:15px; margin-top:-5px; flex-shrink: 0;">
                 <button id="mt-play-pause" class="mt-btn" style="background:#d32f2f; padding:5px 40px; font-size:14px; border-radius:20px;">⏯ 播放 / 暂停 (空格)</button>
            </div>

            <!-- 歌词列表 (可滚动) -->
            <div id="mt-rows-container" class="mt-scroll-area"></div>
            
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:5px; flex-shrink: 0;">
                <button id="mt-download-lrc" class="mt-btn" style="background:#444;">仅下载 LRC</button>
                <button id="mt-download-mp3" class="mt-btn">💾 写入 MP3 并下载</button>
            </div>
        </div>
    `;

    createCustomPopup(html);

    setTimeout(() => {
        const fileInput = document.getElementById('mt-file');
        const triggerBtn = document.getElementById('mt-file-trigger-btn');
        const nameDisplay = document.getElementById('mt-file-name-display');
        triggerBtn.onclick = () => fileInput.click();
        fileInput.onchange = () => {
            if (fileInput.files.length) {
                nameDisplay.innerText = "✅ " + fileInput.files[0].name;
                nameDisplay.style.color = "#8eff8e";
            }
        };
        
        document.getElementById('mt-key').addEventListener('input', (e) => saveSettings({...getSettings(), apiKey: e.target.value}));
        document.getElementById('mt-process-btn').addEventListener('click', runAIAnalysis);
        document.getElementById('mt-download-mp3').addEventListener('click', () => handleExport(true));
        document.getElementById('mt-download-lrc').addEventListener('click', () => handleExport(false));
    }, 100);
}

// --- 7. AI 流程 ---
async function runAIAnalysis() {
    const fileInput = document.getElementById('mt-file');
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!fileInput.files[0]) { status.innerText = "❌ 请选择文件"; return; }
    if (!apiKey) { status.innerText = "❌ 请输入 Key"; return; }

    status.innerText = "⏳ 正在初始化组件...";
    const success = await loadAllLibraries();
    if (!success) { status.innerText = "❌ 组件加载失败"; return; }

    status.innerText = "⏳ 正在 AI 识别...";
    document.getElementById('mt-process-btn').disabled = true;

    try {
        const formData = new FormData();
        formData.append("file", fileInput.files[0]);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "verbose_json");

        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST", headers: { "Authorization": `Bearer ${apiKey}` }, body: formData
        });

        if (!response.ok) throw new Error((await response.json()).error?.message || "API Error");

        const data = await response.json();
        status.innerText = "✅ 识别成功！";
        
        // 只有这里才把 display 设为 flex
        document.getElementById('mt-editor-area').style.display = 'flex';
        initWaveformEditor(fileInput.files[0], data.segments, rawText);

    } catch (e) {
        status.innerText = "❌ 出错: " + e.message;
    } finally {
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// --- 8. 波形编辑器 ---
function initWaveformEditor(file, segments, userText) {
    if (wavesurfer) wavesurfer.destroy();

    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#666',
        progressColor: '#4a90e2',
        url: URL.createObjectURL(file),
        height: 100,
        barWidth: 2, barGap: 1, barRadius: 2,
        normalize: true, minPxPerSec: 50,
        plugins: [
            WaveSurfer.Regions.create(),
            WaveSurfer.Timeline.create({
                container: '#wave-timeline',
                height: 20, timeInterval: 5, primaryLabelInterval: 10,
                style: { fontSize: '10px', color: '#aaa' }
            })
        ]
    });

    wsRegions = wavesurfer.plugins[0];
    const userLines = userText.split('\n').filter(l => l.trim().length > 0);
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    segments.forEach((seg, index) => {
        const txt = userLines[index] !== undefined ? userLines[index] : seg.text.trim();
        const regionId = `region-${index}`;

        wsRegions.addRegion({
            id: regionId,
            start: seg.start, end: seg.end,
            content: txt,
            color: 'rgba(40, 167, 69, 0.4)',
            drag: true, resize: true, minLength: 0.5
        });

        setTimeout(() => {
            const rElem = document.querySelector(`[data-id="${regionId}"]`);
            if(rElem) rElem.setAttribute('data-region-label', truncate(txt, 20));
        }, 100);

        const row = document.createElement('div');
        row.id = `row-${index}`;
        row.className = 'mt-row';
        row.innerHTML = `
            <span style="color:#666; font-size:12px; width:25px;">#${index+1}</span>
            <input type="text" class="mt-time" id="time-${regionId}" value="${formatTime(seg.start)}" readonly>
            <input type="text" class="mt-text" value="${txt}">
            <button class="mt-play-seg" style="cursor:pointer; background:none; border:1px solid #444; color:#aaa; border-radius:3px;">▶</button>
        `;
        container.appendChild(row);

        row.querySelector('.mt-play-seg').onclick = () => {
            const r = wsRegions.getRegions().find(reg => reg.id === regionId);
            if(r) r.play();
        };
        row.querySelector('.mt-text').addEventListener('input', (e) => {
             const val = e.target.value;
             const r = wsRegions.getRegions().find(reg => reg.id === regionId);
             if(r) {
                 r.setOptions({ content: val });
                 const rElem = document.querySelector(`[data-id="${regionId}"]`);
                 if(rElem) rElem.setAttribute('data-region-label', truncate(val, 20));
             }
        });
    });

    wsRegions.on('region-updated', (region) => {
        const timeInput = document.getElementById(`time-${region.id}`);
        if (timeInput) {
            timeInput.value = formatTime(region.start);
            document.querySelectorAll('.mt-row').forEach(r => r.style.background = 'transparent');
            const activeRow = document.getElementById(`row-${region.id.split('-')[1]}`);
            if(activeRow) activeRow.style.background = 'rgba(255,255,255,0.05)';
        }
    });

    wsRegions.on('region-clicked', (region, e) => {
        e.stopPropagation();
        region.play();
        const activeRow = document.getElementById(`row-${region.id.split('-')[1]}`);
        if(activeRow) activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    document.getElementById('mt-play-pause').onclick = () => wavesurfer.playPause();

    let currentZoom = 50;
    document.getElementById('mt-zoom-in').onclick = () => { currentZoom += 20; wavesurfer.zoom(currentZoom); };
    document.getElementById('mt-zoom-out').onclick = () => { currentZoom = Math.max(10, currentZoom - 20); wavesurfer.zoom(currentZoom); };

    document.onkeydown = (e) => {
        if(e.code === 'Space' && document.getElementById('mt-custom-overlay')) {
            if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                wavesurfer.playPause();
            }
        }
    };
}

function formatTime(seconds) {
    const d = new Date(seconds * 1000);
    return `[${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${Math.floor(d.getMilliseconds()/10).toString().padStart(2,'0')}]`;
}

function truncate(str, n) {
    return (str && str.length > n) ? str.substr(0, n-1) + '...' : str;
}

// --- 9. 导出 (增强兼容性) ---
async function handleExport(embed) {
    const rows = document.querySelectorAll('.mt-row');
    let lrc = "";
    // 【修复】使用 \r\n 换行，Windows 兼容性更好
    rows.forEach(r => {
        lrc += `${r.querySelector('.mt-time').value}${r.querySelector('.mt-text').value}\r\n`;
    });
    
    if(!lrc.trim()) return alert("内容为空");
    const file = document.getElementById('mt-file').files[0];
    const name = file.name.replace(/\.[^/.]+$/, "");

    if (!embed) {
        // LRC 文件也建议用 Blob 指定编码，但通常文本直接下载即可
        download(new Blob([lrc], {type: "text/plain;charset=utf-8"}), name + ".lrc");
    } else {
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 写入 ID3 标签...";
        if (!window.ID3Writer) await loadAllLibraries();
        
        try {
            const buffer = await file.arrayBuffer();
            const writer = new window.ID3Writer(buffer);
            
            // 【关键修复】ID3 兼容性设置
            // 1. 设置 padding，预留空间，防止某些播放器读取错误
            // 2. 将 language 设为 'zho' 或 'eng'，有些播放器如果只认 'eng' 可能会忽略 'zho'，但标准是 'zho'。
            // 3. 必须设置 description，哪怕是空字符串，但有些播放器需要 'Lyrics'
            writer.setFrame('USLT', {
                description: '', // 空描述是最通用的，有些播放器显示描述会乱码
                lyrics: lrc,
                language: 'zho' // 中文
            });
            
            // 可选：添加 TIT2 (标题) 标签，确保文件有基本元数据，有时候播放器只读 tag 不完整的会忽略
            writer.setFrame('TIT2', name); 

            writer.addTag();
            
            // 生成带标签的 MP3
            const taggedBlob = writer.getBlob();
            download(taggedBlob, name + "_lyrics.mp3");
            status.innerText = "✅ 导出成功！";
        } catch(e) { status.innerText = "❌ " + e.message; console.error(e); }
    }
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}
