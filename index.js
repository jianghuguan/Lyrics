// --- 1. 设置与依赖管理 ---
const SETTINGS_KEY = "music_tagger_settings";
const URLS = {
    // 仅保留音频处理核心库
    wavesurfer: "https://unpkg.com/wavesurfer.js@7.7.1/dist/wavesurfer.min.js",
    regions: "https://unpkg.com/wavesurfer.js@7.7.1/dist/plugins/regions.min.js"
};

function getSettings() {
    const local = localStorage.getItem(SETTINGS_KEY);
    return local ? JSON.parse(local) : { apiKey: "" };
}

function saveSettings(newSettings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
}

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

async function loadLibraries() {
    const loadScript = (src) => new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`加载失败: ${src}`));
        document.head.appendChild(s);
    });

    try {
        if (!window.WaveSurfer) await loadScript(URLS.wavesurfer);
        if (!window.WaveSurfer.Regions) await loadScript(URLS.regions);
        return true;
    } catch (e) {
        alert("系统错误：无法加载库。\n请检查网络连接"); return false;
    }
}

// --- 2. 弹窗 UI ---
function createCustomPopup(htmlContent) {
    const old = document.getElementById('mt-custom-overlay');
    if (old) old.remove();

    const style = document.createElement('style');
    style.innerHTML = `
        /* --- 核心交互修复 --- */
        
        /* 1. 歌词条背景：完全穿透，不挡手指/鼠标，确保波形可滑动 */
        .wavesurfer-region { 
            pointer-events: none !important; 
            z-index: 4; 
            background-color: rgba(255, 255, 255, 0.1) !important;
        }
        
        /* 2. 歌词文字：也不挡鼠标 */
        .wavesurfer-region-content {
            pointer-events: none !important;
        }

        /* 3. 左右手柄：必须开启交互，加宽以便触摸 */
        .wavesurfer-region-handle { 
            pointer-events: auto !important; 
            width: 20px !important; 
            background-color: rgba(255, 255, 255, 0.5) !important;
            z-index: 5;
            cursor: col-resize !important;
        }
        /* 手柄悬停高亮 */
        .wavesurfer-region-handle:hover {
            background-color: rgba(255, 255, 255, 0.9) !important;
        }

        /* 4. 波形画布：设置为抓手，提示可拖动 */
        #mt-waveform {
            cursor: grab;
        }
        #mt-waveform:active {
            cursor: grabbing;
        }

        /* 其他 UI 样式 */
        .mt-no-select { user-select: none; -webkit-user-select: none; }
        #mt-lyrics-scroll-area::-webkit-scrollbar { width: 8px; }
        #mt-lyrics-scroll-area::-webkit-scrollbar-track { background: #1a1a1a; }
        #mt-lyrics-scroll-area::-webkit-scrollbar-thumb { background: #444; border-radius: 4px; }
        #mt-waveform::-webkit-scrollbar { height: 10px; }
        #mt-waveform::-webkit-scrollbar-track { background: #111; border-radius: 4px; }
        #mt-waveform::-webkit-scrollbar-thumb { background: #555; border-radius: 5px; border: 2px solid #111; }
        
        .mt-row-selected {
            border: 2px solid #ffc107 !important;
            background-color: #333322 !important;
        }
        .mt-row-active { background-color: #334455; }
        
        .mt-control-btn {
            background: #444; color: #eee; border: 1px solid #666; 
            padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;
        }
        .mt-control-btn:hover { background: #555; }
        .mt-control-btn:active { background: #333; }
        
        .mt-region-label {
            color: #fff; font-size: 10px; padding: 4px;
            overflow: hidden; white-space: nowrap; pointer-events: none;
            text-shadow: 0 1px 2px black;
        }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'mt-custom-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.85)', zIndex: 20000,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '30px', backdropFilter: 'blur(5px)'
    });

    const container = document.createElement('div');
    container.className = 'mt-modal mt-no-select';
    Object.assign(container.style, {
        // [修改] maxHeight 调小一点，防止被浏览器底部遮挡
        position: 'relative', width: '1000px', maxWidth: '95%', maxHeight: '85vh', height: 'auto',
        backgroundColor: '#1e1e1e', border: '1px solid #333', color: '#eee',
        borderRadius: '12px', padding: '25px', boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column', gap: '15px', overflowY: 'auto' 
    });

    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '❌';
    Object.assign(closeBtn.style, {
        position: 'absolute', top: '15px', right: '15px',
        cursor: 'pointer', fontSize: '18px', zIndex: 100, color: '#fff', opacity: '0.8'
    });
    closeBtn.onclick = () => { if(window.mtWaveSurfer) window.mtWaveSurfer.destroy(); overlay.remove(); };

    container.innerHTML = htmlContent;
    container.appendChild(closeBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
}

// --- 3. 插件入口 ---
jQuery(async () => {
    console.log("🎵 Music Tagger Loaded (UI Fix)");
    setTimeout(addMusicTaggerButton, 1000);
});

function addMusicTaggerButton() {
    if (document.getElementById("open-music-tagger-btn")) return;
    const btn = document.createElement("div");
    btn.id = "open-music-tagger-btn";
    btn.innerHTML = "🎵";
    btn.title = "MP3 歌词工具";
    Object.assign(btn.style, {
        position: "fixed", top: "60px", right: "55px", zIndex: "2000",
        cursor: "pointer", fontSize: "24px", 
        background: "#007bff", color: "white", 
        padding: "8px", borderRadius: "50%", boxShadow: "0 2px 5px rgba(0,0,0,0.5)"
    });
    btn.onclick = async () => { const loaded = await loadLibraries(); if(loaded) openTaggerModal(); };
    document.body.appendChild(btn);
}

// --- 4. 界面构建 ---
function openTaggerModal() {
    const settings = getSettings();
    const html = `
        <h3 style="margin:0; border-bottom:1px solid #444; padding-bottom:10px; color:#fff; display:flex; justify-content:space-between;">
            <span>🎵 智能歌词剪辑台</span>
            <span style="font-size:12px; color:#aaa; margin-top:5px;">LRC Export</span>
        </h3>
        <div id="mt-setup-area" style="display:flex; gap:20px; flex-wrap:wrap;">
            <div style="flex:1; min-width:200px;">
                <label class="mt-label" style="color:#ccc; display:block; margin-bottom:5px;">1. Groq API Key:</label>
                <input type="password" id="mt-key" value="${settings.apiKey || ''}" placeholder="gsk_..." style="width:100%; padding:8px; background:#333; color:#fff; border:1px solid #555; border-radius:4px;" />
            </div>
            <div style="flex:1; min-width:200px;">
                <label class="mt-label" style="color:#ccc; display:block; margin-bottom:5px;">2. MP3 文件:</label>
                <div style="display:flex; gap:10px;">
                    <input type="file" id="mt-file" accept="audio/mp3" style="display:none;" />
                    <button id="mt-file-btn" style="background:#444; color:white; border:1px solid #666; padding:8px 12px; border-radius:4px; cursor:pointer;">📂 选择文件</button>
                    <span id="mt-filename" style="color:#aaa; align-self:center; font-size:12px;">未选择</span>
                </div>
            </div>
        </div>
        <div>
            <label class="mt-label" style="color:#ccc; display:block; margin-bottom:5px;">3. 歌词文本 (可选):</label>
            <textarea id="mt-lyrics-raw" rows="2" placeholder="粘贴纯歌词文本，AI 将尝试自动对齐..." style="width:100%; background:#333; color:#fff; border:1px solid #555; border-radius:4px; resize:vertical;"></textarea>
        </div>
        <button id="mt-process-btn" style="width:100%; padding:10px; background:#2b5e99; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">⚡ 开始 AI 分析 & 加载编辑器</button>
        <div id="mt-status" style="color:cyan; font-weight:bold; height:20px; font-size:14px;"></div>

        <div id="mt-editor-area" style="display:none; flex-direction:column; flex:1; border-top:1px solid #444; padding-top:10px;">
            <div style="display:flex; gap:15px; margin-bottom:5px; align-items:center; position:sticky; top:0; background:#1e1e1e; z-index:10; padding:10px 0; border-bottom:1px solid #333; flex-wrap:wrap;">
                <button id="mt-play-pause" style="background:#28a745; color:white; border:none; padding:5px 15px; border-radius:4px; cursor:pointer;">▶ 播放/暂停</button>
                <div style="display:flex; gap:5px; border-left:1px solid #444; padding-left:15px;">
                    <button id="mt-set-start" class="mt-control-btn" title="强力设置起点，并向后推挤所有歌词">⇤ 对齐起点 (连锁挤压)</button>
                    <button id="mt-set-end" class="mt-control-btn" title="强力设置终点，并向后推挤所有歌词">对齐终点 (连锁挤压) ⇥</button>
                </div>
                <div style="display:flex; align-items:center; gap:5px; color:#ccc; font-size:12px; margin-left:auto;">
                    <span>🔍 缩放:</span>
                    <input type="range" id="mt-zoom" min="10" max="300" value="50" style="width:80px;">
                </div>
            </div>
            
            <div style="color:#aaa; font-size:12px; margin-bottom:5px;">
                🖱️ <b>双击</b> 波形可选中。使用上方对齐按钮可触发<b>连锁挤压</b>，确保无重叠且每句保留时长。
            </div>

            <div id="mt-waveform" style="width: 100%; height: 135px; background: #000; border-radius: 4px; margin-bottom: 15px; overflow-x: auto; overflow-y: hidden;"></div>
            
            <div id="mt-lyrics-scroll-area" style="background: #141414; padding: 10px; border-radius: 4px; border: 1px solid #333; height: 450px; overflow-y: auto; overscroll-behavior: contain; position: relative;">
                <div id="mt-rows-container"></div>
            </div>
            <!-- [修改] padding-bottom 加大到 40px，防止按钮贴底 -->
            <div style="margin-top:20px; display:flex; gap:10px; justify-content:flex-end; padding-bottom:40px;">
                <button id="mt-download-lrc" style="background:#2b5e99; padding:10px 20px; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">💾 下载 .lrc 歌词文件</button>
            </div>
        </div>
    `;

    createCustomPopup(html);

    const fileInput = document.getElementById('mt-file');
    const fileBtn = document.getElementById('mt-file-btn');
    const nameSpan = document.getElementById('mt-filename');

    fileBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => { if (fileInput.files.length) { nameSpan.innerText = fileInput.files[0].name; nameSpan.style.color = '#4caf50'; } };
    document.getElementById('mt-key').oninput = (e) => { const s = getSettings(); s.apiKey = e.target.value; saveSettings(s); };
    document.getElementById('mt-process-btn').onclick = runAIAndInitEditor;
    document.getElementById('mt-zoom').oninput = (e) => { if (window.mtWaveSurfer) window.mtWaveSurfer.zoom(Number(e.target.value)); };
    document.getElementById('mt-play-pause').onclick = () => { if (window.mtWaveSurfer) window.mtWaveSurfer.playPause(); };
    
    document.getElementById('mt-download-lrc').onclick = exportLrc;
}

// --- 5. AI 处理 ---
async function runAIAndInitEditor() {
    const file = document.getElementById('mt-file').files[0];
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!file || !apiKey) return alert("请先选择文件并填写 Key");

    status.innerText = "⏳ 正在分析...";
    document.getElementById('mt-process-btn').disabled = true;

    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "verbose_json");
        formData.append("prompt", "Split lyrics line by line.");
        
        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST", headers: { "Authorization": `Bearer ${apiKey}` }, body: formData
        });

        if (!response.ok) throw new Error((await response.json()).error?.message || "API Error");
        const data = await response.json();

        status.innerText = "✅ 渲染中...";
        document.getElementById('mt-editor-area').style.display = 'flex';
        document.getElementById('mt-setup-area').style.display = 'none'; 
        
        await initWaveSurfer(file, data.segments, rawText);
        status.innerText = "🎵 编辑器就绪";

    } catch (e) {
        status.innerText = "❌ 错误: " + e.message;
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// --- 6. 编辑器逻辑 ---
async function initWaveSurfer(fileBlob, segments, userRawText) {
    if (window.mtWaveSurfer) window.mtWaveSurfer.destroy();
    
    const WaveSurfer = window.WaveSurfer;
    const RegionsPlugin = window.WaveSurfer.Regions;

    const ws = WaveSurfer.create({
        container: '#mt-waveform',
        waveColor: '#4F4A85',
        progressColor: '#383351',
        url: URL.createObjectURL(fileBlob),
        height: 120, 
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        sampleRate: 3000, 
        pixelRatio: 1, 
        normalize: true,
        autoScroll: true,
        autoCenter: true,
        cursorColor: '#ff0000',
        cursorWidth: 2,
        backend: 'WebAudio',
        interact: true 
    });

    const wsRegions = ws.registerPlugin(RegionsPlugin.create());
    window.mtWaveSurfer = ws;
    window.mtRegions = wsRegions;

    let currentSelectedRegionId = null; 
    let isSyncing = false; // 全局锁

    const userLines = userRawText.split('\n').filter(l => l.trim());
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    function createContentEl(text) {
        const el = document.createElement('div');
        el.className = 'mt-region-label';
        el.textContent = text;
        return el;
    }

    function selectRegion(id) {
        currentSelectedRegionId = id;
        const allRows = container.children;
        for (let row of allRows) {
            row.classList.remove('mt-row-selected');
        }
        const targetRow = document.getElementById(`row-${id}`);
        if(targetRow) {
            targetRow.classList.add('mt-row-selected');
        }
    }

    function createRow(regionId, initialText, startTime) {
        const row = document.createElement('div');
        row.id = `row-${regionId}`;
        row.style.cssText = "display:flex; gap:10px; margin-bottom:8px; align-items:center; background:#222; padding:10px; border-radius:6px; border:2px solid transparent;";
        row.innerHTML = `
            <span class="mt-idx" style="color:#666; font-size:14px; width:25px; font-weight:bold;">#</span>
            <input type="text" class="mt-row-text" value="${initialText}" style="flex:1; background:#333; color:#eee; border:none; padding:8px; border-radius:4px; font-size:14px;">
            <button class="mt-del-btn" style="background:#442222; color:#ff6666; border:none; cursor:pointer; padding:5px 8px; border-radius:4px; font-size:12px;">🗑️</button>
            <span class="mt-time-disp" style="font-family:monospace; color:#aaa; font-size:13px; min-width:90px; text-align:right;">${formatTime(startTime)}</span>
        `;
        
        row.querySelector('input').addEventListener('input', (e) => {
            const reg = wsRegions.getRegions().find(r => r.id === regionId);
            if(reg) reg.setOptions({ content: createContentEl(e.target.value) });
        });

        row.querySelector('.mt-del-btn').onclick = (e) => {
            e.stopPropagation();
            const reg = wsRegions.getRegions().find(r => r.id === regionId);
            if(reg) { reg.remove(); row.remove(); updateIndices(); }
        };

        row.ondblclick = (e) => {
            if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                const reg = wsRegions.getRegions().find(r => r.id === regionId);
                if(reg) {
                    ws.setTime(reg.start);
                    selectRegion(regionId);
                }
            }
        };
        return row;
    }

    function updateIndices() {
        const rows = document.getElementById('mt-rows-container').children;
        Array.from(rows).forEach((row, i) => { row.querySelector('.mt-idx').innerText = i + 1; });
    }

    // --- 核心算法：连锁挤压 (Cascade Push) ---
    function cascadePush(startIdx, newStart, enforceMinLen) {
        if (startIdx >= wsRegions.getRegions().length) return;
        
        const allRegions = wsRegions.getRegions().sort((a, b) => a.start - b.start);
        const totalDuration = ws.getDuration();
        const minLen = 5.0; // 用户要求的保底 5 秒

        let currentStartPtr = newStart;

        for (let i = startIdx; i < allRegions.length; i++) {
            const region = allRegions[i];
            
            // 1. 设置当前 region 的起点
            if (Math.abs(region.start - currentStartPtr) > 0.001) {
                region.setOptions({ start: currentStartPtr });
            }

            // 2. 计算理想终点
            let desiredEnd = region.end;
            desiredEnd = Math.max(region.end, currentStartPtr + minLen);

            // 3. 边界检查
            if (desiredEnd > totalDuration) desiredEnd = totalDuration;

            // 4. 设置终点
            if (Math.abs(region.end - desiredEnd) > 0.001) {
                region.setOptions({ end: desiredEnd });
            }
            
            // 5. 更新指针，准备处理下一个
            currentStartPtr = desiredEnd;

            // 6. UI 更新
            const row = document.getElementById(`row-${region.id}`);
            if(row) row.querySelector('.mt-time-disp').innerText = formatTime(region.start);
        }
    }

    ws.on('ready', () => {
        ws.zoom(50);
        const duration = ws.getDuration();
        const loopCount = Math.max(segments.length, userLines.length);
        
        let lastEndTime = 0; 
        for (let i = 0; i < loopCount; i++) {
            let start, end, text;
            const seg = segments[i]; 
            const userLine = userLines[i];
            start = lastEndTime;
            if (seg) {
                let len = seg.end - seg.start;
                if(len < 0.5) len = 1.0;
                end = start + len;
                text = userLine || seg.text.trim();
            } else {
                end = start + 5.0; // 默认给5秒
                text = userLine || "MISSING";
            }
            if (end > duration) end = duration;
            if (start >= duration) { start = duration - 0.5; end = duration; }
            lastEndTime = end;

            const color = ((i % 2 === 0) ? "rgba(0, 123, 255, 0.2)" : "rgba(40, 167, 69, 0.2)");
            const region = wsRegions.addRegion({
                id: `seg-${i}-${Date.now()}`,
                start: start, end: end,
                content: createContentEl(text),
                color: color, 
                drag: false, resize: true 
            });
            container.appendChild(createRow(region.id, text, start));
        }
        updateIndices();
    });

    // --- 双击波形 ---
    document.getElementById('mt-waveform').ondblclick = (e) => {
        const clickTime = ws.getCurrentTime();
        const regions = wsRegions.getRegions().sort((a,b) => a.start - b.start);
        const clickedRegion = regions.find(r => clickTime >= r.start && clickTime < r.end);
        if (clickedRegion) {
            selectRegion(clickedRegion.id);
        } else {
            const lastRegion = regions[regions.length - 1];
            let start = lastRegion ? lastRegion.end : 0;
            const newRegion = wsRegions.addRegion({
                start: start, end: start + 5, // 新建的也给5秒
                content: createContentEl("新歌词"),
                color: "rgba(255, 255, 255, 0.3)", drag: false, resize: true
            });
            const row = createRow(newRegion.id, "新歌词", start);
            container.appendChild(row);
            updateIndices();
            selectRegion(newRegion.id);
            row.scrollIntoView({ behavior: 'smooth' });
        }
    };

    // --- 拖动手柄时的普通连动 (Basic Chain Sync) ---
    wsRegions.on('region-updated', (region) => {
        if (isSyncing) return; 
        isSyncing = true; 

        const allRegions = wsRegions.getRegions().sort((a, b) => a.start - b.start);
        const index = allRegions.findIndex(r => r.id === region.id);

        if (index > 0) {
            const prev = allRegions[index - 1];
            if (Math.abs(prev.end - region.start) > 0.001) prev.setOptions({ end: region.start });
        }
        if (index < allRegions.length - 1) {
            const next = allRegions[index + 1];
            if (Math.abs(next.start - region.end) > 0.001) next.setOptions({ start: region.end });
        }

        isSyncing = false; 
        const row = document.getElementById(`row-${region.id}`);
        if(row) row.querySelector('.mt-time-disp').innerText = formatTime(region.start);
    });

    // --- 按钮：左对齐 (强力连锁) ---
    document.getElementById('mt-set-start').onclick = () => {
        if (!currentSelectedRegionId) return alert("请先双击选中一行歌词");
        const allRegions = wsRegions.getRegions().sort((a, b) => a.start - b.start);
        const index = allRegions.findIndex(r => r.id === currentSelectedRegionId);
        if (index === -1) return;

        const now = ws.getCurrentTime();
        isSyncing = true; // 开启全局锁
        
        if (index > 0) {
            allRegions[index - 1].setOptions({ end: now });
        }

        // 连锁推演
        cascadePush(index, now, true);

        isSyncing = false;
    };

    // --- 按钮：右对齐 (强力连锁) ---
    document.getElementById('mt-set-end').onclick = () => {
        if (!currentSelectedRegionId) return alert("请先双击选中一行歌词");
        const allRegions = wsRegions.getRegions().sort((a, b) => a.start - b.start);
        const index = allRegions.findIndex(r => r.id === currentSelectedRegionId);
        if (index === -1) return;

        const now = ws.getCurrentTime();
        const currentRegion = allRegions[index];
        if (now <= currentRegion.start) return alert("终点不能早于起点");

        isSyncing = true;

        currentRegion.setOptions({ end: now });

        if (index < allRegions.length - 1) {
            cascadePush(index + 1, now, true);
        }

        isSyncing = false;
    };

    // --- 播放进度逻辑 ---
    let lastActiveRegionId = null;
    let lastActiveRowEl = null;
    const checkActiveRegion = throttle((currentTime) => {
        const regions = wsRegions.getRegions();
        const activeRegion = regions.find(r => currentTime >= r.start && currentTime < r.end);
        if (activeRegion && activeRegion.id !== lastActiveRegionId) {
            lastActiveRegionId = activeRegion.id;
            if (lastActiveRowEl) lastActiveRowEl.classList.remove('mt-row-active');
            const newRow = document.getElementById(`row-${activeRegion.id}`);
            if(newRow) {
                lastActiveRowEl = newRow;
                newRow.classList.add('mt-row-active');
                if(activeRegion.id !== currentSelectedRegionId) {
                    newRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }
        }
    }, 100);
    ws.on('timeupdate', checkActiveRegion);
}

// --- 7. 导出 (仅 LRC) ---
function exportLrc() {
    if (!window.mtRegions) return;
    const regions = window.mtRegions.getRegions().sort((a, b) => a.start - b.start);
    let lrcContent = "";
    regions.forEach(r => {
        const row = document.getElementById(`row-${r.id}`);
        let text = "";
        if (row) text = row.querySelector('.mt-row-text').value;
        else {
             if (r.content instanceof HTMLElement) text = r.content.textContent;
             else text = "Line";
        }
        lrcContent += `[${formatTime(r.start)}]${text}\n`;
    });
    
    const file = document.getElementById('mt-file').files[0];
    const baseName = file.name.replace(/\.[^/.]+$/, "");

    // 核心：添加 BOM (\ufeff) 解决乱码
    const blob = new Blob(['\ufeff' + lrcContent], { type: 'text/plain;charset=utf-8' });
    download(blob, baseName + ".lrc");
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}.${ms.toString().padStart(2,'0')}`;
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}
