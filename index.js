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

// --- 2. 核心：自制弹窗 (顶部对齐 + 深色背景) ---
function createCustomPopup(htmlContent) {
    const old = document.getElementById('mt-custom-overlay');
    if (old) old.remove();

    // 遮罩层
    const overlay = document.createElement('div');
    overlay.id = 'mt-custom-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        zIndex: 20000,
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'flex-start', // 靠上对齐
        paddingTop: '80px',       // 留出顶部距离
        backdropFilter: 'blur(3px)'
    });

    // 弹窗容器
    const container = document.createElement('div');
    container.className = 'mt-modal'; 
    Object.assign(container.style, {
        position: 'relative',
        width: '600px', maxWidth: '90%', maxHeight: '80vh', overflowY: 'auto',
        backgroundColor: '#1a1b1e', // 强制深色背景
        border: '1px solid #444', color: '#eee', borderRadius: '8px',
        padding: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
        display: 'flex', flexDirection: 'column', gap: '15px' // gap 稍微加大一点
    });

    // 关闭按钮
    const closeBtn = document.createElement('div');
    closeBtn.innerHTML = '❌';
    Object.assign(closeBtn.style, {
        position: 'absolute', top: '15px', right: '15px',
        cursor: 'pointer', fontSize: '18px', zIndex: 10, color: '#fff', opacity: '0.8'
    });
    closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
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
    console.log("🎵 Music Tagger Loaded (Visible Upload Button)");
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
        <h3 style="margin:0 0 5px 0; border-bottom:1px solid #555; padding-bottom:10px; color:#fff;">🎵 MP3 歌词工具</h3>
        
        <!-- 1. Key 输入 -->
        <div>
            <label class="mt-label" style="color:#ccc;">1. Groq API Key:</label>
            <input type="password" id="mt-key" class="text_pole mt-input" value="${settings.apiKey || ''}" placeholder="gsk_..." style="padding:8px; background:#333; color:#fff; border:1px solid #555;" />
        </div>

        <!-- 2. MP3 文件上传 (修改部分：改为按钮触发) -->
        <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:5px; border:1px dashed #555;">
            <label class="mt-label" style="color:#ccc;">2. MP3 文件:</label>
            <div style="display:flex; align-items:center; gap:10px; margin-top:5px;">
                <!-- 真正的 input 被隐藏了 -->
                <input type="file" id="mt-file" accept="audio/mp3" style="display:none;" />
                
                <!-- 这个是代理按钮 -->
                <button id="mt-file-trigger-btn" class="mt-btn" style="background:#555; border:1px solid #777;">📂 点击选择文件</button>
                
                <!-- 显示文件名的区域 -->
                <span id="mt-file-name-display" style="color:#aaa; font-style:italic; font-size:0.9em;">未选择文件</span>
            </div>
        </div>

        <!-- 3. 歌词输入 -->
        <div>
            <label class="mt-label" style="color:#ccc;">3. 粘贴纯文本歌词 (一行一句):</label>
            <textarea id="mt-lyrics-raw" class="text_pole mt-input" rows="5" placeholder="粘贴歌词..." style="background:#333; color:#fff; border:1px solid #555;"></textarea>
        </div>

        <button id="mt-process-btn" class="mt-btn" style="width:100%; margin-top:10px; padding:10px; background:#2b5e99; color:white; border:none; border-radius:4px; cursor:pointer;">⚡ 开始 AI 分析</button>
        <div id="mt-status" style="color:cyan; margin:5px 0; font-weight:bold; height:20px;"></div>

        <div id="mt-editor-area" style="display:none; flex-direction:column; overflow:hidden; flex:1; min-height:200px;">
            <div id="mt-rows-container" class="mt-scroll-area" style="max-height: 300px; overflow-y:auto; background:#111; padding:10px; border:1px solid #444;"></div>
            <div style="margin-top:15px; display:flex; gap:10px; justify-content:flex-end;">
                <button id="mt-download-lrc" class="mt-btn" style="background:#444; padding:8px 15px; color:white; border:none; border-radius:4px; cursor:pointer;">仅 LRC</button>
                <button id="mt-download-mp3" class="mt-btn" style="background:#2b5e99; padding:8px 15px; color:white; border:none; border-radius:4px; cursor:pointer;">💾 导出 MP3</button>
            </div>
        </div>
    `;

    createCustomPopup(html);

    setTimeout(() => {
        // --- 绑定上传逻辑 ---
        const fileInput = document.getElementById('mt-file');
        const triggerBtn = document.getElementById('mt-file-trigger-btn');
        const nameDisplay = document.getElementById('mt-file-name-display');

        // 点击按钮 -> 触发隐藏的 input 点击
        triggerBtn.addEventListener('click', () => fileInput.click());

        // 当文件改变时 -> 更新文字显示
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                nameDisplay.innerText = "✅ " + fileInput.files[0].name;
                nameDisplay.style.color = "#4caf50"; // 绿色
                nameDisplay.style.fontWeight = "bold";
            } else {
                nameDisplay.innerText = "未选择文件";
                nameDisplay.style.color = "#aaa";
            }
        });

        // --- 其他原有逻辑 ---
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
        status.innerText = "✅ 分析完成！";
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
            <input type="text" class="mt-time" value="${timeStr}" style="width:100px; background:#222; color:#fff; border:1px solid #444; padding:5px;">
            <input type="text" class="mt-text" value="${txt}" style="flex:1; background:#222; color:#fff; border:1px solid #444; padding:5px;">
            <div style="cursor:pointer; padding:5px; color:#ff6666;" onclick="this.parentElement.remove()">❌</div>
        `;
        row.style.display = "flex";
        row.style.gap = "8px";
        row.style.marginBottom = "5px";
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
