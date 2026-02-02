// --- 1. 设置与依赖管理 ---
const SETTINGS_KEY = "music_tagger_settings";
const URLS = {
    id3: "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js",
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

// 节流函数 (防卡顿)
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
        await loadScript(URLS.id3);
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
        .wavesurfer-region-handle { width: 12px !important; background-color: rgba(255, 255, 255, 0.4) !important; }
        .mt-no-select { user-select: none; -webkit-user-select: none; }
        #mt-lyrics-scroll-area::-webkit-scrollbar { width: 8px; }
        #mt-lyrics-scroll-area::-webkit-scrollbar-track { background: #1a1a1a; }
        #mt-lyrics-scroll-area::-webkit-scrollbar-thumb { background: #444; border-radius: 4px; }
        #mt-waveform::-webkit-scrollbar { height: 10px; }
        #mt-waveform::-webkit-scrollbar-track { background: #111; border-radius: 4px; }
        #mt-waveform::-webkit-scrollbar-thumb { background: #555; border-radius: 5px; border: 2px solid #111; }
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
        position: 'relative', width: '1000px', maxWidth: '95%', maxHeight: '92vh', height: 'auto',
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
    console.log("🎵 Music Tagger Loaded (Rescue Mode)");
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
            <span style="font-size:12px; color:#aaa; margin-top:5px;">WaveSurfer Engine</span>
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
            <div style="display:flex; gap:15px; margin-bottom:10px; align-items:center; position:sticky; top:0; background:#1e1e1e; z-index:10; padding:10px 0; border-bottom:1px solid #333;">
                <button id="mt-play-pause" style="background:#28a745; color:white; border:none; padding:5px 15px; border-radius:4px; cursor:pointer;">▶ 播放/暂停</button>
                <div style="display:flex; align-items:center; gap:5px; color:#ccc; font-size:12px;">
                    <span>🔍 缩放:</span>
                    <input type="range" id="mt-zoom" min="10" max="300" value="50" style="width:100px;">
                </div>
                <div style="color:#aaa; font-size:12px; margin-left:auto;">
                    🖱️ 双击波形空白处可手动添加歌词
                </div>
            </div>
            <div id="mt-waveform" style="width: 100%; height: 135px; background: #000; border-radius: 4px; margin-bottom: 15px; cursor: text; overflow-x: auto; overflow-y: hidden;"></div>
            <div id="mt-lyrics-scroll-area" style="background: #141414; padding: 10px; border-radius: 4px; border: 1px solid #333; height: 450px; overflow-y: auto; overscroll-behavior: contain; position: relative;">
                <div id="mt-rows-container"></div>
            </div>
            <div style="margin-top:20px; display:flex; gap:10px; justify-content:flex-end; padding-bottom:10px;">
                <button id="mt-download-lrc" style="background:#555; padding:10px 20px; color:white; border:none; border-radius:4px; cursor:pointer;">下载 .lrc</button>
                <button id="mt-download-mp3" style="background:#2b5e99; padding:10px 20px; color:white; border:none; border-radius:4px; cursor:pointer;">💾 导出内嵌 MP3</button>
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
    document.getElementById('mt-download-lrc').onclick = () => exportLrc(false);
    document.getElementById('mt-download-mp3').onclick = () => exportLrc(true);
}

