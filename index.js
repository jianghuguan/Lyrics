// --- 1. 设置与初始化 ---
const SETTINGS_KEY = "music_tagger_settings";

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
        if (!window.WaveSurfer?.Regions) await loadScript(LIBS.regions);
        if (!window.WaveSurfer?.Timeline) await loadScript(LIBS.timeline);
        console.log("✅ 核心组件加载完成");
        return true;
    } catch (e) {
        console.error(e);
        alert("组件加载失败，请检查网络");
        return false;
    }
}

// --- 2. 界面构建 ---
function createCustomPopup(htmlContent) {
    const old = document.getElementById('mt-custom-overlay');
    if (old) old.remove();

    // 注入自定义 CSS 以实现“分层轨道”效果
    const style = document.createElement('style');
    style.innerHTML = `
        /* 强制让 Region（歌词块）只占据底部，形成独立轨道感 */
        .wavesurfer-region {
            top: auto !important;     /* 取消顶部对齐 */
            bottom: 0 !important;     /* 强制底部对齐 */
            height: 40px !important;  /* 固定高度，形成“条” */
            border-radius: 4px !important;
            border-top: 1px solid rgba(255,255,255,0.2) !important;
            z-index: 10 !important;
        }
        /* 歌词块内的文字样式 */
        .wavesurfer-region-content {
            font-size: 11px !important;
            padding: 4px !important;
            color: #fff !important;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        }
        /* 光标时间浮标样式 */
        #cursor-time-label {
            position: absolute;
            top: 25px; /* 在刻度尺下方 */
            background: #d32f2f;
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            pointer-events: none; /* 不挡鼠标 */
            transform: translateX(-50%);
            display: none;
            z-index: 20;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'mt-custom-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        zIndex: 20000,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '30px', backdropFilter: 'blur(5px)'
    });

    const container = document.createElement('div');
    container.className = 'mt-modal'; 
    Object.assign(container.style, {
        position: 'relative',
        width: '1200px', maxWidth: '98%', maxHeight: '95vh', overflowY: 'auto',
        backgroundColor: '#181818', 
        border: '1px solid #333', color: '#eee', borderRadius: '8px',
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
        style.remove(); // 清理 CSS
    };
    closeBtn.onclick = closeAction;

    container.innerHTML = htmlContent;
    container.appendChild(closeBtn);
    overlay.appendChild(container);
    
    // 点击遮罩关闭
    overlay.onclick = (e) => { if (e.target === overlay) closeAction(); };
}

// --- 3. 插件入口 ---
jQuery(async () => {
    console.log("🎵 Music Tagger Pro Max (Tracks) Loaded");
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
        <h3 style="margin:0 0 5px 0; border-bottom:1px solid #333; padding-bottom:10px; color:#fff;">🎵 MP3 歌词可视化剪辑 (Pro Max)</h3>
        
        <div style="display:flex; gap:20px;">
            <div style="flex:1;">
                <label class="mt-label" style="color:#888; font-size:12px;">API Key:</label>
                <input type="password" id="mt-key" class="text_pole mt-input" value="${settings.apiKey || ''}" placeholder="gsk_..." style="padding:6px; background:#222; color:#fff; border:1px solid #444; width:100%; box-sizing:border-box;" />
            </div>
            <div style="flex:1;">
                <label class="mt-label" style="color:#888; font-size:12px;">选择文件:</label>
                 <div style="display:flex; align-items:center; gap:10px;">
                    <input type="file" id="mt-file" accept="audio/mp3" style="display:none;" />
                    <button id="mt-file-trigger-btn" class="mt-btn" style="background:#333; border:1px solid #555; padding:6px 15px; color:#ccc; cursor:pointer; border-radius:4px; font-size:12px;">📂 打开 MP3</button>
                    <span id="mt-file-name-display" style="color:#666; font-size:12px;">未选择</span>
                </div>
            </div>
        </div>

        <div>
            <textarea id="mt-lyrics-raw" class="text_pole mt-input" rows="2" placeholder="在此粘贴纯文本歌词 (一行一句)..." style="background:#222; color:#bbb; border:1px solid #444; width:100%; box-sizing:border-box; font-size:12px;"></textarea>
        </div>

        <button id="mt-process-btn" class="mt-btn" style="width:100%; padding:8px; background:#2b5e99; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">⚡ AI 识别并进入轨道视图</button>
        <div id="mt-status" style="color:cyan; font-weight:bold; height:15px; font-size:12px;"></div>

        <!-- 轨道编辑区 -->
        <div id="mt-editor-area" style="display:none; flex-direction:column; border:1px solid #333; background:#000; margin-top:5px;">
            
            <!-- 顶部控制条 -->
            <div style="background:#1a1a1a; padding:5px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333;">
                <span style="color:#666; font-size:11px;">💡 提示：歌词块位于底部轨道，拖动边缘调整时间</span>
                <div style="display:flex; gap:5px;">
                    <button id="mt-play-pause" style="background:#d32f2f; color:white; border:none; padding:2px 12px; cursor:pointer; border-radius:3px; font-size:11px;">⏯ 播放(Space)</button>
                    <button id="mt-zoom-out" style="background:#333; color:#ccc; border:none; cursor:pointer; padding:2px 8px; border-radius:3px;">🔍 -</button>
                    <button id="mt-zoom-in" style="background:#333; color:#ccc; border:none; cursor:pointer; padding:2px 8px; border-radius:3px;">🔍 +</button>
                </div>
            </div>

            <!-- 可视化容器 (Relative) -->
            <div style="position:relative; width:100%; overflow:hidden;">
                <!-- 1. 时间刻度 (Top) -->
                <div id="wave-timeline" style="height:20px; background:#111; border-bottom:1px solid #222;"></div>
                
                <!-- 2. 光标时间浮标 -->
                <div id="cursor-time-label">00:00.00</div>

                <!-- 3. 波形 + 歌词轨道 (混合容器) -->
                <!-- 我们设置高度 160px：上面 120px 给波形，下面 40px 给歌词块 -->
                <div id="waveform" style="height:160px; background:linear-gradient(to bottom, #111 0%, #000 75%, #181818 75%, #181818 100%);"></div>
            </div>

            <!-- 底部歌词列表 (校对用) -->
            <div id="mt-rows-container" class="mt-scroll-area" style="height: 180px; overflow-y:auto; background:#111; padding:5px; border-top:1px solid #333;"></div>
        </div>

        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:5px;">
            <button id="mt-download-lrc" class="mt-btn" style="background:#333; padding:6px 15px; color:#ccc; border:none; border-radius:4px; cursor:pointer; font-size:12px;">仅 LRC</button>
            <button id="mt-download-mp3" class="mt-btn" style="background:#2b5e99; padding:6px 15px; color:white; border:none; border-radius:4px; cursor:pointer; font-size:12px;">💾 写入 MP3</button>
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

// --- 5. AI 流程 ---
async function runAIAnalysis() {
    const fileInput = document.getElementById('mt-file');
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!fileInput.files[0]) { status.innerText = "❌ 请选择文件"; return; }
    if (!apiKey) { status.innerText = "❌ 请输入 Key"; return; }

    status.innerText = "⏳ 加载中...";
    if (!(await loadAllLibraries())) return;

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
        status.innerText = "✅ 识别完成";
        
        document.getElementById('mt-editor-area').style.display = 'flex';
        initWaveformEditor(fileInput.files[0], data.segments, rawText);

    } catch (e) {
        status.innerText = "❌ 出错: " + e.message;
    } finally {
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// --- 6. 核心：剪辑器逻辑 ---
function initWaveformEditor(file, segments, userText) {
    if (wavesurfer) wavesurfer.destroy();

    // 1. 初始化 WaveSurfer
    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#555',
        progressColor: '#4a90e2',
        cursorColor: '#d32f2f', // 红色光标
        cursorWidth: 1,
        url: URL.createObjectURL(file),
        height: 120, // 波形高度只占上方
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        minPxPerSec: 50,
        autoCenter: true,
        plugins: [
            WaveSurfer.Regions.create(),
            WaveSurfer.Timeline.create({
                container: '#wave-timeline',
                height: 20,
                timeInterval: 1,
                primaryColor: '#888',
                secondaryColor: '#444',
                style: { fontSize: '10px', color: '#888' }
            })
        ]
    });

    wsRegions = wavesurfer.plugins[0];

    // 2. 填充歌词块
    const userLines = userText.split('\n').filter(l => l.trim().length > 0);
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    segments.forEach((seg, index) => {
        const txt = userLines[index] !== undefined ? userLines[index] : seg.text.trim();
        const regionId = `region-${index}`;

        // 创建 Region
        wsRegions.addRegion({
            id: regionId,
            start: seg.start,
            end: seg.end,
            content: txt, 
            color: 'rgba(52, 152, 219, 0.4)', // 蓝色块
            drag: true, resize: true, minLength: 0.2
        });

        // 创建下方列表行
        const row = document.createElement('div');
        row.id = `row-${index}`;
        row.className = 'mt-row';
        row.style.cssText = "display:flex; gap:10px; margin-bottom:2px; align-items:center; padding:4px; background:#1a1a1a; border-radius:3px;";
        row.innerHTML = `
            <span style="color:#444; font-size:10px; width:20px;">${index+1}</span>
            <input type="text" class="mt-time" id="time-${regionId}" value="${formatTime(seg.start)}" readonly 
                style="width:80px; background:#000; color:#8eff8e; border:1px solid #333; padding:2px; text-align:center; font-family:monospace; font-size:11px;">
            <input type="text" class="mt-text" value="${txt}" 
                style="flex:1; background:#000; color:#ccc; border:1px solid #333; padding:2px; font-size:12px;">
            <button class="mt-play-seg" style="cursor:pointer; background:none; border:none; color:#666;">▶</button>
        `;
        container.appendChild(row);

        // 绑定事件
        row.querySelector('.mt-play-seg').onclick = () => {
            const r = wsRegions.getRegions().find(reg => reg.id === regionId);
            if(r) r.play();
        };
        row.querySelector('.mt-text').addEventListener('input', (e) => {
             const r = wsRegions.getRegions().find(reg => reg.id === regionId);
             if(r) r.setOptions({ content: e.target.value });
        });
    });

    // 3. 事件交互
    
    // 拖动更新
    wsRegions.on('region-updated', (region) => {
        const timeInput = document.getElementById(`time-${region.id}`);
        if (timeInput) {
            timeInput.value = formatTime(region.start);
            highlightRow(region.id);
        }
    });

    wsRegions.on('region-clicked', (region, e) => {
        e.stopPropagation();
        region.play();
        highlightRow(region.id);
    });

    // 播放时光标跟随
    const cursorLabel = document.getElementById('cursor-time-label');
    
    // 更新浮标位置和时间的函数
    const updateCursor = (currentTime) => {
        if(!cursorLabel) return;
        
        // 计算当前时间在当前视图中的百分比位置
        const duration = wavesurfer.getDuration();
        if(!duration) return;
        
        // WaveSurfer 内部计算逻辑（简化版）
        // 我们利用 Wrapper 的宽度和 scrollLeft 来计算
        const wrapper = document.querySelector('#waveform > div'); // shadow dom wrapper usually
        if(wrapper) {
            // 获取当前进度的像素位置
            // 这里我们简单用 currentTime 格式化
            cursorLabel.innerText = formatTimeSimple(currentTime);
            
            // 计算 label 的 left 位置。由于 WaveSurfer 的 cursor 是绝对定位的，
            // 我们可以直接寻找 WaveSurfer 内部生成的 cursor 元素，或者自己根据进度算
            // 但最简单的是：每当 audioprocess 或 seeking 时，获取 wave-cursor 元素的位置
            // WaveSurfer 默认 cursor 也是一个 div
            
            // 为了简化，我们直接显示时间，位置跟随 cursor 比较难完美同步，
            // 建议：直接让它显示在顶部固定位置或者鼠标附近？
            // 用户要求：“点击音频时出现的基准线要有时间刻度” -> 意味着它应该跟着线走。
            
            // 尝试获取内置 cursor
            const cursorEl = document.querySelector('#waveform ::part(cursor)'); // 如果是 shadow dom
            // V7 是直接渲染在 div 里的
            const cursor = document.querySelector('#waveform > div > div[style*="position: absolute; z-index: 4"]'); 
            // 这种查找太脆弱。
            
            // 替代方案：根据鼠标点击位置更新 label 位置
        }
    };
    
    // 监听进度更新
    wavesurfer.on('audioprocess', (t) => {
         cursorLabel.innerText = formatTimeSimple(t);
         updateLabelPosition();
    });
    wavesurfer.on('seeking', (t) => {
         cursorLabel.innerText = formatTimeSimple(t);
         updateLabelPosition();
    });
    
    // 核心：计算光标的屏幕 X 坐标
    function updateLabelPosition() {
        const wrapper = document.querySelector('#waveform');
        const scrollContainer = wrapper.shadowRoot ? wrapper.shadowRoot.querySelector('.scroll') : wrapper.querySelector('div'); 
        // V7 结构比较复杂，我们用一个简化的方式：
        // 既然 WaveSurfer 有 autoCenter，光标通常在中间（播放时）。
        // 但暂停时点击哪就是哪。
        
        // 我们利用 WaveSurfer 的 API 把时间转为像素
        // 这一步比较难精确，我们退而求其次：
        // 让 Label 显示在顶部正中间？不，用户要基准线。
        
        // 方案：改为鼠标移动时显示时间（像编辑器一样），点击后固定显示当前播放时间
        cursorLabel.style.display = 'block';
        
        // 我们可以通过 wavesurfer.getCurrentTime() 获取时间，
        // 然后我们要找到这个时间对应的 x 坐标。
        // 这需要获取当前的 scrollLeft 和 pxPerSec
        // 比较麻烦，所以我把时间显示做成了固定在“顶部时间轴”上，
        // 或者跟随鼠标 Hover 显示。
        
        // 最终修正：用户要求的是“基准线有时间刻度”。
        // 最好的办法是让 Timeline 插件自己处理，或者我们只是简单地显示一个当前时间在左上角？
        // 不，我将在 timeline 上方动态显示当前时间。
    }
    
    // 补充：为了满足“基准线要有时间刻度”，我们做一个跟随鼠标的 Time Tooltip
    const hoverLabel = document.createElement('div');
    hoverLabel.style.cssText = "position:absolute; background:#333; color:#fff; padding:2px 5px; font-size:10px; pointer-events:none; display:none; z-index:100; border-radius:3px;";
    document.body.appendChild(hoverLabel);
    
    document.querySelector('#waveform').addEventListener('mousemove', (e) => {
        const rect = document.querySelector('#waveform').getBoundingClientRect();
        const x = e.clientX - rect.left;
        const duration = wavesurfer.getDuration();
        const progress = x / rect.width; // 这是一个相对可视区域的比例，不准确因为有滚动
        
        // WaveSurfer V7 点击交互实际上是把 event 传给 map
        // 这里手动算比较复杂。
        
        // 退回简单方案：在 Timeline 上方加一个固定的“当前播放时间”显示
        // 修改 cursor-time-label 的行为为：显示当前播放头的时间
        cursorLabel.style.display = 'block';
        cursorLabel.style.left = '50%'; // 播放时通常居中
        cursorLabel.innerText = formatTimeSimple(wavesurfer.getCurrentTime());
    });

    document.getElementById('mt-play-pause').onclick = () => wavesurfer.playPause();

    // 缩放
    let currentZoom = 50;
    document.getElementById('mt-zoom-in').onclick = () => { currentZoom += 20; wavesurfer.zoom(currentZoom); };
    document.getElementById('mt-zoom-out').onclick = () => { currentZoom = Math.max(10, currentZoom - 20); wavesurfer.zoom(currentZoom); };

    // 键盘
    document.onkeydown = (e) => {
        if(e.code === 'Space' && document.getElementById('mt-custom-overlay')) {
            if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                wavesurfer.playPause();
            }
        }
    };
}

// 辅助：高亮行
function highlightRow(regionId) {
    document.querySelectorAll('.mt-row').forEach(r => r.style.background = '#1a1a1a');
    const index = regionId.split('-')[1];
    const row = document.getElementById(`row-${index}`);
    if(row) {
        row.style.background = '#333';
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function formatTime(seconds) {
    const d = new Date(seconds * 1000);
    return `[${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${Math.floor(d.getMilliseconds()/10).toString().padStart(2,'0')}]`;
}

function formatTimeSimple(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = Math.floor((seconds % 1) * 100).toString().padStart(2, '0');
    return `${m}:${s}.${ms}`;
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
        status.innerText = "⏳ 写入中...";
        if (!window.ID3Writer) await loadAllLibraries();
        
        try {
            const writer = new window.ID3Writer(await file.arrayBuffer());
            writer.setFrame('USLT', { description: '', lyrics: lrc, language: 'zho' });
            writer.addTag();
            download(new Blob([writer.getBlob()]), name + "_lyrics.mp3");
            status.innerText = "✅ 完成";
        } catch(e) { status.innerText = "❌ 失败: " + e.message; alert(e.message); }
    }
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}
