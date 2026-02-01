// --- 1. 设置与常量 ---
const SETTINGS_KEY = "music_tagger_settings";

// 定义依赖库：新增了 timeline (时间刻度尺)
const LIBS = {
    id3: "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js",
    wavesurfer: "https://unpkg.com/wavesurfer.js@7.7.1/dist/wavesurfer.min.js",
    regions: "https://unpkg.com/wavesurfer.js@7.7.1/dist/plugins/regions.min.js",
    timeline: "https://unpkg.com/wavesurfer.js@7.7.1/dist/plugins/timeline.min.js"
};

let wavesurfer = null;
let wsRegions = null;

// --- 2. 样式注入 (集成你的 CSS) ---
function injectStyles() {
    if (document.getElementById('mt-custom-styles')) return;
    const style = document.createElement('style');
    style.id = 'mt-custom-styles';
    style.textContent = `
        /* 你的原始 CSS */
        .mt-modal {
            background-color: var(--SmartThemeBlur, #1a1b1e); /* 提供默认深色回退 */
            padding: 15px;
            display: flex;
            flex-direction: column;
            gap: 15px;
            height: 80vh;
            border: 1px solid #444;
            border-radius: 8px;
            color: #eee;
        }
        .mt-scroll-area {
            flex-grow: 1;
            overflow-y: auto;
            padding-right: 10px;
            border: 1px solid var(--SmartThemeBorderColor, #444);
            border-radius: 5px;
            padding: 10px;
            background: rgba(0, 0, 0, 0.2);
        }
        .mt-row {
            display: flex; gap: 8px; margin-bottom: 5px; align-items: center;
        }
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
        }
        .mt-btn:hover { filter: brightness(1.2); }
        .mt-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .mt-label { display: block; margin-bottom: 5px; font-weight: bold; opacity: 0.8; }
        .mt-input { width: 100%; box-sizing: border-box; padding: 8px; background: #333; color: #fff; border: 1px solid #555; }
        
        /* --- 新增：波形剪辑区专用样式 --- */
        #mt-waveform-container {
            background: #000;
            padding: 10px 10px 0 10px; /* 底部不留白，为了贴合轨道 */
            border: 1px solid #444;
            border-radius: 5px;
            display: flex; 
            flex-direction: column;
        }
        /* 时间刻度尺的高度 */
        #wave-timeline { height: 20px; width: 100%; margin-top: -5px; } 
        
        /* 强制覆盖 Region 样式，让它们看起来像是在独立的轨道 */
        .wavesurfer-region {
            opacity: 0.8 !important;
            border-bottom: 2px solid #fff !important; /* 底部加亮条方便看边界 */
            z-index: 10 !important;
        }
        /* Region 的提示词 */
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

// --- 3. 基础功能函数 ---
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

// 严格顺序加载库
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
        if (!window.WaveSurfer?.Timeline) await loadScript(LIBS.timeline); // 加载时间轴插件
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

    // 注入 CSS
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
    container.className = 'mt-modal'; // 使用你的 CSS 类
    Object.assign(container.style, {
        width: '1000px', maxWidth: '95%',
        // 高度和其他样式已由 .mt-modal CSS 类控制
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
    console.log("🎵 Music Tagger Pro (Timeline Edition) Loaded");
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

// --- 6. 核心 HTML 结构 ---
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

        <!-- 剪辑工作区 (Flex 纵向布局) -->
        <div id="mt-editor-area" style="display:none; flex-direction:column; gap:10px; flex-grow:1; overflow:hidden;">
            
            <!-- 可视化轨道区域 -->
            <div id="mt-waveform-container">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span style="color:#aaa; font-size:12px;">🎧 拖动下方绿色色块边缘调整时间 | 点击刻度线跳转</span>
                    <div style="display:flex; gap:10px;">
                        <button id="mt-zoom-out" style="background:none; color:#fff; border:none; cursor:pointer;">🔍 -</button>
                        <button id="mt-zoom-in" style="background:none; color:#fff; border:none; cursor:pointer;">🔍 +</button>
                    </div>
                </div>
                
                <!-- 1. 音频波形 (上层) -->
                <div id="waveform" style="width:100%;"></div>
                
                <!-- 2. 时间刻度 (中层) -->
                <div id="wave-timeline"></div>
                
                <!-- 3. 歌词轨道 (下层, 实际上是 Regions 的视觉容器) -->
                <!-- 我们通过 CSS 让 Regions 看起来像在这个位置 -->
            </div>
            
            <div style="display:flex; justify-content:center; gap:15px; margin-top:-5px;">
                 <button id="mt-play-pause" class="mt-btn" style="background:#d32f2f; padding:5px 40px; font-size:14px; border-radius:20px;">⏯ 播放 / 暂停 (空格)</button>
            </div>

            <!-- 歌词列表 (可滚动) -->
            <div id="mt-rows-container" class="mt-scroll-area"></div>
            
            <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:5px;">
                <button id="mt-download-lrc" class="mt-btn" style="background:#444;">仅下载 LRC</button>
                <button id="mt-download-mp3" class="mt-btn">💾 写入 MP3 并下载</button>
            </div>
        </div>
    `;

    createCustomPopup(html);

    setTimeout(() => {
        // 事件绑定
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
        
        document.getElementById('mt-editor-area').style.display = 'flex';
        initWaveformEditor(fileInput.files[0], data.segments, rawText);

    } catch (e) {
        status.innerText = "❌ 出错: " + e.message;
    } finally {
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// --- 8. 波形编辑器 (含 Timeline) ---
function initWaveformEditor(file, segments, userText) {
    if (wavesurfer) wavesurfer.destroy();

    // 1. 初始化 WaveSurfer
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#666',      // 灰色波形
        progressColor: '#4a90e2', // 蓝色进度
        url: URL.createObjectURL(file),
        height: 100,            // 波形高度减小，给歌词轨道留空间
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        minPxPerSec: 50,
        plugins: [
            // 注册 Regions 插件
            WaveSurfer.Regions.create(),
            // 注册 Timeline 插件 (时间刻度尺)
            WaveSurfer.Timeline.create({
                container: '#wave-timeline', // 放在波形下方
                height: 20,
                timeInterval: 5,
                primaryLabelInterval: 10,
                style: {
                    fontSize: '10px',
                    color: '#aaa'
                }
            })
        ]
    });

    wsRegions = wavesurfer.plugins[0]; // 获取 Regions 实例

    // 2. 填充歌词数据
    const userLines = userText.split('\n').filter(l => l.trim().length > 0);
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    segments.forEach((seg, index) => {
        const txt = userLines[index] !== undefined ? userLines[index] : seg.text.trim();
        const regionId = `region-${index}`;

        // A. 创建歌词条 (Region)
        // 技巧：我们无法真正把 Region 移出波形容器，但可以通过 CSS 调整视觉
        // 或者直接让它铺满波形的底部，形成“字幕条”的感觉
        wsRegions.addRegion({
            id: regionId,
            start: seg.start,
            end: seg.end,
            content: txt, // 直接把歌词显示在条上
            color: 'rgba(40, 167, 69, 0.4)', // 绿色半透明
            drag: true, resize: true,
            minLength: 0.5
        });

        // 手动添加一个属性，用于在 CSS 里通过 attr() 获取显示
        setTimeout(() => {
            const rElem = document.querySelector(`[data-id="${regionId}"]`);
            if(rElem) rElem.setAttribute('data-region-label', truncate(txt, 20));
        }, 100);

        // B. 列表行
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

        // 绑定事件
        row.querySelector('.mt-play-seg').onclick = () => {
            const r = wsRegions.getRegions().find(reg => reg.id === regionId);
            if(r) r.play();
        };
        row.querySelector('.mt-text').addEventListener('input', (e) => {
             const val = e.target.value;
             const r = wsRegions.getRegions().find(reg => reg.id === regionId);
             if(r) {
                 r.setOptions({ content: val }); // 更新 Region 内部内容
                 const rElem = document.querySelector(`[data-id="${regionId}"]`);
                 if(rElem) rElem.setAttribute('data-region-label', truncate(val, 20)); // 更新 CSS 伪元素显示
             }
        });
    });

    // 3. 全局交互
    // 拖动/缩放歌词条 -> 更新时间
    wsRegions.on('region-updated', (region) => {
        const timeInput = document.getElementById(`time-${region.id}`);
        if (timeInput) {
            timeInput.value = formatTime(region.start);
            document.querySelectorAll('.mt-row').forEach(r => r.style.background = 'transparent');
            const activeRow = document.getElementById(`row-${region.id.split('-')[1]}`);
            if(activeRow) {
                activeRow.style.background = 'rgba(255,255,255,0.05)';
            }
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

    // 键盘控制
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

// --- 9. 导出 ---
async function handleExport(embed) {
    const rows = document.querySelectorAll('.mt-row');
    let lrc = "";
    rows.forEach(r => {
        lrc += `${r.querySelector('.mt-time').value}${r.querySelector('.mt-text').value}\n`;
    });
    
    if(!lrc.trim()) return alert("内容为空");
    const file = document.getElementById('mt-file').files[0];
    const name = file.name.replace(/\.[^/.]+$/, "");

    if (!embed) {
        download(new Blob([lrc]), name + ".lrc");
    } else {
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 写入中...";
        if (!window.ID3Writer) await loadAllLibraries();
        
        try {
            const writer = new window.ID3Writer(await file.arrayBuffer());
            writer.setFrame('USLT', { description: '', lyrics: lrc, language: 'zho' });
            writer.addTag();
            download(new Blob([writer.getBlob()]), name + "_lyrics.mp3");
            status.innerText = "✅ 成功";
        } catch(e) { status.innerText = "❌ " + e.message; }
    }
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}
