// 全局状态管理
const appState = {
    currentCondition: 'normal', // 可选: normal, vwd, hemophilia_a, vit_k_toxicity, dic
    currentStage: 0, // 1: 血管损伤, 2: 初级止血, 3: 起始阶段, 4: 放大阶段, 5: 传播阶段

    // 用于判定当前病理状态下，某个阶段是否会“卡住”或“报错”
    checkCondition() {
        if (this.currentCondition === 'vwd' && this.currentStage >= 1) {
            return { status: 'fail', message: '由于缺乏 vWF，初级止血失败...' };
        }
        if (this.currentCondition === 'hemophilia_a' && this.currentStage >= 4) {
            return { status: 'fail', message: '缺乏 FVIII，Tenase 复合物无法组装，传播阶段中止...' };
        }
        // ... 其他逻辑
        return { status: 'success' };
    }
};

// 全局状态
const state = {
    stage: 0,
    condition: 'normal',
    maxStage: 5,
    isAnimating: false,
    queuedNext: false,
    hasAlertTriggered: false,
    isPaused: false
};



let currentTimeline = null;

// DOM 元素引用
const elements = {
    btnNext: document.getElementById('btn-next'),
    btnPrev: document.getElementById('btn-prev'),
    conditionSelector: document.getElementById('condition-selector'),
    steps: document.querySelectorAll('.step'),
    mechanismText: document.getElementById('mechanism-text'),
    alertBox: document.getElementById('alert-box'),
    collagen: document.querySelectorAll('.collagen-layer'),
    factorsContainer: document.getElementById('factors-container')
};

// 阶段说明文案字典 (索引 0~5 对应阶段 0~5)
const stageDescriptions = [
    "请点击下方“下一步”开始观察止血过程。",
    "血管内皮损伤，暴露出内皮下的胶原蛋白 (Collagen)。",
    "初级止血：vWF 结合至胶原，血小板粘附并活化（启动期）；随后发生脱颗粒反应，释放 vWF、TxA2、ADP 等介质招募周围血小板（扩展期），形成初级血小板栓子。",
    "起始阶段 (Initiation)：组织因子 (TF) 与 FVIIa 结合，微量活化 FIX 与 FX，产生初始的微量凝血酶 (Thrombin)。",
    "放大阶段 (Amplification)：凝血重心转移。微量凝血酶活化血小板，并活化辅因子 FV, FVIII 及因子 FXI。",
    "传播阶段 (Propagation)：FIXa/FVIIIa 组成 Tenase；FXa/FVa 组成 Prothrombinase。发生凝血酶大爆发，形成纤维蛋白网。"
];

// 自动进入 Stage 1 定时器
let autoAdvanceTimer = null;

function scheduleAutoAdvance() {
    if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
    }
    autoAdvanceTimer = setTimeout(() => {
        autoAdvanceTimer = null;
        if (state.stage === 0) {
            changeStage(1);
        }
    }, 1000);
}

// 初始化监听器
elements.btnNext.addEventListener('click', () => changeStage(1));
elements.btnPrev.addEventListener('click', () => changeStage(-1));
elements.conditionSelector.addEventListener('change', (e) => {
    state.condition = e.target.value;
    resetSimulation(); // 切换病理状态时重置回第 0 步
    e.target.blur();   // 清除焦点
    scheduleAutoAdvance(); // 等待 1 秒自动进入 Stage 1
});

// 键盘按键绑定 (Space 切换暂停/继续，Left/Right 方向键切换阶段)
document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePause();
    } else if (e.key === 'ArrowLeft' || e.key === 'Left') {
        if (!elements.btnPrev.disabled) {
            e.preventDefault();
            changeStage(-1);
        }
    } else if (e.key === 'ArrowRight' || e.key === 'Right') {
        if (!elements.btnNext.disabled) {
            e.preventDefault();
            changeStage(1);
        }
    }
});

function togglePause() {
    state.isPaused = !state.isPaused;
    if (currentTimeline) {
        if (state.isPaused) {
            currentTimeline.pause();
        } else {
            currentTimeline.resume();
        }
    }
    showPauseIndicator(state.isPaused);
}

function showPauseIndicator(isPaused) {
    let indicator = document.getElementById('pause-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'pause-indicator';
        indicator.className = 'pause-indicator';
        indicator.innerHTML = '⏸';
        const stage = document.querySelector('.animation-stage');
        if (stage) stage.appendChild(indicator);
    }
    indicator.style.display = isPaused ? 'block' : 'none';
}


function changeStage(direction) {
    if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }

    // 如果当前正在播放前进动画，点击“下一步”不中断当前阶段，而是排队待动画完成后自动接续
    if (direction > 0 && state.isAnimating) {
        state.queuedNext = true;
        return;
    }

    let nextStage = state.stage + direction;
    if (nextStage >= 0 && nextStage <= state.maxStage) {
        state.stage = nextStage;
        if (direction < 0) {
            handleBackwardStep(nextStage);
        }
        updateUI();
        if (direction > 0) {
            playAnimationForCurrentStage();
        }
    }
}

function handleBackwardStep(targetStage) {
    gsap.killTweensOf("*");
    if (currentTimeline) {
        currentTimeline.kill();
        currentTimeline = null;
    }
    state.isAnimating = false;
    state.queuedNext = false;

    // 清除在 targetStage 之后产生的所有因子/物体
    const factorEls = elements.factorsContainer.querySelectorAll('[data-created-stage]');
    factorEls.forEach(el => {
        if (parseInt(el.dataset.createdStage) > targetStage) {
            el.remove();
        }
    });

    if ((state.condition === 'vwd' && targetStage < 2) ||
        (state.condition === 'vit_k' && targetStage < 5) ||
        (state.condition === 'hemophilia_a' && targetStage < 5)) {
        state.hasAlertTriggered = false;
        elements.alertBox.style.display = 'none';
        elements.alertBox.innerText = '';
    }



    if (targetStage <= 4) {
        document.querySelectorAll('.fibrinogen-strand').forEach(el => {
            gsap.set(el, { stroke: '#95a5a6', filter: 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.5))' });
        });
    }

    // 根据目标阶段恢复已有物体的状态与位置
    if (targetStage < 1) {
        gsap.set(elements.collagen, { opacity: 0 });
    } else {
        gsap.set(elements.collagen, { opacity: 1 });
    }

    const { width: sWidth, height: sHeight } = getStageDimensions();
    const primaryPltX = sWidth * 0.36;

    const platelet = document.querySelector('.platelet.primary-platelet') || document.querySelector('.platelet');
    if (platelet) {
        if (targetStage < 4) {
            // 重置主血小板到 Stage 2/3 的位置与高亮状态
            gsap.set(platelet, {
                x: primaryPltX,
                y: sHeight - 260,
                filter: targetStage >= 2 ? 'drop-shadow(0 0 20px #f39c12)' : 'none',
                scale: targetStage >= 2 ? 1.05 : 1
            });
        }
    }

    if (targetStage === 3) {
        // 清除脱颗粒介质
        elements.factorsContainer.querySelectorAll('.granule-particle:not(.bound-vwf)').forEach(el => el.remove());

        // 重置 Stage 3 产生的微量凝血酶 IIa
        const fii = document.querySelector('.f-ii');
        if (fii && parseInt(fii.dataset.createdStage) === 3) {
            gsap.set(fii, {
                x: sWidth * 0.60 * 0.95,
                y: 200,
                textContent: 'IIa',
                backgroundColor: '#27ae60',
                scale: 0.8,
                opacity: 1
            });
        }

        // 重置 Stage 3 产生的 Xa/Va
        const fx = document.querySelector('.f-x');
        if (fx && parseInt(fx.dataset.createdStage) === 3) {
            gsap.set(fx, {
                x: sWidth * 0.60 * 0.95,
                y: 160,
                textContent: 'Xa/Va',
                backgroundColor: '#e67e22',
                width: 110,
                borderRadius: '25px',
                opacity: 1
            });
        }
    }
}

