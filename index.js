// --- 1. 设置与初始化 ---
const SETTINGS_KEY = "music_tagger_settings";
// 引入 Wavesurfer (波形) 和 Regions (区域插件)
const LIB_URLS = [
    "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js",
    "https://unpkg.com/wavesurfer.js@7.7.1/dist/wavesurfer.min.js",
    "https://unpkg.com/wavesurfer.js@7.7.1/dist/plugins/regions.min.js",
    "https://unpkg.com/wavesurfer.js@7.7.1/dist/plugins/timeline.min.js"
];
let libsLoaded = 0;

// 全局变量存储 wavesurfer 实例，方便后续操作
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

async function loadLibraries() {
    if (libsLoaded === LIB_URLS.length) return;
    return Promise.all(LIB_URLS.map(url => {
        return new Promise((resolve) => {
            // 简单防重检查
            if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
            const script = document.createElement("script");
            script.src = url;
            script.onload = () => { libsLoaded++; resolve(); };
            document.head.appendChild(script);
        });
    }));
}

// --- 2. 界面：顶部对齐 + 宽屏以容纳波形 ---
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
        width: '1000px', // 加宽，为了显示波形
        maxWidth: '95%', 
        maxHeight: '90vh', 
        overflowY: 'auto',
        backgroundColor: '#1a1b1e', 
        border: '1px solid #444', 
        color: '#eee', 
        borderRadius: '8px',
        padding: '20px', 
        boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column', gap: '15px'
    });

    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '❌';
    Object.assign(closeBtn.style, {
        position: 'absolute', top: '15px', right: '15px',
        cursor: 'pointer', fontSize: '18px', zIndex: 10, color: '#fff'
    });
    closeBtn.onclick = () => {
        if(wavesurfer) wavesurfer.destroy(); // 关闭时销毁播放器防止后台播放
        overlay.remove();
    };

    container.innerHTML = htmlContent;
    container.appendChild(closeBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
             if(wavesurfer) wavesurfer.destroy();
             overlay.remove();
        }
    });
}