// --- 5. AI 处理 ---
async function runAIAndInitEditor() {
    const file = document.getElementById('mt-file').files[0];
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!file || !apiKey) return alert("请先选择文件并填写 Key");

    status.innerText = "⏳ 正在分析 (强制分句模式)...";
    document.getElementById('mt-process-btn').disabled = true;

    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "verbose_json");
        // 【关键】修改提示词，强制要求按行切分，即使是短句也不要合并
        formData.append("prompt", "Split the lyrics line by line carefully. Do not merge multiple lines into one segment. Transcribe every single line. 一行歌词一个时间戳。");
        
        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST", headers: { "Authorization": `Bearer ${apiKey}` }, body: formData
        });

        if (!response.ok) throw new Error((await response.json()).error?.message || "API Error");
        const data = await response.json();

        status.innerText = "✅ 渲染中...";
        document.getElementById('mt-editor-area').style.display = 'flex';
        document.getElementById('mt-setup-area').style.display = 'none'; 
        
        await initWaveSurfer(file, data.segments, rawText);
        status.innerText = "🎵 完成！AI 遗漏的歌词已自动补在末尾，请拖动调整。双击波形可新增。";

    } catch (e) {
        status.innerText = "❌ 错误: " + e.message;
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// --- 6. 编辑器逻辑 (防丢失 & 双击添加) ---
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
        backend: 'WebAudio'
    });

    const wsRegions = ws.registerPlugin(RegionsPlugin.create());
    window.mtWaveSurfer = ws;
    window.mtRegions = wsRegions;

    const userLines = userRawText.split('\n').filter(l => l.trim());
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    // 辅助函数：创建一行 UI
    function createRow(regionId, initialText, startTime) {
        const row = document.createElement('div');
        row.id = `row-${regionId}`;
        row.style.cssText = "display:flex; gap:10px; margin-bottom:8px; align-items:center; background:#222; padding:10px; border-radius:6px; border-left:4px solid transparent;";
        row.innerHTML = `
            <span class="mt-idx" style="color:#666; font-size:14px; width:25px; font-weight:bold;">#</span>
            <input type="text" class="mt-row-text" value="${initialText}" style="flex:1; background:#333; color:#eee; border:none; padding:8px; border-radius:4px; font-size:14px;">
            <button class="mt-del-btn" style="background:#442222; color:#ff6666; border:none; cursor:pointer; padding:5px 8px; border-radius:4px; font-size:12px;">🗑️</button>
            <span class="mt-time-disp" style="font-family:monospace; color:#aaa; font-size:13px; min-width:90px; text-align:right;">${formatTime(startTime)}</span>
        `;
        
        // 文本同步
        row.querySelector('input').addEventListener('input', (e) => {
            const reg = wsRegions.getRegions().find(r => r.id === regionId);
            if(reg) reg.setOptions({ content: `<div style="color:#fff; font-size:10px; padding:2px; overflow:hidden; white-space:nowrap; pointer-events:none;">${e.target.value}</div>` });
        });

        // 也可以删除
        row.querySelector('.mt-del-btn').onclick = (e) => {
            e.stopPropagation();
            const reg = wsRegions.getRegions().find(r => r.id === regionId);
            if(reg) { reg.remove(); row.remove(); updateIndices(); }
        };

        // 点击定位
        row.onclick = (e) => {
            if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                const reg = wsRegions.getRegions().find(r => r.id === regionId);
                if(reg) ws.setTime(reg.start);
            }
        };
        return row;
    }

    // 辅助函数：更新所有行的序号
    function updateIndices() {
        const rows = document.getElementById('mt-rows-container').children;
        Array.from(rows).forEach((row, i) => {
            row.querySelector('.mt-idx').innerText = i + 1;
        });
    }

    ws.on('ready', () => {
        ws.zoom(50);
        const duration = ws.getDuration();
        
        // 【核心修复】：确定要生成的条目总数，取 AI 片段数和用户行数的最大值
        const loopCount = Math.max(segments.length, userLines.length);
        
        for (let i = 0; i < loopCount; i++) {
            let start, end, text;
            const seg = segments[i]; // 尝试获取 AI 数据
            const userLine = userLines[i]; // 尝试获取用户文本

            if (seg) {
                // 情况A: AI 有数据，正常使用
                start = seg.start;
                end = seg.end;
                text = userLine || seg.text.trim();
            } else {
                // 情况B: AI 没数据了，但用户还有文本 -> 开启“救援模式”
                // 将丢失的歌词放在音频末尾，每条 2 秒，依次堆叠
                // 留出最后 5 秒作为缓冲区，如果没有空间就在最后 2 秒堆叠
                let safeStart = Math.max(0, duration - 10 + (i - segments.length) * 2);
                if (safeStart >= duration) safeStart = duration - 2;
                
                start = safeStart;
                end = start + 2; 
                text = userLine || "MISSING LYRIC"; // 如果也没有文本，就标记为丢失
            }

            // 颜色区分：AI 生成的 vs 后来补的
            const color = seg ? 
                ((i % 2 === 0) ? "rgba(0, 123, 255, 0.2)" : "rgba(40, 167, 69, 0.2)") : 
                "rgba(255, 193, 7, 0.3)"; // 补救的显示黄色

            const region = wsRegions.addRegion({
                start: start,
                end: end,
                content: `<div style="color:#fff; font-size:10px; padding:2px; overflow:hidden; white-space:nowrap; pointer-events:none;">${text}</div>`,
                color: color,
                drag: true, resize: true
            });

            container.appendChild(createRow(region.id, text, start));
        }
        updateIndices();
    });

    // 【新增功能】双击波形空白处，手动添加歌词条
    ws.on('click', (relativeX) => {
        // 这个 click 事件通常是点击波形定位，我们利用它来检测双击需要一点技巧
        // 由于 wavesurfer 自身有 interaction，我们最好监听 wrapper 的 dblclick
    });

    // 监听容器的双击事件来添加 Region
    document.getElementById('mt-waveform').ondblclick = (e) => {
        const duration = ws.getDuration();
        const clickTime = ws.getCurrentTime(); // 双击时 cursor 已经跳过去了
        
        const newRegion = wsRegions.addRegion({
            start: clickTime,
            end: Math.min(clickTime + 2, duration),
            content: `<div style="color:#fff; font-size:10px; padding:2px; overflow:hidden; white-space:nowrap; pointer-events:none;">新歌词</div>`,
            color: "rgba(255, 255, 255, 0.3)"
        });

        // 插入到 UI 列表中（简单起见，追加到最后，用户自己调整顺序目前比较难做，但至少能编辑了）
        // 理想情况是按时间排序插入 DOM，这里简单追加
        const row = createRow(newRegion.id, "新歌词", clickTime);
        container.appendChild(row);
        updateIndices();
        
        // 自动滚动到底部
        row.scrollIntoView({ behavior: 'smooth' });
    };

    wsRegions.on('region-clicked', (region, e) => { e.stopPropagation(); region.play(); });

    // 性能优化版 Timeupdate
    let lastActiveRegionId = null;
    let lastActiveRowEl = null;
    
    const checkActiveRegion = throttle((currentTime) => {
        const regions = wsRegions.getRegions();
        // 找到开始时间 <= 当前时间 且 结束时间 > 当前时间的
        const activeRegion = regions.find(r => currentTime >= r.start && currentTime < r.end);

        if (activeRegion && activeRegion.id !== lastActiveRegionId) {
            lastActiveRegionId = activeRegion.id;
            if (lastActiveRowEl) {
                lastActiveRowEl.style.background = '#222';
                lastActiveRowEl.style.borderLeftColor = 'transparent';
            }
            const newRow = document.getElementById(`row-${activeRegion.id}`);
            if(newRow) {
                lastActiveRowEl = newRow;
                newRow.style.background = '#334455';
                newRow.style.borderLeftColor = '#007bff';
                newRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }
    }, 100);

    ws.on('timeupdate', checkActiveRegion);

    let animationFrameId = null;
    wsRegions.on('region-updated', (region) => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        animationFrameId = requestAnimationFrame(() => {
            const row = document.getElementById(`row-${region.id}`);
            if (row) row.querySelector('.mt-time-disp').innerText = formatTime(region.start);
        });
    });
}