// 非罗马数字因子/物体图例定义 (key, 包含的 stages, 中文 label)
const legendData = [
    { key: 'vwf', stages: [2, 3, 4, 5], label: '血管因子 (vWF)' },
    { key: 'platelet', stages: [2, 3, 4, 5], label: '血小板 (Platelet)' },
    { key: 'tf', stages: [3, 4, 5], label: '组织因子 (TF, FIII)' },
    { key: 'tfpi', stages: [4, 5], label: '组织因子途径抑制物 (TFPI)' },
    { key: 'fibrinogen', stages: [4, 5], label: '纤维蛋白原 (Fibrinogen, FI)' },
    { key: 'fibrin', stages: [4, 5], label: '纤维蛋白丝 (Fibrin, FIa)' }
];

function updateLegend() {
    const container = document.getElementById('legend-items');
    const panel = document.getElementById('legend-panel');
    if (!container || !panel) return;

    container.innerHTML = '';
    const currentStage = state.stage;

    // 过滤出当前 stage 应该显示的非罗马数字物体
    const activeItems = legendData.filter(item => item.stages.includes(currentStage));

    if (activeItems.length === 0) {
        panel.style.display = 'none';
        return;
    } else {
        panel.style.display = 'block';
    }


    activeItems.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'legend-item';

        let graphicHTML = '';
        if (item.key === 'vwf') {
            graphicHTML = `<div class="legend-graphic legend-vwf">vWF</div>`;
        } else if (item.key === 'platelet') {
            graphicHTML = `<div class="legend-graphic legend-platelet"></div>`;
        } else if (item.key === 'tf') {
            graphicHTML = `<div class="legend-graphic legend-tf">TF</div>`;
        } else if (item.key === 'tfpi') {
            graphicHTML = `<div class="legend-graphic legend-tfpi">TFPI</div>`;
        } else if (item.key === 'fibrinogen') {
            graphicHTML = `
                <svg class="legend-graphic legend-svg" viewBox="0 0 40 20">
                    <path d="M 4,10 C 14,18 26,2 36,10" stroke="#95a5a6" stroke-width="3" fill="none" stroke-linecap="round"/>
                </svg>`;
        } else if (item.key === 'fibrin') {
            graphicHTML = `
                <svg class="legend-graphic legend-svg" viewBox="0 0 40 20">
                    <path d="M 4,10 C 14,18 26,2 36,10" stroke="#ecf0f1" stroke-width="3" fill="none" stroke-linecap="round" filter="drop-shadow(0 0 3px #ffffff)"/>
                </svg>`;
        }

        itemEl.innerHTML = `
            ${graphicHTML}
            <span class="legend-label">${item.label}</span>
        `;
        container.appendChild(itemEl);
    });
}

function updateUI() {
    // 更新按钮状态
    elements.btnPrev.disabled = state.stage === 0;
    elements.btnNext.disabled = state.stage === state.maxStage;

    // 更新时间轴高亮：根据 data-step 匹配当前 stage
    elements.steps.forEach(step => {
        const stepNum = parseInt(step.dataset.step);
        step.classList.toggle('active', stepNum === state.stage);
    });

    // 更新说明文案，保持病理警告在触发后持续显示至 stage 5
    elements.mechanismText.innerText = stageDescriptions[state.stage];
    if (state.condition === 'normal' || state.stage === 0) {
        elements.alertBox.style.display = 'none';
        elements.alertBox.innerText = '';
    } else if (elements.alertBox.innerText) {
        elements.alertBox.style.display = 'block';
    }

    // 更新侧边栏图例
    updateLegend();
}


function resetSimulation() {
    if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }
    state.stage = 0;
    state.hasAlertTriggered = false;
    state.isPaused = false;
    showPauseIndicator(false);
    elements.alertBox.style.display = 'none';
    elements.alertBox.innerText = '';
    elements.factorsContainer.innerHTML = ''; // 清空舞台
    gsap.killTweensOf("*"); // 停止所有进行中的动画
    gsap.set(elements.collagen, { opacity: 0 }); // 隐藏胶原
    updateUI();
}




// 全局固定基准画布尺寸 (1024 × 768)
const STAGE_CONFIG = {
    width: 1024,
    height: 768
};

// 辅助函数：判断是否为移动端
function isMobile() {
    return window.innerWidth <= 768;
}

// 辅助函数：获取动画舞台的逻辑画布尺寸（始终保持 1024 × 768）
function getStageDimensions() {
    return { width: STAGE_CONFIG.width, height: STAGE_CONFIG.height };
}

