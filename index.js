// 修复：使用 ../../ 适配标准安装路径
import { extension_settings } from "../../extensions.js";
import { saveSettingsDebounced } from "../../script.js";
import { callPopup } from "../../popup.js";

const SETTINGS_KEY = "music_tagger_settings";
// 初始化设置，防止报错
if (!extension_settings[SETTINGS_KEY]) {
    extension_settings[SETTINGS_KEY] = { apiKey: "" };
}
let settings = extension_settings[SETTINGS_KEY];

// 动态加载 ID3 写入库
const ID3_LIB_URL = "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js";
let isLibLoaded = false;

// 加载外部库的函数
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
            console.error("ID3 Writer 库加载失败");
            reject(new Error("无法加载 ID3 Writer 库，请检查网络连接"));
        };
        document.head.appendChild(script);
    });
}

// 插件入口
jQuery(async () => {
    // 延时一点加载，确保界面准备好
    setTimeout(() => {
        addMusicTaggerButton();
    }, 1000);
});

function addMusicTaggerButton() {
    // 防止重复添加
    if (document.getElementById("open-music-tagger-btn")) return;

    const btn = document.createElement("div");
    btn.id = "open-music-tagger-btn";
    btn.innerHTML = "🎵";
    btn.title = "打开 MP3 歌词嵌入工具";
    
    // 样式设置
    Object.assign(btn.style, {
        position: "fixed", 
        top: "60px", 
        right: "10px", 
        zIndex: "2000",
        cursor: "pointer", 
        fontSize: "24px", 
        background: "var(--SmartThemeQuoteColor)",
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

function openTaggerModal() {
    // 重新获取最新的设置
    settings = extension_settings[SETTINGS_KEY];
    
    const html = `
    <div class="mt-modal">
        <h3>🎵 MP3 歌词嵌入工具 (Groq版)</h3>
        
        <div>
            <label class="mt-label">1. Groq API Key (免费):</label>
            <input type="password" id="mt-key" class="text_pole mt-input" value="${settings.apiKey || ''}" placeholder="gsk_..." />
            <div class="mt-note">请前往 console.groq.com 申请免费 Key</div>
        </div>

        <div style="display:flex; gap:10px;">
            <div style="flex:1">
                <label class="mt-label">2. 选择 MP3 文件:</label>
                <input type="file" id="mt-file" accept="audio/mp3" class="mt-input" />
            </div>
        </div>

        <div>
            <label class="mt-label">3. 粘贴歌词文本 (一行一句):</label>
            <textarea id="mt-lyrics-raw" class="text_pole mt-input" rows="4" placeholder="在这里粘贴你的纯文本歌词..."></textarea>
        </div>

        <button id="mt-process-btn" class="mt-btn">⚡ 使用 AI 分析时间轴</button>
        <div id="mt-status" style="color:cyan; min-height: 20px;"></div>

        <div id="mt-editor-area" style="display:none; flex-grow:1; flex-direction:column;">
            <label class="mt-label">4. 预览与编辑 (确保文字对应正确的时间):</label>
            <div id="mt-rows-container" class="mt-scroll-area"></div>
            
            <div style="margin-top:10px; display:flex; gap:10px;">
                <button id="mt-download-lrc" class="mt-btn" style="background:#555;">仅下载 .LRC</button>
                <button id="mt-download-mp3" class="mt-btn">💾 导出内嵌歌词的 MP3</button>
            </div>
        </div>
    </div>
    `;

    // 调用酒馆的弹窗
    callPopup(html, "text", "", { wide: true, large: true });

    // 绑定事件
    document.getElementById('mt-key').addEventListener('input', (e) => {
        settings.apiKey = e.target.value;
        extension_settings[SETTINGS_KEY] = settings;
        saveSettingsDebounced();
    });

    document.getElementById('mt-process-btn').addEventListener('click', runAIAnalysis);
    document.getElementById('mt-download-mp3').addEventListener('click', () => handleExport(true));
    document.getElementById('mt-download-lrc').addEventListener('click', () => handleExport(false));

    // 预加载库
    loadID3Library().catch(e => console.error(e));
}

async function runAIAnalysis() {
    const fileInput = document.getElementById('mt-file');
    const apiKey = document.getElementById('mt-key').value;
    const status = document.getElementById('mt-status');
    const rawText = document.getElementById('mt-lyrics-raw').value;

    if (!fileInput.files[0]) {
        status.innerText = "❌ 请先选择 MP3 文件";
        return;
    }
    if (!apiKey) {
        status.innerText = "❌ 请输入 Groq API Key";
        return;
    }

    status.innerText = "⏳ 正在上传并分析音频 (whisper-large-v3)...";
    const btn = document.getElementById('mt-process-btn');
    btn.disabled = true;

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

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || "请求失败");
        }

        const data = await response.json();
        status.innerText = "✅ 分析完成！请在下方核对歌词。";
        
        renderEditor(data.segments, rawText);
        
        // 修改显示方式以兼容不同浏览器
        const editor = document.getElementById('mt-editor-area');
        editor.style.display = 'flex'; 
        
    } catch (e) {
        status.innerText = "❌ 错误: " + e.message;
        console.error(e);
    } finally {
        btn.disabled = false;
    }
}

