// 全局状态管理
const appState = {
    currentCondition: 'normal', // 可选: normal, vwd, hemophilia_a, vit_k_toxicity, dic
    currentStage: 0, // 0: 血管损伤, 1: 初级止血, 2: 起始阶段, 3: 放大阶段, 4: 传播阶段

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
    maxStage: 5
};

// DOM 元素引用
const elements = {
    btnNext: document.getElementById('btn-next'),
    btnPrev: document.getElementById('btn-prev'),
    conditionSelector: document.getElementById('condition-selector'),
    steps: document.querySelectorAll('.step'),
    mechanismText: document.getElementById('mechanism-text'),
    alertBox: document.getElementById('alert-box'),
    collagen: document.querySelector('.collagen-layer'),
    factorsContainer: document.getElementById('factors-container')
};

// 阶段说明文案字典 (索引 0~5 对应阶段 0~5)
const stageDescriptions = [
    "请点击下方“下一步”开始观察止血过程。",
    "血管内皮损伤，暴露出内皮下的胶原蛋白 (Collagen)。",
    "初级止血：vWF 结合至胶原，血小板通过 GP Ib-IX-V 受体粘附并活化，形成初期血小板栓子。",
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

// 键盘方向键 (向左/向右) 联动
document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (e.key === 'ArrowLeft' || e.key === 'Left') {
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

function changeStage(direction) {
    if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
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

    // 清除在 targetStage 之后产生的所有因子/物体
    const factorEls = elements.factorsContainer.querySelectorAll('[data-created-stage]');
    factorEls.forEach(el => {
        if (parseInt(el.dataset.createdStage) > targetStage) {
            el.remove();
        }
    });

    // 根据目标阶段恢复已有物体的状态与位置
    if (targetStage < 1) {
        gsap.set(elements.collagen, { opacity: 0 });
    } else {
        gsap.set(elements.collagen, { opacity: 1 });
    }

    if (targetStage < 4) {
        // 重置血小板高亮和缩放
        const platelet = document.querySelector('.platelet.primary-platelet') || document.querySelector('.platelet');
        if (platelet) {
            gsap.set(platelet, { filter: 'none', scale: 1 });
        }
        // 若回到阶段 3，将微量凝血酶（IIa）移回阶段 3 的最终位置
        if (targetStage === 3) {
            const fii = document.querySelector('.f-ii');
            if (fii && parseInt(fii.dataset.createdStage) === 3) {
                gsap.set(fii, {
                    x: window.innerWidth * 0.2,
                    y: window.innerHeight - 330,
                    textContent: 'IIa',
                    backgroundColor: '#27ae60',
                    scale: 0.8
                });
            }
        }
    }
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

    // 更新说明文案，隐藏警告
    elements.mechanismText.innerText = stageDescriptions[state.stage];
    elements.alertBox.style.display = 'none';
}

function resetSimulation() {
    if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }
    state.stage = 0;
    elements.factorsContainer.innerHTML = ''; // 清空舞台
    gsap.killTweensOf("*"); // 停止所有进行中的动画
    gsap.set(elements.collagen, { opacity: 0 }); // 隐藏胶原
    updateUI();
}

// 辅助函数：获取动画舞台的实际尺寸
function getStageDimensions() {
    const stageEl = document.querySelector('.animation-stage');
    const width = stageEl ? stageEl.offsetWidth : (window.innerWidth - 320);
    const height = stageEl ? stageEl.offsetHeight : window.innerHeight;
    return { width, height };
}

// 核心动画分发器
function playAnimationForCurrentStage() {
    const tl = gsap.timeline();
    const { width: sWidth, height: sHeight } = getStageDimensions();

    if (state.stage === 1) {
        // 1: 血管损伤
        tl.to(elements.collagen, { opacity: 1, duration: 0.5 });
    }
    else if (state.stage === 2) {
        // 2: 初级止血
        if (state.condition === 'vwd') {
            triggerPathologyAlert("初级止血失败：缺乏 vWF (血管性血友病)，血小板无法有效粘附至暴露的胶原。");
            return; // 动画中止
        }
        const primaryVwfX = sWidth * 0.16 - 30;
        const primaryPltX = sWidth * 0.16;

        const vwf = createFactorElement('f-vwf primary-vwf', 'vWF', { x: 50, y: 100 });
        const primaryPlatelet = createFactorElement('platelet primary-platelet', 'Platelet', { x: 100, y: 50 });
        
        // GSAP 将第一个主血小板和 vWF 移动到底部的胶原上
        tl.to(vwf, { y: sHeight - 240, x: primaryVwfX, duration: 1 })
            .to(primaryPlatelet, { y: sHeight - 350, x: primaryPltX, duration: 1 }, "-=0.5");

        // 主血小板动画结束后延迟，在右侧胶原区域陆续聚集更多血小板与 vWF (不同间距、不同大小、区别颜色)
        const secondaryConfig = [
            { vwfX: sWidth * 0.50 - 25, pltX: sWidth * 0.50, scale: 0.68, rot: -5 },
            { vwfX: sWidth * 0.66 - 20, pltX: sWidth * 0.66, scale: 0.60, rot: 5 },
            { vwfX: sWidth * 0.79 - 20, pltX: sWidth * 0.79, scale: 0.54, rot: -6 }
        ];

        secondaryConfig.forEach((cfg, idx) => {
            const secVwf = createFactorElement('f-vwf secondary-vwf', 'vWF', { x: cfg.pltX, y: -60 });
            const secPlt = createFactorElement('platelet secondary-platelet', 'Platelet', { x: cfg.pltX + 40, y: -120 });

            const startOffset = (idx === 0) ? "+=0.5" : "-=0.35";

            tl.to(secVwf, {
                y: sHeight - 240,
                x: cfg.vwfX,
                duration: 0.6,
                ease: "power2.out"
            }, startOffset)
            .to(secPlt, {
                y: sHeight - 350,
                x: cfg.pltX,
                scale: cfg.scale,
                rotation: cfg.rot,
                duration: 0.6,
                ease: "power2.out"
            }, "-=0.3");
        });
    }

    else if (state.stage === 3) {
        // --- 3: 起始阶段 (Initiation) ---
        if (state.condition === 'vit_k') {
            triggerPathologyAlert("起始失败：维生素K拮抗剂中毒。缺乏 γ-羧化，因子 VII、IX、X、II 无法结合至细胞表面的磷脂膜。外源性途径中断，PT 延长。");
            // 视觉表现：生成灰色的因子，并在半空中停滞
            createFactorElement('f-vii inactive', 'FVII', { x: window.innerWidth * 0.2, y: 50 });
            return;
        }

        // 1. 暴露组织因子 (TF)
        const tf = createFactorElement('f-tf', 'TF', { x: window.innerWidth * 0.2, y: window.innerHeight - 210 });
        gsap.set(tf, { backgroundColor: '#8e44ad', borderRadius: '5px' }); // TF 形状略有不同

        // 2. FVII 出现并与 TF 结合
        const f7 = createFactorElement('f-vii', 'VII', { x: 50, y: 50 });

        // 3. 活化 FX 和 FIX，产生微量凝血酶 (Thrombin/FIIa)
        const fx = createFactorElement('f-x', 'X', { x: 150, y: 50 });
        const fii = createFactorElement('f-ii', 'II', { x: 250, y: 50 });

        tl.to(f7, { x: window.innerWidth * 0.2, y: window.innerHeight - 250, duration: 1 }) // FVII 结合 TF
            .to(f7, { textContent: 'VIIa', backgroundColor: '#2980b9', duration: 0.2 }) // 活化为 FVIIa
            .to(fx, { x: window.innerWidth * 0.2, y: window.innerHeight - 290, duration: 1 }, "+=0.2") // FX 靠近复合物
            .to(fx, { textContent: 'Xa', backgroundColor: '#d35400', duration: 0.2 }) // FX 活化为 FXa
            .to(fii, { x: window.innerWidth * 0.2, y: window.innerHeight - 330, duration: 1 }, "+=0.2")
            .to(fii, { textContent: 'IIa', scale: 0.8, backgroundColor: '#27ae60', duration: 0.2 }); // 产生微量凝血酶
    }

    else if (state.stage === 4) {
        // --- 4: 放大阶段 (Amplification) ---
        // 重心转移：微量凝血酶 (FIIa) 移动到初级止血阶段粘附的主血小板上
        const microThrombin = document.querySelector('.f-ii'); // 获取上一阶段产生的 FIIa
        const platelet = document.querySelector('.platelet.primary-platelet') || document.querySelector('.platelet');

        if (!platelet) return; // 防错处理

        // 1. 凝血酶活化血小板 (通过 PAR 受体)
        tl.to(microThrombin, { x: gsap.getProperty(platelet, "x"), y: gsap.getProperty(platelet, "y") - 40, duration: 1 })
            .to(platelet, { filter: 'drop-shadow(0 0 20px #f1c40f)', scale: 1.1, duration: 0.5 }); // 血小板形态改变发光

        // 2. 凝血酶活化辅因子 (FV, FVIII) 和 FXI
        const fv = createFactorElement('f-v', 'V', { x: window.innerWidth * 0.5, y: 100 });
        const f8 = createFactorElement('f-viii', 'VIII', { x: window.innerWidth * 0.6, y: 100 });

        tl.to([fv, f8], { y: gsap.getProperty(platelet, "y") - 60, stagger: 0.3, duration: 1 })
            .to(fv, { textContent: 'Va', backgroundColor: '#c0392b', duration: 0.2 })
            .to(f8, { textContent: 'VIIIa', backgroundColor: '#e67e22', duration: 0.2 });
    }

    else if (state.stage === 5) {
        // --- 5: 传播阶段 (Propagation) & 凝血酶爆发 ---
        if (state.condition === 'hemophilia_a') {
            triggerPathologyAlert("传播中止：血友病 A 缺乏因子 VIII (FVIII)。无法在血小板表面组装内源性因子X酶 (Tenase) 复合物，凝血酶爆发失败，导致严重出血。");
            return;
        }

        const platelet = document.querySelector('.platelet.primary-platelet') || document.querySelector('.platelet');
        const pX = platelet ? gsap.getProperty(platelet, "x") : window.innerWidth * 0.4;
        const pY = platelet ? gsap.getProperty(platelet, "y") : window.innerHeight - 350;

        // 1. 组装 Tenase (FIXa + FVIIIa) 和 Prothrombinase (FXa + FVa)
        const prothrombin = createFactorElement('f-ii', 'II', { x: pX + 100, y: 50 });

        tl.to(prothrombin, { x: pX, y: pY - 80, duration: 1 })
            // 2. 凝血酶爆发 (Thrombin Burst)
            .call(() => triggerThrombinBurst(pX, pY))
            // 3. 纤维蛋白网形成
            .call(() => createFibrinMesh(pX, pY), null, "+=1");
    }
}

// --- 视觉特效辅助函数 ---

// 凝血酶爆发特效
function triggerThrombinBurst(x, y) {
    for (let i = 0; i < 15; i++) {
        const burstFIIa = createFactorElement('f-ii burst', 'IIa', { x: x, y: y });
        gsap.set(burstFIIa, { backgroundColor: '#2ecc71', scale: 0.5 });

        // 向四周散射的动画
        gsap.to(burstFIIa, {
            x: x + (Math.random() - 0.5) * 300,
            y: y - Math.random() * 200 - 50,
            opacity: 0,
            scale: 1.5,
            duration: 1.5 + Math.random(),
            ease: "power3.out",
            onComplete: () => burstFIIa.remove() // 动画结束后清理 DOM
        });
    }
}

// 形成纤维蛋白网特效
function createFibrinMesh(x, y) {
    const meshContainer = document.createElement('div');
    meshContainer.className = 'fibrin-mesh-container';
    meshContainer.dataset.createdStage = state.stage; // 记录创建时的阶段
    meshContainer.style.position = 'absolute';
    meshContainer.style.left = (x - 60) + 'px';
    meshContainer.style.top = (y - 40) + 'px';
    meshContainer.style.width = '120px';
    meshContainer.style.height = '80px';
    meshContainer.style.zIndex = '5';
    elements.factorsContainer.appendChild(meshContainer);

    // 随机生成交错的纤维蛋白丝
    for (let i = 0; i < 20; i++) {
        const thread = document.createElement('div');
        thread.style.position = 'absolute';
        thread.style.backgroundColor = '#ecf0f1'; // 白色纤维蛋白
        thread.style.boxShadow = '0 0 5px #bdc3c7';
        thread.style.height = '2px';
        thread.style.width = (40 + Math.random() * 80) + 'px';
        thread.style.top = (Math.random() * 80) + 'px';
        thread.style.left = (Math.random() * 40) + 'px';
        thread.style.transform = `rotate(${Math.random() * 180}deg)`;
        thread.style.opacity = 0;
        meshContainer.appendChild(thread);

        gsap.to(thread, { opacity: 1, duration: 0.5, delay: i * 0.05 });
    }
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
    elements.alertBox.innerText = message;
    elements.alertBox.style.display = 'block';
    elements.mechanismText.innerText = "生理过程已中断。";
}

// 初始化 UI 并安排 1 秒后自动进入 Stage 1
updateUI();
scheduleAutoAdvance();