// 核心动画分发器
function playAnimationForCurrentStage() {
    state.isPaused = false;
    showPauseIndicator(false);

    if (currentTimeline) {
        currentTimeline.kill();
        currentTimeline = null;
    }
    state.isAnimating = true;
    state.queuedNext = false;


    const tl = gsap.timeline({
        onComplete: () => {
            state.isAnimating = false;
            if (state.queuedNext) {
                state.queuedNext = false;
                changeStage(1);
            } else if (state.condition !== 'normal' && state.stage > 0 && state.stage < state.maxStage) {
                // 疾病状态下，动画播放完毕后自动推进到下一 stage；弹出 alertBox 后缩短等待间隔
                const advanceDelay = state.hasAlertTriggered ? 200 : 600;
                autoAdvanceTimer = setTimeout(() => {
                    autoAdvanceTimer = null;
                    if (state.stage < state.maxStage) {
                        changeStage(1);
                    }
                }, advanceDelay);
            }
        }
    });

    // 播放速度控制：正常生理状态为 1x 速度；疾病状态初始为 2x 速度，触发 alertBox 后加速至 3x 速度
    if (state.condition !== 'normal') {
        if (state.hasAlertTriggered) {
            tl.timeScale(3);
        } else {
            tl.timeScale(2);
        }
    }


    currentTimeline = tl;
    const { width: sWidth, height: sHeight } = getStageDimensions();


    if (state.stage === 1) {
        // 1: 血管损伤
        tl.to(elements.collagen, { opacity: 1, duration: 0.5 });
    }
    else if (state.stage === 2) {
        // 2: 初级止血
        const primaryVwfX = sWidth * 0.36 - 30;
        const primaryPltX = sWidth * 0.36;
        const isVwd = state.condition === 'vwd';

        const vwf = createFactorElement('f-vwf primary-vwf', 'vWF', { x: 250, y: 400 });
        const primaryPlatelet = createFactorElement('platelet primary-platelet', 'Platelet', { x: primaryPltX + 100, y: 250 });

        // GSAP 将第一个主血小板和 vWF 移动到底部的胶原上
        tl.to(vwf, { y: sHeight - 150, x: primaryVwfX, duration: 1 })
            .to(primaryPlatelet, { y: sHeight - 260, x: primaryPltX, duration: 1 }, "-=0.5");

        // 扩展期（Extension）：脱颗粒反应（vWD 状态下隐藏 granule-vwf）
        const granuleAdp = createFactorElement('granule-particle granule-adp', 'ADP', { x: primaryPltX + 160, y: sHeight - 240 });
        const granuleTxa2 = createFactorElement('granule-particle granule-txa2', 'TxA2', { x: primaryPltX + 150, y: sHeight - 250 });

        const granulesToAnimate = [granuleAdp, granuleTxa2];
        let granuleVwf = null;

        if (!isVwd) {
            granuleVwf = createFactorElement('granule-particle granule-vwf', 'vWF', { x: primaryPltX + 170, y: sHeight - 230 });
            granulesToAnimate.push(granuleVwf);
        }

        gsap.set(granulesToAnimate, { scale: 0, opacity: 0 });

        // 副血小板与 secVwf 配置 (vWD 状态下结束位置向右移，远离主血小板且互不接触)
        const offsetRight = isVwd ? 80 : 0;
        const secondaryConfig = [
            { vwfX: sWidth * 0.57, pltX: sWidth * 0.56 + offsetRight, scale: 0.68, rot: -5 },
            { vwfX: sWidth * 0.71, pltX: sWidth * 0.69 + offsetRight, scale: 0.60, rot: 5 },
            { vwfX: sWidth * 0.82, pltX: sWidth * 0.81 + offsetRight, scale: 0.54, rot: -6 }
        ];

        const secVwfEls = [];
        const secPltConfig = [];

        secondaryConfig.forEach((cfg) => {
            if (!isVwd) {
                // 正常状态下生成 secVwf
                const secVwf = createFactorElement('f-vwf secondary-vwf', 'vWF', { x: cfg.vwfX, y: sHeight - 150 });
                gsap.set(secVwf, { opacity: 0 });
                secVwfEls.push(secVwf);
            }

            // 无论正常还是 vWD 状态，副血小板均在原本位置生成并飞入
            const secPlt = createFactorElement('platelet secondary-platelet', 'Platelet', { x: cfg.pltX + 1000, y: 500 });
            secPltConfig.push({ el: secPlt, cfg });
        });

        // 主血小板活化（高亮发光与形态改变）并脱颗粒释放介质
        tl.to(primaryPlatelet, { filter: 'drop-shadow(0 0 20px #f39c12)', scale: 1.05, duration: 0.4 })
            .to(granulesToAnimate, { scale: 1, opacity: 1, duration: 0.3, stagger: 0.1 }, "+=0.5")
            .to(granuleAdp, { x: primaryPltX + 190, y: sHeight - 320, opacity: 0.9, duration: 0.8, ease: "power1.out" }, "-=0.2")
            .to(granuleTxa2, { x: primaryPltX + 280, y: sHeight - 300, opacity: 0.9, duration: 0.8, ease: "power1.out" }, "-=0.7");

        if (!isVwd && granuleVwf) {
            tl.to(granuleVwf, { x: primaryPltX + 360, y: sHeight - 250, opacity: 0.9, duration: 0.8, ease: "power1.out" }, "-=0.7");
            tl.to(secVwfEls, { opacity: 0.85, duration: 0.4, stagger: 0.1 }, "+=0.2");
        }

        // 副血小板飞入（vWD 状态下增加飞入动作时间，且落点右移远离主血小板）
        const flyDuration = isVwd ? 0.9 : 0.4;
        secPltConfig.forEach(({ el: secPlt, cfg }, idx) => {
            tl.to(secPlt, {
                y: isVwd ? 360 : sHeight - 240,
                x: cfg.pltX,
                scale: isVwd ? cfg.scale * 0.85 : cfg.scale,
                rotation: cfg.rot,
                duration: flyDuration,
                ease: isVwd ? "power1.out" : "power2.out"
            }, idx === 0 ? "+=0.2" : (isVwd ? "-=0.6" : "-=0.35"));
        });

        if (isVwd) {
            tl.call(() => {
                triggerPathologyAlert("初级止血失败：缺乏 vWF，血小板无法有效粘附至暴露的胶原。");
            });
        }
    }



    else if (state.stage === 3) {
        // --- 3: 起始阶段 (Initiation) ---
        // 0. 进入阶段 3 时，先清除脱颗粒阶段释放出的 vWF、TxA2、ADP 介质
        const granuleParticles = document.querySelectorAll('.granule-particle');
        if (granuleParticles.length > 0) {
            tl.to(granuleParticles, {
                opacity: 0,
                scale: 0,
                duration: 0.4,
                stagger: 0.05,
                onComplete: () => {
                    granuleParticles.forEach(el => el.remove());
                }
            });
        }

        const tfX = sWidth * 0.60;
        const appearX = sWidth * 0.48;

        // 1. 暴露组织因子 (TF)
        const tf = createFactorElement('f-tf', 'TF', { x: tfX, y: 80 });
        gsap.set(tf, { backgroundColor: '#8e44ad', borderRadius: '5px' });

        if (state.condition === 'vit_k') {
            // 维生素K拮抗剂中毒：F7以灰色状态出现，之后的动画由于与F7有关，此处不执行
            const f7Inactive = createFactorElement('f-vii inactive', 'VII', { x: sWidth * 0.70, y: 150 });
            gsap.set(f7Inactive, { opacity: 0 });
            tl.to(f7Inactive, { opacity: 1, duration: 0.6 }, "+=0.5");
            return;
        }

        // 2. FVII 出现并与 TF 结合
        const f7 = createFactorElement('f-vii', 'VIIa', { x: sWidth * 0.70, y: 150 });

        // 3. 活化 FX 和 FIX，产生微量凝血酶 (Thrombin/FIIa)
        // 由上而下依次排列：FX (y: 160), FVa (y: 220), FII (y: 280)
        const fx = createFactorElement('f-x', 'X', { x: appearX, y: 160 });
        const fv = createFactorElement('f-v', 'Va', { x: appearX, y: 220 });
        const fii = createFactorElement('f-ii', 'II', { x: appearX, y: 280 });

        // 初始设置 FX、FVa、FII 不可见
        gsap.set([fx, fv, fii], { opacity: 0 });
        gsap.set(fv, { backgroundColor: '#c0392b' });

        tl.to(f7, { x: tfX, y: 120, duration: 1 }, "+=1.5") // FVII 靠近并结合 TF
            .to([fx, fv, fii], { opacity: 1, duration: 0.4, stagger: 0.1 }, "+=1") // FX, FVa, FII 依序由上而下显现
            .to(fx, { x: tfX * 0.95, duration: 1 }, "+=1") // FX 靠近复合物
            .to(fx, { textContent: 'Xa', backgroundColor: '#d35400', duration: 0.2 }) // FX 活化为 FXa
            .to(fv, { x: tfX * 0.95, y: 160, duration: 0.8 }, "+=1") // FVa 靠近复合物 FXa
            .to(fx, { textContent: 'Xa/Va', backgroundColor: '#e67e22', width: 110, borderRadius: '25px', duration: 0.3 }) // 合并成为 Xa/Va
            .to(fv, { opacity: 0, scale: 0, duration: 0.3, onComplete: () => fv.remove() }, "-=0.3") // 移除 fv
            .to(fii, { x: tfX * 0.95, y: 200, duration: 0.8 }) // FII 靠近复合物
            .to(fii, { textContent: 'IIa', scale: 0.8, backgroundColor: '#27ae60', duration: 0.2 }); // 产生微量凝血酶
    }

    else if (state.stage === 4) {
        // --- 4: 放大阶段 (Amplification) ---
        const platelet = document.querySelector('.platelet.primary-platelet') || document.querySelector('.platelet');

        if (!platelet) {
            state.isAnimating = false;
            state.queuedNext = false;
            return;
        }

        const pltX = gsap.getProperty(platelet, "x");
        const pltY = gsap.getProperty(platelet, "y");
        const midLeftX = pltX - 100;
        const midLeftY = sHeight * 0.42;
        const alignX = midLeftX - 160;

        if (state.condition === 'vit_k') {
            // 维生素K拮抗剂中毒：无需执行 FIIa 活化血小板/纤维蛋白原与 TFPI 动画
            // 在 (midLeftX, midLeftY) 生成 F12，此处只显示 f11，f8a 和 f5a 出现在结束位置
            const f12 = createFactorElement('f-xii', 'XIIa', { x: midLeftX, y: midLeftY });
            const f11 = createFactorElement('f-xi', 'XI', { x: alignX, y: midLeftY - 60 });
            const f8a = createFactorElement('f-viii', 'VIIIa', { x: midLeftX + 210, y: midLeftY + 60 });
            const f5a = createFactorElement('f-v', 'Va', { x: midLeftX + 320, y: midLeftY + 60 });

            gsap.set(f8a, { backgroundColor: '#e67e22' });
            gsap.set(f5a, { backgroundColor: '#c0392b' });
            gsap.set([f12, f11, f8a, f5a], { opacity: 0 });

            // F12、F11 显现，F8a 和 F5a 直接在结束位置显现
            tl.to([f12, f11, f8a, f5a], { opacity: 1, duration: 0.5 }, "+=0.3")
                // FXI 靠近 FXII 活化为 FXIa，并移动到主血小板表面
                .to(f11, { x: midLeftX, y: midLeftY + 40, duration: 0.8 }, "+=1.0")
                .to(f11, { textContent: 'XIa', backgroundColor: '#16a085', duration: 0.3 })
                .to(f11, { x: pltX + 10, y: pltY - 50, duration: 0.8 });
            return;
        }

        const microThrombin = document.querySelector('.f-ii'); // 获取上一阶段产生的 FIIa

        // 1. 第一代凝血酶 (FIIa) 移动到主血小板上，通过 PAR 受体活化血小板
        tl.to(microThrombin, { x: pltX - 100, y: pltY + 45, duration: 1 })
            .to(platelet, { filter: 'drop-shadow(0 0 20px #f1c40f)', scale: 1.1, duration: 0.5 }) // 血小板形态改变发光
            .call(() => createFibrinogenStrands(pltX, pltY), null, "-=0.2");

        const stage3FIIaX = sWidth * 0.60 * 0.95;
        const stage3FIIaY = 200;

        // 1.5 在过程 1 和 2 中间生成一个额外的 FIIa，移动到 fibrinogen 中间将其活化为白色后消失
        const actFIIa = createFactorElement('f-ii stage4-act-fiia', 'IIa', { x: stage3FIIaX, y: stage3FIIaY });
        gsap.set(actFIIa, { scale: 0.8, backgroundColor: '#27ae60', zIndex: 10 });

        tl.to(actFIIa, { x: pltX + 260, y: pltY + 145, duration: 1 }, "+=0.4")
            .call(() => {
                const fibrinogens = document.querySelectorAll('.fibrinogen-strand');
                if (fibrinogens.length > 0) {
                    gsap.to(fibrinogens, {
                        stroke: '#ecf0f1',
                        filter: 'drop-shadow(0 0 6px #ffffff)',
                        duration: 0.5
                    });
                }
            })
            .to(actFIIa, { opacity: 0, scale: 0, duration: 0.4, onComplete: () => actFIIa.remove() }, "+=0.1");


        // 2. 从 Stage 3 FIIa 结束位置生成新的 FIIa，飞向舞台中间左侧
        const secondFIIa = createFactorElement('f-ii stage4-fiia', 'IIa', { x: stage3FIIaX, y: stage3FIIaY });
        gsap.set(secondFIIa, { scale: 0.8, backgroundColor: '#27ae60' });

        tl.to(secondFIIa, { x: midLeftX, y: midLeftY, duration: 1 }, "+=0.5");

        // 2.5 组织因子途径抑制物 (TFPI) 出现并移动到 FVIIa 右边
        const tfpi = createFactorElement('f-tfpi', 'TFPI', { x: sWidth * 0.75, y: 80 });
        gsap.set(tfpi, { opacity: 0 });

        const f7El = document.querySelector('.f-vii');
        const f7X = f7El ? gsap.getProperty(f7El, "x") : sWidth * 0.60;
        const f7Y = f7El ? gsap.getProperty(f7El, "y") : 120;

        tl.to(tfpi, { opacity: 1, duration: 0.4 }, "+=0.2")
            .to(tfpi, { x: f7X + 105, y: f7Y, duration: 0.8, ease: "power1.out" });

        // 3. f11, [f8, vwfBound], f5 垂直对齐 (x: alignX) 并同时显现：
        const isHemophiliaA = state.condition === 'hemophilia_a';

        const f11 = createFactorElement('f-xi', 'XI', { x: alignX, y: midLeftY - 60 });
        const f5 = createFactorElement('f-v', 'V', { x: alignX, y: midLeftY + 140 });

        let f8 = null;
        let vwfBound = null;
        if (!isHemophiliaA) {
            f8 = createFactorElement('f-viii', 'VIII', { x: alignX, y: midLeftY + 40 });
            vwfBound = createFactorElement('granule-particle granule-vwf bound-vwf', 'vWF', { x: alignX - 60, y: midLeftY + 40 });
        }

        const elementsToAppear = [f11, f5];
        if (!isHemophiliaA) {
            elementsToAppear.push(f8, vwfBound);
        }

        gsap.set(elementsToAppear, { opacity: 0 });

        // 同时显现
        tl.to(elementsToAppear, { opacity: 1, duration: 0.4 }, "+=0.3");

        // (1) FXI 靠近 FIIa 活化为 FXIa，移动到主血小板表面
        tl.to(f11, { x: midLeftX, y: midLeftY + 40, duration: 0.8 }, "+=1.5")
            .to(f11, { textContent: 'XIa', backgroundColor: '#16a085', duration: 0.3 })
            .to(f11, { x: pltX + 10, y: pltY - 50, duration: 0.8 });

        // (2) FVIII 和 vWF 靠近 FIIa，FVIII 活化为 FVIIIa，vWF 飞向上方胶原层（血友病 A 时缺乏 FVIII，跳过此步骤）
        if (!isHemophiliaA) {
            tl.to([f8, vwfBound], { x: (i) => i === 0 ? midLeftX : midLeftX - 60, y: midLeftY + 40, duration: 0.8 }, "+=0.2")
                .to(f8, { textContent: 'VIIIa', backgroundColor: '#e67e22', duration: 0.3 })
                .to(vwfBound, { x: sWidth * 0.45, y: 90, duration: 1, ease: "power1.out" }, "-=0.2")
                .call(() => {
                    vwfBound.className = 'factor f-vwf bound-vwf';
                    gsap.set(vwfBound, { scale: 1 });
                })
                .to(f8, { x: midLeftX + 210, y: midLeftY + 60, duration: 0.8 }, "-=0.6");
        }

        // (3) FV 移动到 FIIa 旁，活化为 FVa
        tl.to(f5, { x: midLeftX, y: midLeftY + 40, duration: 0.8 }, "+=0.2")
            .to(f5, { textContent: 'Va', backgroundColor: '#c0392b', duration: 0.3 })
            .to(f5, { x: midLeftX + 320, y: midLeftY + 60, duration: 0.8 });
    }

    else if (state.stage === 5) {
        // --- 5: 传播阶段 (Propagation) & 凝血酶爆发 ---
        // 进入阶段 5 时移除 Stage 3 产生的 Xa/Va 复合物以及 Stage 4 产生的第二代 FIIa
        const stage3XaVa = document.querySelector('.f-x');
        if (stage3XaVa && parseInt(stage3XaVa.dataset.createdStage) === 3) {
            stage3XaVa.remove();
        }
        const stage4FIIa = document.querySelector('.stage4-fiia');
        if (stage4FIIa) {
            stage4FIIa.remove();
        }


        if (state.condition === 'hemophilia_a') {
            state.isAnimating = false;
            state.queuedNext = false;
            triggerPathologyAlert("传播中止：血友病 A 缺乏因子 VIII，导致无法在血小板表面组装内源性因子X酶 (Tenase) 复合物，凝血酶爆发失败，导致严重出血。");
            return;
        }

        const platelet = document.querySelector('.platelet.primary-platelet') || document.querySelector('.platelet');
        const pX = platelet ? gsap.getProperty(platelet, "x") : window.innerWidth * 0.4;
        const pY = platelet ? gsap.getProperty(platelet, "y") : window.innerHeight - 350;
        const midLeftX = pX - 100;
        const midLeftY = sHeight * 0.42;
        const alignX = midLeftX - 160;

        if (state.condition === 'vit_k') {
            // 维生素K拮抗剂中毒：
            // 1. 生成 FIX 移动到 fXIa 右边，活化成 FIXa
            const f9 = createFactorElement('f-ix', 'IX', { x: pX - 80, y: pY - 140 });
            gsap.set(f9, { opacity: 0 });

            tl.to(f9, { opacity: 1, duration: 0.4 }, "+=0.2")
                .to(f9, { x: pX + 90, y: pY - 60, duration: 0.8 })
                .to(f9, { textContent: 'IXa', backgroundColor: '#16a085', duration: 0.3 });

            // 2. fVIIIa 移动到 FIXa 组成 Tenase (IXa/VIIIa)
            const f8a = Array.from(document.querySelectorAll('.f-viii')).find(el => el.innerText === 'VIIIa') || document.querySelector('.f-viii');
            if (f8a) {
                tl.to(f8a, { x: pX + 90, y: pY - 60, duration: 0.8 }, "+=0.3")
                    .to(f9, { textContent: 'IXa/VIIIa', backgroundColor: '#8e44ad', width: 125, borderRadius: '25px', duration: 0.3 })
                    .to(f8a, { opacity: 0, scale: 0, duration: 0.3, onComplete: () => f8a.remove() }, "-=0.3");
            }

            // 3. 生成 fX 移动到 IXa/VIIIa 右边，活化成 fXa
            const f10 = createFactorElement('f-x', 'X', { x: pX + 140, y: pY - 140 });
            gsap.set(f10, { opacity: 0 });

            tl.to(f10, { opacity: 1, duration: 0.4 }, "+=0.3")
                .to(f10, { x: pX + 210, y: pY - 60, duration: 0.8 })
                .to(f10, { textContent: 'Xa', backgroundColor: '#d35400', duration: 0.3 });

            // 4. fVa 移动到 fXa 组成 Prothrombinase (Xa/Va)
            const fVa = Array.from(document.querySelectorAll('.f-v')).find(el => el.innerText === 'Va') || document.querySelector('.f-v');
            if (fVa) {
                tl.to(fVa, { x: pX + 210, y: pY - 60, duration: 0.8 }, "+=0.3")
                    .to(f10, { textContent: 'Xa/Va', backgroundColor: '#e67e22', width: 110, borderRadius: '25px', duration: 0.3 })
                    .to(fVa, { opacity: 0, scale: 0, duration: 0.3, onComplete: () => fVa.remove() }, "-=0.3");
            }

            // 5. 凝血酶不能大爆发只能小爆发，生成的纤维蛋白丝减少
            tl.call(() => triggerThrombinBurst(pX + 235, pY - 60, true), null, "+=0.4")
                .call(() => createFibrinMesh(pX, pY, true), null, "+=1.2")
                .to({}, { duration: 2.2 }); // 停留观察小爆发与少量纤维蛋白网

            // 6. 额外动画：等待一小段时间后，画面退回到生成 F12 时的状态
            tl.call(() => {
                const strands = document.querySelectorAll('.fibrin-strand, .fibrinogen-strand');
                gsap.to(strands, { opacity: 0, duration: 0.6, onComplete: () => strands.forEach(s => s.remove()) });
                const factorsToClear = document.querySelectorAll('.f-xii, .f-xi, .f-viii, .f-v, .f-ix, .f-x, .f-ii');
                gsap.to(factorsToClear, { opacity: 0, scale: 0.5, duration: 0.6, onComplete: () => factorsToClear.forEach(f => f.remove()) });
            })
                .to({}, { duration: 2.0 });

            // 7. 动画继续：重新生成 F12，f11 正常显现并活化为 FXIa 移至血小板，f8a 和 f5a 出现在结束位置，并弹出病理警告
            tl.call(() => {
                triggerPathologyAlert("病理机制：维生素K拮抗剂中毒。缺乏 γ-羧化，凝血因子 II、VII、IX、X 均无法在细胞膜负电磷脂表面组装催化复合体（Gla结构域缺失）。外源性与内源性途径均阻断，凝血酶生成严重受损导致大出血，PT 与 APTT 均显著延长。");

                const f12_replay = createFactorElement('f-xii', 'XIIa', { x: midLeftX, y: midLeftY });
                const f11_replay = createFactorElement('f-xi', 'XI', { x: alignX, y: midLeftY - 60 });
                const f8a_replay = createFactorElement('f-viii', 'VIIIa', { x: midLeftX + 210, y: midLeftY });
                const f5a_replay = createFactorElement('f-v', 'Va', { x: midLeftX + 320, y: midLeftY });

                gsap.set(f8a_replay, { backgroundColor: '#e67e22' });
                gsap.set(f5a_replay, { backgroundColor: '#c0392b' });
                gsap.set([f12_replay, f11_replay, f8a_replay, f5a_replay], { opacity: 0 });

                gsap.timeline()
                    .to([f12_replay, f11_replay, f8a_replay, f5a_replay], { opacity: 1, duration: 0.6 })
                    .to(f11_replay, { x: midLeftX, y: midLeftY + 40, duration: 0.8 }, "+=0.5")
                    .to(f11_replay, { textContent: 'XIa', backgroundColor: '#16a085', duration: 0.3 })
                    .to(f11_replay, { x: pX + 10, y: pY - 50, duration: 0.8 });
            }, null, "+=1.0")

            // 8. f9 出现时变成灰色，活化动画取消
            tl.call(() => {
                const f9_replay = createFactorElement('f-ix inactive', 'IX', { x: pX - 80, y: pY - 140 });
                gsap.set(f9_replay, { opacity: 0, scale: 0.8 });
                gsap.to(f9_replay, { opacity: 1, scale: 1, duration: 0.6 });
            }, null, "+=0.6")
                .to({}, { duration: 1.0 });

            // 9. f10 出现时变成灰色，之后不继续后续动画
            tl.call(() => {
                const f10_replay = createFactorElement('f-x inactive', 'X', { x: pX + 140, y: pY - 140 });
                gsap.set(f10_replay, { opacity: 0, scale: 0.8 });
                gsap.to(f10_replay, { opacity: 1, scale: 1, duration: 0.6 });
            }, null, "+=0.6")
                .to({}, { duration: 1.5 });

            return;
        }

        // 1. 生成 FIX 移动到 fXIa 右边，活化成 FIXa
        const f9 = createFactorElement('f-ix', 'IX', { x: pX - 80, y: pY - 140 });
        gsap.set(f9, { opacity: 0 });

        tl.to(f9, { opacity: 1, duration: 0.4 }, "+=0.2")
            .to(f9, { x: pX + 90, y: pY - 60, duration: 0.8 }) // 移动到 fXIa 右边
            .to(f9, { textContent: 'IXa', backgroundColor: '#16a085', duration: 0.3 }); // 活化成 FIXa

        // 2. fVIIIa 移动到 FIXa，成为新的因子 (IXa/VIIIa)
        const f8a = Array.from(document.querySelectorAll('.f-viii')).find(el => el.innerText === 'VIIIa') || document.querySelector('.f-viii');
        if (f8a) {
            tl.to(f8a, { x: pX + 90, y: pY - 60, duration: 0.8 }, "+=0.3")
                .to(f9, { textContent: 'IXa/VIIIa', backgroundColor: '#8e44ad', width: 125, borderRadius: '25px', duration: 0.3 })
                .to(f8a, { opacity: 0, scale: 0, duration: 0.3, onComplete: () => f8a.remove() }, "-=0.3");
        }

        // 3. 生成 fX (和 stage 3 时生成的一样)，移动到 IXa/VIIIa 右边，活化成 fXa
        const f10 = createFactorElement('f-x', 'X', { x: pX + 140, y: pY - 140 });
        gsap.set(f10, { opacity: 0 });

        tl.to(f10, { opacity: 1, duration: 0.4 }, "+=0.3")
            .to(f10, { x: pX + 210, y: pY - 60, duration: 0.8 }) // 移动到 IXa/VIIIa 右边
            .to(f10, { textContent: 'Xa', backgroundColor: '#d35400', duration: 0.3 }); // 活化成 FXa

        // 4. fVa 移动到 fXa，成为新的因子 (Xa/Va)
        const fVa = Array.from(document.querySelectorAll('.f-v')).find(el => el.innerText === 'Va') || document.querySelector('.f-v');
        if (fVa) {
            tl.to(fVa, { x: pX + 210, y: pY - 60, duration: 0.8 }, "+=0.3")
                .to(f10, { textContent: 'Xa/Va', backgroundColor: '#e67e22', width: 110, borderRadius: '25px', duration: 0.3 })
                .to(fVa, { opacity: 0, scale: 0, duration: 0.3, onComplete: () => fVa.remove() }, "-=0.3");
        }

        // 5. 凝血酶在 Xa/Va 右边爆发，随后形成纤维蛋白网与因子 XIII 稳定收拢
        tl.call(() => triggerThrombinBurst(pX + 235, pY - 60), null, "+=0.5")
            .call(() => createFibrinMesh(pX, pY), null, "+=2.0")
            .call(() => triggerFactorXIIICrosslinking(pX, pY), null, "+=1.8")
            .to({}, { duration: 2.5 });
    }
}