// --- 3. 插件入口 ---
jQuery(async () => {
    console.log("🎵 Music Tagger Loaded (Visual Editor)");
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
        <h3 style="margin:0 0 5px 0; border-bottom:1px solid #555; padding-bottom:10px; color:#fff;">🎵 MP3 歌词可视化编辑器</h3>
        
        <div style="display:flex; gap:20px;">
            <div style="flex:1;">
                <label class="mt-label" style="color:#ccc;">1. API Key:</label>
                <input type="password" id="mt-key" class="text_pole mt-input" value="${settings.apiKey || ''}" placeholder="gsk_..." style="padding:6px; background:#333; color:#fff; border:1px solid #555; width:100%;" />
            </div>
            <div style="flex:1;">
                <label class="mt-label" style="color:#ccc;">2. MP3 文件:</label>
                 <div style="display:flex; align-items:center; gap:10px;">
                    <input type="file" id="mt-file" accept="audio/mp3" style="display:none;" />
                    <button id="mt-file-trigger-btn" class="mt-btn" style="background:#555; border:1px solid #777; padding:6px 12px; color:white;">📂 选择文件</button>
                    <span id="mt-file-name-display" style="color:#aaa; font-size:0.9em;"></span>
                </div>
            </div>
        </div>

        <div>
            <label class="mt-label" style="color:#ccc;">3. 粘贴纯文本歌词 (一行一句):</label>
            <textarea id="mt-lyrics-raw" class="text_pole mt-input" rows="3" placeholder="粘贴歌词..." style="background:#333; color:#fff; border:1px solid #555; width:100%;"></textarea>
        </div>

        <button id="mt-process-btn" class="mt-btn" style="width:100%; padding:10px; background:#2b5e99; color:white; border:none; border-radius:4px; cursor:pointer;">⚡ 开始 AI 分析 & 载入编辑器</button>
        <div id="mt-status" style="color:cyan; font-weight:bold; height:20px;"></div>

        <!-- 编辑器区域 -->
        <div id="mt-editor-area" style="display:none; flex-direction:column; gap:10px; border-top:1px solid #555; padding-top:10px;">
            
            <!-- 波形容器 -->
            <div style="background:#000; padding:10px; border-radius:5px; border:1px solid #333;">
                <div style="color:#aaa; font-size:12px; margin-bottom:5px;">🎧 音频轨道 (拖动色块边缘调整时间 / 双击色块播放)</div>
                <div id="waveform" style="width:100%;"></div>
                <div id="wave-timeline" style="width:100%;"></div>
                
                <div style="margin-top:5px; display:flex; gap:10px; justify-content:center;">
                    <button id="mt-play-pause" style="background:#444; color:white; border:none; padding:5px 15px; cursor:pointer;">⏯ 播放/暂停 (空格)</button>
                    <button id="mt-zoom-in" style="background:#333; color:white; border:none; padding:5px 10px; cursor:pointer;">🔍 放大</button>
                    <button id="mt-zoom-out" style="background:#333; color:white; border:none; padding:5px 10px; cursor:pointer;">🔍 缩小</button>
                </div>
            </div>

            <!-- 歌词列表 -->
            <div id="mt-rows-container" class="mt-scroll-area" style="max-height: 250px; overflow-y:auto; background:#111; padding:10px; border:1px solid #444;"></div>
            
            <div style="margin-top:10px; display:flex; gap:10px; justify-content:flex-end;">
                <button id="mt-download-lrc" class="mt-btn" style="background:#444; padding:8px 15px; color:white; border:none; border-radius:4px; cursor:pointer;">仅 LRC</button>
                <button id="mt-download-mp3" class="mt-btn" style="background:#2b5e99; padding:8px 15px; color:white; border:none; border-radius:4px; cursor:pointer;">💾 导出 MP3</button>
            </div>
        </div>
    `;

    createCustomPopup(html);

    // 绑定事件
    setTimeout(() => {
        loadLibraries(); // 预加载库

        const fileInput = document.getElementById('mt-file');
        document.getElementById('mt-file-trigger-btn').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) {
                document.getElementById('mt-file-name-display').innerText = "✅ " + fileInput.files[0].name;
            }
        });

        document.getElementById('mt-key').addEventListener('input', (e) => saveSettings({...getSettings(), apiKey: e.target.value}));
        document.getElementById('mt-process-btn').addEventListener('click', runAIAnalysis);
        document.getElementById('mt-download-mp3').addEventListener('click', () => handleExport(true));
        document.getElementById('mt-download-lrc').addEventListener('click', () => handleExport(false));
    }, 100);
}

// --- 5. AI 分析 & 初始化编辑器 ---
async function runAIAnalysis() {
    const fileInput = document.getElementById('mt-file');
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!fileInput.files[0]) { status.innerText = "❌ 请选择文件"; return; }
    if (!apiKey) { status.innerText = "❌ 请输入 Key"; return; }

    status.innerText = "⏳ 正在加载库...";
    await loadLibraries();

    status.innerText = "⏳ 正在上传 Groq 分析...";
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
        status.innerText = "✅ 分析完成，正在渲染波形...";
        
        // 显示编辑器并初始化 Wavesurfer
        document.getElementById('mt-editor-area').style.display = 'flex';
        initWavesurfer(fileInput.files[0], data.segments, rawText);
        status.innerText = "✅ 准备就绪！拖动波形块调整时间";

    } catch (e) {
        status.innerText = "❌ 出错: " + e.message;
    } finally {
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// --- 6. 波形编辑器核心逻辑 ---
function initWavesurfer(file, segments, userText) {
    if (wavesurfer) wavesurfer.destroy();

    // 1. 创建 Wavesurfer 实例
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#4F4A85',
        progressColor: '#383351',
        url: URL.createObjectURL(file),
        height: 100,
        barWidth: 2,
        cursorColor: '#ff0000',
        plugins: [
            WaveSurfer.Timeline.create({ container: '#wave-timeline' }),
            WaveSurfer.Regions.create() // 启用区域插件
        ]
    });

    wsRegions = wavesurfer.plugins[1]; // 获取 Regions 插件实例

    // 2. 准备数据
    const userLines = userText.split('\n').filter(l => l.trim().length > 0);
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    // 3. 渲染每一行 (同时创建列表行和波形区域)
    segments.forEach((seg, index) => {
        const txt = userLines[index] !== undefined ? userLines[index] : seg.text.trim();
        const start = seg.start;
        const end = seg.end;
        const regionId = `region-${index}`;

        // A. 在波形上创建区域
        wsRegions.addRegion({
            id: regionId,
            start: start,
            end: end,
            content: txt.substring(0, 10) + '...', // 简略显示
            color: 'rgba(0, 255, 0, 0.1)', // 绿色半透明
            drag: true,
            resize: true
        });

        // B. 在下方创建列表行
        const row = document.createElement('div');
        row.id = `row-${index}`;
        row.className = 'mt-row';
        row.style.display = "flex";
        row.style.gap = "8px";
        row.style.marginBottom = "5px";
        row.style.alignItems = "center";
        
        // 生成初始时间字符串
        const timeStr = formatTime(start);

        row.innerHTML = `
            <span style="color:#888; font-size:12px; width:20px;">${index+1}</span>
            <input type="text" class="mt-time" id="time-${regionId}" value="${timeStr}" readonly 
                style="width:90px; background:#222; color:#8eff8e; border:1px solid #444; padding:5px; text-align:center;">
            <input type="text" class="mt-text" value="${txt}" 
                style="flex:1; background:#222; color:#fff; border:1px solid #444; padding:5px;">
            <button class="play-seg-btn" style="cursor:pointer; background:none; border:none;">▶️</button>
        `;
        container.appendChild(row);

        // C. 绑定：列表点击 -> 播放该段
        row.querySelector('.play-seg-btn').onclick = () => {
            wavesurfer.setTime(start);
            wavesurfer.play();
        };
        
        // D. 绑定：文字修改 -> 更新波形上的标签
        row.querySelector('.mt-text').addEventListener('input', (e) => {
             const region = wsRegions.getRegions().find(r => r.id === regionId);
             if(region) region.setOptions({ content: e.target.value.substring(0, 10) });
        });
    });

    // 4. 绑定全局事件
    
    // A. 区域更新时 -> 更新列表中的时间
    wsRegions.on('region-updated', (region) => {
        const timeInput = document.getElementById(`time-${region.id}`);
        if (timeInput) {
            timeInput.value = formatTime(region.start);
            // 高亮当前正在调整的行
            document.querySelectorAll('.mt-row').forEach(r => r.style.background = 'transparent');
            const activeRow = document.getElementById(`row-${region.id.split('-')[1]}`);
            if(activeRow) {
                activeRow.style.background = '#333';
                activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    });

    // B. 区域双击 -> 播放该区域
    wsRegions.on('region-clicked', (region, e) => {
        e.stopPropagation();
        region.play();
    });

    // C. 播放/暂停
    document.getElementById('mt-play-pause').onclick = () => wavesurfer.playPause();
    
    // D. 缩放
    document.getElementById('mt-zoom-in').onclick = () => wavesurfer.zoom(wavesurfer.options.minPxPerSec * 1.5 || 20);
    document.getElementById('mt-zoom-out').onclick = () => wavesurfer.zoom(wavesurfer.options.minPxPerSec / 1.5 || 20);

    // E. 键盘空格控制播放
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && document.getElementById('mt-custom-overlay')) {
            // 如果焦点不在输入框里，才拦截空格
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                wavesurfer.playPause();
            }
        }
    });
}

// 辅助：格式化时间 [mm:ss.xx]
function formatTime(seconds) {
    const d = new Date(seconds * 1000);
    const m = d.getMinutes().toString().padStart(2,'0');
    const s = d.getSeconds().toString().padStart(2,'0');
    const ms = Math.floor(d.getMilliseconds()/10).toString().padStart(2,'0');
    return `[${m}:${s}.${ms}]`;
}

// --- 7. 导出逻辑 ---
async function handleExport(embed) {
    const rows = document.querySelectorAll('.mt-row');
    let lrc = "";
    
    rows.forEach(r => {
        const time = r.querySelector('.mt-time').value;
        const text = r.querySelector('.mt-text').value;
        lrc += `${time}${text}\n`;
    });
    
    if(!lrc) return alert("没内容");
    const file = document.getElementById('mt-file').files[0];
    const name = file.name.replace(/\.[^/.]+$/, "");

    if (!embed) {
        download(new Blob([lrc]), name + ".lrc");
    } else {
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 写入中...";
        if (!window.ID3Writer) await loadLibraries();
        try {
            const writer = new window.ID3Writer(await file.arrayBuffer());
            writer.setFrame('USLT', { description: '', lyrics: lrc, language: 'zho' });
            writer.addTag();
            download(new Blob([writer.getBlob()]), name + "_lyrics.mp3");
            status.innerText = "✅ 成功";
        } catch(e) { status.innerText = "❌ 失败"; alert(e.message); }
    }
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}
