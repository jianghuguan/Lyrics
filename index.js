// --- 1. 设置与依赖 ---
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
        alert("库加载失败，请检查网络");
        console.error(e);
        return false;
    }
}

// --- 2. 弹窗 UI (Flex 布局 + 独立滚动) ---
function createCustomPopup(htmlContent) {
    const old = document.getElementById('mt-custom-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mt-custom-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        zIndex: 20000,
        display: 'flex', justifyContent: 'center', alignItems: 'center', // 垂直居中
        backdropFilter: 'blur(5px)'
    });

    const container = document.createElement('div');
    container.className = 'mt-modal';
    Object.assign(container.style, {
        position: 'relative', 
        width: '1000px', maxWidth: '95%', 
        height: '90vh', // 固定高度，占屏幕 90%
        backgroundColor: '#1e1e1e', border: '1px solid #333', color: '#eee',
        borderRadius: '12px', padding: '20px', 
        boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column', gap: '15px',
        overflow: 'hidden' // 【关键】禁止整个弹窗滚动，只让内部区域滚动
    });

    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '❌';
    Object.assign(closeBtn.style, {
        position: 'absolute', top: '15px', right: '15px',
        cursor: 'pointer', fontSize: '18px', zIndex: 100, color: '#fff', opacity: '0.8'
    });
    closeBtn.onclick = () => {
        if(window.mtWaveSurfer) window.mtWaveSurfer.destroy();
        overlay.remove();
    };

    container.innerHTML = htmlContent;
    container.appendChild(closeBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
}

