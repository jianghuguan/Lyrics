// 【重要】没有任何 import 语句，防止路径报错
// 直接使用 window 全局变量

const SETTINGS_KEY = "music_tagger_settings";
const ID3_LIB_URL = "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js";
let isLibLoaded = false;

// 1. 确保设置对象存在
if (!window.extension_settings) {
    window.extension_settings = {};
}
if (!window.extension_settings[SETTINGS_KEY]) {
    window.extension_settings[SETTINGS_KEY] = { apiKey: "" };
}

// 2. 加载外部库的辅助函数
async function loadID3Library() {
    if (isLibLoaded || window.ID3Writer) {
        isLibLoaded = true;
        return;
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = ID3_LIB_URL;
        script.onload = () => { isLibLoaded = true; resolve(); };
        script.onerror = () => {
            console.warn("CDN加载失败，尝试备用源...");
            script.src = "https://cdn.jsdelivr.net/npm/browser-id3-writer@4.0.0/dist/browser-id3-writer.min.js";
        };
        document.head.appendChild(script);
    });
}

// 3. 插件入口 (使用 jQuery 的 ready 事件)
jQuery(async () => {
    console.log("[Music Tagger] 插件已加载"); // F12 控制台应该能看到这句话
    
    // 延迟 1 秒执行，确保酒馆界面完全加载
    setTimeout(() => {
        addMusicTaggerButton();
    }, 1000);
});

// 4. 添加按钮
function addMusicTaggerButton() {
    if (document.getElementById("open-music-tagger-btn")) return;

    const btn = document.createElement("div");
    btn.id = "open-music-tagger-btn";
    btn.innerHTML = "🎵";
    btn.title = "MP3 歌词工具";
    
    // 样式
    Object.assign(btn.style, {
        position: "fixed", 
        top: "60px", 
        right: "55px", // 避开原生按钮
        zIndex: "2000",
        cursor: "pointer", 
        fontSize: "24px", 
        background: "var(--SmartThemeQuoteColor, #007bff)", // 使用酒馆主题色，没有则用蓝色
        color: "white", 
        padding: "8px", 
        borderRadius: "50%", 
        boxShadow: "0 2px 5px rgba(0,0,0,0.5)",
        transition: "transform 0.2s"
    });
    
    btn.onmouseover = () => btn.style.transform = "scale(1.1)";
    btn.onmouseout = () => btn.style.transform = "scale(1.0)";
    
    btn.onclick = openTaggerModal;
    document.body.appendChild(btn);
}

// 5. 打开主界面
function openTaggerModal() {
    const settings = window.extension_settings[SETTINGS_KEY];
    
    const html = `
    <div class="mt-modal">
        <h3>🎵 MP3 歌词嵌入工具 (Groq版)</h3>
        
        <div style="margin-bottom: 10px;">
            <label class="mt-label">1. Groq API Key:</label>
            <input type="password" id="mt-key" class="text_pole mt-input" value="${settings.apiKey || ''}" placeholder="gsk_..." />
            <div class="mt-note" style="font-size:0.8em; opacity:0.7;">API Key自动保存</div>
        </div>

        <div style="margin-bottom: 10px;">
            <label class="mt-label">2. MP3 文件:</label>
            <input type="file" id="mt-file" accept="audio/mp3" class="mt-input" />
        </div>

        <div style="margin-bottom: 10px;">
            <label class="mt-label">3. 纯文本歌词 (一行一句):</label>
            <textarea id="mt-lyrics-raw" class="text_pole mt-input" rows="5" placeholder="粘贴歌词..."></textarea>
        </div>

        <button id="mt-process-btn" class="menu_button" style="width:100%; padding:10px;">⚡ AI 自动对齐时间轴</button>
        <div id="mt-status" style="color:cyan; margin: 10px 0; min-height:20px; font-weight:bold;"></div>

        <div id="mt-editor-area" style="display:none; flex-direction:column; flex:1; overflow:hidden; border-top:1px solid #555; padding-top:10px;">
            <div id="mt-rows-container" class="mt-scroll-area" style="flex:1; overflow-y:auto; max-height:300px;"></div>
            
            <div style="margin-top:10px; display:flex; gap:10px;">
                <button id="mt-download-lrc" class="menu_button">仅下载 .LRC</button>
                <button id="mt-download-mp3" class="menu_button" style="font-weight:bold;">💾 导出 MP3</button>
            </div>
        </div>
    </div>
    `;

    // 使用 window.callPopup 防止引用错误
    if (window.callPopup) {
        window.callPopup(html, "text", "", { wide: true, large: true });
    } else {
        alert("错误：无法找到酒馆的弹窗函数 (callPopup)");
        return;
    }

    // 绑定事件
    document.getElementById('mt-key').addEventListener('input', (e) => {
        window.extension_settings[SETTINGS_KEY].apiKey = e.target.value;
        // 尝试保存设置
        if (window.saveSettingsDebounced) window.saveSettingsDebounced();
    });

    document.getElementById('mt-process-btn').addEventListener('click', runAIAnalysis);
    document.getElementById('mt-download-mp3').addEventListener('click', () => handleExport(true));
    document.getElementById('mt-download-lrc').addEventListener('click', () => handleExport(false));

    loadID3Library();
}

