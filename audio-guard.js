/**
 * =================================================================
 * AudioGuard - 課堂智慧音訊管家與防亂按防護引擎 (全域 5 秒冷卻鎖定版)
 * 適用路徑：D:\GOOGLE雲端\我的雲端硬碟\壽豐國中\115英語教學\GitHub\kevinchang
 * =================================================================
 * 解決學生課堂中瘋狂連點、按不同按鈕洗音效與互相干擾問題。
 * 
 * 核心規則：
 * 【全域 5 秒冷卻鎖定 (Global 5s Cooldown)】：
 * 限制一次只能按一個按鈕！只要點擊任何發音或音效按鈕，全站所有發音按鈕
 * 立即同步進入 5 秒冷卻鎖定，頂部顯示倒數計時進度條。
 * 5 秒倒數結束前，完全禁止點擊下一個按鈕！
 */

const AudioGuard = (function() {
    const DEFAULT_COOLDOWN_SECONDS = 5;

    // 狀態設定
    let currentMode = localStorage.getItem('classroom_audio_mode') || 'all'; // 'all' | 'tts_only' | 'mute'
    let globalCooldownRemaining = 0;
    let globalCooldownTimer = null;
    let currentLockedButtons = [];
    let currentActiveButton = null;
    let currentActiveButtonOriginalHtml = '';

    // Web Audio API 單例
    let audioCtx = null;
    let masterGain = null;

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

    // 建立頂部全域冷卻提示懸浮條 (Global Cooldown Pill)
    function getCooldownPill() {
        let pill = document.getElementById('globalAudioCooldownPill');
        if (!pill) {
            pill = document.createElement('div');
            pill.id = 'globalAudioCooldownPill';
            pill.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[9999] transition-all duration-300 transform -translate-y-16 opacity-0 pointer-events-none';
            pill.innerHTML = `
                <div id="globalCooldownCard" class="flex items-center gap-3 bg-slate-900/95 text-amber-300 px-5 py-2.5 rounded-full border-2 border-amber-500/80 shadow-2xl backdrop-blur-md text-xs sm:text-sm font-bold font-fun">
                    <i class="fa-solid fa-hourglass-half text-amber-400 text-sm animate-spin"></i>
                    <span id="globalCooldownText">發音冷卻中：<strong id="globalCooldownSec" class="text-amber-400 text-base font-black">5</strong> 秒後才可按下一題</span>
                    <div class="w-20 bg-slate-800 h-2.5 rounded-full overflow-hidden border border-slate-700 hidden sm:block">
                        <div id="globalCooldownBar" class="bg-gradient-to-r from-amber-400 to-orange-500 h-full w-full transition-all duration-1000 ease-linear"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(pill);
        }
        return pill;
    }

    // 顯示冷卻阻擋警告 (當學生在冷卻中試圖按下一個按鈕時)
    function showCooldownBlockedWarning(remainingSec) {
        const pill = getCooldownPill();
        const card = document.getElementById('globalCooldownCard');
        const textEl = document.getElementById('globalCooldownText');

        if (card && textEl) {
            // 晃動視覺特效
            card.classList.add('ring-4', 'ring-rose-500', 'bg-rose-950/90', 'scale-105');
            textEl.innerHTML = `✋ <span class="text-rose-300">請專心聽完！還需等待 <strong class="text-white text-base font-black">${remainingSec}</strong> 秒才能按下一題喔！</span>`;

            setTimeout(() => {
                card.classList.remove('ring-4', 'ring-rose-500', 'bg-rose-950/90', 'scale-105');
                if (globalCooldownRemaining > 0) {
                    textEl.innerHTML = `發音冷卻中：<strong id="globalCooldownSec" class="text-amber-400 text-base font-black">${globalCooldownRemaining}</strong> 秒後才可按下一題`;
                }
            }, 1000);
        }

        pill.classList.remove('-translate-y-16', 'opacity-0');
        pill.classList.add('translate-y-0', 'opacity-100');
    }

    // 檢查元素是否為發音或音效按鈕
    function isAudioButton(btn) {
        if (!btn || !(btn instanceof Element)) return false;

        // 排除控制列、選單分頁切換按鈕、送出答案或重整按鈕
        if (btn.id === 'audioGuardBtn' || btn.id === 'audioFxBtn' || 
            btn.classList.contains('classroom-audio-btn') ||
            btn.classList.contains('no-cooldown') ||
            btn.classList.contains('tab-btn') ||
            btn.id.startsWith('tab-') || btn.id.startsWith('btn-tab') ||
            btn.id === 'playAllBtn' || btn.id === 'playAllText' ||
            btn.id === 'playAllIcon' || btn.id === 'togglePlayLetterBtn' ||
            btn.getAttribute('role') === 'tab') {
            return false;
        }

        const onclickStr = btn.getAttribute('onclick') || '';
        return btn.classList.contains('audio-btn') || 
               btn.classList.contains('speak-btn') || 
               btn.hasAttribute('data-speak') ||
               /speak|playSound|playBeep|speakText|speakQuote|speakVerb|speakPattern|speakSentence|playDialogueLine|speakVocab|speakVerbItem/i.test(onclickStr);
    }

    // 搜尋頁面上所有的發音按鈕
    function getAllAudioButtons() {
        return Array.from(document.querySelectorAll('button, .audio-btn, .speak-btn, [data-speak]'))
                    .filter(isAudioButton);
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

    // 啟動全域 5 秒冷卻鎖定 (限制一次只能按一個按鈕)
    function startGlobalCooldown(triggerBtn, seconds = DEFAULT_COOLDOWN_SECONDS) {
        // 若已經在全域冷卻中，更新警告並返回
        if (globalCooldownRemaining > 0) {
            showCooldownBlockedWarning(globalCooldownRemaining);
            return false;
        }

        globalCooldownRemaining = seconds;

        // 1. 鎖定全站所有發音按鈕
        currentLockedButtons = getAllAudioButtons();
        currentLockedButtons.forEach(btn => {
            btn._globalAudioLocked = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        });

        // 2. 當前觸發按鈕特別標註倒數中
        currentActiveButton = triggerBtn;
        if (triggerBtn) {
            currentActiveButtonOriginalHtml = triggerBtn.innerHTML;
            const isIconOnly = triggerBtn.textContent.trim().length === 0;
            if (isIconOnly) {
                triggerBtn.innerHTML = `<span class="text-[11px] font-black font-fun text-amber-400 animate-pulse">${seconds}s</span>`;
            } else {
                triggerBtn.innerHTML = `<i class="fa-solid fa-hourglass-half text-amber-400 text-xs animate-spin"></i> <span class="font-fun text-amber-300 ml-1 text-xs">冷卻 ${seconds}s</span>`;
            }
        }

        // 3. 顯示頂部全域冷卻進度條
        const pill = getCooldownPill();
        const secEl = document.getElementById('globalCooldownSec');
        const barEl = document.getElementById('globalCooldownBar');
        const textEl = document.getElementById('globalCooldownText');

        if (secEl) secEl.innerText = seconds;
        if (textEl) textEl.innerHTML = `發音冷卻中：<strong id="globalCooldownSec" class="text-amber-400 text-base font-black">${seconds}</strong> 秒後才可按下一題`;
        if (barEl) barEl.style.width = '100%';

        pill.classList.remove('-translate-y-16', 'opacity-0', 'pointer-events-none');
        pill.classList.add('translate-y-0', 'opacity-100');

        // 4. 開始 1 秒倒數計時器
        clearInterval(globalCooldownTimer);
        globalCooldownTimer = setInterval(() => {
            globalCooldownRemaining--;

            if (globalCooldownRemaining > 0) {
                // 更新頂部顯示
                const curSecEl = document.getElementById('globalCooldownSec');
                if (curSecEl) curSecEl.innerText = globalCooldownRemaining;
                if (barEl) barEl.style.width = `${(globalCooldownRemaining / seconds) * 100}%`;

                // 更新觸發按鈕顯示
                if (currentActiveButton) {
                    const isIconOnly = currentActiveButton.textContent.trim().length <= 3;
                    if (isIconOnly) {
                        currentActiveButton.innerHTML = `<span class="text-[11px] font-black font-fun text-amber-400 animate-pulse">${globalCooldownRemaining}s</span>`;
                    } else {
                        currentActiveButton.innerHTML = `<i class="fa-solid fa-hourglass-half text-amber-400 text-xs animate-spin"></i> <span class="font-fun text-amber-300 ml-1 text-xs">冷卻 ${globalCooldownRemaining}s</span>`;
                    }
                }
            } else {
                // 倒數結束：解除全域鎖定！
                endGlobalCooldown();
            }
        }, 1000);

        return true;
    }

    // 解除全域冷卻鎖定
    function endGlobalCooldown() {
        clearInterval(globalCooldownTimer);
        globalCooldownRemaining = 0;

        // 解鎖全站按鈕
        currentLockedButtons.forEach(btn => {
            btn._globalAudioLocked = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
        });
        currentLockedButtons = [];

        // 恢復觸發按鈕的原始文字外觀
        if (currentActiveButton && currentActiveButtonOriginalHtml) {
            currentActiveButton.innerHTML = currentActiveButtonOriginalHtml;
            currentActiveButton = null;
            currentActiveButtonOriginalHtml = '';
        }

        // 隱藏頂部提示條
        const pill = getCooldownPill();
        if (pill) {
            pill.classList.remove('translate-y-0', 'opacity-100');
            pill.classList.add('-translate-y-16', 'opacity-0', 'pointer-events-none');
        }
    }

    // --- 公開方法 ---
    return {
        DEFAULT_COOLDOWN_SECONDS,

        // 取得目前冷卻剩餘秒數
        getRemainingCooldown() {
            return globalCooldownRemaining;
        },

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

            this.updateWidgetUI();
        },

        // 循環切換模式
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

        // 啟動全域 5 秒鎖定 API
        lockAll(triggerBtn, seconds = DEFAULT_COOLDOWN_SECONDS) {
            return startGlobalCooldown(triggerBtn, seconds);
        },

        // 語音朗讀 (TTS) - 內建全域 5 秒冷卻、單音源互斥
        speak(text, options = {}) {
            if (!text) return false;

            // 靜音模式直接不發聲
            if (currentMode === 'mute') {
                if (options.onEnd) options.onEnd();
                return false;
            }

            // 檢查全域冷卻：若正在 5 秒冷卻中，完全禁止下一個按鈕發音！
            if (!options.skipCooldownCheck && globalCooldownRemaining > 0) {
                showCooldownBlockedWarning(globalCooldownRemaining);
                return false;
            }

            if (!('speechSynthesis' in window)) {
                console.warn('此瀏覽器不支援 Web Speech API');
                return false;
            }

            const buttonEl = options.button;
            const cooldownSec = options.cooldown !== undefined ? options.cooldown : DEFAULT_COOLDOWN_SECONDS;

            // 立即啟動全域 5 秒冷卻鎖定！
            startGlobalCooldown(buttonEl, cooldownSec);

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
            if (currentMode === 'mute' || currentMode === 'tts_only') return;

            try {
                const ctx = getAudioContext();
                if (!ctx || !masterGain) return;
                const now = ctx.currentTime;

                if (type === 'correct') {
                    const osc1 = ctx.createOscillator();
                    const osc2 = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc1.type = 'triangle';
                    osc2.type = 'sine';
                    osc1.frequency.setValueAtTime(523.25, now);
                    osc1.frequency.setValueAtTime(659.25, now + 0.08);
                    osc2.frequency.setValueAtTime(783.99, now + 0.16);
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

        // 初始化全域監聽與攔截
        init() {
            // 全域守護原生 speechSynthesis.speak
            if ('speechSynthesis' in window && !window.speechSynthesis._audioGuardPatched) {
                const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
                window.speechSynthesis.speak = function(utterance) {
                    if (currentMode === 'mute') return;
                    origSpeak(utterance);
                };
                window.speechSynthesis._audioGuardPatched = true;
            }

            const setup = () => {
                this.updateWidgetUI();

                // 綁定音訊切換按鈕
                const btns = document.querySelectorAll('#audioGuardBtn, #audioFxBtn, .classroom-audio-btn');
                btns.forEach(btn => {
                    btn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.cycleMode();
                    };
                });

                // 使用者第一次互動時解鎖 AudioContext
                const unlockAudio = () => {
                    getAudioContext();
                    window.removeEventListener('click', unlockAudio);
                    window.removeEventListener('keydown', unlockAudio);
                };
                window.addEventListener('click', unlockAudio);
                window.addEventListener('keydown', unlockAudio);

                // =================================================================
                // 核心關鍵：全域點擊事件 Capture 攔截
                // 確保「按了某個按鈕之後，全站 5 秒過後才能按下一個按鈕」
                // =================================================================
                document.addEventListener('click', (e) => {
                    const targetBtn = e.target.closest('button, .audio-trigger, .speak-btn, [data-speak], .audio-btn');
                    if (!targetBtn || !isAudioButton(targetBtn)) return;

                    // 若目前全域正在 5 秒冷卻中：
                    if (globalCooldownRemaining > 0) {
                        // 徹底攔截阻止一切行為（包括行內 onclick 與其他監聽器）！
                        e.preventDefault();
                        e.stopImmediatePropagation();

                        // 彈出頂部警示：告知還剩多少秒才能按下一個按鈕
                        showCooldownBlockedWarning(globalCooldownRemaining);
                        return false;
                    }

                    // 尚未在冷卻中：允許此次點擊，並立即將全站鎖定 5 秒！
                    startGlobalCooldown(targetBtn, DEFAULT_COOLDOWN_SECONDS);
                }, true); // useCapture: true 是確保在任何行內 onclick 執行前完成攔截
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setup);
            } else {
                setup();
            }
        }
    };
})();

// 全域掛載
window.AudioGuard = AudioGuard;
AudioGuard.init();