// --- 视觉特效辅助函数 ---

// 凝血酶爆发特效 (多波次持续喷涌爆发，isSmall 为 true 时为小爆发)
function triggerThrombinBurst(x, y, isSmall = false) {
    const burstCount = isSmall ? 12 : 35; // 增加粒子数量与持续释放波次 (共 35 个 IIa 粒子持续喷涌，小爆发时为 12 个)
    for (let i = 0; i < burstCount; i++) {
        const burstFIIa = createFactorElement('f-ii burst', 'IIa', { x: x, y: y });
        const delay = Math.random() * (isSmall ? 0.9 : 1.6); // 错落有致的分批爆发，拉长喷涌时间
        gsap.set(burstFIIa, {
            backgroundColor: '#2ecc71',
            scale: isSmall ? 0.35 : 0.4,
            opacity: 0,
            zIndex: 8
        });

        // 快速显现后向四周喷射弥散
        gsap.to(burstFIIa, {
            opacity: 1,
            scale: (isSmall ? 0.6 : 0.8) + Math.random() * (isSmall ? 0.25 : 0.4),
            duration: 0.25,
            delay: delay
        });

        gsap.to(burstFIIa, {
            x: x + (Math.random() - 0.45) * (isSmall ? 180 : 360),
            y: y - Math.random() * (isSmall ? 120 : 240) - (isSmall ? 25 : 60),
            opacity: 0,
            scale: (isSmall ? 0.9 : 1.4) + Math.random() * 0.4,
            duration: (isSmall ? 1.5 : 2.2) + Math.random() * (isSmall ? 0.6 : 1.2),
            delay: delay + 0.15,
            ease: "power2.out",
            onComplete: () => burstFIIa.remove() // 动画结束后清理 DOM
        });
    }
}