// --- 7. 导出 ---
async function exportLrc(embed) {
    if (!window.mtRegions) return;
    // 导出时必须按 Start Time 重新排序，因为手动添加或拖拽后顺序可能变了
    const regions = window.mtRegions.getRegions().sort((a, b) => a.start - b.start);
    
    let lrcContent = "";
    regions.forEach(r => {
        const row = document.getElementById(`row-${r.id}`);
        // 如果行被删了但 region 还在（异常情况），取 region content
        let text = "";
        if (row) text = row.querySelector('.mt-row-text').value;
        else {
             // 尝试从 content HTML 解析纯文本，或直接空
             const temp = document.createElement('div');
             temp.innerHTML = r.content.innerHTML || "";
             text = temp.innerText;
        }
        lrcContent += `[${formatTime(r.start)}]${text}\n`;
    });
    
    const file = document.getElementById('mt-file').files[0];
    const baseName = file.name.replace(/\.[^/.]+$/, "");

    if (!embed) {
        download(new Blob([lrcContent]), baseName + ".lrc");
    } else {
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 写入中...";
        try {
            const writer = new window.ID3Writer(await file.arrayBuffer());
            writer.setFrame('USLT', { description: '', lyrics: lrcContent, language: 'eng' });
            writer.addTag();
            download(new Blob([writer.getBlob()]), baseName + "_lyrics.mp3");
            status.innerText = "✅ 完成";
        } catch(e) { status.innerText = "❌ 失败: " + e.message; }
    }
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
