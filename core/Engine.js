/* ═══════════════════════════════════════════════════════════════════════════
   DIGITAL DETECTIVE — Visual Novel Engine
   core/Engine.js  (fixed: settings, credits, save/load, tabs)
   ═══════════════════════════════════════════════════════════════════════════ */

import { ScenarioLoader } from './ScenarioLoader.js';

/* ─────────────────────────────────────────────────────────────────────────
   CONSTANTS
─────────────────────────────────────────────────────────────────────────── */

const TEXT_SPEED = {
    slow: 22,
    normal: 45,
    fast: 90,
    instant: Infinity
};

const SAVE_SLOTS = 3;
const SAVE_KEY_PREFIX = 'dd_save_';
const SETTINGS_KEY = 'dd_settings';

const FALLBACK_SPRITE_COLORS = {
    detective: { bg: '#0a2a14', border: '#00ff41', label: 'DET' },
    detective2: { bg: '#2a0a10', border: '#ff2d55', label: '???' },
    dispatch: { bg: '#0a1e2a', border: '#00ccff', label: 'DIS' },
    default: { bg: '#111827', border: '#6a9ab0', label: 'CHR' }
};

const FALLBACK_BG_COLORS = {
    bg_rain_city: 'linear-gradient(160deg, #020810 0%, #0a1520 50%, #050d18 100%)',
    bg_crime_scene: 'linear-gradient(160deg, #080c10 0%, #0d0810 50%, #060408 100%)',
    default: 'linear-gradient(160deg, #050d12 0%, #020408 100%)'
};

/* ═══════════════════════════════════════════════════════════════════════════
   ENGINE CLASS
═══════════════════════════════════════════════════════════════════════════ */

class Engine {

    constructor() {
        this.scenario = null;
        this.steps = [];
        this.stepIndex = 0;
        this.isTyping = false;
        this.isWaiting = false;
        this.isBusy = false;
        this.typewriterRAF = null;
        this.fullText = '';
        this._bgmAudio = null;
        this._bgmWasPaused = false;
        this._hoverSfx = null;
        this._selectSfx = null;
        this._gameStarted = false;

        // Which characterId is currently in each slot
        this._slotOccupant = { left: null, center: null, right: null };

        // Current save/load tab
        this._saveLoadTab = 'save';

        // Settings (loaded from localStorage or defaults)
        this.settings = {
            textSpeed: 'normal',
            bgmVolume: 0.5,
            sfxVolume: 0.7
        };

        this.dom = {};
        this.loader = new ScenarioLoader({ basePath: 'data/', verbose: true });
    }

    /* ─────────────────────────────────────────────────────────────────────────
       INIT
    ───────────────────────────────────────────────────────────────────────── */

