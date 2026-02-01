// --- 1. 设置与初始化 ---
const SETTINGS_KEY = "music_tagger_settings";

// 库地址配置 (新增 timeline 插件)
const LIBS = {
    id3: "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js",
    wavesurfer: "https://unpkg.com/wavesurfer.js@7.7.1/dist/wavesurfer.min.js",
    regions: "https://unpkg.com/wavesurfer.js@7.7.1/dist/plugins/regions.min.js",
    timeline: "https://unpkg.com/wavesurfer.js@7.7.1/dist/plugins/timeline.min.js"
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

// 强制按顺序加载库
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
        // 插件依赖主程序，需顺序加载
        if (!window.WaveSurfer?.Regions) await loadScript(LIBS.regions);
        if (!window.WaveSurfer?.Timeline) await loadScript(LIBS.timeline);
        
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
        width: '1100px', maxWidth: '95%', maxHeight: '90vh', overflowY: 'auto',
        backgroundColor: '#1e1e1e', 
        border: '1px solid #444', color: '#eee', borderRadius: '8px',
        padding: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column', gap: '15px'
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
    
    overlay.onclick = (e) => { if (e.target === overlay) closeAction(); };
}

// --- 3. 插件入口 ---
jQuery(async () => {
    console.log("🎵 Music Tagger Pro+ (Timeline) Loaded");
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
        <h3 style="margin:0 0 5px 0; border-bottom:1px solid #555; padding-bottom:10px; color:#fff;">🎵 MP3 歌词可视化剪辑 (Pro+)</h3>
        
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

        <!-- 剪辑器区域 -->
        <div id="mt-editor-area" style="display:none; flex-direction:column; gap:0px; border:1px solid #444; border-radius:5px; overflow:hidden; margin-top:10px;">
            
            <!-- 工具栏 -->
            <div style="background:#252525; padding:8px 15px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333;">
                <span style="color:#aaa; font-size:12px;">🎧 拖动色块左右边缘调整时长 | 双击色块播放</span>
                <div style="display:flex; gap:10px;">
                    <button id="mt-play-pause" style="background:#d32f2f; color:white; border:none; padding:4px 15px; cursor:pointer; border-radius:4px; font-size:12px;">⏯ 播放/暂停</button>
                    <button id="mt-zoom-out" style="background:#444; color:#fff; border:none; cursor:pointer; padding:4px 10px; border-radius:4px;">➖</button>
                    <button id="mt-zoom-in" style="background:#444; color:#fff; border:none; cursor:pointer; padding:4px 10px; border-radius:4px;">➕</button>
                </div>
            </div>

            <!-- 1. 时间刻度尺 (Timeline) -->
            <div id="wave-timeline" style="background:#111; height:25px;"></div>

            <!-- 2. 音频波形与歌词条容器 -->
            <div id="waveform" style="background:#000;"></div>

            <!-- 3. 歌词列表 -->
            <div id="mt-rows-container" class="mt-scroll-area" style="max-height: 250px; overflow-y:auto; background:#111; padding:10px; border-top:1px solid #444;"></div>
        </div>

        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:10px;">
            <button id="mt-download-lrc" class="mt-btn" style="background:#444; padding:8px 20px; color:white; border:none; border-radius:4px; cursor:pointer;">仅下载 LRC</button>
            <button id="mt-download-mp3" class="mt-btn" style="background:#2b5e99; padding:8px 20px; color:white; border:none; border-radius:4px; cursor:pointer;">💾 写入 MP3 并下载</button>
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

    status.innerText = "⏳ AI 识别中...";
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
        status.innerText = "✅ 识别成功！正在渲染轨道...";
        
        document.getElementById('mt-editor-area').style.display = 'flex';
        initWaveformEditor(fileInput.files[0], data.segments, rawText);
        status.innerText = "✅ 编辑模式就绪";

    } catch (e) {
        status.innerText = "❌ 出错: " + e.message;
    } finally {
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// --- 6. 核心：波形剪辑器逻辑 ---
function initWaveformEditor(file, segments, userText) {
    if (wavesurfer) wavesurfer.destroy();

    // 1. 初始化 WaveSurfer (带 Timeline 和 Regions)
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#666',      // 灰色波形
        progressColor: '#4a90e2', // 蓝色进度
        cursorColor: '#ff5722',   // 橙色基准线 (显眼)
        cursorWidth: 2,
        url: URL.createObjectURL(file),
        height: 150,           // 增加高度，给歌词条留空间
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        minPxPerSec: 50,       // 默认缩放
        plugins: [
            WaveSurfer.Regions.create(),
            WaveSurfer.Timeline.create({
                container: '#wave-timeline', // 刻度尺放在上方独立容器
                height: 20,
                primaryColor: '#ccc',
                secondaryColor: '#777',
                timeInterval: 0.5
            })
        ]
    });

    wsRegions = wavesurfer.plugins[0]; // 获取 Regions 插件实例

    // 2. 填充歌词数据
    const userLines = userText.split('\n').filter(l => l.trim().length > 0);
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    segments.forEach((seg, index) => {
        const txt = userLines[index] !== undefined ? userLines[index] : seg.text.trim();
        const regionId = `region-${index}`;

        // A. 创建波形区域 (歌词条)
        // 技巧：利用 content 属性显示歌词摘要
        wsRegions.addRegion({
            id: regionId,
            start: seg.start,
            end: seg.end,
            content: txt,  // 直接在波形上显示歌词
            color: 'rgba(39, 174, 96, 0.4)', // 绿色半透明，不完全遮挡波形
            drag: true, 
            resize: true, 
            minLength: 0.5
        });

        // B. 创建下方文本列表
        const row = document.createElement('div');
        row.id = `row-${index}`;
        row.className = 'mt-row';
        row.style.cssText = "display:flex; gap:10px; margin-bottom:5px; align-items:center; padding:5px; border-radius:4px;";
        row.innerHTML = `
            <span style="color:#666; font-size:12px; width:25px;">#${index+1}</span>
            <input type="text" class="mt-time" id="time-${regionId}" value="${formatTime(seg.start)}" readonly 
                style="width:90px; background:#222; color:#8eff8e; border:1px solid #444; padding:5px; text-align:center; font-family:monospace;">
            <input type="text" class="mt-text" value="${txt}" 
                style="flex:1; background:#222; color:#fff; border:1px solid #444; padding:5px;">
            <button class="mt-play-seg" style="cursor:pointer; background:none; border:1px solid #444; color:#aaa; border-radius:3px; padding:2px 8px;">▶</button>
        `;
        container.appendChild(row);

        // 联动：点击列表播放按钮 -> 播放该段区域
        row.querySelector('.mt-play-seg').onclick = () => {
            const r = wsRegions.getRegions().find(reg => reg.id === regionId);
            if(r) r.play();
        };

        // 联动：修改列表文字 -> 更新波形上的文字
        row.querySelector('.mt-text').addEventListener('input', (e) => {
             const r = wsRegions.getRegions().find(reg => reg.id === regionId);
             if(r) r.setOptions({ content: e.target.value }); // 完整显示，或者截断
        });
    });

    // 3. 事件绑定
    
    // 拖动波形区域 -> 更新时间
    wsRegions.on('region-updated', (region) => {
        const timeInput = document.getElementById(`time-${region.id}`);
        if (timeInput) {
            timeInput.value = formatTime(region.start);
            // 高亮当前行
            document.querySelectorAll('.mt-row').forEach(r => r.style.background = 'transparent');
            const activeRow = document.getElementById(`row-${region.id.split('-')[1]}`);
            if(activeRow) {
                activeRow.style.background = '#333';
                activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    });

    // 点击波形区域 -> 播放 + 滚动
    wsRegions.on('region-clicked', (region, e) => {
        e.stopPropagation();
        region.play();
        const activeRow = document.getElementById(`row-${region.id.split('-')[1]}`);
        if(activeRow) {
            document.querySelectorAll('.mt-row').forEach(r => r.style.background = 'transparent');
            activeRow.style.background = '#333';
            activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    document.getElementById('mt-play-pause').onclick = () => wavesurfer.playPause();

    // 缩放控制
    let currentZoom = 50;
    document.getElementById('mt-zoom-in').onclick = () => { currentZoom += 20; wavesurfer.zoom(currentZoom); };
    document.getElementById('mt-zoom-out').onclick = () => { currentZoom = Math.max(10, currentZoom - 20); wavesurfer.zoom(currentZoom); };

    // 键盘快捷键
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
        status.innerText = "⏳ 写入标签中...";
        if (!window.ID3Writer) await loadAllLibraries();
        
        try {
            const writer = new window.ID3Writer(await file.arrayBuffer());
            writer.setFrame('USLT', { description: '', lyrics: lrc, language: 'zho' });
            writer.addTag();
            download(new Blob([writer.getBlob()]), name + "_lyrics.mp3");
            status.innerText = "✅ 导出成功";
        } catch(e) { status.innerText = "❌ 失败: " + e.message; alert(e.message); }
    }
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}
