/**
 * =================================================================
 * AudioGuard - 課堂智慧音訊管家與防亂按防護引擎 (5 秒冷卻鎖定版)
 * 適用路徑：D:\GOOGLE雲端\我的雲端硬碟\壽豐國中\115英語教學\GitHub\kevinchang
 * =================================================================
 * 解決學生課堂中瘋狂連點、重疊爆音、破音與互相干擾問題。
 * 
 * 核心功能：
 * 1. 【按鈕冷卻鎖定 5s】：發音按鈕點擊後強制鎖定 5 秒，即時倒數 5s -> 1s，倒數結束前完全禁止再次觸發。
 * 2. 【搗蛋狂按偵測 (Anti-Rage Spamming)】：2.5秒內連按≥3次立即鎖定4秒，彈出幽默提醒。
 * 3. 【單音源互斥 (Exclusive Playback)】：永遠先中斷舊語音，絕無重疊雜音。
 * 4. 【單例 Web Audio API】：主音量上限箝制 (Gain ≤ 0.15)，防止爆音。
 * 5. 【課堂三段音訊模式】：
 *    - 'all'      : 正常模式 (英語朗讀 + 遊戲音效)
 *    - 'tts_only' : 僅開英語朗讀 (靜音遊戲叮咚聲，只保留課文朗讀，老師最愛！)
 *    - 'mute'     : 完全靜音 (自習安靜模式)
 */

