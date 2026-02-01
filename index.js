// 注意：这里使用了 ../../../ 因为你在 extensions/third-party/子文件夹 中
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../script.js";
import { callPopup } from "../../../popup.js";

const SETTINGS_KEY = "music_tagger_settings";

// 初始化设置
if (!extension_settings[SETTINGS_KEY]) {
    extension_settings[SETTINGS_KEY] = { apiKey: "" };
}
let settings = extension_settings[SETTINGS_KEY];

// ID3 库地址
const ID3_LIB_URL = "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js";
let isLibLoaded = false;

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
            console.error("ID3 Writer load failed");
            // 备用源
            script.src = "https://cdn.jsdelivr.net/npm/browser-id3-writer@4.0.0/dist/browser-id3-writer.min.js";
        };
        document.head.appendChild(script);
    });
}

jQuery(async () => {
    // 延迟加载 UI
    setTimeout(() => {
        addMusicTaggerButton();
    }, 1000);
});

function addMusicTaggerButton() {
    if (document.getElementById("open-music-tagger-btn")) return;

    const btn = document.createElement("div");
    btn.id = "open-music-tagger-btn";
    btn.innerHTML = "🎵";
    btn.title = "MP3 歌词工具";
    
    Object.assign(btn.style, {
        position: "fixed", top: "60px", right: "50px", // 稍微往左挪一点，避免和原生按钮重叠
        zIndex: "2000", cursor: "pointer", fontSize: "24px", 
        background: "var(--SmartThemeQuoteColor)", color: "white", 
        padding: "8px", borderRadius: "50%", boxShadow: "0 2px 5px rgba(0,0,0,0.5)"
    });
    
    btn.onclick = openTaggerModal;
    document.body.appendChild(btn);
}

function openTaggerModal() {
    settings = extension_settings[SETTINGS_KEY];
    
    const html = `
    <div class="mt-modal">
        <h3>🎵 MP3 歌词嵌入工具 (Groq版)</h3>
        
        <div>
            <label class="mt-label">1. Groq API Key:</label>
            <input type="password" id="mt-key" class="text_pole mt-input" value="${settings.apiKey || ''}" placeholder="gsk_..." />
        </div>

        <div style="margin-top:10px;">
            <label class="mt-label">2. 选择 MP3 文件:</label>
            <input type="file" id="mt-file" accept="audio/mp3" class="mt-input" />
        </div>

        <div style="margin-top:10px;">
            <label class="mt-label">3. 粘贴歌词 (纯文本):</label>
            <textarea id="mt-lyrics-raw" class="text_pole mt-input" rows="5" placeholder="粘贴歌词..."></textarea>
        </div>

        <button id="mt-process-btn" class="mt-btn" style="margin-top:10px;">⚡ AI 分析时间轴</button>
        <div id="mt-status" style="color:cyan; margin: 5px 0; min-height:20px;"></div>

        <div id="mt-editor-area" style="display:none; flex-direction:column; flex:1; overflow:hidden;">
            <div id="mt-rows-container" class="mt-scroll-area" style="flex:1; overflow-y:auto;"></div>
            
            <div style="margin-top:10px; display:flex; gap:10px;">
                <button id="mt-download-lrc" class="mt-btn" style="background:#555;">仅下载 LRC</button>
                <button id="mt-download-mp3" class="mt-btn">💾 导出内嵌歌词 MP3</button>
            </div>
        </div>
    </div>
    `;

    callPopup(html, "text", "", { wide: true, large: true });

    document.getElementById('mt-key').addEventListener('input', (e) => {
        settings.apiKey = e.target.value;
        extension_settings[SETTINGS_KEY] = settings;
        saveSettingsDebounced();
    });

    document.getElementById('mt-process-btn').addEventListener('click', runAIAnalysis);
    document.getElementById('mt-download-mp3').addEventListener('click', () => handleExport(true));
    document.getElementById('mt-download-lrc').addEventListener('click', () => handleExport(false));

    loadID3Library();
}

async function runAIAnalysis() {
    const fileInput = document.getElementById('mt-file');
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!fileInput.files[0]) return status.innerText = "❌ 请选择文件";
    if (!apiKey) return status.innerText = "❌ 请输入 Key";

    status.innerText = "⏳ 上传分析中 (Whisper-large-v3)...";
    document.getElementById('mt-process-btn').disabled = true;

    try {
        const formData = new FormData();
        formData.append("file", fileInput.files[0]);
        formData.append("model", "whisper-large-v3");
        formData.append("response_format", "verbose_json");

        const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}` },
            body: formData
        });

        if (!response.ok) throw new Error((await response.json()).error?.message);

        const data = await response.json();
        status.innerText = "✅ 分析完成！";
        
        renderEditor(data.segments, rawText);
        document.getElementById('mt-editor-area').style.display = 'flex';
        
    } catch (e) {
        status.innerText = "❌ 错误: " + e.message;
        console.error(e);
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
        const date = new Date(seg.start * 1000);
        const timeStr = date.toISOString().substr(14, 9); // mm:ss.ms
        const text = userLines[index] !== undefined ? userLines[index] : seg.text.trim();

        row.innerHTML = `
            <input type="text" class="mt-time" value="[${timeStr}]">
            <input type="text" class="mt-text" value="${text}">
            <button class="menu_button" onclick="this.parentElement.remove()">❌</button>
        `;
        container.appendChild(row);
    });
}

async function handleExport(embed) {
    if (embed && !window.ID3Writer) await loadID3Library();

    const rows = document.querySelectorAll('.mt-row');
    let lrc = "";
    rows.forEach(r => lrc += `${r.querySelector('.mt-time').value}${r.querySelector('.mt-text').value}\n`);

    if (!lrc) return alert("空内容");
    
    const file = document.getElementById('mt-file').files[0];
    const name = file.name.replace(/\.[^/.]+$/, "");

    if (!embed) {
        downloadBlob(new Blob([lrc]), `${name}.lrc`);
    } else {
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 写入标签中...";
        try {
            const writer = new window.ID3Writer(await file.arrayBuffer());
            writer.setFrame('USLT', { description: '', lyrics: lrc, language: 'zho' });
            writer.addTag();
            downloadBlob(writer.getBlob(), `${name}_lyrics.mp3`);
            status.innerText = "✅ 导出成功";
        } catch (e) {
            alert("写入失败: " + e.message);
        }
    }
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
}
