// --- 1. 设置与库加载 (新增 WaveSurfer 支持) ---
const SETTINGS_KEY = "music_tagger_settings";
// ID3 库
const ID3_LIB_URL = "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js";
// WaveSurfer 核心库 (音频波形)
const WS_LIB_URL = "https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.min.js";
// WaveSurfer Regions 插件 (区块拖拽)
const WS_REGIONS_URL = "https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.min.js";

let libsLoaded = { id3: false, ws: false };
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

// 统一加载所有必要的库
async function loadAllLibraries() {
    const loadScript = (url) => new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });

    if (!libsLoaded.id3 && !window.ID3Writer) {
        await loadScript(ID3_LIB_URL);
        libsLoaded.id3 = true;
    }
    if (!libsLoaded.ws && !window.WaveSurfer) {
        await loadScript(WS_LIB_URL);
        await loadScript(WS_REGIONS_URL);
        libsLoaded.ws = true;
    }
}

// --- 2. 核心：自制弹窗 (顶部对齐 + 波形可视区域) ---
function createCustomPopup(htmlContent) {
    const old = document.getElementById('mt-custom-overlay');
    if (old) old.remove();

    // 销毁旧波形实例防止内存泄漏
    if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; }

    const overlay = document.createElement('div');
    overlay.id = 'mt-custom-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.85)', // 背景更深一点，为了看清波形
        zIndex: 20000,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '60px', backdropFilter: 'blur(5px)'
    });

    const container = document.createElement('div');
    container.className = 'mt-modal'; 
    Object.assign(container.style, {
        position: 'relative',
        width: '900px', // 宽度加宽，方便剪辑
        maxWidth: '95%', 
        height: '85vh', // 固定高度，为了让内部滚动
        display: 'flex', flexDirection: 'column',
        backgroundColor: '#1a1b1e', 
        border: '1px solid #444', color: '#eee', borderRadius: '8px',
        padding: '20px', boxShadow: '0 10px 40px rgba(0,0,0,0.9)',
    });

    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '❌';
    Object.assign(closeBtn.style, {
        position: 'absolute', top: '15px', right: '15px',
        cursor: 'pointer', fontSize: '18px', zIndex: 10, color: '#fff', opacity: '0.8'
    });
    closeBtn.onclick = () => overlay.remove();

    container.innerHTML = htmlContent;
    container.appendChild(closeBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
}