// 获取或创建用于绘制纤维蛋白/纤维蛋白原的 SVG 容器
function getOrCreateFibrinSVG() {
    let svgContainer = document.getElementById('fibrin-svg-container');
    if (!svgContainer) {
        svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgContainer.id = 'fibrin-svg-container';
        svgContainer.style.position = 'absolute';
        svgContainer.style.left = '0';
        svgContainer.style.top = '0';
        svgContainer.style.width = '100%';
        svgContainer.style.height = '100%';
        svgContainer.style.pointerEvents = 'none';
        svgContainer.style.zIndex = '4';
        svgContainer.style.overflow = 'visible';
        elements.factorsContainer.appendChild(svgContainer);
    }
    return svgContainer;
}

// 生成 ~ 形状的三阶贝塞尔曲线 Path 数据
function generateTildePath(x1, y1, x2, y2, amplitude) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const nx = -uy;
    const ny = ux;

    const p1x = x1 + ux * (dist * 0.33) + nx * amplitude;
    const p1y = y1 + uy * (dist * 0.33) + ny * amplitude;
    const p2x = x1 + ux * (dist * 0.67) - nx * amplitude;
    const p2y = y1 + uy * (dist * 0.67) - ny * amplitude;

    return `M ${x1.toFixed(1)},${y1.toFixed(1)} C ${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

// 在活化主血小板下方生成 fibrinogen 丝（~ 形状，颜色为不活化物体的配色，一端接主血小板，向右延伸，长/向/弯各异）
function createFibrinogenStrands(pltX, pltY) {
    const svg = getOrCreateFibrinSVG();
    const count = 5;

    for (let i = 0; i < count; i++) {
        const startX = pltX + 80 + i * 35 + (Math.random() * 20 - 10);
        const startY = pltY + 115 + (Math.random() * 15 - 5);

        const len = 120 + Math.random() * 120; // 长度不同
        const endX = startX + len; // 向右侧延伸
        const endY = startY + (Math.random() * 70 - 25); // 方向/角度不同
        const amp = (18 + Math.random() * 22) * (i % 2 === 0 ? 1 : -1); // 弯曲程度不同

        const d = generateTildePath(startX, startY, endX, endY, amp);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', 'fibrinogen-strand');
        path.setAttribute('data-created-stage', '4');
        path.style.opacity = '0';
        svg.appendChild(path);

        gsap.to(path, { opacity: 1, duration: 0.6, delay: i * 0.08 });
    }
}

// 保存当前阶段生成的纤维蛋白丝几何数据，用于后续因子 XIII 的交联与收拢动画
let activeFibrinStrands = [];

// 形成纤维蛋白网特效 (isReduced 为 true 时生成的纤维蛋白丝减少且长度缩短)
function createFibrinMesh(pX, pY, isReduced = false) {
    const svg = getOrCreateFibrinSVG();
    activeFibrinStrands = [];

    // 生成新的交错纤维蛋白丝：方向大致为左右向，Y坐标与 fibrinogen 所在区间 (pY + 80 ~ pY + 185) 一致
    const { width: sWidth } = getStageDimensions();
    const minX = pX - 40;
    const maxX = sWidth * 0.88;
    const minY = pY + 80;
    const maxY = pY + 185;

    const threadCount = isReduced ? 12 : 45; // 减少或正常数量
    for (let i = 0; i < threadCount; i++) {
        const x1 = minX + Math.random() * (maxX - minX - (isReduced ? 180 : 100));
        const y1 = minY + Math.random() * (maxY - minY);

        // 方向大致为左右向 (倾角限制在 -25° 到 +25° 之间)
        const angle = (Math.random() * 50 - 25) * (Math.PI / 180);
        const len = (isReduced ? 90 : 160) + Math.random() * (isReduced ? 70 : 160);
        const x2 = x1 + Math.cos(angle) * len;
        const y2 = y1 + Math.sin(angle) * len;

        const amp = ((isReduced ? 10 : 16) + Math.random() * (isReduced ? 12 : 22)) * (i % 2 === 0 ? 1 : -1);

        const d = generateTildePath(x1, y1, x2, y2, amp);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', 'fibrin-strand');
        path.setAttribute('data-created-stage', '5');
        path.style.opacity = '0';
        svg.appendChild(path);

        // 记录纤维蛋白丝的几何参数，便于后续趋向 0 度与收拢插值
        activeFibrinStrands.push({
            path,
            x1, y1,
            x2, y2,
            angle,
            len,
            amp
        });

        gsap.to(path, { opacity: 1, duration: 0.5, delay: i * 0.03 });
    }
}

// 因子 XIII 出现并飞入纤维蛋白网，引发纤维蛋白网收拢（角度趋向 0 度）与交联加固
function triggerFactorXIIICrosslinking(pX, pY) {
    const { width: sWidth, height: sHeight } = getStageDimensions();
    const minX = pX - 30;
    const maxX = sWidth * 0.86;
    const minY = pY + 85;
    const maxY = pY + 180;
    const centerY = pY + 132.5;
    const centerX = (minX + maxX) / 2;

    // 1. 在舞台右侧中间区域生成多个散在的因子 XIII (样式参考 granule-particle)
    const count = 5;
    const xiiiElements = [];

    for (let i = 0; i < count; i++) {
        // 初始位置：舞台右侧中间散开
        const initX = sWidth - 20 + (Math.random() * 70 - 20);
        const initY = (sHeight * 0.46) + (Math.random() * 130 - 65);

        const el = createFactorElement('granule-particle granule-xiii', 'XIII', { x: initX, y: initY });
        gsap.set(el, { opacity: 0, scale: 0.5, zIndex: 6 });
        xiiiElements.push(el);

        // 目标位置：均匀散落在纤维蛋白网区域内部
        const targetX = minX + 50 + ((maxX - minX - 90) / (count - 1)) * i + (Math.random() * 30 - 15);
        const targetY = minY + 15 + Math.random() * (maxY - minY - 30);

        // 显现并飞入纤维蛋白网
        gsap.to(el, { opacity: 1, scale: 1, duration: 0.4, delay: i * 0.08 });
        gsap.to(el, {
            x: targetX,
            y: targetY,
            duration: 1.1 + Math.random() * 0.3,
            delay: 0.1 + i * 0.08,
            ease: "power2.out"
        });

        // 进入网状结构后轻微发光，呈现活化/交联活性
        gsap.to(el, {
            boxShadow: '0 0 16px rgba(26, 188, 156, 0.9), inset 1px 1px 2px rgba(255, 255, 255, 0.8)',
            duration: 0.5,
            delay: 1.1 + i * 0.08
        });
    }

    // 2. 纤维蛋白丝角度趋向 0 度，呈现出收拢加固的动作 (温和适度的收拢幅度)
    // 为每根纤维蛋白丝计算收拢目标参数
    activeFibrinStrands.forEach(s => {
        const targetAngle = s.angle * 0.35; // 角度稍微趋向 0 度
        const targetAmp = s.amp * 0.72;     // 波幅稍微变平紧绷
        const targetY1 = s.y1 + (centerY - s.y1) * 0.10; // 向中轴线温和收拢
        const targetX1 = s.x1 + (centerX - s.x1) * 0.02; // 水平轻微聚拢
        const targetLen = s.len * 0.98;     // 纤维长度微调
        const targetX2 = targetX1 + Math.cos(targetAngle) * targetLen;
        const targetY2 = targetY1 + Math.sin(targetAngle) * targetLen;

        s.targetX1 = targetX1;
        s.targetY1 = targetY1;
        s.targetX2 = targetX2;
        s.targetY2 = targetY2;
        s.targetAmp = targetAmp;
    });

    // 3. 伴随因子 XIII 飞入，平滑插值变形纤维蛋白丝
    const morphObj = { progress: 0 };
    gsap.to(morphObj, {
        progress: 1,
        duration: 1.4,
        delay: 0.65,
        ease: "power2.inOut",
        onUpdate: () => {
            const p = morphObj.progress;
            activeFibrinStrands.forEach(s => {
                const curX1 = s.x1 + (s.targetX1 - s.x1) * p;
                const curY1 = s.y1 + (s.targetY1 - s.y1) * p;
                const curX2 = s.x2 + (s.targetX2 - s.x2) * p;
                const curY2 = s.y2 + (s.targetY2 - s.y2) * p;
                const curAmp = s.amp + (s.targetAmp - s.amp) * p;
                s.path.setAttribute('d', generateTildePath(curX1, curY1, curX2, curY2, curAmp));
            });
        }
    });

    // 纤维蛋白丝加固发光
    gsap.to('.fibrin-strand', {
        stroke: '#ffffff',
        strokeWidth: '2.8px',
        filter: 'drop-shadow(0 0 6px #ffffff) drop-shadow(0 0 10px rgba(26, 188, 156, 0.4))',
        duration: 1.4,
        delay: 0.65,
        ease: "power2.inOut"
    });
}



// 辅助函数：在舞台上创建 3D 因子元素
function createFactorElement(className, text, initialPos) {
    const el = document.createElement('div');
    el.className = `factor ${className}`;
    el.innerText = text;
    el.dataset.createdStage = state.stage; // 记录创建时的阶段
    // 初始位置设置
    gsap.set(el, { x: initialPos.x, y: initialPos.y });
    elements.factorsContainer.appendChild(el);
    return el;
}

// 辅助函数：触发病理警告
function triggerPathologyAlert(message) {
    state.hasAlertTriggered = true;
    elements.alertBox.innerText = message;
    elements.alertBox.style.display = 'block';
    elements.mechanismText.innerText = "生理过程已中断。";
    if (currentTimeline) {
        currentTimeline.timeScale(3); // 弹出 alertBox 时即刻加速当前阶段动画
    }
}


// 辅助函数：计算并设置舞台缩放比例 CSS 变量 (--stage-scale)
function updateStageScale() {
    const wrapper = document.querySelector('.stage-wrapper');
    if (!wrapper) return;

    if (isMobile()) {
        const containerWidth = wrapper.parentElement ? wrapper.parentElement.clientWidth : window.innerWidth;
        const scale = containerWidth / STAGE_CONFIG.width;
        document.documentElement.style.setProperty('--stage-scale', scale);
        wrapper.style.height = `${scale * STAGE_CONFIG.height}px`;
    } else {
        // 桌面/平板宽屏模式：同时根据舞台区域可用宽高计算最佳等比缩放比例 (Contain Scale)
        const availWidth = wrapper.clientWidth || (window.innerWidth - 320);
        const availHeight = wrapper.clientHeight || (window.innerHeight - 80);
        const scale = Math.min(availWidth / STAGE_CONFIG.width, availHeight / STAGE_CONFIG.height);
        document.documentElement.style.setProperty('--stage-scale', scale);
        wrapper.style.height = '';
    }
}

// 移动端手势支持（左右滑动切换步骤，双击切换暂停）
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let lastTapTime = 0;

function initTouchGestures() {
    const stageWrapper = document.querySelector('.stage-wrapper') || document.querySelector('.animation-stage');
    if (!stageWrapper) return;

    stageWrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
        }
    }, { passive: true });

    stageWrapper.addEventListener('touchend', (e) => {
        if (e.changedTouches.length === 1) {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const diffX = touchEndX - touchStartX;
            const diffY = touchEndY - touchStartY;
            const duration = Date.now() - touchStartTime;

            // 双击判定 (< 300ms 且位移极小)
            const currentTime = Date.now();
            const tapDuration = currentTime - lastTapTime;
            if (tapDuration < 300 && Math.abs(diffX) < 15 && Math.abs(diffY) < 15) {
                togglePause();
                lastTapTime = 0;
                return;
            }
            lastTapTime = currentTime;

            // 滑动手势判定 (水平距离 > 45px，且水平偏移大于垂直偏移，时间 < 500ms)
            if (duration < 500 && Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
                if (diffX < 0) {
                    // 向左滑 -> 下一步
                    if (!elements.btnNext.disabled) {
                        changeStage(1);
                    }
                } else {
                    // 向右滑 -> 上一步
                    if (!elements.btnPrev.disabled) {
                        changeStage(-1);
                    }
                }
            }
        }
    }, { passive: true });
}

window.addEventListener('resize', () => {
    updateStageScale();
});
window.addEventListener('orientationchange', () => {
    setTimeout(updateStageScale, 100);
});

// 初始化 UI、手势及缩放计算，并安排 1 秒后自动进入 Stage 1
updateStageScale();
initTouchGestures();
updateUI();
scheduleAutoAdvance();