const AudioGuard = (function() {
    // 預設冷卻秒數：嚴格執行 5 秒冷卻鎖定
    const DEFAULT_COOLDOWN_SECONDS = 5;

    // 狀態設定
    let currentMode = localStorage.getItem('classroom_audio_mode') || 'all'; // 'all' | 'tts_only' | 'mute'
    let clickHistory = [];
    let isSpamLocked = false;
    let lockCountdown = 0;
    let lockCountdownInterval = null;

    // Web Audio API 單例
    let audioCtx = null;
    let masterGain = null;

    // 幽默防搗蛋語錄
    const spamTips = [
        "🤖 助教喝水中：慢慢聽才學得好，請等 {s} 秒再按喔！",
        "🏃 跑太快啦！英語一句一句跟讀才紮實，冷靜 {s} 秒～",
        "🎧 助教深呼吸中：狂按按鈕不會升級喔！休息 {s} 秒～",
        "⚡ 系統降溫中：耳朵需要一點消化時間，冷卻 {s} 秒！",
        "🛑 偵測到音效連擊！請靜下心仔細聆聽，倒數 {s} 秒～"
    ];

    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
                masterGain = audioCtx.createGain();
                masterGain.gain.setValueAtTime(0.15, audioCtx.currentTime); // 安全音量上限
                masterGain.connect(audioCtx.destination);
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    }

    // 顯示全螢幕懸浮幽默提醒 Toast
    function showSpamToast(message, duration = 3000) {
        let toast = document.getElementById('audioGuardToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'audioGuardToast';
            toast.className = 'fixed top-6 left-1/2 -translate-x-1/2 z-[9999] transition-all duration-300 transform scale-95 opacity-0 pointer-events-none';
            toast.innerHTML = `
                <div class="flex items-center gap-3 bg-slate-900/95 text-amber-300 px-5 py-3 rounded-2xl border-2 border-amber-500 shadow-2xl backdrop-blur-md">
                    <div class="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 text-lg animate-bounce">
                        <i class="fa-solid fa-mug-hot"></i>
                    </div>
                    <div>
                        <div class="text-[11px] font-black uppercase text-amber-400 font-fun tracking-wider">Classroom Audio Guard</div>
                        <div id="audioGuardToastMsg" class="text-xs sm:text-sm font-bold text-slate-100"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(toast);
        }

        const msgEl = document.getElementById('audioGuardToastMsg');
        if (msgEl) msgEl.innerHTML = message;

        // 顯示
        toast.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
        toast.classList.add('opacity-100', 'scale-100');

        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => {
            toast.classList.remove('opacity-100', 'scale-100');
            toast.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
        }, duration);
    }

    // 觸發狂按封鎖保護
    function triggerSpamLock() {
        if (isSpamLocked) return;
        isSpamLocked = true;
        lockCountdown = 4;

        // 中斷目前正在播的聲音
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }

        const template = spamTips[Math.floor(Math.random() * spamTips.length)];
        showSpamToast(template.replace('{s}', `<span class="text-amber-400 font-black text-base">${lockCountdown}</span>`), 4000);

        // 倒數計時器
        clearInterval(lockCountdownInterval);
        lockCountdownInterval = setInterval(() => {
            lockCountdown--;
            if (lockCountdown > 0) {
                const msgEl = document.getElementById('audioGuardToastMsg');
                if (msgEl) {
                    msgEl.innerHTML = template.replace('{s}', `<span class="text-amber-400 font-black text-base">${lockCountdown}</span>`);
                }
            } else {
                clearInterval(lockCountdownInterval);
                isSpamLocked = false;
                clickHistory = [];
            }
        }, 1000);

        // 溫和警示音 (若不是靜音狀態)
        if (currentMode !== 'mute') {
            playBeepTone(330, 0.15, 'triangle');
        }
    }

    // 檢查點擊頻率
    function checkClickSpam() {
        if (isSpamLocked) {
            const template = spamTips[0];
            showSpamToast(template.replace('{s}', `<span class="text-amber-400 font-black text-base">${Math.max(1, lockCountdown)}</span>`), 1500);
            return false;
        }

        const now = Date.now();
        // 清理 2.5 秒前的點擊紀錄
        clickHistory = clickHistory.filter(t => now - t < 2500);
        clickHistory.push(now);

        // 2.5 秒內點擊超過 3 次即觸發狂按防護！
        if (clickHistory.length >= 4) {
            triggerSpamLock();
            return false;
        }

        return true;
    }

    // 播放特定頻率小音效
    function playBeepTone(freq, duration = 0.15, type = 'sine') {
        try {
            const ctx = getAudioContext();
            if (!ctx || !masterGain) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(masterGain);
            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch(e) {}
    }

    // --- 公開方法 ---
    return {
        DEFAULT_COOLDOWN_SECONDS,

        // 取得目前模式
        getMode() {
            return currentMode;
        },

        // 設定模式
        setMode(newMode) {
            if (!['all', 'tts_only', 'mute'].includes(newMode)) return;
            currentMode = newMode;
            localStorage.setItem('classroom_audio_mode', newMode);

            if (newMode === 'mute') {
                this.stopAll();
            }

            // 更新全站 UI 標籤與圖示
            this.updateWidgetUI();

            // 提示切換結果
            const modeLabels = {
                'all': '🔊 一般模式：英語朗讀與遊戲音效全開',
                'tts_only': '🗣️ 課堂專心模式：僅保留英語朗讀，已靜音遊戲音效！',
                'mute': '🔇 完全靜音模式：所有聲音已關閉 (安靜自習)'
            };
            showSpamToast(modeLabels[newMode], 2500);
        },

        // 循環切換模式 (點擊切換鈕時)
        cycleMode() {
            if (currentMode === 'all') {
                this.setMode('tts_only');
            } else if (currentMode === 'tts_only') {
                this.setMode('mute');
            } else {
                this.setMode('all');
            }
        },

        // 停止所有聲音
        stopAll() {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        },

        // 執行按鈕 5 秒冷卻鎖定 (含即時倒數計時顯示)
        lockButton(buttonEl, seconds = DEFAULT_COOLDOWN_SECONDS) {
            if (!buttonEl || buttonEl._cooldownActive) return false;

            buttonEl._cooldownActive = true;
            buttonEl.disabled = true;
            buttonEl.style.pointerEvents = 'none';
            buttonEl.classList.add('cooldown-locked', 'opacity-60', 'cursor-not-allowed');

            const originalHtml = buttonEl.innerHTML;
            let remaining = seconds;

            // 判斷按鈕文字形態，提供適當的倒數排版
            const isIconOnly = buttonEl.textContent.trim().length === 0;

            const updateDisplay = () => {
                if (remaining <= 0) {
                    clearInterval(buttonEl._cdTimer);
                    buttonEl.innerHTML = originalHtml;
                    buttonEl.disabled = false;
                    buttonEl.style.pointerEvents = '';
                    buttonEl.classList.remove('cooldown-locked', 'opacity-60', 'cursor-not-allowed');
                    buttonEl._cooldownActive = false;
                    return;
                }

                if (isIconOnly) {
                    buttonEl.innerHTML = `<span class="text-[11px] font-black font-fun text-amber-400 animate-pulse">${remaining}s</span>`;
                } else {
                    buttonEl.innerHTML = `<i class="fa-solid fa-hourglass-half text-amber-400 text-xs"></i> <span class="font-fun text-amber-300 ml-1 text-xs">冷卻 ${remaining}s</span>`;
                }
                remaining--;
            };

            updateDisplay();
            buttonEl._cdTimer = setInterval(updateDisplay, 1000);
            return true;
        },

        // 語音朗讀 (TTS) - 內建 5 秒冷卻、防搗蛋、單音源互斥
        speak(text, options = {}) {
            if (!text) return false;

            // 靜音模式下直接不發聲
            if (currentMode === 'mute') {
                if (options.onEnd) options.onEnd();
                return false;
            }

            // 防搗蛋連點檢驗
            if (!options.skipSpamCheck && !checkClickSpam()) {
                return false;
            }

            if (!('speechSynthesis' in window)) {
                console.warn('此瀏覽器不支援 Web Speech API');
                return false;
            }

            const buttonEl = options.button;
            const cooldownSec = options.cooldown !== undefined ? options.cooldown : DEFAULT_COOLDOWN_SECONDS;

            // 若有傳入按鈕，執行 5 秒冷卻鎖定
            if (buttonEl) {
                this.lockButton(buttonEl, cooldownSec);
            }

            // 單音源互斥：永遠先取消上一段未播完的語音
            window.speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = options.lang || 'en-US';
            utterance.rate = options.rate || 0.95;
            utterance.pitch = options.pitch || 1.0;

            utterance.onend = () => {
                if (options.onEnd) options.onEnd();
            };

            utterance.onerror = (err) => {
                if (options.onError) options.onError(err);
            };

            window.speechSynthesis.speak(utterance);
            return true;
        },

        // 遊戲音效播放 (Web Audio API)
        playSFX(type) {
            // 如果是 'mute' 或 'tts_only'，完全不播放遊戲音效！
            if (currentMode === 'mute' || currentMode === 'tts_only') {
                return;
            }

            if (isSpamLocked) return;

            try {
                const ctx = getAudioContext();
                if (!ctx || !masterGain) return;
                const now = ctx.currentTime;

                if (type === 'correct') {
                    // 悅耳和弦 (C5 -> E5 -> G5)
                    const osc1 = ctx.createOscillator();
                    const osc2 = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc1.type = 'triangle';
                    osc2.type = 'sine';
                    osc1.frequency.setValueAtTime(523.25, now); // C5
                    osc1.frequency.setValueAtTime(659.25, now + 0.08); // E5
                    osc2.frequency.setValueAtTime(783.99, now + 0.16); // G5
                    gain.gain.setValueAtTime(0.12, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                    osc1.connect(gain);
                    osc2.connect(gain);
                    gain.connect(masterGain);
                    osc1.start(now);
                    osc2.start(now + 0.16);
                    osc1.stop(now + 0.35);
                    osc2.stop(now + 0.35);
                } else if (type === 'wrong') {
                    // 柔和錯誤音 (避免刺耳或驚嚇)
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(220, now);
                    osc.frequency.setValueAtTime(164.81, now + 0.12);
                    gain.gain.setValueAtTime(0.1, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
                    osc.connect(gain);
                    gain.connect(masterGain);
                    osc.start(now);
                    osc.stop(now + 0.28);
                } else if (type === 'levelup' || type === 'trophy') {
                    // 升級小琶音
                    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99];
                    notes.forEach((freq, i) => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.frequency.value = freq;
                        gain.gain.setValueAtTime(0.1, now + i * 0.07);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.22);
                        osc.connect(gain);
                        gain.connect(masterGain);
                        osc.start(now + i * 0.07);
                        osc.stop(now + i * 0.07 + 0.22);
                    });
                } else if (type === 'click' || type === 'card') {
                    playBeepTone(480, 0.06, 'triangle');
                } else if (type === 'beep') {
                    playBeepTone(580, 0.1, 'sine');
                }
            } catch(e) {}
        },

        // 更新各頁面的音效切換按鈕外觀
        updateWidgetUI() {
            const btns = document.querySelectorAll('#audioGuardBtn, #audioFxBtn, .classroom-audio-btn');
            btns.forEach(btn => {
                const icon = btn.querySelector('i') || btn.querySelector('#audioIcon');
                const textSpan = btn.querySelector('span');

                if (currentMode === 'all') {
                    btn.className = "bg-slate-800 hover:bg-slate-700 text-amber-300 px-3 py-2 rounded-xl text-xs font-bold border border-amber-500/40 transition flex items-center gap-2 shadow-sm";
                    btn.title = "目前：全部開啟 (英語朗讀 + 遊戲音效) - 點擊切換";
                    if (icon) icon.className = "fa-solid fa-volume-high text-amber-400";
                    if (textSpan) textSpan.innerHTML = '音效全開';
                } else if (currentMode === 'tts_only') {
                    btn.className = "bg-indigo-950 hover:bg-indigo-900 text-sky-300 px-3 py-2 rounded-xl text-xs font-bold border border-sky-400/50 transition flex items-center gap-2 shadow-sm ring-1 ring-sky-400/30";
                    btn.title = "目前：課堂專心模式 (僅英語朗讀，已靜音叮咚聲) - 點擊切換";
                    if (icon) icon.className = "fa-solid fa-headphones text-sky-400 animate-pulse";
                    if (textSpan) textSpan.innerHTML = '僅英語朗讀 <span class="text-[10px] bg-sky-500/20 px-1 py-0.5 rounded text-sky-300 ml-0.5">推薦</span>';
                } else if (currentMode === 'mute') {
                    btn.className = "bg-slate-900 hover:bg-slate-800 text-slate-400 px-3 py-2 rounded-xl text-xs font-bold border border-slate-700 transition flex items-center gap-2";
                    btn.title = "目前：完全靜音 (安靜自習) - 點擊切換";
                    if (icon) icon.className = "fa-solid fa-volume-xmark text-slate-500";
                    if (textSpan) textSpan.innerHTML = '完全靜音';
                }
            });
        },

        // 綁定全域點擊事件 (自動攔截音訊按鈕並施加 5 秒冷卻鎖定)
        init() {
            // 全域守護原生 speechSynthesis.speak
            if ('speechSynthesis' in window && !window.speechSynthesis._audioGuardPatched) {
                const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
                window.speechSynthesis.speak = function(utterance) {
                    if (currentMode === 'mute') return;
                    if (isSpamLocked) return;
                    origSpeak(utterance);
                };
                window.speechSynthesis._audioGuardPatched = true;
            }

            const setup = () => {
                this.updateWidgetUI();

                // 綁定現有的切換按鈕
                const btns = document.querySelectorAll('#audioGuardBtn, #audioFxBtn, .classroom-audio-btn');
                btns.forEach(btn => {
                    btn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.cycleMode();
                    };
                });

                // 全域監聽使用者第一次點擊以解鎖 AudioContext
                const unlockAudio = () => {
                    getAudioContext();
                    window.removeEventListener('click', unlockAudio);
                    window.removeEventListener('keydown', unlockAudio);
                };
                window.addEventListener('click', unlockAudio);
                window.addEventListener('keydown', unlockAudio);

                // 全域點擊攔截：在 Capture 階段攔截所有音效發音按鈕，強制 5 秒冷卻
                document.addEventListener('click', (e) => {
                    const targetBtn = e.target.closest('button, .audio-trigger, .speak-btn, [data-speak]');
                    if (!targetBtn) return;

                    // 排除控制列、全課播放切換、或免冷卻按鈕
                    if (targetBtn.id === 'audioGuardBtn' || targetBtn.id === 'audioFxBtn' || 
                        targetBtn.classList.contains('classroom-audio-btn') ||
                        targetBtn.classList.contains('no-cooldown') ||
                        targetBtn.id === 'playAllBtn' || targetBtn.id === 'playAllText' ||
                        targetBtn.id === 'playAllIcon' || targetBtn.id === 'togglePlayLetterBtn') {
                        return;
                    }

                    const onclickStr = targetBtn.getAttribute('onclick') || '';
                    const isAudioBtn = targetBtn.classList.contains('audio-btn') || 
                                       targetBtn.classList.contains('speak-btn') || 
                                       targetBtn.hasAttribute('data-speak') ||
                                       /speak|playSound|playBeep|speakText|speakQuote|speakVerb|speakPattern|speakSentence/i.test(onclickStr);

                    if (isAudioBtn) {
                        // 若已在冷卻中，徹底阻擋後續一切行為 (包含 inline onclick 與 XP 累加)
                        if (targetBtn._cooldownActive) {
                            e.preventDefault();
                            e.stopImmediatePropagation();
                            return false;
                        }

                        // 立即啟動 5 秒冷卻鎖定！
                        AudioGuard.lockButton(targetBtn, DEFAULT_COOLDOWN_SECONDS);
                    }
                }, true); // Capture phase ensures immediate blocking of spamming
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setup);
            } else {
                setup();
            }
        }
    };
})();

// 全域掛載方便除錯與呼叫
window.AudioGuard = AudioGuard;
AudioGuard.init();
