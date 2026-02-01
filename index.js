// --- 1. 设置与依赖加载 ---
const SETTINGS_KEY = "music_tagger_settings";
const LIBS = {
    id3: "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js",
    wavesurfer: "https://unpkg.com/wavesurfer.js@7.7.0/dist/wavesurfer.min.js",
    wsRegions: "https://unpkg.com/wavesurfer.js@7.7.0/dist/plugins/regions.min.js"
};

function getSettings() {
    const local = localStorage.getItem(SETTINGS_KEY);
    return local ? JSON.parse(local) : { apiKey: "" };
}

function saveSettings(newSettings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
}

// 动态加载所有依赖库
async function loadLibraries() {
    const loadScript = (src) => new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });

    try {
        await Promise.all(Object.values(LIBS).map(loadScript));
        return true;
    } catch (e) {
        alert("库加载失败，请检查网络: " + e.message);
        return false;
    }
}

// --- 2. 核心：弹窗 UI (顶部对齐 + 波形容器) ---
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
        paddingTop: '60px', backdropFilter: 'blur(5px)'
    });

    const container = document.createElement('div');
    container.className = 'mt-modal';
    Object.assign(container.style, {
        position: 'relative', width: '900px', maxWidth: '95%', height: '85vh',
        backgroundColor: '#1e1e1e', border: '1px solid #333', color: '#eee',
        borderRadius: '12px', padding: '20px', boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column', gap: '15px', overflow: 'hidden'
    });

    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '❌';
    Object.assign(closeBtn.style, {
        position: 'absolute', top: '15px', right: '15px',
        cursor: 'pointer', fontSize: '18px', zIndex: 100, color: '#fff', opacity: '0.8'
    });
    closeBtn.onclick = () => {
        if(window.mtWaveSurfer) window.mtWaveSurfer.destroy(); // 销毁实例防止内存泄漏
        overlay.remove();
    };

    container.innerHTML = htmlContent;
    container.appendChild(closeBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
}

// --- 3. 插件入口 ---
jQuery(async () => {
    console.log("🎵 Music Tagger Loaded (Waveform Editor)");
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
        await loadLibraries();
        openTaggerModal();
    };
    document.body.appendChild(btn);
}