// --- 3. 入口 ---
jQuery(async () => {
    console.log("🎵 Music Tagger Loaded (Final Fix)");
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
    btn.onclick = async () => {
        const loaded = await loadLibraries();
        if(loaded) openTaggerModal();
    };
    document.body.appendChild(btn);
}

// --- 4. 界面构建 ---
function openTaggerModal() {
    const settings = getSettings();
    
    const html = `
        <h3 style="margin:0; border-bottom:1px solid #444; padding-bottom:10px; color:#fff; display:flex; justify-content:space-between; flex-shrink: 0;">
            <span>🎵 智能歌词剪辑台</span>
            <span style="font-size:12px; color:#aaa; font-weight:normal; margin-top:5px;">WaveSurfer Engine</span>
        </h3>
        
        <!-- 顶部：设置 (分析完成后隐藏) -->
        <div id="mt-setup-area" style="display:flex; flex-direction:column; gap:15px; overflow-y:auto;">
            <div style="display:flex; gap:20px; flex-wrap:wrap;">
                <div style="flex:1;">
                    <label class="mt-label" style="color:#ccc; display:block; margin-bottom:5px;">1. Groq API Key:</label>
                    <input type="password" id="mt-key" value="${settings.apiKey || ''}" placeholder="gsk_..." style="width:100%; padding:8px; background:#333; color:#fff; border:1px solid #555; border-radius:4px;" />
                </div>
                <div style="flex:1;">
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
                <textarea id="mt-lyrics-raw" rows="3" placeholder="粘贴纯歌词文本，AI 将尝试自动对齐..." style="width:100%; background:#333; color:#fff; border:1px solid #555; border-radius:4px; resize:vertical;"></textarea>
            </div>
            <button id="mt-process-btn" style="width:100%; padding:12px; background:#2b5e99; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">⚡ 开始 AI 分析 & 加载编辑器</button>
            <div id="mt-status" style="color:cyan; font-weight:bold; height:20px; font-size:14px;"></div>
        </div>

        <!-- 底部：编辑器区域 (Flex 列布局) -->
        <div id="mt-editor-area" style="display:none; flex-direction:column; flex:1; overflow:hidden; border-top:1px solid #444; padding-top:10px;">
            
            <!-- 固定控制区 -->
            <div style="display:flex; gap:15px; margin-bottom:10px; align-items:center; flex-shrink: 0;">
                <button id="mt-play-pause" style="background:#28a745; color:white; border:none; padding:5px 15px; border-radius:4px; cursor:pointer;">▶ 播放/暂停</button>
                <div style="display:flex; align-items:center; gap:5px; color:#ccc; font-size:12px;">
                    <span>🔍 缩放:</span>
                    <input type="range" id="mt-zoom" min="10" max="300" value="50" style="width:100px;">
                </div>
                <div style="color:#aaa; font-size:12px; margin-left:auto;">
                    ✋ 拖动两端 | 👆 点击跳转 | 🖱 滚轮查看列表
                </div>
            </div>

            <!-- 波形区 (固定高度，禁止触摸滚动以修复拖拽断触) -->
            <div id="mt-waveform" style="width:100%; height:120px; background:#000; border-radius:4px; margin-bottom:10px; flex-shrink: 0; touch-action: none;"></div>
            
            <!-- 歌词列表 (独立滚动区域) -->
            <div style="flex:1; overflow-y:auto; background:#141414; padding:10px; border-radius:4px; border:1px solid #333; margin-bottom:10px;">
                <div id="mt-rows-container"></div>
            </div>

            <!-- 底部按钮区 -->
            <div style="display:flex; gap:10px; justify-content:flex-end; flex-shrink: 0;">
                <button id="mt-download-lrc" style="background:#555; padding:8px 15px; color:white; border:none; border-radius:4px; cursor:pointer;">下载 .lrc</button>
                <button id="mt-download-mp3" style="background:#2b5e99; padding:8px 15px; color:white; border:none; border-radius:4px; cursor:pointer;">💾 导出 MP3</button>
            </div>
        </div>
    `;

    createCustomPopup(html);

    // 事件绑定
    const fileInput = document.getElementById('mt-file');
    const fileBtn = document.getElementById('mt-file-btn');
    const nameSpan = document.getElementById('mt-filename');

    fileBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => {
        if (fileInput.files.length) {
            nameSpan.innerText = fileInput.files[0].name;
            nameSpan.style.color = '#4caf50';
        }
    };

    document.getElementById('mt-key').oninput = (e) => {
        const s = getSettings(); s.apiKey = e.target.value; saveSettings(s);
    };

    document.getElementById('mt-process-btn').onclick = runAIAndInitEditor;
    
    document.getElementById('mt-zoom').oninput = (e) => {
        if (window.mtWaveSurfer) window.mtWaveSurfer.zoom(Number(e.target.value));
    };
    document.getElementById('mt-play-pause').onclick = () => {
        if (window.mtWaveSurfer) window.mtWaveSurfer.playPause();
    };

    document.getElementById('mt-download-lrc').onclick = () => exportLrc(false);
    document.getElementById('mt-download-mp3').onclick = () => exportLrc(true);
}

// --- 5. 核心逻辑 ---
async function runAIAndInitEditor() {
    const file = document.getElementById('mt-file').files[0];
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!file || !apiKey) return alert("请先选择文件并填写 Key");

    status.innerText = "⏳ 正在分析 (Groq Whisper)...";
    document.getElementById('mt-process-btn').disabled = true;

    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "verbose_json");
        
        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST", headers: { "Authorization": `Bearer ${apiKey}` }, body: formData
        });

        if (!response.ok) throw new Error((await response.json()).error?.message || "API Error");
        const data = await response.json();

        status.innerText = "✅ 渲染编辑器...";
        document.getElementById('mt-editor-area').style.display = 'flex';
        document.getElementById('mt-setup-area').style.display = 'none'; // 隐藏设置，腾出空间
        
        await initWaveSurfer(file, data.segments, rawText);
        status.innerText = ""; 

    } catch (e) {
        status.innerText = "❌ 错误: " + e.message;
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// --- 6. WaveSurfer 编辑器 (修复代码乱码 + 拖拽流畅) ---
async function initWaveSurfer(fileBlob, segments, userRawText) {
    if (window.mtWaveSurfer) window.mtWaveSurfer.destroy();
    
    const WaveSurfer = window.WaveSurfer;
    const RegionsPlugin = window.WaveSurfer.Regions;

    // 创建 WaveSurfer
    const ws = WaveSurfer.create({
        container: '#mt-waveform',
        waveColor: '#4F4A85',
        progressColor: '#383351',
        url: URL.createObjectURL(fileBlob),
        height: 120,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        cursorColor: '#ff0000',
        cursorWidth: 2,
        normalize: true,
        backend: 'WebAudio'
    });

    const wsRegions = ws.registerPlugin(RegionsPlugin.create());
    
    window.mtWaveSurfer = ws;
    window.mtRegions = wsRegions;

    const userLines = userRawText.split('\n').filter(l => l.trim());
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    ws.on('ready', () => {
        ws.zoom(50);
        
        segments.forEach((seg, index) => {
            const text = userLines[index] || seg.text.trim();
            const color = (index % 2 === 0) ? "rgba(0, 123, 255, 0.2)" : "rgba(40, 167, 69, 0.2)";

            // 【修复】使用 DOM 元素作为 content，避免显示 HTML 代码
            const label = document.createElement('div');
            label.textContent = text;
            Object.assign(label.style, {
                color: '#fff', fontSize: '11px', padding: '4px',
                overflow: 'hidden', whiteSpace: 'nowrap', 
                pointerEvents: 'none', // 让点击透传给 Region
                textShadow: '0 1px 2px #000'
            });

            const region = wsRegions.addRegion({
                id: `seg-${index}`,
                start: seg.start,
                end: seg.end,
                content: label, // 传入 DOM 对象
                color: color,
                drag: false,   // 禁止整体拖动
                resize: true,  // 允许两端拖动
            });

            // 列表行
            const row = document.createElement('div');
            row.id = `row-${region.id}`;
            row.style.cssText = "display:flex; gap:10px; margin-bottom:8px; align-items:center; background:#222; padding:10px; border-radius:6px;";
            row.innerHTML = `
                <span style="color:#666; font-size:14px; width:25px; font-weight:bold;">${index+1}</span>
                <input type="text" class="mt-row-text" value="${text}" style="flex:1; background:#333; color:#eee; border:none; padding:8px; border-radius:4px; font-size:14px;">
                <span class="mt-time-disp" style="font-family:monospace; color:#aaa; font-size:13px; min-width:90px; text-align:right;">${formatTime(seg.start)}</span>
            `;
            
            // 联动：输入框改字 -> 更新波形上的 DOM 文本
            row.querySelector('input').addEventListener('input', (e) => {
                const newText = e.target.value;
                label.textContent = newText; // 直接修改 DOM，不再 setOptions，防止重绘闪烁
            });

            // 联动：点击行 -> 只跳转播放，不滚动列表
            row.onclick = (e) => {
                if(e.target.tagName !== 'INPUT') {
                    ws.setTime(region.start);
                    // 【修复】移除 row.scrollIntoView，保持视图稳定
                    
                    // 仅高亮当前行
                    document.querySelectorAll('#mt-rows-container > div').forEach(d => d.style.background = '#222');
                    row.style.background = '#334455';
                }
            };
            container.appendChild(row);
        });
    });

    // 波形点击 -> 跳转播放 & 高亮列表（带滚动，方便找）
    wsRegions.on('region-clicked', (region, e) => {
        e.stopPropagation();
        region.play(); 
        
        const row = document.getElementById(`row-${region.id}`);
        if(row) {
            document.querySelectorAll('#mt-rows-container > div').forEach(d => d.style.background = '#222');
            row.style.background = '#334455';
            // 只有点击波形时，才自动滚动列表，方便用户知道点到哪句了
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    // 拖动波形边缘 -> 实时更新时间
    wsRegions.on('region-updated', (region) => {
        const row = document.getElementById(`row-${region.id}`);
        if (row) {
            row.querySelector('.mt-time-disp').innerText = formatTime(region.start);
            // 拖动时不自动滚动，防止列表乱跳
            document.querySelectorAll('#mt-rows-container > div').forEach(d => d.style.background = '#222');
            row.style.background = '#334455';
        }
    });
}

// --- 7. 导出 ---
async function exportLrc(embed) {
    if (!window.mtRegions) return;
    const regions = window.mtRegions.getRegions().sort((a, b) => a.start - b.start);
    let lrcContent = "";
    regions.forEach(r => {
        const row = document.getElementById(`row-${r.id}`);
        const text = row ? row.querySelector('.mt-row-text').value : "";
        lrcContent += `[${formatTime(r.start)}]${text}\n`;
    });
    const file = document.getElementById('mt-file').files[0];
    const baseName = file.name.replace(/\.[^/.]+$/, "");

    if (!embed) {
        download(new Blob([lrcContent]), baseName + ".lrc");
    } else {
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 写入 ID3 标签...";
        try {
            const writer = new window.ID3Writer(await file.arrayBuffer());
            writer.setFrame('USLT', { description: '', lyrics: lrcContent, language: 'eng' });
            writer.addTag();
            download(new Blob([writer.getBlob()]), baseName + "_lyrics.mp3");
            status.innerText = "✅ 成功! 建议同时下载 .lrc";
        } catch(e) { status.innerText = "❌ 写入失败: " + e.message; }
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
