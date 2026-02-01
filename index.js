import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../script.js";
import { callPopup } from "../../../popup.js";

const SETTINGS_KEY = "music_tagger_settings";
let settings = extension_settings[SETTINGS_KEY] || { apiKey: "" };

// 动态加载 ID3 写入库 (使用 unpkg CDN)
const ID3_LIB_URL = "https://unpkg.com/browser-id3-writer@4.4.0/dist/browser-id3-writer.js";
let isLibLoaded = false;

async function loadID3Library() {
    if (isLibLoaded) return;
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = ID3_LIB_URL;
        script.onload = () => { isLibLoaded = true; resolve(); };
        script.onerror = () => reject(new Error("无法加载 ID3 Writer 库，请检查网络"));
        document.head.appendChild(script);
    });
}

jQuery(async () => {
    // 创建入口按钮 (浮动在右上角，或者你可以改为添加到Slash命令)
    const btn = document.createElement("div");
    btn.innerHTML = "🎵";
    btn.title = "打开 MP3 歌词嵌入工具";
    Object.assign(btn.style, {
        position: "fixed", top: "50px", right: "10px", zIndex: "2000",
        cursor: "pointer", fontSize: "24px", background: "var(--SmartThemeQuoteColor)",
        color: "white", padding: "8px", borderRadius: "50%", boxShadow: "0 2px 5px rgba(0,0,0,0.5)"
    });
    btn.onclick = openTaggerModal;
    document.body.appendChild(btn);
});

function openTaggerModal() {
    const html = `
    <div class="mt-modal">
        <h3>🎵 MP3 歌词嵌入工具 (Groq版)</h3>
        
        <div>
            <label class="mt-label">1. Groq API Key (免费):</label>
            <input type="password" id="mt-key" class="text_pole mt-input" value="${settings.apiKey}" placeholder="gsk_..." />
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
        <div id="mt-status" style="color:cyan;"></div>

        <div id="mt-editor-area" style="display:none; flex-grow:1; display:flex; flex-direction:column;">
            <label class="mt-label">4. 预览与编辑 (确保文字对应正确的时间):</label>
            <div id="mt-rows-container" class="mt-scroll-area"></div>
            
            <div style="margin-top:10px; display:flex; gap:10px;">
                <button id="mt-download-lrc" class="mt-btn" style="background:#555;">仅下载 .LRC</button>
                <button id="mt-download-mp3" class="mt-btn">💾 导出内嵌歌词的 MP3</button>
            </div>
        </div>
    </div>
    `;

    callPopup(html, "text", "", { wide: true, large: true });

    // 绑定事件
    document.getElementById('mt-key').addEventListener('change', (e) => {
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

    if (!fileInput.files[0]) return alert("请先选择 MP3 文件");
    if (!apiKey) return alert("请输入 Groq API Key");

    status.innerText = "正在上传并分析音频 (whisper-large-v3)...";
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
            throw new Error(err.error?.message || "请求失败");
        }

        const data = await response.json();
        status.innerText = "分析完成！请在下方核对歌词。";
        
        renderEditor(data.segments, rawText);
        document.getElementById('mt-editor-area').style.display = 'flex'; // 显示编辑器

    } catch (e) {
        status.innerText = "错误: " + e.message;
        console.error(e);
    } finally {
        btn.disabled = false;
    }
}

function renderEditor(segments, userText) {
    const container = document.getElementById('mt-rows-container');
    container.innerHTML = "";

    // 将用户输入的文本按行分割，过滤空行
    const userLines = userText.split('\n').filter(l => l.trim().length > 0);

    // 策略：以 AI 识别出的时间段为基准
    // 如果用户提供了歌词，则优先按顺序填入用户的歌词
    segments.forEach((seg, index) => {
        const row = document.createElement('div');
        row.className = 'mt-row';
        
        // 格式化时间 [mm:ss.xx]
        const timeStr = formatTime(seg.start);
        
        // 优先使用用户对应的行，如果用户行数不够，使用AI听写的原文
        const textContent = userLines[index] !== undefined ? userLines[index] : seg.text.trim();

        row.innerHTML = `
            <input type="text" class="mt-time" value="[${timeStr}]">
            <input type="text" class="mt-text" value="${textContent}">
            <button class="menu_button" style="padding:2px 8px;" onclick="this.parentElement.remove()">❌</button>
        `;
        container.appendChild(row);
    });

    // 如果用户粘贴的行数比 AI 听到的段落多，把多余的也显示出来（时间戳为空）
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
    if (embedInMp3 && !window.ID3Writer) {
        await loadID3Library();
    }

    // 1. 生成 LRC 字符串
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
        // === 仅下载 LRC ===
        downloadBlob(new Blob([lrcContent], { type: "text/plain" }), `${originalName}.lrc`);
    } else {
        // === 嵌入 MP3 ===
        const status = document.getElementById('mt-status');
        status.innerText = "正在处理 MP3 文件...";
        
        try {
            const arrayBuffer = await originalFile.arrayBuffer();
            
            // 使用 browser-id3-writer
            const writer = new window.ID3Writer(arrayBuffer);
            
            // 写入 USLT 帧 (Unsynchronized lyrics)
            // 许多播放器会读取这个作为歌词
            writer.setFrame('USLT', {
                description: '',
                lyrics: lrcContent,
                language: 'zho' // 假设是中文
            });
            
            // 保留原有的 Tag 比较复杂，ID3Writer 会覆盖旧的 ID3v2 头部
            // 如果需要保留原有的 标题/作者，这里需要先读取再写入。
            // 为了简化，这里我们只添加歌词。如果原文件没有标签，它就是新的标签。
            // *注意：这个库在写入新标签时，如果原文件有ID3v2标签，可能会丢失其他元数据。*
            // 但对于单纯"加歌词"的需求，这是 Web 端最简单的方案。
            
            writer.addTag();
            
            const taggedUrl = writer.getURL();
            const link = document.createElement('a');
            link.href = taggedUrl;
            link.download = `${originalName}_with_lyrics.mp3`;
            link.click();
            
            URL.revokeObjectURL(taggedUrl);
            status.innerText = "导出成功！";

        } catch (e) {
            console.error(e);
            alert("MP3 处理失败，请检查文件是否损坏或受保护。");
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
