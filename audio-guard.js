/**
 * =================================================================
 * AudioGuard - 課堂智慧音訊管家與防亂按防護引擎 (全面修正聲音與5秒冷卻版)
 * 適用路徑：D:\GOOGLE雲端\我的雲端硬碟\壽豐國中\115英語教學\GitHub\kevinchang
 * =================================================================
 * 1. 解決按鈕無聲問題：修復原本冷卻檢查阻擋自己聲音發出的重大 Bug，解鎖 AudioContext 與 Web Speech API。
 * 2. 5 秒全域冷卻防亂按：學生按下發音、單字卡或答題按鈕後，立即啟動 5 秒全站冷卻鎖定。
 * 3. 頂部冷卻進度提示：倒數 5 秒內若學生亂按其他按鈕，立即攔截並彈出溫馨提醒。
 */

const AudioGuard = (function() {
    const DEFAULT_COOLDOWN_SECONDS = 5;

    // 狀態設定 (預設一律開啟所有聲音)
    let currentMode = localStorage.getItem('classroom_audio_mode') || 'all'; // 'all' | 'tts_only' | 'mute'
    if (currentMode !== 'all' && currentMode !== 'tts_only' && currentMode !== 'mute') {
        currentMode = 'all';
    }

    let globalCooldownRemaining = 0;
    let globalCooldownTimer = null;
    let currentLockedButtons = [];
    let currentActiveButton = null;

    // 防止 Chrome 垃圾回收 SpeechSynthesisUtterance 導致無聲中斷
    window._activeUtterances = window._activeUtterances || [];

    // Web Audio API 單例
    let audioCtx = null;
    let masterGain = null;

    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
                masterGain = audioCtx.createGain();
                masterGain.gain.setValueAtTime(0.25, audioCtx.currentTime); // 清晰合適的音量
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
                    <span id="globalCooldownText">冷卻中：<strong id="globalCooldownSec" class="text-amber-400 text-base font-black">5</strong> 秒後才可按下一題</span>
                    <div class="w-20 bg-slate-800 h-2.5 rounded-full overflow-hidden border border-slate-700 hidden sm:block">
                        <div id="globalCooldownBar" class="bg-gradient-to-r from-amber-400 to-orange-500 h-full w-full transition-all duration-1000 ease-linear"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(pill);
        }
        return pill;
    }

    // 顯示冷卻阻擋警告 (當學生在 5 秒冷卻中試圖按下一個按鈕時)
    function showCooldownBlockedWarning(remainingSec) {
        const pill = getCooldownPill();
        const card = document.getElementById('globalCooldownCard');
        const textEl = document.getElementById('globalCooldownText');

        if (card && textEl) {
            // 晃動與醒目顏色特效
            card.classList.add('ring-4', 'ring-rose-500', 'bg-rose-950/90', 'scale-105');
            textEl.innerHTML = `✋ <span class="text-rose-300">請專心聽完！還需等待 <strong class="text-white text-base font-black">${remainingSec}</strong> 秒才能按下一題喔！</span>`;

            setTimeout(() => {
                card.classList.remove('ring-4', 'ring-rose-500', 'bg-rose-950/90', 'scale-105');
                if (globalCooldownRemaining > 0) {
                    textEl.innerHTML = `冷卻中：<strong id="globalCooldownSec" class="text-amber-400 text-base font-black">${globalCooldownRemaining}</strong> 秒後才可按下一題`;
                }
            }, 1000);
        }

        pill.classList.remove('-translate-y-16', 'opacity-0');
        pill.classList.add('translate-y-0', 'opacity-100');
    }

    // 檢查元素是否為發音或互動答題按鈕 (全面涵蓋 Pattern, Dialogue, Reading, Review)
    function isAudioOrQuizButton(btn) {
        if (!btn || !(btn instanceof Element)) return false;

        // 排除導覽列、頁籤分頁切換按鈕、AI 彈窗關閉按鈕、全篇朗讀控制鍵
        if (btn.id === 'audioGuardBtn' || btn.id === 'audioFxBtn' || 
            btn.classList.contains('classroom-audio-btn') ||
            btn.classList.contains('no-cooldown') ||
            btn.classList.contains('tab-btn') ||
            btn.id.startsWith('tab-') || btn.id.startsWith('btn-tab') ||
            btn.id === 'playAllBtn' || btn.id === 'playAllText' ||
            btn.id === 'playAllIcon' || btn.id === 'togglePlayLetterBtn' ||
            btn.id === 'playArticleBtn' || btn.id === 'playArticleText' ||
            btn.getAttribute('role') === 'tab' ||
            btn.getAttribute('onclick')?.includes('switchTab') ||
            btn.getAttribute('onclick')?.includes('toggleAiModal') ||
            btn.getAttribute('onclick')?.includes('togglePlayAll') ||
            btn.getAttribute('onclick')?.includes('togglePlayArticle') ||
            btn.getAttribute('onclick')?.includes('togglePlayLetter') ||
            btn.getAttribute('onclick')?.includes('stopArticleSpeech') ||
            btn.getAttribute('onclick')?.includes('stopSpeech')) {
            return false;
        }

        const onclickStr = btn.getAttribute('onclick') || '';
        // 包含 Pattern 的 playTTS, checkSentence, checkVerbCard, checkScenario, checkDropdown, sortItem, selectQuizAnswer, checkF1, checkExercise 等
        return btn.classList.contains('audio-btn') || 
               btn.classList.contains('speak-btn') || 
               btn.hasAttribute('data-speak') ||
               btn.classList.contains('choice-btn') ||
               /speak|play|sound|audio|tts|check|quiz|answer|sort|card|verb|scenario|dropdown|f1|f2|exercise|fillin|pair|feed/i.test(onclickStr);
    }

    // 搜尋頁面上所有發音與互動答題按鈕
    function getAllInteractiveButtons() {
        return Array.from(document.querySelectorAll('button, .audio-btn, .speak-btn, [data-speak], .choice-btn'))
                    .filter(isAudioOrQuizButton);
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
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(masterGain);
            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch(e) {}
    }

    // 啟動全域 5 秒冷卻鎖定
    function startGlobalCooldown(triggerBtn, seconds = DEFAULT_COOLDOWN_SECONDS) {
        globalCooldownRemaining = seconds;

        // 1. 視覺上標記其他按鈕處於冷卻狀態 (不使用 disabled 以免破壞事件流)
        setTimeout(() => {
            currentLockedButtons = getAllInteractiveButtons();
            currentLockedButtons.forEach(btn => {
                if (btn !== triggerBtn) {
                    btn.classList.add('opacity-70', 'cursor-not-allowed');
                }
            });
            if (triggerBtn) {
                triggerBtn.classList.add('ring-2', 'ring-amber-400');
            }
        }, 0);

        currentActiveButton = triggerBtn;

        // 2. 顯示頂部全域冷卻進度條
        const pill = getCooldownPill();
        const secEl = document.getElementById('globalCooldownSec');
        const barEl = document.getElementById('globalCooldownBar');
        const textEl = document.getElementById('globalCooldownText');

        if (secEl) secEl.innerText = seconds;
        if (textEl) textEl.innerHTML = `冷卻中：<strong id="globalCooldownSec" class="text-amber-400 text-base font-black">${seconds}</strong> 秒後才可按下一題`;
        if (barEl) barEl.style.width = '100%';

        pill.classList.remove('-translate-y-16', 'opacity-0', 'pointer-events-none');
        pill.classList.add('translate-y-0', 'opacity-100');

        // 3. 開始 1 秒倒數計時器
        clearInterval(globalCooldownTimer);
        globalCooldownTimer = setInterval(() => {
            globalCooldownRemaining--;

            if (globalCooldownRemaining > 0) {
                const curSecEl = document.getElementById('globalCooldownSec');
                if (curSecEl) curSecEl.innerText = globalCooldownRemaining;
                if (barEl) barEl.style.width = `${(globalCooldownRemaining / seconds) * 100}%`;
            } else {
                endGlobalCooldown();
            }
        }, 1000);

        return true;
    }

    // 解除全域冷卻鎖定
    function endGlobalCooldown() {
        clearInterval(globalCooldownTimer);
        globalCooldownRemaining = 0;

        if (currentLockedButtons && currentLockedButtons.length) {
            currentLockedButtons.forEach(btn => {
                btn.classList.remove('opacity-70', 'cursor-not-allowed');
            });
            currentLockedButtons = [];
        }
        if (currentActiveButton) {
            currentActiveButton.classList.remove('ring-2', 'ring-amber-400');
            currentActiveButton = null;
        }

        const pill = getCooldownPill();
        if (pill) {
            pill.classList.remove('translate-y-0', 'opacity-100');
            pill.classList.add('-translate-y-16', 'opacity-0', 'pointer-events-none');
        }
    }

    // --- 公開方法 ---
    return {
        DEFAULT_COOLDOWN_SECONDS,

        getRemainingCooldown() {
            return globalCooldownRemaining;
        },

        getMode() {
            return currentMode;
        },

        setMode(newMode) {
            if (!['all', 'tts_only', 'mute'].includes(newMode)) return;
            currentMode = newMode;
            localStorage.setItem('classroom_audio_mode', newMode);
            if (newMode === 'mute') this.stopAll();
            this.updateWidgetUI();
        },

        cycleMode() {
            if (currentMode === 'all') {
                this.setMode('tts_only');
            } else if (currentMode === 'tts_only') {
                this.setMode('mute');
            } else {
                this.setMode('all');
            }
        },

        stopAll() {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        },

        lockAll(triggerBtn, seconds = DEFAULT_COOLDOWN_SECONDS) {
            return startGlobalCooldown(triggerBtn, seconds);
        },

        // 語音朗讀 (TTS) - 確保聲音穩定發出
        speak(text, options = {}) {
            if (!text) return false;
            if (currentMode === 'mute') {
                if (options.onEnd) options.onEnd();
                return false;
            }

            if (!('speechSynthesis' in window)) {
                console.warn('瀏覽器不支援 Web Speech API');
                return false;
            }

            try {
                window.speechSynthesis.cancel();
            } catch(e) {}

            const utterance = new SpeechSynthesisUtterance(String(text));
            utterance.lang = options.lang || 'en-US';
            utterance.rate = options.rate || 0.95;
            utterance.pitch = options.pitch || 1.0;

            // 尋找英文發音
            const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
            const englishVoice = voices.find(v => /^en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
            if (englishVoice) utterance.voice = englishVoice;

            // 防止垃圾回收
            window._activeUtterances.push(utterance);
            const cleanup = () => {
                const idx = window._activeUtterances.indexOf(utterance);
                if (idx > -1) window._activeUtterances.splice(idx, 1);
            };

            utterance.onend = () => {
                cleanup();
                if (options.onEnd) options.onEnd();
            };

            utterance.onerror = (err) => {
                cleanup();
                if (options.onError) options.onError(err);
            };

            // 稍微延遲 40ms 以避開 Chrome cancel() 異步取消新 utterance 的問題
            setTimeout(() => {
                try {
                    window.speechSynthesis.resume();
                    window.speechSynthesis.speak(utterance);
                } catch(e) {
                    console.error('TTS error:', e);
                }
            }, 40);

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
                    gain.gain.setValueAtTime(0.18, now);
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
                    gain.gain.setValueAtTime(0.15, now);
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
                        gain.gain.setValueAtTime(0.15, now + i * 0.07);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.22);
                        osc.connect(gain);
                        gain.connect(masterGain);
                        osc.start(now + i * 0.07);
                        osc.stop(now + i * 0.07 + 0.22);
                    });
                } else if (type === 'click' || type === 'card' || type === 'coin') {
                    playBeepTone(480, 0.06, 'triangle');
                } else if (type === 'beep') {
                    playBeepTone(580, 0.1, 'sine');
                }
            } catch(e) {}
        },

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

        init() {
            // 全域守護原生 speechSynthesis.speak：保證不被垃圾回收、自動喚醒、防止瀏覽器取消
            if ('speechSynthesis' in window && !window.speechSynthesis._audioGuardPatched) {
                const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
                window.speechSynthesis.speak = function(utterance) {
                    if (currentMode === 'mute') return;

                    window._activeUtterances = window._activeUtterances || [];
                    window._activeUtterances.push(utterance);
                    const cleanup = () => {
                        const idx = window._activeUtterances.indexOf(utterance);
                        if (idx > -1) window._activeUtterances.splice(idx, 1);
                    };
                    utterance.onend = cleanup;
                    utterance.onerror = cleanup;

                    // 確保語音引擎喚醒 (處理 Chrome/Edge 暫停與取消問題)
                    setTimeout(() => {
                        try {
                            window.speechSynthesis.resume();
                            origSpeak(utterance);
                        } catch(e) {
                            console.error('speechSynthesis speak error:', e);
                        }
                    }, 40);
                };
                window.speechSynthesis._audioGuardPatched = true;
            }

            // 全域橋接 Pattern 頁面原生函數 (若頁面未定義則使用此實現)
            if (!window.playSound) {
                window.playSound = (type) => this.playSFX(type);
            }
            if (!window.playTTS) {
                window.playTTS = (text, btn) => this.speak(text, { button: btn });
            }

            const setup = () => {
                this.updateWidgetUI();

                const btns = document.querySelectorAll('#audioGuardBtn, #audioFxBtn, .classroom-audio-btn');
                btns.forEach(btn => {
                    btn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.cycleMode();
                    };
                });

                // 使用者第一次互動時解鎖 AudioContext 與 SpeechSynthesis
                const unlockAudio = () => {
                    getAudioContext();
                    if ('speechSynthesis' in window) {
                        try { window.speechSynthesis.resume(); } catch(e) {}
                    }
                };
                window.addEventListener('click', unlockAudio, { passive: true });
                window.addEventListener('touchstart', unlockAudio, { passive: true });
                window.addEventListener('keydown', unlockAudio, { passive: true });

                // =================================================================
                // 核心關鍵：全域點擊事件 Capture 攔截
                // 1. 若處於 5 秒冷卻中：攔截阻擋點擊，並跳出倒數提醒
                // 2. 若未處於冷卻中：允許此次點擊執行發音/答題，並立即啟動 5 秒全域冷卻！
                // =================================================================
                document.addEventListener('click', (e) => {
                    const targetBtn = e.target.closest('button, .audio-trigger, .speak-btn, [data-speak], .audio-btn, .choice-btn');
                    if (!targetBtn || !isAudioOrQuizButton(targetBtn)) return;

                    // 若目前全域正在 5 秒冷卻中：徹底攔截阻止！
                    if (globalCooldownRemaining > 0) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        showCooldownBlockedWarning(globalCooldownRemaining);
                        return false;
                    }

                    // 尚未在冷卻中：允許此次點擊播放聲音/執行，並立即啟動 5 秒全站冷卻鎖定！
                    startGlobalCooldown(targetBtn, DEFAULT_COOLDOWN_SECONDS);
                }, true); // useCapture: true 確保在任何子元素 handler 前先判斷冷卻狀態
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