// 6. 核心逻辑：调用 Groq API
async function runAIAnalysis() {
    const fileInput = document.getElementById('mt-file');
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!fileInput.files[0]) { status.innerText = "❌ 请选择 MP3 文件"; return; }
    if (!apiKey) { status.innerText = "❌ 请输入 Groq API Key"; return; }

    status.innerText = "⏳ 正在上传音频到 Groq (Whisper-large-v3)...";
    const btn = document.getElementById('mt-process-btn');
    btn.disabled = true;

    try {
        const formData = new FormData();
        formData.append("file", fileInput.files[0]);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "verbose_json"); // 获取详细时间戳

        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}` },
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || "API 请求失败");
        }

        const data = await response.json();
        status.innerText = "✅ 分析完成！请在下方核对。";
        
        renderEditor(data.segments, rawText);
        
        const editor = document.getElementById('mt-editor-area');
        editor.style.display = 'flex'; 
        
    } catch (e) {
        status.innerText = "❌ 错误: " + e.message;
        console.error(e);
    } finally {
        btn.disabled = false;
    }
}

// 7. 渲染编辑器
function renderEditor(segments, userText) {
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";
    
    // 将用户粘贴的文本按行分割
    const userLines = userText.split('\n').filter(l => l.trim().length > 0);

    segments.forEach((seg, index) => {
        const row = document.createElement('div');
        row.className = 'mt-row';
        
        // 格式化时间
        const date = new Date(seg.start * 1000);
        const mm = date.getMinutes().toString().padStart(2, '0');
        const ss = date.getSeconds().toString().padStart(2, '0');
        const ms = Math.floor(date.getMilliseconds() / 10).toString().padStart(2, '0');
        const timeStr = `[${mm}:${ss}.${ms}]`;

        // 优先使用用户提供的文本，如果没有则使用 AI 识别的文本
        const textContent = userLines[index] !== undefined ? userLines[index] : seg.text.trim();

        row.innerHTML = `
            <input type="text" class="text_pole mt-time" value="${timeStr}" style="width:100px; font-family:monospace;">
            <input type="text" class="text_pole mt-text" value="${textContent}" style="flex:1;">
            <div class="menu_button" onclick="this.parentElement.remove()" style="padding:0 10px; cursor:pointer;">❌</div>
        `;
        
        // Flex 布局
        row.style.display = "flex";
        row.style.gap = "5px";
        row.style.marginBottom = "5px";
        
        container.appendChild(row);
    });
}

// 8. 导出功能
async function handleExport(embedInMp3) {
    if (embedInMp3) {
        if (!window.ID3Writer && !isLibLoaded) {
            await loadID3Library();
        }
    }

    const rows = document.querySelectorAll('.mt-row');
    let lrcContent = "";
    rows.forEach(row => {
        const time = row.querySelector('.mt-time').value;
        const text = row.querySelector('.mt-text').value;
        if (text.trim()) {
            lrcContent += `${time}${text}\n`;
        }
    });

    if (!lrcContent) return alert("内容为空");

    const fileInput = document.getElementById('mt-file');
    const originalFile = fileInput.files[0];
    const originalName = originalFile.name.replace(/\.[^/.]+$/, "");

    if (!embedInMp3) {
        // 下载 LRC
        const blob = new Blob([lrcContent], { type: "text/plain" });
        downloadBlob(blob, `${originalName}.lrc`);
    } else {
        // 嵌入 MP3
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 正在写入 ID3 标签...";
        
        try {
            const arrayBuffer = await originalFile.arrayBuffer();
            
            if (!window.ID3Writer) throw new Error("ID3 库未加载");

            const writer = new window.ID3Writer(arrayBuffer);
            writer.setFrame('USLT', {
                description: '',
                lyrics: lrcContent,
                language: 'zho'
            });
            writer.addTag();
            
            const taggedBlob = writer.getBlob();
            downloadBlob(taggedBlob, `${originalName}_lyrics.mp3`);
            
            status.innerText = "✅ 导出成功！文件已下载。";

        } catch (e) {
            console.error(e);
            status.innerText = "❌ 处理失败";
            alert("写入失败: " + e.message);
        }
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