// --- 3. 插件入口 ---
jQuery(async () => {
    console.log("🎵 Music Tagger Loaded (Waveform Editor Edition)");
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

// --- 4. 界面逻辑 ---
function openTaggerModal() {
    const settings = getSettings();
    
    const html = `
        <h3 style="margin:0 0 10px 0; border-bottom:1px solid #555; padding-bottom:10px; color:#fff;">🎵 MP3 歌词工具 (专业剪辑版)</h3>
        
        <div style="display:flex; gap:20px; flex-wrap:wrap;">
            <div style="flex:1; min-width:200px;">
                <label class="mt-label" style="color:#ccc;">1. Groq API Key:</label>
                <input type="password" id="mt-key" value="${settings.apiKey || ''}" placeholder="gsk_..." style="width:100%; padding:8px; background:#333; color:#fff; border:1px solid #555; border-radius:4px;" />
            </div>
            <div style="flex:1; min-width:200px;">
                <label class="mt-label" style="color:#ccc;">2. MP3 文件:</label>
                <div style="display:flex; align-items:center; gap:10px;">
                    <input type="file" id="mt-file" accept="audio/mp3" style="display:none;" />
                    <button id="mt-file-trigger-btn" style="padding:8px 15px; background:#555; color:white; border:1px solid #777; cursor:pointer; border-radius:4px;">📂 选择文件</button>
                    <span id="mt-file-name-display" style="color:#aaa; font-size:0.9em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px;">未选择</span>
                </div>
            </div>
        </div>

        <div style="margin-top:10px;">
            <label class="mt-label" style="color:#ccc;">3. 粘贴歌词 (可选，用于辅助校对):</label>
            <textarea id="mt-lyrics-raw" rows="2" placeholder="粘贴纯文本歌词，AI识别后将自动填充..." style="width:100%; padding:8px; background:#333; color:#fff; border:1px solid #555; border-radius:4px;"></textarea>
        </div>

        <button id="mt-process-btn" style="width:100%; margin-top:10px; padding:10px; background:#2b5e99; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">⚡ 开始 AI 分析与波形加载</button>
        <div id="mt-status" style="color:cyan; margin:5px 0; font-weight:bold; height:20px; font-size:14px;"></div>

        <!-- 编辑区域：默认隐藏 -->
        <div id="mt-editor-area" style="display:none; flex-direction:column; flex:1; overflow:hidden; margin-top:10px; border-top:1px solid #444; padding-top:10px;">
            
            <!-- 波形容器 -->
            <div style="margin-bottom:5px; display:flex; justify-content:space-between; color:#aaa; font-size:12px;">
                <span>🌊 音频波形 (拖动边缘调整时间，双击区域播放)</span>
                <span>🖱️ 滚轮缩放 / 拖拽调整</span>
            </div>
            <div id="mt-waveform" style="width:100%; height:120px; background:#000; border-radius:4px; border:1px solid #333; margin-bottom:10px;"></div>
            
            <!-- 歌词列表容器 -->
            <div id="mt-rows-header" style="display:flex; padding:0 10px; margin-bottom:5px; font-weight:bold; color:#888;">
                <span style="width:80px;">开始</span>
                <span style="width:80px;">结束</span>
                <span style="flex:1;">歌词内容</span>
                <span style="width:30px;"></span>
            </div>
            <div id="mt-rows-container" style="flex:1; overflow-y:auto; background:#111; padding:10px; border:1px solid #444; border-radius:4px;"></div>

            <!-- 底部按钮 -->
            <div style="margin-top:15px; display:flex; gap:10px; justify-content:flex-end;">
                <button id="mt-download-lrc" style="background:#444; padding:8px 15px; color:white; border:none; border-radius:4px; cursor:pointer;">仅导出 LRC</button>
                <button id="mt-download-mp3" style="background:#2b5e99; padding:8px 15px; color:white; border:none; border-radius:4px; cursor:pointer;">💾 导出嵌入歌词的 MP3</button>
            </div>
        </div>
    `;

    createCustomPopup(html);

    // 绑定事件
    setTimeout(() => {
        const fileInput = document.getElementById('mt-file');
        document.getElementById('mt-file-trigger-btn').onclick = () => fileInput.click();
        fileInput.onchange = () => {
            const display = document.getElementById('mt-file-name-display');
            if(fileInput.files[0]) {
                display.innerText = "✅ " + fileInput.files[0].name;
                display.style.color = "#4caf50";
            }
        };

        document.getElementById('mt-key').oninput = (e) => {
            const s = getSettings(); s.apiKey = e.target.value; saveSettings(s);
        };
        
        document.getElementById('mt-process-btn').onclick = runAIAndWaveform;
        document.getElementById('mt-download-mp3').onclick = () => handleExport(true);
        document.getElementById('mt-download-lrc').onclick = () => handleExport(false);

        // 预加载库
        loadAllLibraries(); 
    }, 100);
}

// --- 5. 核心逻辑：AI 分析 + 波形初始化 ---
async function runAIAndWaveform() {
    const fileInput = document.getElementById('mt-file');
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!fileInput.files[0]) { status.innerText = "❌ 请选择文件"; return; }
    if (!apiKey) { status.innerText = "❌ 请输入 Key"; return; }

    status.innerText = "⏳ 正在加载库文件...";
    await loadAllLibraries();
    
    document.getElementById('mt-process-btn').disabled = true;
    
    try {
        // 1. 初始化 WaveSurfer (先显示空波形，让用户知道在加载)
        status.innerText = "🌊 正在生成波形...";
        document.getElementById('mt-editor-area').style.display = 'flex';
        
        await initWaveSurfer(fileInput.files[0]);

        // 2. 调用 AI
        status.innerText = "🚀 正在上传 Groq 进行 AI 识别 (请稍候)...";
        const formData = new FormData();
        formData.append("file", fileInput.files[0]);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "verbose_json");

        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST", headers: { "Authorization": `Bearer ${apiKey}` }, body: formData
        });

        if (!response.ok) throw new Error((await response.json()).error?.message || "API Error");

        const data = await response.json();
        
        // 3. 将 AI 结果渲染到波形上
        status.innerText = "✅ 分析完成！请在下方微调。";
        syncDataToEditor(data.segments, rawText);

    } catch (e) {
        status.innerText = "❌ 出错: " + e.message;
        console.error(e);
    } finally {
        document.getElementById('mt-process-btn').disabled = false;
    }
}

