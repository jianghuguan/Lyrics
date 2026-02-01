// --- 1. 设置与初始化 ---
const SETTINGS_KEY = "music_tagger_settings";

// 库地址配置
const LIBS = {
    id3: "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js",
    wavesurfer: "https://unpkg.com/wavesurfer.js@7.7.1/dist/wavesurfer.min.js",
    regions: "https://unpkg.com/wavesurfer.js@7.7.1/dist/plugins/regions.min.js"
};

let wavesurfer = null;
let wsRegions = null;

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

// 【关键修复】强制按顺序加载库，防止插件报错
async function loadScript(url) {
    return new Promise((resolve, reject) => {
        // 检查是否已存在（避免重复加载）
        if (document.querySelector(`script[src="${url}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function loadAllLibraries() {
    try {
        // 1. 先加载 ID3 工具 (独立)
        if (!window.ID3Writer) await loadScript(LIBS.id3);
        
        // 2. 必须先加载 WaveSurfer 主程序
        if (!window.WaveSurfer) await loadScript(LIBS.wavesurfer);
        
        // 3. 最后加载 Regions 插件 (因为它依赖 WaveSurfer)
        // 检查 WaveSurfer.Regions 是否存在，不存在才加载
        if (!window.WaveSurfer?.Regions) await loadScript(LIBS.regions);
        
        console.log("✅ 所有库加载完成");
        return true;
    } catch (e) {
        console.error("库加载失败:", e);
        alert("组件加载失败，请检查网络连接");
        return false;
    }
}

// --- 2. 界面构建 ---
function createCustomPopup(htmlContent) {
    const old = document.getElementById('mt-custom-overlay');
    if (old) old.remove();

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
        position: 'relative',
        width: '1000px', maxWidth: '95%', maxHeight: '90vh', overflowY: 'auto',
        backgroundColor: '#1a1b1e', 
        border: '1px solid #444', color: '#eee', borderRadius: '8px',
        padding: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column', gap: '15px'
    });

    // 关闭按钮
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

// --- 3. 插件入口 ---
jQuery(async () => {
    console.log("🎵 Music Tagger Pro (Fixed) Loaded");
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

// --- 4. 界面 HTML ---
function openTaggerModal() {
    const settings = getSettings();
    
    const html = `
        <h3 style="margin:0 0 5px 0; border-bottom:1px solid #555; padding-bottom:10px; color:#fff;">🎵 MP3 歌词可视化剪辑</h3>
        
        <div style="display:flex; gap:20px;">
            <div style="flex:1;">
                <label class="mt-label" style="color:#ccc;">1. API Key:</label>
                <input type="password" id="mt-key" class="text_pole mt-input" value="${settings.apiKey || ''}" placeholder="gsk_..." style="padding:8px; background:#333; color:#fff; border:1px solid #555; width:100%; box-sizing:border-box;" />
            </div>
            <div style="flex:1;">
                <label class="mt-label" style="color:#ccc;">2. MP3 文件:</label>
                 <div style="display:flex; align-items:center; gap:10px; margin-top:2px;">
                    <input type="file" id="mt-file" accept="audio/mp3" style="display:none;" />
                    <button id="mt-file-trigger-btn" class="mt-btn" style="background:#444; border:1px solid #666; padding:6px 15px; color:white; cursor:pointer; border-radius:4px;">📂 点击选择文件</button>
                    <span id="mt-file-name-display" style="color:#aaa; font-size:0.9em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:150px;">未选择</span>
                </div>
            </div>
        </div>

        <div>
            <label class="mt-label" style="color:#ccc;">3. 粘贴纯文本歌词 (一行一句):</label>
            <textarea id="mt-lyrics-raw" class="text_pole mt-input" rows="3" placeholder="在此粘贴歌词..." style="background:#333; color:#fff; border:1px solid #555; width:100%; box-sizing:border-box;"></textarea>
        </div>

        <button id="mt-process-btn" class="mt-btn" style="width:100%; padding:10px; background:#2b5e99; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">⚡ 开始 AI 分析 & 进入剪辑模式</button>
        <div id="mt-status" style="color:cyan; font-weight:bold; height:20px; font-size:14px;"></div>

        <div id="mt-editor-area" style="display:none; flex-direction:column; gap:15px; border-top:1px solid #555; padding-top:15px;">
            <div style="background:#000; padding:10px; border-radius:5px; border:1px solid #333;">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span style="color:#aaa; font-size:12px;">🎧 拖动绿色色块边缘调整时间 | 双击色块播放</span>
                    <div style="display:flex; gap:10px;">
                        <button id="mt-zoom-out" style="background:#333; color:#fff; border:none; cursor:pointer; padding:2px 8px; font-size:12px;">➖ 缩小</button>
                        <button id="mt-zoom-in" style="background:#333; color:#fff; border:none; cursor:pointer; padding:2px 8px; font-size:12px;">➕ 放大</button>
                    </div>
                </div>
                <div id="waveform" style="width:100%;"></div>
                <div style="margin-top:10px; display:flex; justify-content:center;">
                    <button id="mt-play-pause" style="background:#d32f2f; color:white; border:none; padding:5px 30px; cursor:pointer; border-radius:20px; font-size:14px;">⏯ 播放 / 暂停 (空格键)</button>
                </div>
            </div>

            <div id="mt-rows-container" class="mt-scroll-area" style="max-height: 250px; overflow-y:auto; background:#111; padding:10px; border:1px solid #444;"></div>
            
            <div style="display:flex; gap:10px; justify-content:flex-end;">
                <button id="mt-download-lrc" class="mt-btn" style="background:#444; padding:8px 20px; color:white; border:none; border-radius:4px; cursor:pointer;">仅下载 LRC</button>
                <button id="mt-download-mp3" class="mt-btn" style="background:#2b5e99; padding:8px 20px; color:white; border:none; border-radius:4px; cursor:pointer;">💾 写入 MP3 并下载</button>
            </div>
        </div>
    `;

    createCustomPopup(html);

    setTimeout(() => {
        // 绑定事件
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

// --- 5. AI 分析逻辑 ---
async function runAIAnalysis() {
    const fileInput = document.getElementById('mt-file');
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!fileInput.files[0]) { status.innerText = "❌ 请选择文件"; return; }
    if (!apiKey) { status.innerText = "❌ 请输入 Key"; return; }

    status.innerText = "⏳ 正在加载组件...";
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
        status.innerText = "✅ 识别成功！正在生成波形...";
        
        document.getElementById('mt-editor-area').style.display = 'flex';
        initWaveformEditor(fileInput.files[0], data.segments, rawText);
        status.innerText = "✅ 编辑模式就绪";

    } catch (e) {
        status.innerText = "❌ 出错: " + e.message;
    } finally {
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// --- 6. 波形剪辑器逻辑 ---
function initWaveformEditor(file, segments, userText) {
    if (wavesurfer) wavesurfer.destroy();

    // 双重检查库是否加载
    if (!window.WaveSurfer || !window.WaveSurfer.Regions) {
        alert("错误：WaveSurfer 组件未完全加载，请重试。");
        return;
    }

    // 1. 初始化 WaveSurfer
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#555',
        progressColor: '#4a90e2',
        url: URL.createObjectURL(file),
        height: 120,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        minPxPerSec: 50,
        plugins: [
            WaveSurfer.Regions.create() // 这里之前报错，现在因为顺序加载修复了
        ]
    });

    wsRegions = wavesurfer.plugins[0];

    // 2. 填充数据
    const userLines = userText.split('\n').filter(l => l.trim().length > 0);
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    segments.forEach((seg, index) => {
        const txt = userLines[index] !== undefined ? userLines[index] : seg.text.trim();
        const regionId = `region-${index}`;

        // A. 波形区域
        wsRegions.addRegion({
            id: regionId,
            start: seg.start,
            end: seg.end,
            content: truncate(txt, 15),
            color: 'rgba(46, 204, 113, 0.3)',
            drag: true, resize: true, minLength: 0.5
        });

        // B. 文本行
        const row = document.createElement('div');
        row.id = `row-${index}`;
        row.className = 'mt-row';
        row.style.cssText = "display:flex; gap:10px; margin-bottom:5px; align-items:center;";
        row.innerHTML = `
            <span style="color:#666; font-size:12px; width:25px;">#${index+1}</span>
            <input type="text" class="mt-time" id="time-${regionId}" value="${formatTime(seg.start)}" readonly 
                style="width:90px; background:#222; color:#8eff8e; border:1px solid #444; padding:5px; text-align:center; font-family:monospace;">
            <input type="text" class="mt-text" value="${txt}" 
                style="flex:1; background:#222; color:#fff; border:1px solid #444; padding:5px;">
            <button class="mt-play-seg" style="cursor:pointer; background:none; border:1px solid #444; color:#aaa; border-radius:3px; padding:2px 8px;">▶</button>
        `;
        container.appendChild(row);

        row.querySelector('.mt-play-seg').onclick = () => {
            const r = wsRegions.getRegions().find(reg => reg.id === regionId);
            if(r) r.play();
        };
        row.querySelector('.mt-text').addEventListener('input', (e) => {
             const r = wsRegions.getRegions().find(reg => reg.id === regionId);
             if(r) r.setOptions({ content: truncate(e.target.value, 15) });
        });
    });

    // 3. 事件绑定
    wsRegions.on('region-updated', (region) => {
        const timeInput = document.getElementById(`time-${region.id}`);
        if (timeInput) {
            timeInput.value = formatTime(region.start);
            document.querySelectorAll('.mt-row').forEach(r => r.style.background = 'transparent');
            const activeRow = document.getElementById(`row-${region.id.split('-')[1]}`);
            if(activeRow) activeRow.style.background = '#2a2a2a';
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
    return (str.length > n) ? str.substr(0, n-1) + '...' : str;
}

// --- 7. 导出 ---
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
        status.innerText = "⏳ 正在写入 MP3 标签...";
        if (!window.ID3Writer) await loadAllLibraries();
        
        try {
            const writer = new window.ID3Writer(await file.arrayBuffer());
            writer.setFrame('USLT', { description: '', lyrics: lrc, language: 'zho' });
            writer.addTag();
            download(new Blob([writer.getBlob()]), name + "_lyrics.mp3");
            status.innerText = "✅ 导出成功！";
        } catch(e) { status.innerText = "❌ 失败: " + e.message; alert(e.message); }
    }
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}
