# 移动端 UI/UX 优化方案 (第二版：视口比例缩放方案)

在第一版方案中，我们尝试了「折叠侧边栏」+「JS 坐标手动按比例计算缩放」的思路。虽然解决了空间占用问题，但带来了一些新痛点：
1. 机制说明文本（当前机制）被收纳在折叠面板中，用户需要频繁展开/折叠才能对照看懂每一步动画，学习体验不佳。
2. JS 中混合了百分比定位与硬编码像素值，手动缩放坐标逻辑复杂，容易产生元素定位微小偏移或贴合不紧密的问题。

为了彻底解决这些体验和实现问题，我们提出第二版**「视口比例缩放（Viewport Scale）与上下分屏」**方案。

---

## 核心设计理念

### 1. 上下分屏常显布局 (Split-Screen)
- **上半部分 (动画舞台)**：占据屏幕宽度的 100%，高度按 2:1 比例自适应（例如在 375px 宽的手机上，高度为 187.5px）。
- **下半部分 (控制面板)**：将原本的左侧边栏移至舞台下方。包含「临床状态设定」、「当前机制说明」和「图例面板」。**不需要折叠**，始终完整显示。用户在观看动画时可以实时对照阅读文字，体验更连贯。
- **底部 (时间轴)**：保持在屏幕最下方，提供清晰的导航。

### 2. 视口比例缩放 (CSS Transform Scale)
- 在移动端，我们将动画舞台 `.animation-stage` 的逻辑尺寸固定为 `1000px × 500px`。
- 使用 CSS `transform: scale(var(--stage-scale))` 将整个舞台等比缩放，以完美契合手机屏幕宽度。
- **优势**：
  - 动画中所有元素（血小板、因子、纤维蛋白网、路径）的相对位置、大小和文字大小与桌面端 **100% 保持一致**，画面比例完美，无任何拉伸或错位。
  - JS 动画逻辑中**完全不需要**进行手动的坐标缩放计算（可完全移除 `sx()` / `sy()` 函数），`getStageDimensions()` 在移动端直接返回 `{ width: 1000, height: 500 }`。

---

## Proposed Changes

### HTML 结构调整

#### [MODIFY] [index.html](file:///d:/Code/Antigravity/project-coag/index.html)
- 引入外层包裹器 `.stage-wrapper` 用于确定 2:1 比例空间。
- 移除第一版引入的 `#panel-toggle` 折叠按钮。

```html
<div class="simulator-container">
    <!-- 移动端：.stage-wrapper 将排在最上方 -->
    <div class="stage-wrapper">
        <main class="animation-stage">
            <!-- 血管及动画内容 -->
        </main>
    </div>
    
    <!-- 移动端：.control-panel 将排在舞台下方 -->
    <aside class="control-panel" id="control-panel">
        <h2>临床状态设定</h2>
        ...
    </aside>
</div>
```

---

### CSS 样式重构

#### [MODIFY] [style.css](file:///d:/Code/Antigravity/project-coag/style.css)
- 移除第一版所有的折叠面板和硬编码缩放样式（例如缩小后的 `.platelet`, `.factor` 等，因为 `transform: scale` 会自动处理它们）。
- 实现移动端 `@media (max-width: 768px)` 布局：
  - `.simulator-container` 改为 `flex-direction: column`。
  - `.stage-wrapper` 设置 `width: 100%; aspect-ratio: 2 / 1; position: relative; overflow: hidden;`。
  - `.animation-stage` 固定为 `width: 1000px; height: 500px; transform: scale(var(--stage-scale, 1)); transform-origin: top left;`。
  - `.control-panel` 设置为满宽，取消 `max-height` 限制，正常流式布局。
  - 优化移动端图例排版为横向流动布局（`flex-direction: row; flex-wrap: wrap;`）以节省垂直空间。

---

### JS 逻辑重写

#### [MODIFY] [app.js](file:///d:/Code/Antigravity/project-coag/app.js)
- 移除第一版临时添加的 `sx()` / `sy()` 缩放函数，将 Stage 2~5 的动画坐标恢复为直观的像素值（与 `main` 分支原版一致）。
- 重构 `getStageDimensions()`，移动端直接返回固定的参考尺寸：
  ```javascript
  function getStageDimensions() {
      if (isMobile()) {
          return { width: 1000, height: 500 };
      }
      const stageEl = document.querySelector('.animation-stage');
      const width = stageEl ? stageEl.offsetWidth : (window.innerWidth - 320);
      const height = stageEl ? stageEl.offsetHeight : window.innerHeight;
      return { width, height };
  }
  ```
- 添加动态计算缩放比例的逻辑：
  ```javascript
  function updateStageScale() {
      if (isMobile()) {
          const wrapper = document.querySelector('.stage-wrapper');
          if (wrapper) {
              const scale = wrapper.offsetWidth / 1000;
              document.documentElement.style.setProperty('--stage-scale', scale);
          }
      } else {
          document.documentElement.style.removeProperty('--stage-scale');
      }
  }
  ```
- 保留并优化触摸手势交互（左右滑动切换步骤、双击暂停），移除折叠面板相关的 JS 代码。

---

## 验证计划

### 自动测试与手动验证
1. **视口缩放正确性**：在 DevTools 中从 320px 逐步拉大到 768px，检查舞台是否能以完美 2:1 比例缩放，无像素错位或黑边。
2. **文本可读性**：检查舞台下方常显的「当前机制」文字在各种屏幕高度下是否均能完整阅读，无需折叠。
3. **手势验证**：在模拟器上用触摸滑动和双击，检查交互是否灵敏、流畅。
4. **横竖屏切换**：旋转设备，检查页面是否能快速自适应调整。