// 初始化 WaveSurfer
function initWaveSurfer(fileBlob) {
    return new Promise((resolve, reject) => {
        const container = document.getElementById('mt-waveform');
        container.innerHTML = ''; // 清空

        // 创建实例
        wavesurfer = WaveSurfer.create({
            container: container,
            waveColor: '#4F4A85',
            progressColor: '#383351',
            cursorColor: '#ff0000',
            barWidth: 2,
            height: 120,
            normalize: true,
            minPxPerSec: 100, // 关键：拉宽波形，方便剪辑
            scrollParent: true,
            interact: true,
            plugins: [
                WaveSurfer.Regions.create()
            ]
        });

        wsRegions = wavesurfer.plugins[0];

        // 启用拖拽更新
        wsRegions.on('region-updated', (region) => {
            updateInputFromRegion(region);
        });

        wsRegions.on('region-clicked', (region, e) => {
            e.stopPropagation(); // 防止触发 seek
            region.play();
        });
        
        // 也就是点击波形空白处时
        wavesurfer.on('interaction', () => {
             // 可以在这里做暂停或其他逻辑
        });

        wavesurfer.loadBlob(fileBlob);
        wavesurfer.on('ready', resolve);
        wavesurfer.on('error', reject);
    });
}

// 将数据同步到 编辑器 (Region + List)
function syncDataToEditor(segments, userText) {
    // 清空现有内容
    wsRegions.clearRegions();
    const listContainer = document.getElementById('mt-rows-container');
    listContainer.innerHTML = "";
    
    const userLines = userText.split('\n').filter(l => l.trim().length > 0);

    segments.forEach((seg, index) => {
        // 1. 在波形上创建 Region
        // Whisper 有时没有准确的 end，如果 end - start 太大，可能需要手动截断，这里暂且信任
        const regionId = 'region-' + index;
        const txt = userLines[index] !== undefined ? userLines[index] : seg.text.trim();
        
        const region = wsRegions.addRegion({
            id: regionId,
            start: seg.start,
            end: seg.end,
            content: `<span style="color:#fff; text-shadow:1px 1px 0 #000; font-size:10px; padding:2px;">${txt.substring(0, 10)}...</span>`,
            color: 'rgba(0, 123, 255, 0.3)',
            drag: true,
            resize: true
        });

        // 2. 在下方列表创建输入行
        const row = document.createElement('div');
        row.id = 'row-' + regionId;
        row.className = 'mt-row';
        row.style.cssText = "display:flex; gap:5px; margin-bottom:5px; align-items:center;";

        // 格式化时间的辅助函数
        const fmt = (t) => {
            const m = Math.floor(t / 60).toString().padStart(2,'0');
            const s = Math.floor(t % 60).toString().padStart(2,'0');
            const ms = Math.floor((t % 1) * 100).toString().padStart(2,'0');
            return `[${m}:${s}.${ms}]`;
        };

        row.innerHTML = `
            <input type="text" class="mt-start" value="${fmt(seg.start)}" style="width:75px; background:#222; color:#8f8; border:1px solid #444; text-align:center; font-family:monospace;">
            <input type="text" class="mt-end" value="${fmt(seg.end)}" style="width:75px; background:#222; color:#f88; border:1px solid #444; text-align:center; font-family:monospace;">
            <input type="text" class="mt-text" value="${txt}" style="flex:1; background:#333; color:#fff; border:1px solid #444; padding:5px;">
            <div class="mt-del" style="cursor:pointer; padding:5px; color:#666;">❌</div>
        `;
        
        listContainer.appendChild(row);

        // 3. 绑定列表事件 -> 反向更新 Region
        const startInput = row.querySelector('.mt-start');
        const endInput = row.querySelector('.mt-end');
        const textInput = row.querySelector('.mt-text');
        const delBtn = row.querySelector('.mt-del');

        // 输入框失焦时更新 Region
        const updateRegionFromInput = () => {
            const parse = (str) => {
                // [MM:SS.xx] -> seconds
                const m = str.match(/\[(\d+):(\d+)\.(\d+)\]/);
                if (m) return parseInt(m[1])*60 + parseInt(m[2]) + parseInt(m[3])/100;
                return region.start; // 格式错误保持原样
            };
            
            region.setOptions({
                start: parse(startInput.value),
                end: parse(endInput.value),
                content: `<span style="color:#fff; text-shadow:1px 1px 0 #000; font-size:10px;">${textInput.value.substring(0, 10)}...</span>`
            });
        };

        startInput.onchange = updateRegionFromInput;
        endInput.onchange = updateRegionFromInput;
        textInput.oninput = () => {
             // 实时更新波形上的文字预览
             region.setOptions({ content: `<span style="color:#fff; text-shadow:1px 1px 0 #000; font-size:10px;">${textInput.value.substring(0, 10)}...</span>` });
        };
        
        // 点击行 -> 滚动波形到对应位置并播放
        row.onclick = (e) => {
            if(e.target.tagName === 'INPUT' || e.target.className.includes('mt-del')) return;
            region.play();
        };

        delBtn.onclick = () => {
            region.remove();
            row.remove();
        };
    });
}

