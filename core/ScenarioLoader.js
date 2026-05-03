/* ═══════════════════════════════════════════════════════════════════════════
   DIGITAL DETECTIVE — Visual Novel Engine
   core/ScenarioLoader.js
   ─────────────────────────────────────────────────────────────────────────
   Responsible for:
     • Fetching scenario JSON files from the /data/ directory
     • Validating the structure so Engine.js never receives malformed data
     • Resolving character sprite paths + injecting fallback metadata
     • Pre-checking asset URLs and flagging missing ones (no crash policy)
   ═══════════════════════════════════════════════════════════════════════════ */

export class ScenarioLoader {

    /**
     * @param {object} options
     * @param {string} options.basePath   - Root path to /data/ directory.
     *                                      Default: 'data/'
     * @param {boolean} options.verbose   - Log warnings to console.
     *                                      Default: true
     */
    constructor({ basePath = 'data/', verbose = true } = {}) {
        this.basePath = basePath.endsWith('/') ? basePath : basePath + '/';
        this.verbose = verbose;

        // Cache: scenarioId → validated scenario object
        this._cache = new Map();
    }

    /* ─────────────────────────────────────────────────────────────────────────
       PUBLIC API
    ───────────────────────────────────────────────────────────────────────── */

    /**
     * Load and validate a scenario file.
     *
     * @param {string} filename   - e.g. 'scenario.json' or 'scenario_chapter2.json'
     * @returns {Promise<object>} - Validated, enriched scenario object
     */
    async load(filename) {
        const url = this.basePath + filename;

        // Return cached version if already loaded
        if (this._cache.has(url)) {
            this._log(`[ScenarioLoader] Returning cached scenario: ${url}`);
            return this._cache.get(url);
        }

        // ── Fetch ──────────────────────────────────────────────────────────────
        let raw;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} — ${response.statusText}`);
            }
            raw = await response.json();
        } catch (err) {
            throw new Error(`[ScenarioLoader] Failed to load "${url}": ${err.message}`);
        }

        // ── Validate + Enrich ──────────────────────────────────────────────────
        const scenario = this._validate(raw);
        const enriched = this._enrich(scenario);

        this._cache.set(url, enriched);
        this._log(`[ScenarioLoader] Loaded scenario: "${enriched.title}" (${enriched.steps.length} steps)`);

        return enriched;
    }

    /**
     * Load and merge a branch into the main steps array.
     * Called by Engine.js when a choice is made.
     *
     * @param {object} scenario   - The full scenario object (from load())
     * @param {string} branchId   - Key in scenario.branches
     * @returns {Array}           - The branch's steps array, validated
     */
    resolveBranch(scenario, branchId) {
        if (!scenario.branches || !scenario.branches[branchId]) {
            this._warn(`[ScenarioLoader] Branch "${branchId}" not found in scenario "${scenario.id}". Returning empty.`);
            return [];
        }
        const steps = scenario.branches[branchId];
        return steps.map((step, i) => this._validateStep(step, `branches.${branchId}[${i}]`));
    }

    /* ─────────────────────────────────────────────────────────────────────────
       VALIDATION
    ───────────────────────────────────────────────────────────────────────── */

    /**
     * Validates top-level scenario structure.
     * Throws descriptive errors on hard failures; warns on soft ones.
     */
    _validate(raw) {
        // ── Required top-level fields ──────────────────────────────────────────
        const required = ['id', 'title', 'characters', 'steps'];
        for (const key of required) {
            if (raw[key] === undefined || raw[key] === null) {
                throw new Error(`[ScenarioLoader] Missing required field: "${key}"`);
            }
        }

        if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
            throw new Error(`[ScenarioLoader] "steps" must be a non-empty array.`);
        }

        if (typeof raw.characters !== 'object') {
            throw new Error(`[ScenarioLoader] "characters" must be an object.`);
        }

        // ── Validate each step ─────────────────────────────────────────────────
        raw.steps = raw.steps.map((step, i) => this._validateStep(step, `steps[${i}]`));

        // ── Validate branches (optional) ───────────────────────────────────────
        if (raw.branches) {
            for (const [branchId, branchSteps] of Object.entries(raw.branches)) {
                if (!Array.isArray(branchSteps)) {
                    this._warn(`[ScenarioLoader] Branch "${branchId}" is not an array. Skipping.`);
                    delete raw.branches[branchId];
                }
            }
        }

        return raw;
    }

    /**
     * Validates a single step object.
     * Invalid steps are patched into safe no-ops instead of throwing,
     * so one bad line never kills the whole scene.
     */
    _validateStep(step, label) {
        if (!step || typeof step !== 'object') {
            this._warn(`[ScenarioLoader] ${label}: step is not an object. Replacing with no-op.`);
            return { type: 'noop' };
        }

        const validTypes = ['dialogue', 'choice', 'sprite', 'background', 'bgm', 'sfx', 'noop'];

        if (!step.type || !validTypes.includes(step.type)) {
            this._warn(`[ScenarioLoader] ${label}: unknown type "${step.type}". Replacing with no-op.`);
            return { type: 'noop' };
        }

        // ── Per-type checks ────────────────────────────────────────────────────
        switch (step.type) {

            case 'dialogue':
                if (!step.character) {
                    this._warn(`[ScenarioLoader] ${label} (dialogue): missing "character". Setting to "narrator".`);
                    step.character = 'narrator';
                }
                if (typeof step.text !== 'string' || step.text.trim() === '') {
                    this._warn(`[ScenarioLoader] ${label} (dialogue): missing or empty "text". Setting placeholder.`);
                    step.text = '…';
                }
                // Normalise textSpeed
                const validSpeeds = ['slow', 'normal', 'fast', 'instant'];
                if (!validSpeeds.includes(step.textSpeed)) {
                    step.textSpeed = 'normal';
                }
                break;

            case 'choice':
                if (!Array.isArray(step.choices) || step.choices.length === 0) {
                    this._warn(`[ScenarioLoader] ${label} (choice): no valid choices array. Converting to noop.`);
                    return { type: 'noop' };
                }
                // Patch each choice entry
                step.choices = step.choices.map((c, ci) => {
                    if (!c.text) {
                        this._warn(`[ScenarioLoader] ${label} choice[${ci}]: missing "text".`);
                        c.text = `Option ${ci + 1}`;
                    }
                    if (!c.goto) {
                        this._warn(`[ScenarioLoader] ${label} choice[${ci}]: missing "goto". Will be a dead end.`);
                        c.goto = null;
                    }
                    return c;
                });
                if (!step.prompt) step.prompt = 'What will you do?';
                break;

            case 'sprite':
                if (!step.character) {
                    this._warn(`[ScenarioLoader] ${label} (sprite): missing "character". Converting to noop.`);
                    return { type: 'noop' };
                }
                const validPositions = ['left', 'center', 'right', null];
                if (!validPositions.includes(step.position)) {
                    this._warn(`[ScenarioLoader] ${label} (sprite): invalid position "${step.position}". Defaulting to "left".`);
                    step.position = 'left';
                }
                if (!step.emotion) step.emotion = 'neutral';
                break;

            case 'background':
                if (!step.src && !step.fallbackColor) {
                    this._warn(`[ScenarioLoader] ${label} (background): missing both "src" and "fallbackColor".`);
                    step.fallbackColor = '#050d12';
                }
                if (!step.transition) step.transition = 'fade';
                break;

            case 'bgm':
            case 'sfx':
                if (!step.src) {
                    this._warn(`[ScenarioLoader] ${label} (${step.type}): missing "src". Converting to noop.`);
                    return { type: 'noop' };
                }
                if (typeof step.volume !== 'number') step.volume = 0.7;
                step.volume = Math.max(0, Math.min(1, step.volume));
                break;
        }

        return step;
    }

    /* ─────────────────────────────────────────────────────────────────────────
       ENRICHMENT
       Adds derived / computed data the Engine expects at runtime.
    ───────────────────────────────────────────────────────────────────────── */

    _enrich(scenario) {
        // ── Resolve character sprite maps ──────────────────────────────────────
        // Each character gets a resolved spriteMap: { emotion → url }
        // Missing sprites are flagged — fallback SVG is handled by Engine/SpriteManager
        for (const [charId, charDef] of Object.entries(scenario.characters)) {
            charDef.id = charId;
            charDef.resolvedSprites = {};

            if (charDef.sprites && typeof charDef.sprites === 'object') {
                for (const [emotion, path] of Object.entries(charDef.sprites)) {
                    charDef.resolvedSprites[emotion] = {
                        src: path,
                        verified: false,     // will be set true after AssetPreloader checks it
                        fallback: false
                    };
                }
            }

            // Ensure every character has at least a 'neutral' entry
            if (!charDef.resolvedSprites.neutral) {
                charDef.resolvedSprites.neutral = {
                    src: null,
                    verified: false,
                    fallback: true
                };
            }
        }

        // ── Defaults ───────────────────────────────────────────────────────────
        if (!scenario.chapter) scenario.chapter = 'I';
        if (!scenario.branches) scenario.branches = {};

        return scenario;
    }

    /* ─────────────────────────────────────────────────────────────────────────
       ASSET PROBE
       Checks if an image URL is reachable without triggering a hard error.
       Returns true if OK, false if missing — used by Engine fallback logic.
    ───────────────────────────────────────────────────────────────────────── */

    /**
     * @param {string} url
     * @returns {Promise<boolean>}
     */
    async probeImage(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        });
    }

    /**
     * Probe all sprite images in a scenario and mark verified/fallback flags.
     * Call this after load() but before the first scene renders.
     *
     * @param {object} scenario
     * @returns {Promise<object>} - Same scenario, with verified flags updated
     */
    async probeAllSprites(scenario) {
        const probes = [];

        for (const charDef of Object.values(scenario.characters)) {
            for (const [emotion, entry] of Object.entries(charDef.resolvedSprites)) {
                if (!entry.src) continue;
                probes.push(
                    this.probeImage(entry.src).then((ok) => {
                        entry.verified = ok;
                        entry.fallback = !ok;
                        if (!ok) {
                            this._warn(
                                `[ScenarioLoader] Missing sprite: ${charDef.id}/${emotion} → "${entry.src}". Fallback will render.`
                            );
                        }
                    })
                );
            }
        }

        await Promise.all(probes);
        return scenario;
    }

    /* ─────────────────────────────────────────────────────────────────────────
       INTERNAL HELPERS
    ───────────────────────────────────────────────────────────────────────── */

    _log(msg) { if (this.verbose) console.log(msg); }
    _warn(msg) { if (this.verbose) console.warn(msg); }
}