function renderEditor(segments, userText) {
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    const userLines = userText.split('\n').filter(l => l.trim().length > 0);

    segments.forEach((seg, index) => {
        const row = document.createElement('div');
        row.className = 'mt-row';
        const timeStr = formatTime(seg.start);
        const textContent = userLines[index] !== undefined ? userLines[index] : seg.text.trim();

        row.innerHTML = `
            <input type="text" class="mt-time" value="[${timeStr}]">
            <input type="text" class="mt-text" value="${textContent}">
            <button class="menu_button" style="padding:2px 8px;" onclick="this.parentElement.remove()">❌</button>
        `;
        container.appendChild(row);
    });

    // 处理多余的行
    if (userLines.length > segments.length) {
        for (let i = segments.length; i < userLines.length; i++) {
            const row = document.createElement('div');
            row.className = 'mt-row';
            row.innerHTML = `
                <input type="text" class="mt-time" value="[00:00.00]" style="border-color:red;">
                <input type="text" class="mt-text" value="${userLines[i]}">
                <button class="menu_button" onclick="this.parentElement.remove()">❌</button>
            `;
            container.appendChild(row);
        }
    }
}

function formatTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const mm = date.getMinutes().toString().padStart(2, '0');
    const ss = date.getSeconds().toString().padStart(2, '0');
    const ms = Math.floor(date.getMilliseconds() / 10).toString().padStart(2, '0');
    return `${mm}:${ss}.${ms}`;
}

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

    if (lrcContent.length === 0) return alert("没有内容可导出");

    const fileInput = document.getElementById('mt-file');
    const originalFile = fileInput.files[0];
    const originalName = originalFile.name.replace(/\.[^/.]+$/, "");

    if (!embedInMp3) {
        downloadBlob(new Blob([lrcContent], { type: "text/plain" }), `${originalName}.lrc`);
    } else {
        const status = document.getElementById('mt-status');
        status.innerText = "⏳ 正在写入 ID3 标签...";
        
        try {
            const arrayBuffer = await originalFile.arrayBuffer();
            
            // 确保库已加载
            if (!window.ID3Writer) throw new Error("ID3 Writer 库未加载");

            const writer = new window.ID3Writer(arrayBuffer);
            
            writer.setFrame('USLT', {
                description: '',
                lyrics: lrcContent,
                language: 'zho'
            });
            
            writer.addTag();
            
            const taggedUrl = writer.getURL();
            const link = document.createElement('a');
            link.href = taggedUrl;
            link.download = `${originalName}_with_lyrics.mp3`;
            link.click();
            
            URL.revokeObjectURL(taggedUrl);
            status.innerText = "✅ 导出成功！文件已下载。";

        } catch (e) {
            console.error(e);
            alert("MP3 处理失败，请查看控制台 (F12)。可能原因：文件格式受损或网络拦截了库文件。");
            status.innerText = "❌ 处理失败";
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