// 当拖拽 Region 时，更新对应的输入框
function updateInputFromRegion(region) {
    const row = document.getElementById('row-' + region.id);
    if (!row) return;

    const fmt = (t) => {
        const d = new Date(t * 1000);
        return `[${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${Math.floor(d.getMilliseconds()/10).toString().padStart(2,'0')}]`;
    };

    row.querySelector('.mt-start').value = fmt(region.start);
    row.querySelector('.mt-end').value = fmt(region.end);
}

// --- 6. 导出逻辑 ---
async function handleExport(embed) {
    // 从 Regions 获取最终数据，因为它们是最准的（经过了微调）
    const regions = wsRegions.getRegions();
    // 按时间排序
    regions.sort((a, b) => a.start - b.start);

    let lrc = "";
    regions.forEach(r => {
        const row = document.getElementById('row-' + r.id);
        if (row) {
            const timeStr = row.querySelector('.mt-start').value; // 使用格式化后的字符串
            const text = row.querySelector('.mt-text').value;
            lrc += `${timeStr}${text}\n`;
        }
    });

    if(!lrc) return alert("没有内容可导出");
    
    const file = document.getElementById('mt-file').files[0];
    const name = file.name.replace(/\.[^/.]+$/, "");

    if (!embed) {
        download(new Blob([lrc]), name + ".lrc");
    } else {
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 正在写入 ID3 标签...";
        try {
            if (!window.ID3Writer) await loadAllLibraries();
            const writer = new window.ID3Writer(await file.arrayBuffer());
            writer.setFrame('USLT', { description: '', lyrics: lrc, language: 'zho' });
            writer.addTag();
            download(new Blob([writer.getBlob()]), name + "_lyrics.mp3");
            status.innerText = "✅ 导出成功！";
        } catch(e) { 
            status.innerText = "❌ 写入失败: " + e.message; 
            alert("写入失败，请检查文件是否受保护。\n" + e.message);
        }
    }
}

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}```