// --- 4. 界面逻辑 ---
function openTaggerModal() {
    const settings = getSettings();
    
    const html = `
        <h3 style="margin:0; border-bottom:1px solid #444; padding-bottom:10px; color:#fff; display:flex; justify-content:space-between;">
            <span>🎵 智能歌词编辑器</span>
            <span style="font-size:12px; color:#aaa; font-weight:normal; margin-top:5px;">WaveSurfer Engine</span>
        </h3>
        
        <!-- 上半部分：设置与上传 -->
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

        <!-- 下半部分：波形编辑器 (初始隐藏) -->
        <div id="mt-editor-area" style="display:none; flex-direction:column; flex:1; border-top:1px solid #444; padding-top:10px; overflow:hidden;">
            
            <!-- 工具栏 -->
            <div style="display:flex; gap:15px; margin-bottom:10px; align-items:center;">
                <button id="mt-play-pause" style="background:#28a745; color:white; border:none; padding:5px 15px; border-radius:4px; cursor:pointer;">▶ 播放/暂停</button>
                <div style="display:flex; align-items:center; gap:5px; color:#ccc; font-size:12px;">
                    <span>🔍 缩放:</span>
                    <input type="range" id="mt-zoom" min="10" max="200" value="50" style="width:100px;">
                </div>
                <div style="color:#aaa; font-size:12px; margin-left:auto;">
                    💡 拖动色块边缘调整时间，双击色块播放
                </div>
            </div>

            <!-- 波形容器 -->
            <div id="mt-waveform" style="width:100%; height:120px; background:#000; border-radius:4px; margin-bottom:10px;"></div>
            
            <!-- 歌词列表 (用于编辑文字) -->
            <div style="flex:1; overflow-y:auto; background:#111; padding:10px; border-radius:4px; border:1px solid #333;">
                <div id="mt-rows-container"></div>
            </div>

            <!-- 底部按钮 -->
            <div style="margin-top:15px; display:flex; gap:10px; justify-content:flex-end;">
                <button id="mt-download-lrc" style="background:#555; padding:8px 15px; color:white; border:none; border-radius:4px; cursor:pointer;">下载 .lrc (推荐)</button>
                <button id="mt-download-mp3" style="background:#2b5e99; padding:8px 15px; color:white; border:none; border-radius:4px; cursor:pointer;">💾 导出内嵌 MP3</button>
            </div>
        </div>
    `;

    createCustomPopup(html);

    // --- 事件绑定 ---
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

// --- 5. AI 分析与编辑器初始化 ---
async function runAIAndInitEditor() {
    const file = document.getElementById('mt-file').files[0];
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!file || !apiKey) return alert("请先选择文件并填写 Key");

    status.innerText = "⏳ 正在上传音频进行 AI 分析...";
    document.getElementById('mt-process-btn').disabled = true;

    try {
        // 1. 请求 Groq API
        const formData = new FormData();
        formData.append("file", file);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "verbose_json");
        // 如果用户提供了文本，可以用 prompt 引导 (Groq Whisper 可能支持 prompt，也可能不支持，视情况而定，这里仅做转录)
        
        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST", headers: { "Authorization": `Bearer ${apiKey}` }, body: formData
        });

        if (!response.ok) throw new Error((await response.json()).error?.message || "API Error");
        const data = await response.json();

        // 2. 初始化编辑器
        status.innerText = "✅ 分析完成，正在加载波形...";
        document.getElementById('mt-editor-area').style.display = 'flex';
        document.getElementById('mt-setup-area').style.display = 'none'; // 隐藏顶部设置节省空间
        
        await initWaveSurfer(file, data.segments, rawText);
        status.innerText = "🎵 编辑器就绪！请拖拽波形调整时间。";

    } catch (e) {
        status.innerText = "❌ 错误: " + e.message;
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// --- 6. WaveSurfer 编辑器逻辑 ---
async function initWaveSurfer(fileBlob, segments, userRawText) {
    if (window.mtWaveSurfer) window.mtWaveSurfer.destroy();

    const WaveSurfer = window.WaveSurfer;
    const RegionsPlugin = window.WaveSurfer.Regions;

    // 创建 WaveSurfer 实例
    const ws = WaveSurfer.create({
        container: '#mt-waveform',
        waveColor: '#4F4A85',
        progressColor: '#383351',
        url: URL.createObjectURL(fileBlob),
        height: 120,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
    });

    // 注册 Regions 插件 (用于歌词块)
    const wsRegions = ws.registerPlugin(RegionsPlugin.create());
    window.mtWaveSurfer = ws;
    window.mtRegions = wsRegions;

    // 处理文本对应关系
    const userLines = userRawText.split('\n').filter(l => l.trim());
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    ws.on('ready', () => {
        ws.zoom(50); // 默认缩放
        
        // 创建 Region 和 输入框
        segments.forEach((seg, index) => {
            const text = userLines[index] || seg.text.trim();
            const color = (index % 2 === 0) ? "rgba(0, 123, 255, 0.2)" : "rgba(40, 167, 69, 0.2)";

            // 1. 在波形上添加区域
            const region = wsRegions.addRegion({
                id: `seg-${index}`,
                start: seg.start,
                end: seg.end,
                content: `<div style="color:#fff; font-size:10px; padding:2px; overflow:hidden; white-space:nowrap;">${text}</div>`,
                color: color,
                drag: true,
                resize: true
            });

            // 2. 在下方列表添加输入框
            const row = document.createElement('div');
            row.id = `row-${region.id}`;
            row.style.cssText = "display:flex; gap:10px; margin-bottom:5px; align-items:center; background:#222; padding:5px;";
            row.innerHTML = `
                <span style="color:#666; font-size:12px; width:20px;">${index+1}</span>
                <input type="text" class="mt-row-text" value="${text}" style="flex:1; background:#333; color:#eee; border:none; padding:5px;">
                <span class="mt-time-disp" style="font-family:monospace; color:#aaa; font-size:12px;">${formatTime(seg.start)}</span>
            `;
            
            // 绑定：输入框文字修改 -> 更新波形上的文字
            row.querySelector('input').addEventListener('input', (e) => {
                const newText = e.target.value;
                region.setOptions({ content: `<div style="color:#fff; font-size:10px; padding:2px; overflow:hidden; white-space:nowrap;">${newText}</div>` });
            });

            // 绑定：点击行 -> 波形跳转
            row.onclick = (e) => {
                if(e.target.tagName !== 'INPUT') {
                    region.play();
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            };

            container.appendChild(row);
        });
    });

    // 绑定：拖拽 Region -> 更新列表时间显示
    wsRegions.on('region-updated', (region) => {
        const row = document.getElementById(`row-${region.id}`);
        if (row) {
            row.querySelector('.mt-time-disp').innerText = formatTime(region.start);
            // 高亮当前正在编辑的行
            document.querySelectorAll('#mt-rows-container > div').forEach(d => d.style.border = 'none');
            row.style.borderLeft = '3px solid #007bff';
        }
    });

    // 绑定：点击 Region -> 播放该片段
    wsRegions.on('region-clicked', (region, e) => {
        e.stopPropagation();
        region.play();
        const row = document.getElementById(`row-${region.id}`);
        if(row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

// --- 7. 导出逻辑 ---
async function exportLrc(embed) {
    if (!window.mtRegions) return;
    
    // 获取所有 Regions，按开始时间排序
    const regions = window.mtRegions.getRegions().sort((a, b) => a.start - b.start);
    
    let lrcContent = "";
    regions.forEach(r => {
        // 从对应的 DOM 输入框获取最新文本（因为用户可能修改了文字）
        const row = document.getElementById(`row-${r.id}`);
        const text = row ? row.querySelector('.mt-row-text').value : "";
        lrcContent += `[${formatTime(r.start)}]${text}\n`;
    });

    const file = document.getElementById('mt-file').files[0];
    const baseName = file.name.replace(/\.[^/.]+$/, "");

    if (!embed) {
        // 纯 LRC 下载
        download(new Blob([lrcContent]), baseName + ".lrc");
    } else {
        // 内嵌 MP3
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 写入 ID3 标签...";
        try {
            const writer = new window.ID3Writer(await file.arrayBuffer());
            
            // 写入 USLT (非同步文本) - 这是最通用的内嵌方式，但不支持滚动
            writer.setFrame('USLT', {
                description: 'Lyrics',
                lyrics: lrcContent,
                language: 'eng' // 改为 eng 兼容性稍好
            });
            
            // 尝试添加 COMM (注释) 标签，有些播放器读这个
            writer.setFrame('COMM', {
                description: 'Lyrics',
                text: lrcContent,
                language: 'eng'
            });

            writer.addTag();
            download(new Blob([writer.getBlob()]), baseName + "_embedded.mp3");
            status.innerText = "✅ 导出成功！(若不显示歌词请配合 .lrc 使用)";
            alert("导出成功！\n\n注意：大部分播放器不支持内嵌的‘滚动’歌词。\n如果播放器里歌词不动，请务必使用同时下载的 .lrc 文件。");
        } catch(e) {
            status.innerText = "❌ 写入失败";
            alert(e.message);
        }
    }
}

// 辅助：时间格式化 12.345 -> 00:12.34
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