    async init() {
        this._cacheDOM();
        this._loadSettings();
        this._bindEvents();
        this._buildSettingsUI();
        this._startViewportScaler();
        this._initUIAudio();

        try {
            this._setLoadingProgress(10, 'Reading case file…');
            const scenario = await this.loader.load('scenario.json');
            this._setLoadingProgress(45, 'Verifying assets…');
            await this.loader.probeAllSprites(scenario);
            this._setLoadingProgress(80, 'Preparing scene…');
            this.scenario = scenario;

            this.dom.hudCaseTitle.textContent = scenario.title || 'Case #001';
            this.dom.hudChapterValue.textContent = scenario.chapter || 'I';

            await this._delay(400);
            this._setLoadingProgress(100, 'Case file ready.');
            await this._delay(600);

            this._hideScreen('screen-loading');
            this._showScreen('screen-main-menu');

        } catch (err) {
            console.error('[Engine] Init failed:', err);
            this._setLoadingProgress(100, `ERROR: ${err.message}`);
            this.dom.loadingText.style.color = 'var(--clr-neon-red)';
        }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       DOM CACHE
    ───────────────────────────────────────────────────────────────────────── */

    _cacheDOM() {
        const $ = (id) => document.getElementById(id);
        this.dom = {
            gameContainer: $('game-container'),
            backgroundImage: $('background-image'),
            spriteLeft: $('sprite-left'),
            spriteCenter: $('sprite-center'),
            spriteRight: $('sprite-right'),
            dialogueBox: $('dialogue-box'),
            dialogueText: $('dialogue-text'),
            speakerName: $('speaker-name'),
            nameTagAccent: $('name-tag-accent'),
            nameTagWrapper: $('name-tag-wrapper'),
            continueIndicator: $('continue-indicator'),
            choicePanel: $('choice-panel'),
            choicePromptText: $('choice-prompt-text'),
            choiceList: $('choice-list'),
            hudCaseTitle: $('hud-case-title'),
            hudChapterValue: $('hud-chapter-value'),
            screenMainMenu: $('screen-main-menu'),
            screenSaveLoad: $('screen-save-load'),
            screenSettings: $('screen-settings'),
            screenLog: $('screen-log'),
            screenCredits: $('screen-credits'),
            screenLoading: $('screen-loading'),
            loadingText: $('loading-text'),
            loadingBarFill: $('loading-bar-fill'),
            btnMenu: $('btn-menu'),
            btnSave: $('btn-save'),
            btnLog: $('btn-log'),
            btnSettings: $('btn-settings'),
            menuNewGame: $('menu-new-game'),
            menuLoadGame: $('menu-load-game'),
            menuSettingsMain: $('menu-settings-main'),
            menuCredits: $('menu-credits'),
            menuReturnTitle: $('menu-return-title'),
            menuQuitGame: $('menu-quit-game'),
            closeSaveLoad: $('close-save-load'),
            closeSettings: $('close-settings'),
            closeLog: $('close-log'),
            closeCredits: $('close-credits'),
            saveSlotList: $('save-slot-list'),
            saveLoadTabs: $('save-load-tabs'),
            settingsBody: $('settings-body'),
        };
    }

    /* ─────────────────────────────────────────────────────────────────────────
       EVENT BINDING
    ───────────────────────────────────────────────────────────────────────── */

    _bindEvents() {
        // Dialogue advance
        this.dom.dialogueBox.addEventListener('click', () => this._onAdvance());
        this.dom.dialogueBox.addEventListener('touchend', (e) => { e.preventDefault(); this._onAdvance(); });
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') {
                e.preventDefault();
                this._onAdvance();
            }
            if (e.code === 'Escape') this._toggleMenu();
        });

        // ── Main menu buttons ──────────────────────────────────────────────
        const menuBtns = document.querySelectorAll('.menu-btn');
        menuBtns.forEach(btn => {
            btn.addEventListener('mouseenter', () => this._playHoverSfx());
        });

        this.dom.menuNewGame?.addEventListener('click', () => {
            this._playSelectSfx();
            this._startGame();
        });

        this.dom.menuLoadGame?.addEventListener('click', () => {
            this._playSelectSfx();
            this._saveLoadTab = 'load';
            this._hideScreen('screen-main-menu');
            this._openSaveLoad('load');
        });

        this.dom.menuSettingsMain?.addEventListener('click', () => {
            this._playSelectSfx();
            this._hideScreen('screen-main-menu');
            this._showScreen('screen-settings');
        });

        this.dom.menuCredits?.addEventListener('click', () => {
            this._playSelectSfx();
            this._hideScreen('screen-main-menu');
            this._showScreen('screen-credits');
        });

        this.dom.menuReturnTitle?.addEventListener('click', () => {
            this._playSelectSfx();
            this._confirmDialog(
                '⚠',
                'Return to Title',
                'Unsaved progress will be lost.\nAre you sure?',
                () => this._returnToTitle()
            );
        });

        this.dom.menuQuitGame?.addEventListener('click', () => {
            this._playSelectSfx();
            this._confirmDialog(
                '✕',
                'Exit Game',
                'Are you sure you want to exit?',
                () => this._quitGame()
            );
        });

        // ── HUD buttons ────────────────────────────────────────────────────
        this.dom.btnMenu?.addEventListener('click', () => this._toggleMenu());

        this.dom.btnSave?.addEventListener('click', () => {
            this._saveLoadTab = 'save';
            this._openSaveLoad('save');
        });

        this.dom.btnLog?.addEventListener('click', () => this._showScreen('screen-log'));

        this.dom.btnSettings?.addEventListener('click', () => this._showScreen('screen-settings'));

        // ── Close buttons ──────────────────────────────────────────────────
        this.dom.closeSaveLoad?.addEventListener('click', () => {
            this._hideScreen('screen-save-load');
            if (!this._gameStarted) this._showScreen('screen-main-menu');
        });
        this.dom.closeSettings?.addEventListener('click', () => {
            this._hideScreen('screen-settings');
            if (!this._gameStarted) this._showScreen('screen-main-menu');
        });
        this.dom.closeLog?.addEventListener('click', () => this._hideScreen('screen-log'));
        this.dom.closeCredits?.addEventListener('click', () => {
            this._hideScreen('screen-credits');
            this._showScreen('screen-main-menu');
        });

        // ── Save/Load tabs ─────────────────────────────────────────────────
        this.dom.saveLoadTabs?.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this._saveLoadTab = tab;
                this.dom.saveLoadTabs.querySelectorAll('.tab-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.tab === tab);
                    b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
                });
                this._renderSaveSlots(tab);
            });
        });
    }

    /* ─────────────────────────────────────────────────────────────────────────
       GAME FLOW
    ───────────────────────────────────────────────────────────────────────── */

    _startGame() {
        this._hideScreen('screen-main-menu');
        this._clearAllSlots();
        this.steps = [...this.scenario.steps];
        this.stepIndex = 0;
        this._gameStarted = true;
        this._updateGameButtons();
        this._processNextStep();
    }

    _onAdvance() {
        if (this.isBusy) return;
        if (!this.dom.choicePanel.classList.contains('hidden')) return;

        if (this.isTyping) {
            this._completeTyping();
            return;
        }

        if (this.isWaiting) {
            this.isWaiting = false;
            this._hideContinue();
            this._processNextStep();
        }
    }

    _processNextStep() {
        if (this.stepIndex >= this.steps.length) {
            this._onSceneEnd();
            return;
        }
        const step = this.steps[this.stepIndex++];
        this._dispatchStep(step);
    }

    _dispatchStep(step) {
        switch (step.type) {
            case 'dialogue': this._handleDialogue(step); break;
            case 'choice': this._handleChoice(step); break;
            case 'sprite': this._handleSprite(step); break;
            case 'background': this._handleBackground(step); break;
            case 'bgm': this._handleBGM(step); break;
            case 'sfx': this._handleSFX(step); break;
            case 'noop': this._processNextStep(); break;
            default:
                console.warn(`[Engine] Unknown step type: "${step.type}"`);
                this._processNextStep();
        }
    }

    _onSceneEnd() {
        console.log('[Engine] Scene complete.');
        this._hideContinue();
        this._clearAllSlots();
        this.dom.dialogueText.textContent = '';
        this.dom.speakerName.textContent = '— FIN —';
    }

    /* ─────────────────────────────────────────────────────────────────────────
       DIALOGUE
    ───────────────────────────────────────────────────────────────────────── */

    _handleDialogue(step) {
        const charDef = this.scenario.characters[step.character];
        const name = charDef ? charDef.name : step.character;
        const color = charDef ? charDef.color : '#d8eaf0';

        this.dom.speakerName.textContent = name;
        this.dom.speakerName.style.color = color;
        this.dom.nameTagAccent.style.background = color;
        this.dom.nameTagAccent.style.boxShadow = `0 0 8px ${color}88`;

        // ── Show only the speaking character ───────────────────────────────
        // On mobile (narrow screens) always show one character; on desktop too for consistency
        if (step.character !== 'narrator' && charDef) {
            this._showOnlySpeaker(step.character, charDef);
        } else if (step.character === 'narrator') {
            // Narrator has no sprite — clear everyone
            this._clearAllSlots();
        }

        const speed = step.textSpeed || this.settings.textSpeed;
        this._typewrite(step.text, speed);
        this._appendLog(name, step.text);
    }

    _showOnlySpeaker(characterId, charDef) {
        // Clear all slots first
        this._clearAllSlots();

        // Show speaking character in center
        const slot = this.dom.spriteCenter;
        if (!slot) return;

        this._slotOccupant['center'] = characterId;
        slot.innerHTML = '';
        slot.className = 'sprite-slot';
        slot.setAttribute('data-position', 'center');

        const entry = charDef.resolvedSprites?.['neutral'];
        if (!entry || entry.fallback || !entry.src) {
            slot.appendChild(this._makeSvgFallbackSprite(characterId, charDef));
        } else {
            const img = document.createElement('img');
            img.src = entry.src;
            img.alt = charDef.name;
            img.draggable = false;
            img.onerror = () => {
                slot.innerHTML = '';
                slot.appendChild(this._makeSvgFallbackSprite(characterId, charDef));
            };
            slot.appendChild(img);
        }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       CHOICE
    ───────────────────────────────────────────────────────────────────────── */

    _handleChoice(step) {
        this.isWaiting = false;
        this._hideContinue();

        this.dom.choicePromptText.textContent = step.prompt || 'What will you do?';
        this.dom.choiceList.innerHTML = '';

        step.choices.forEach((choice, idx) => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.textContent = choice.text;
            btn.style.animationDelay = `${idx * 60}ms`;
            btn.addEventListener('click', () => this._onChoiceSelected(choice.goto));
            this.dom.choiceList.appendChild(btn);
        });

        this.dom.choicePanel.classList.remove('hidden');
    }

    _onChoiceSelected(branchId) {
        this.dom.choicePanel.classList.add('hidden');
        this.dom.choiceList.innerHTML = '';

        if (!branchId) {
            this._processNextStep();
            return;
        }

        const branchSteps = this.loader.resolveBranch(this.scenario, branchId);
        if (branchSteps.length === 0) {
            this._processNextStep();
            return;
        }

        this.steps.splice(this.stepIndex, 0, ...branchSteps);
        this._processNextStep();
    }

    /* ─────────────────────────────────────────────────────────────────────────
       SPRITE
    ───────────────────────────────────────────────────────────────────────── */

    _handleSprite(step) {
        if (step.animation === 'hide') {
            this._hideCharacter(step.character);
            this._processNextStep();
            return;
        }

        const charDef = this.scenario.characters[step.character];
        if (!charDef) {
            console.warn(`[Engine] Sprite: unknown character "${step.character}"`);
            this._processNextStep();
            return;
        }

        const position = step.position;
        if (!position) { this._processNextStep(); return; }

        const slot = this._getSlot(position);
        if (!slot) { this._processNextStep(); return; }

        if (this._slotOccupant[position] && this._slotOccupant[position] !== step.character) {
            slot.innerHTML = '';
        }

        this._slotOccupant[position] = step.character;
        slot.innerHTML = '';
        slot.className = 'sprite-slot';
        slot.setAttribute('data-position', position);

        const emotion = step.emotion || 'neutral';
        const entry = charDef.resolvedSprites?.[emotion] || charDef.resolvedSprites?.['neutral'];

        if (!entry || entry.fallback || !entry.src) {
            slot.appendChild(this._makeSvgFallbackSprite(step.character, charDef));
        } else {
            const img = document.createElement('img');
            img.src = entry.src;
            img.alt = `${charDef.name} — ${emotion}`;
            img.draggable = false;
            img.onerror = () => {
                console.warn(`[Engine] Runtime sprite fail: ${entry.src}`);
                slot.innerHTML = '';
                slot.appendChild(this._makeSvgFallbackSprite(step.character, charDef));
            };
            slot.appendChild(img);
        }

        const anim = step.animation;
        if (anim && anim !== 'hide') slot.classList.add(anim);

        this._processNextStep();
    }

    _hideCharacter(characterId) {
        for (const [pos, occupant] of Object.entries(this._slotOccupant)) {
            if (occupant === characterId) {
                const slot = this._getSlot(pos);
                if (slot) {
                    slot.innerHTML = '';
                    slot.className = 'sprite-slot';
                    slot.setAttribute('data-position', pos);
                }
                this._slotOccupant[pos] = null;
            }
        }
    }

    _clearAllSlots() {
        for (const pos of ['left', 'center', 'right']) {
            const slot = this._getSlot(pos);
            if (slot) {
                slot.innerHTML = '';
                slot.className = 'sprite-slot';
                slot.setAttribute('data-position', pos);
            }
            this._slotOccupant[pos] = null;
        }
    }

    _getSlot(position) {
        switch (position) {
            case 'left': return this.dom.spriteLeft;
            case 'center': return this.dom.spriteCenter;
            case 'right': return this.dom.spriteRight;
            default: return null;
        }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       BACKGROUND
    ───────────────────────────────────────────────────────────────────────── */

    async _handleBackground(step) {
        this.isBusy = true;
        const el = this.dom.backgroundImage;

        el.style.opacity = '0';
        el.style.transition = 'opacity 0.5s ease';
        await this._delay(500);

        if (step.src) {
            const ok = await this.loader.probeImage(step.src);
            if (ok) {
                el.style.background = '';
                el.style.backgroundImage = `url('${step.src}')`;
                el.style.backgroundSize = 'cover';
                el.style.backgroundPosition = 'center';
            } else {
                console.warn(`[Engine] Background missing: "${step.src}". Using fallback.`);
                this._applyFallbackBackground(el, step);
            }
        } else {
            this._applyFallbackBackground(el, step);
        }

        el.style.opacity = '1';
        await this._delay(500);
        this.isBusy = false;
        this._processNextStep();
    }

    _applyFallbackBackground(el, step) {
        el.style.backgroundImage = 'none';
        el.style.background = FALLBACK_BG_COLORS[step.id] || FALLBACK_BG_COLORS.default;
    }

    /* ─────────────────────────────────────────────────────────────────────────
       AUDIO
    ───────────────────────────────────────────────────────────────────────── */

    _handleBGM(step) {
        try {
            if (this._bgmAudio) { this._bgmAudio.pause(); this._bgmAudio = null; }
            const audio = new Audio(step.src);
            audio.loop = step.loop ?? true;
            audio.volume = (step.volume ?? 1) * this.settings.bgmVolume;
            audio.play().catch(() => { });
            this._bgmAudio = audio;
        } catch (e) {
            console.warn('[Engine] BGM failed (graceful skip):', e.message);
        }
        this._processNextStep();
    }

    _handleSFX(step) {
        try {
            const audio = new Audio(step.src);
            audio.volume = (step.volume ?? 1) * this.settings.sfxVolume;
            audio.play().catch(() => { });
        } catch (e) {
            console.warn('[Engine] SFX failed (graceful skip):', e.message);
        }
        this._processNextStep();
    }

    /* ─────────────────────────────────────────────────────────────────────────
       TYPEWRITER
    ───────────────────────────────────────────────────────────────────────── */

    _typewrite(text, speed = 'normal') {
        if (this.typewriterRAF) {
            cancelAnimationFrame(this.typewriterRAF);
            this.typewriterRAF = null;
        }

        this.fullText = text;
        this.isTyping = true;
        this.isWaiting = false;
        this._hideContinue();

        const el = this.dom.dialogueText;
        el.textContent = '';
        el.classList.remove('done');

        if (speed === 'instant' || TEXT_SPEED[speed] === Infinity) {
            el.textContent = text;
            this._onTypingComplete();
            return;
        }

        const cps = TEXT_SPEED[speed] || 45;
        const msPerChar = 1000 / cps;
        let charIndex = 0;
        let lastTime = null;
        let accumulated = 0;

        const tick = (timestamp) => {
            if (!lastTime) lastTime = timestamp;
            accumulated += timestamp - lastTime;
            lastTime = timestamp;

            while (accumulated >= msPerChar && charIndex < text.length) {
                accumulated -= msPerChar;
                charIndex++;
                el.textContent = text.slice(0, charIndex);
            }

            if (charIndex < text.length) {
                this.typewriterRAF = requestAnimationFrame(tick);
            } else {
                this._onTypingComplete();
            }
        };

        this.typewriterRAF = requestAnimationFrame(tick);
    }

    _completeTyping() {
        if (this.typewriterRAF) {
            cancelAnimationFrame(this.typewriterRAF);
            this.typewriterRAF = null;
        }
        this.dom.dialogueText.textContent = this.fullText;
        this._onTypingComplete();
    }

    _onTypingComplete() {
        this.isTyping = false;
        this.isWaiting = true;
        this.dom.dialogueText.classList.add('done');
        this._showContinue();
    }

    /* ─────────────────────────────────────────────────────────────────────────
       SETTINGS
    ───────────────────────────────────────────────────────────────────────── */

    _loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) Object.assign(this.settings, JSON.parse(raw));
        } catch (e) {
            console.warn('[Engine] Could not load settings:', e.message);
        }
    }

    _saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (e) {
            console.warn('[Engine] Could not save settings:', e.message);
        }
    }

    _buildSettingsUI() {
        const body = this.dom.settingsBody;
        if (!body) return;

        body.innerHTML = '';

        // ── Text Speed ────────────────────────────────────────────────────
        const speedRow = document.createElement('div');
        speedRow.className = 'setting-row';
        speedRow.innerHTML = `<span class="setting-label">Text Speed</span>`;

        const speedCtrl = document.createElement('div');
        speedCtrl.className = 'setting-control setting-speed-group';

        ['slow', 'normal', 'fast', 'instant'].forEach(val => {
            const btn = document.createElement('button');
            btn.className = 'setting-opt-btn' + (this.settings.textSpeed === val ? ' active' : '');
            btn.textContent = val.charAt(0).toUpperCase() + val.slice(1);
            btn.dataset.value = val;
            btn.addEventListener('click', () => {
                this.settings.textSpeed = val;
                speedCtrl.querySelectorAll('.setting-opt-btn').forEach(b =>
                    b.classList.toggle('active', b.dataset.value === val));
                this._saveSettings();
            });
            speedCtrl.appendChild(btn);
        });

        speedRow.appendChild(speedCtrl);
        body.appendChild(speedRow);

        // ── BGM Volume ────────────────────────────────────────────────────
        body.appendChild(this._makeSliderRow(
            'BGM Volume',
            Math.round(this.settings.bgmVolume * 100),
            (val) => {
                this.settings.bgmVolume = val / 100;
                if (this._bgmAudio) this._bgmAudio.volume = this.settings.bgmVolume;
                this._saveSettings();
            }
        ));

        // ── SFX Volume ────────────────────────────────────────────────────
        body.appendChild(this._makeSliderRow(
            'SFX Volume',
            Math.round(this.settings.sfxVolume * 100),
            (val) => {
                this.settings.sfxVolume = val / 100;
                this._saveSettings();
            }
        ));
    }

    _makeSliderRow(label, value, onChange) {
        const row = document.createElement('div');
        row.className = 'setting-row';

        const lbl = document.createElement('span');
        lbl.className = 'setting-label';
        lbl.textContent = label;

        const ctrl = document.createElement('div');
        ctrl.className = 'setting-control';

        const valDisplay = document.createElement('span');
        valDisplay.className = 'setting-val-display';
        valDisplay.textContent = value + '%';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = 0;
        slider.max = 100;
        slider.value = value;
        slider.addEventListener('input', () => {
            valDisplay.textContent = slider.value + '%';
            onChange(parseInt(slider.value, 10));
        });

        ctrl.appendChild(slider);
        ctrl.appendChild(valDisplay);
        row.appendChild(lbl);
        row.appendChild(ctrl);
        return row;
    }

    /* ─────────────────────────────────────────────────────────────────────────
       SAVE / LOAD
    ───────────────────────────────────────────────────────────────────────── */

    _openSaveLoad(tab) {
        // Reset tabs UI
        this.dom.saveLoadTabs?.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tab);
            b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
        });
        this._renderSaveSlots(tab);
        this._showScreen('screen-save-load');
    }

    _renderSaveSlots(tab) {
        const list = this.dom.saveSlotList;
        if (!list) return;
        list.innerHTML = '';

        for (let i = 0; i < SAVE_SLOTS; i++) {
            const raw = localStorage.getItem(`${SAVE_KEY_PREFIX}${i}`);
            const data = raw ? JSON.parse(raw) : null;

            const slot = document.createElement('div');
            slot.className = 'save-slot' + (data ? '' : ' empty');

            const numEl = document.createElement('div');
            numEl.className = 'save-slot-number';
            numEl.textContent = String(i + 1).padStart(2, '0');

            const infoEl = document.createElement('div');
            infoEl.className = 'save-slot-info';

            const titleEl = document.createElement('div');
            titleEl.className = 'save-slot-title';
            titleEl.textContent = data ? (data.title || 'Untitled') : '— Empty Slot —';

            const dateEl = document.createElement('div');
            dateEl.className = 'save-slot-date';
            dateEl.textContent = data ? data.date : '';

            infoEl.appendChild(titleEl);
            infoEl.appendChild(dateEl);

            const actionsEl = document.createElement('div');
            actionsEl.className = 'save-slot-actions';

            if (tab === 'save') {
                const saveBtn = document.createElement('button');
                saveBtn.className = 'save-slot-action-btn';
                saveBtn.textContent = 'Save';
                saveBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._saveToSlot(i);
                    this._renderSaveSlots('save');
                });
                actionsEl.appendChild(saveBtn);

                if (data) {
                    const delBtn = document.createElement('button');
                    delBtn.className = 'save-slot-action-btn del';
                    delBtn.textContent = 'Delete';
                    delBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (confirm(`Delete save slot ${i + 1}?`)) {
                            localStorage.removeItem(`${SAVE_KEY_PREFIX}${i}`);
                            this._renderSaveSlots('save');
                        }
                    });
                    actionsEl.appendChild(delBtn);
                }
            } else {
                // Load tab
                if (data) {
                    const loadBtn = document.createElement('button');
                    loadBtn.className = 'save-slot-action-btn';
                    loadBtn.textContent = 'Load';
                    loadBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._loadFromSlot(i);
                    });
                    actionsEl.appendChild(loadBtn);
                }
            }

            slot.appendChild(numEl);
            slot.appendChild(infoEl);
            slot.appendChild(actionsEl);
            list.appendChild(slot);
        }
    }

    _saveToSlot(slotIndex) {
        if (!this.scenario) {
            alert('No active game to save.');
            return;
        }
        try {
            const save = {
                title: this.scenario.title || 'Case #001',
                chapter: this.scenario.chapter || 'I',
                stepIndex: this.stepIndex,
                steps: this.steps,
                date: new Date().toLocaleString()
            };
            localStorage.setItem(`${SAVE_KEY_PREFIX}${slotIndex}`, JSON.stringify(save));
            console.log(`[Engine] Saved to slot ${slotIndex}`);
        } catch (e) {
            console.error('[Engine] Save failed:', e.message);
            alert('Save failed: storage may be full or unavailable.');
        }
    }

    _loadFromSlot(slotIndex) {
        try {
            const raw = localStorage.getItem(`${SAVE_KEY_PREFIX}${slotIndex}`);
            if (!raw) { alert('No save data in this slot.'); return; }
            const save = JSON.parse(raw);

            this._hideScreen('screen-save-load');
            this._hideScreen('screen-main-menu');
            this._clearAllSlots();

            this.scenario = this.scenario || {};
            this.scenario.title = save.title;
            this.scenario.chapter = save.chapter;

            this.dom.hudCaseTitle.textContent = save.title || 'Case #001';
            this.dom.hudChapterValue.textContent = save.chapter || 'I';

            this.steps = save.steps;
            this.stepIndex = save.stepIndex;
            this.isTyping = false;
            this.isWaiting = false;
            this.isBusy = false;
            this._gameStarted = true;
            this._updateGameButtons();

            console.log(`[Engine] Loaded from slot ${slotIndex}, step ${this.stepIndex}`);
            this._processNextStep();
        } catch (e) {
            console.error('[Engine] Load failed:', e.message);
            alert('Load failed: save data may be corrupted.');
        }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       UI HELPERS
    ───────────────────────────────────────────────────────────────────────── */

    _showContinue() { this.dom.continueIndicator.classList.remove('hidden'); }
    _hideContinue() { this.dom.continueIndicator.classList.add('hidden'); }

    _showScreen(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('hidden');
        el.style.removeProperty('display');
        // Ensure flex display for all screens
        if (el.classList.contains('screen')) {
            el.style.display = 'flex';
        }
        if (id === 'screen-main-menu') this._startMenuRain();
    }
    _hideScreen(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add('hidden');
        el.style.display = 'none';
        if (id === 'screen-main-menu') this._stopMenuRain();
    }

    _toggleMenu() {
        const m = this.dom.screenMainMenu;
        if (!m) return;
        if (m.classList.contains('hidden')) {
            // Opening menu → pause BGM
            if (this._bgmAudio && !this._bgmAudio.paused) {
                this._bgmAudio.pause();
                this._bgmWasPaused = true;
            }
            this._showScreen('screen-main-menu');
        } else {
            // Closing menu → resume BGM if it was playing before
            this._hideScreen('screen-main-menu');
            if (this._bgmAudio && this._bgmWasPaused) {
                this._bgmAudio.play().catch(() => { });
                this._bgmWasPaused = false;
            }
        }
    }

    _setLoadingProgress(percent, message) {
        if (this.dom.loadingBarFill) this.dom.loadingBarFill.style.width = `${percent}%`;
        if (this.dom.loadingText && message) this.dom.loadingText.textContent = message;
    }

    _appendLog(name, text) {
        const log = document.getElementById('log-body');
        if (!log) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        const nameEl = document.createElement('span');
        nameEl.className = 'log-entry-name';
        nameEl.textContent = name;
        const textEl = document.createElement('p');
        textEl.className = 'log-entry-text';
        textEl.textContent = text;
        entry.appendChild(nameEl);
        entry.appendChild(textEl);
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    /* ─────────────────────────────────────────────────────────────────────────
       FALLBACK SPRITE SVG
    ───────────────────────────────────────────────────────────────────────── */

    _makeSvgFallbackSprite(characterId, charDef) {
        const palette = FALLBACK_SPRITE_COLORS[characterId] || FALLBACK_SPRITE_COLORS.default;
        const nameColor = charDef?.color || palette.border;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 200 480');
        svg.setAttribute('width', '200');
        svg.setAttribute('height', '480');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('aria-label', charDef?.name || characterId);
        svg.style.filter = `drop-shadow(0 8px 32px ${palette.border}44)`;

        svg.innerHTML = `
      <defs>
        <linearGradient id="bg_${characterId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${palette.border}" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="${palette.border}" stop-opacity="0.04"/>
        </linearGradient>
        <filter id="glow_${characterId}">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect x="40" y="100" width="120" height="340" rx="8"
            fill="url(#bg_${characterId})"
            stroke="${palette.border}" stroke-width="1" stroke-opacity="0.4"/>
      <circle cx="100" cy="72" r="44"
              fill="${palette.bg}"
              stroke="${palette.border}" stroke-width="1.5" stroke-opacity="0.6"
              filter="url(#glow_${characterId})"/>
      <line x1="82"  y1="66" x2="92"  y2="66" stroke="${palette.border}" stroke-width="2" stroke-opacity="0.7" stroke-linecap="round"/>
      <line x1="108" y1="66" x2="118" y2="66" stroke="${palette.border}" stroke-width="2" stroke-opacity="0.7" stroke-linecap="round"/>
      <path d="M88 84 Q100 90 112 84" stroke="${palette.border}" stroke-width="1.5" fill="none" stroke-opacity="0.5" stroke-linecap="round"/>
      <line x1="100" y1="116" x2="100" y2="200" stroke="${palette.border}" stroke-width="1" stroke-opacity="0.3" stroke-dasharray="4 4"/>
      <polyline points="44,108 44,104 48,104"  fill="none" stroke="${palette.border}" stroke-width="1.5" stroke-opacity="0.8"/>
      <polyline points="156,432 156,436 152,436" fill="none" stroke="${palette.border}" stroke-width="1.5" stroke-opacity="0.8"/>
      <rect x="68" y="400" width="64" height="22" rx="3"
            fill="${palette.bg}" stroke="${palette.border}" stroke-width="1" stroke-opacity="0.6"/>
      <text x="100" y="415"
            font-family="'Special Elite','Courier New',monospace"
            font-size="11" fill="${nameColor}" text-anchor="middle"
            letter-spacing="3" opacity="0.9">${palette.label}</text>
    `;

        return svg;
    }

    /* ─────────────────────────────────────────────────────────────────────────
       VIEWPORT SCALER
    ───────────────────────────────────────────────────────────────────────── */

    _startViewportScaler() {
        const W = 1280, H = 720;
        const scale = () => {
            // Use visualViewport for accurate mobile dimensions (handles browser toolbars)
            const vw = window.visualViewport ? window.visualViewport.width  : window.innerWidth;
            const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || vw < 1024;
            let s;
            if (isMobile) {
                // On mobile: always scale to fill width — gives the biggest image
                s = vw / W;
            } else {
                // Desktop: fit both axes
                s = Math.min(vw / W, vh / H);
            }
            const left = (vw - W * s) / 2;
            const top  = isMobile ? 0 : Math.max(0, (vh - H * s) / 2);
            this.dom.gameContainer.style.transform       = `scale(${s})`;
            this.dom.gameContainer.style.transformOrigin = 'top left';
            this.dom.gameContainer.style.position        = 'absolute';
            this.dom.gameContainer.style.left            = `${left}px`;
            this.dom.gameContainer.style.top             = `${top}px`;
        };
        scale();
        window.addEventListener('resize', scale);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', scale);
        window.addEventListener('orientationchange', () => setTimeout(scale, 300));
    }

    _startMenuRain() {
        const canvas = document.getElementById('menu-rain-canvas');
        if (!canvas) return;
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');
        const drops = Array.from({ length: 120 }, () => ({
            x: Math.random() * 1280,
            y: Math.random() * 720,
            len: 10 + Math.random() * 22,
            speed: 6 + Math.random() * 10,
            opacity: 0.1 + Math.random() * 0.5,
            width: 0.4 + Math.random() * 0.8
        }));
        const tick = () => {
            ctx.clearRect(0, 0, 1280, 720);
            drops.forEach(d => {
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x - d.len * 0.15, d.y + d.len);
                ctx.strokeStyle = `rgba(0,180,220,${d.opacity})`;
                ctx.lineWidth = d.width;
                ctx.stroke();
                d.y += d.speed;
                d.x -= d.speed * 0.15;
                if (d.y > 720 + d.len) {
                    d.y = -d.len;
                    d.x = Math.random() * 1280;
                }
            });
            this._rainRAF = requestAnimationFrame(tick);
        };
        tick();
    }

    _stopMenuRain() {
        if (this._rainRAF) {
            cancelAnimationFrame(this._rainRAF);
            this._rainRAF = null;
        }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       RETURN TO TITLE / QUIT
    ───────────────────────────────────────────────────────────────────────── */

    _updateGameButtons() {
        const btn = this.dom.menuReturnTitle;
        if (!btn) return;
        if (this._gameStarted) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    }

    async _returnToTitle() {
        // ── Stop BGM ──────────────────────────────────────────────────────
        if (this._bgmAudio) { this._bgmAudio.pause(); this._bgmAudio = null; }
        this._bgmWasPaused = false;

        // ── Cancel typewriter ──────────────────────────────────────────────
        if (this.typewriterRAF) { cancelAnimationFrame(this.typewriterRAF); this.typewriterRAF = null; }

        // ── Reset game state ───────────────────────────────────────────────
        this._gameStarted = false;
        this.steps = [];
        this.stepIndex = 0;
        this.isTyping = false;
        this.isWaiting = false;
        this.isBusy = false;
        this._clearAllSlots();
        this.dom.dialogueText.textContent = '';
        this.dom.speakerName.textContent = '???';
        this._hideContinue();
        this.dom.choicePanel.classList.add('hidden');

        // ── Hide every screen ──────────────────────────────────────────────
        ['screen-main-menu', 'screen-save-load', 'screen-settings',
         'screen-log', 'screen-credits'].forEach(id => this._hideScreen(id));
        this._stopMenuRain();

        // ── Show loading screen as a clean transition (z-index 50 = above all) ──
        this._setLoadingProgress(100, 'Returning to title…');
        this._showScreen('screen-loading');

        await this._delay(900);

        // ── Hide loading and reveal fresh main menu ────────────────────────
        this._hideScreen('screen-loading');
        this._updateGameButtons();
        this._showScreen('screen-main-menu');
    }

    _quitGame() {
        // Try to close the window/tab
        window.close();
        // If window.close() was blocked (most browsers block it), show a message
        setTimeout(() => {
            this._confirmDialog(
                '✓',
                'Safe to Close',
                'You can now close this\ntab or window.',
                null,
                'Close'
            );
        }, 300);
    }

    _confirmDialog(icon, title, message, onConfirm, confirmLabel = 'Confirm') {
        // Remove any existing dialog
        const existing = document.getElementById('confirm-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'confirm-overlay';

        overlay.innerHTML = `
            <div id="confirm-box">
                <span id="confirm-icon">${icon}</span>
                <div id="confirm-title">${title}</div>
                <div id="confirm-message">${message.replace(/\n/g, '<br>')}</div>
                <div id="confirm-actions">
                    ${onConfirm ? `<button class="confirm-btn confirm-btn--yes" id="confirm-yes">${confirmLabel}</button>` : ''}
                    <button class="confirm-btn confirm-btn--no" id="confirm-no">${onConfirm ? 'Cancel' : 'OK'}</button>
                </div>
            </div>
        `;

        // Append inside the main menu screen so it layers correctly
        const menuScreen = this.dom.screenMainMenu;
        menuScreen.appendChild(overlay);

        const close = () => overlay.remove();

        overlay.querySelector('#confirm-no')?.addEventListener('click', close);
        if (onConfirm) {
            overlay.querySelector('#confirm-yes')?.addEventListener('click', () => {
                close();
                onConfirm();
            });
        }
    }

    /* ─────────────────────────────────────────────────────────────────────────
       UI AUDIO (hover & select sounds)
    ───────────────────────────────────────────────────────────────────────── */

    _initUIAudio() {
        try {
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            // Load and decode both sounds into memory buffers for zero-latency playback
            const load = async (url) => {
                const res = await fetch(url);
                const arr = await res.arrayBuffer();
                return this._audioCtx.decodeAudioData(arr);
            };
            Promise.all([
                load('assets/sfx/menu.mp3'),
                load('assets/sfx/select.mp3')
            ]).then(([hoverBuf, selectBuf]) => {
                this._hoverBuffer = hoverBuf;
                this._selectBuffer = selectBuf;
            }).catch(e => console.warn('[Engine] UI audio decode failed:', e.message));
        } catch (e) {
            console.warn('[Engine] Web Audio API not available:', e.message);
        }
    }

    _playBuffer(buffer) {
        if (!buffer || !this._audioCtx) return;
        try {
            if (this._audioCtx.state === 'suspended') this._audioCtx.resume();
            const source = this._audioCtx.createBufferSource();
            source.buffer = buffer;
            const gain = this._audioCtx.createGain();
            gain.gain.value = this.settings.sfxVolume;
            source.connect(gain);
            gain.connect(this._audioCtx.destination);
            source.start(0);
        } catch (e) { }
    }

    _playHoverSfx() {
        this._playBuffer(this._hoverBuffer);
    }

    _playSelectSfx() {
        this._playBuffer(this._selectBuffer);
    }

    /* ─────────────────────────────────────────────────────────────────────────
       UTILITY
    ───────────────────────────────────────────────────────────────────────── */

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/* ── Bootstrap ────────────────────────────────────────────────────────────── */
const engine = new Engine();
engine.init();
