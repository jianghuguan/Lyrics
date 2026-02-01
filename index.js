// --- 1. 设置与初始化 ---
const SETTINGS_KEY = "music_tagger_settings";
const ID3_LIB_URL = "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js";
let isLibLoaded = false;

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

async function loadID3Library() {
    if (isLibLoaded || window.ID3Writer) { isLibLoaded = true; return; }
    return new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = ID3_LIB_URL;
        script.onload = () => { isLibLoaded = true; resolve(); };
        script.onerror = () => {
            script.src = "https://cdn.jsdelivr.net/npm/browser-id3-writer@4.0.0/dist/browser-id3-writer.min.js";
        };
        document.head.appendChild(script);
    });
}

// --- 2. 核心：样式修复后的自制弹窗 ---
function createCustomPopup(htmlContent) {
    const old = document.getElementById('mt-custom-overlay');
    if (old) old.remove();

    // 1. 遮罩层 (全屏，负责居中)
    const overlay = document.createElement('div');
    overlay.id = 'mt-custom-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.6)', // 黑色半透明背景
        zIndex: 19000, // 确保在最上层
        display: 'flex', 
        justifyContent: 'center', // 水平居中
        alignItems: 'center',     // 垂直居中
        backdropFilter: 'blur(2px)'
    });

    // 2. 弹窗容器 (限制高度，添加实心背景)
    const container = document.createElement('div');
    container.className = 'mt-modal'; // 保留 CSS 类以便应用部分样式
    
    Object.assign(container.style, {
        position: 'relative',
        width: '600px', 
        maxWidth: '90%', 
        maxHeight: '85vh',       // 最大高度为屏幕的 85%
        overflowY: 'auto',       // 内容太多时，弹窗内部滚动，而不会超出屏幕
        backgroundColor: '#202124', // 【修复】强制深灰色背景，防止透明
        backgroundImage: 'var(--SmartThemeBackground)', // 尝试使用主题背景色
        color: 'var(--SmartThemeBodyColor, #fff)',
        borderRadius: '10px',
        padding: '20px',
        boxShadow: '0 5px 20px rgba(0,0,0,0.5)',
        display: 'flex', 
        flexDirection: 'column',
        gap: '10px'
    });

    // 关闭按钮
    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '❌';
    Object.assign(closeBtn.style, {
        position: 'absolute', top: '10px', right: '15px',
        cursor: 'pointer', fontSize: '18px', zIndex: 10,
        opacity: '0.7'
    });
    closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
    closeBtn.onmouseout = () => closeBtn.style.opacity = '0.7';
    closeBtn.onclick = () => overlay.remove();

    container.innerHTML = htmlContent;
    container.appendChild(closeBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

// --- 3. 插件入口 ---
jQuery(async () => {
    console.log("🎵 Music Tagger Loaded (Fixed Style)");
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
        <h3 style="margin:0 0 10px 0; border-bottom:1px solid #555; padding-bottom:10px;">🎵 MP3 歌词嵌入工具</h3>
        
        <div>
            <label class="mt-label">1. Groq API Key:</label>
            <input type="password" id="mt-key" class="text_pole mt-input" value="${settings.apiKey || ''}" placeholder="gsk_..." style="padding:8px;" />
        </div>

        <div>
            <label class="mt-label">2. MP3 文件:</label>
            <input type="file" id="mt-file" accept="audio/mp3" class="mt-input" style="padding:5px 0;" />
        </div>

        <div>
            <label class="mt-label">3. 粘贴纯文本歌词:</label>
            <textarea id="mt-lyrics-raw" class="text_pole mt-input" rows="5" placeholder="粘贴歌词..."></textarea>
        </div>

        <button id="mt-process-btn" class="mt-btn" style="width:100%; margin-top:10px;">⚡ 开始 AI 分析</button>
        <div id="mt-status" style="color:cyan; margin:5px 0; font-weight:bold; height:20px;"></div>

        <div id="mt-editor-area" style="display:none; flex-direction:column; overflow:hidden; flex:1; min-height:200px;">
            <div id="mt-rows-container" class="mt-scroll-area" style="max-height: 300px; overflow-y:auto;"></div>
            <div style="margin-top:10px; display:flex; gap:10px; justify-content:flex-end;">
                <button id="mt-download-lrc" class="mt-btn" style="background:#555;">仅 LRC</button>
                <button id="mt-download-mp3" class="mt-btn">💾 导出 MP3</button>
            </div>
        </div>
    `;

    createCustomPopup(html);

    setTimeout(() => {
        document.getElementById('mt-key').addEventListener('input', (e) => {
            const s = getSettings();
            s.apiKey = e.target.value;
            saveSettings(s);
        });
        document.getElementById('mt-process-btn').addEventListener('click', runAIAnalysis);
        document.getElementById('mt-download-mp3').addEventListener('click', () => handleExport(true));
        document.getElementById('mt-download-lrc').addEventListener('click', () => handleExport(false));
        loadID3Library();
    }, 100);
}

// --- 5. AI 处理逻辑 ---
async function runAIAnalysis() {
    const fileInput = document.getElementById('mt-file');
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!fileInput.files[0]) { status.innerText = "❌ 请选择文件"; return; }
    if (!apiKey) { status.innerText = "❌ 请输入 Key"; return; }

    status.innerText = "⏳ 分析中...";
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
        status.innerText = "✅ 完成！";
        renderEditor(data.segments, rawText);
        document.getElementById('mt-editor-area').style.display = 'flex';

    } catch (e) {
        status.innerText = "❌ 出错: " + e.message;
    } finally {
        document.getElementById('mt-process-btn').disabled = false;
    }
}

function renderEditor(segments, userText) {
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";
    const userLines = userText.split('\n').filter(l => l.trim().length > 0);

    segments.forEach((seg, index) => {
        const row = document.createElement('div');
        row.className = 'mt-row';
        const d = new Date(seg.start * 1000);
        const timeStr = `[${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${Math.floor(d.getMilliseconds()/10).toString().padStart(2,'0')}]`;
        const txt = userLines[index] !== undefined ? userLines[index] : seg.text.trim();

        row.innerHTML = `
            <input type="text" class="mt-time" value="${timeStr}">
            <input type="text" class="mt-text" value="${txt}">
            <div style="cursor:pointer; padding:5px;" onclick="this.parentElement.remove()">❌</div>
        `;
        container.appendChild(row);
    });
}

async function handleExport(embed) {
    if (embed && !window.ID3Writer) await loadID3Library();
    const rows = document.querySelectorAll('.mt-row');
    let lrc = "";
    rows.forEach(r => lrc += `${r.querySelector('.mt-time').value}${r.querySelector('.mt-text').value}\n`);
    
    if(!lrc) return alert("没内容");
    const file = document.getElementById('mt-file').files[0];
    const name = file.name.replace(/\.[^/.]+$/, "");

    if (!embed) {
        download(new Blob([lrc]), name + ".lrc");
    } else {
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 写入中...";
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
