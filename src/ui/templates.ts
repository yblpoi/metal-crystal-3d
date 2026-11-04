import { STRUCTURE_META } from '../crystal/structures';
import type { StructureId } from '../crystal/types';
import { icon } from './icons';

function miniSvg(id: StructureId): string {
  if (id === 'fcc') {
    return `<svg class="mini" viewBox="0 0 64 44" aria-hidden="true">
      <path class="mini-cell" d="M13 12 32 4 51 12v20L32 40 13 32Z"/>
      <path class="mini-cell dim" d="M13 12 32 20 51 12M32 20v20"/>
      <circle class="mini-atom" cx="32" cy="20" r="3.1"/>
      <circle class="mini-atom" cx="13" cy="12" r="2.5"/><circle class="mini-atom" cx="51" cy="12" r="2.5"/>
      <circle class="mini-atom" cx="13" cy="32" r="2.5"/><circle class="mini-atom" cx="51" cy="32" r="2.5"/>
      <circle class="mini-atom" cx="32" cy="4" r="2.5"/><circle class="mini-atom" cx="32" cy="40" r="2.5"/>
    </svg>`;
  }
  if (id === 'bcc') {
    return `<svg class="mini" viewBox="0 0 64 44" aria-hidden="true">
      <path class="mini-cell" d="M13 12 32 4 51 12v20L32 40 13 32Z"/>
      <path class="mini-cell dim" d="M13 12 32 20 51 12M32 20v20"/>
      <circle class="mini-atom" cx="32" cy="20" r="4"/>
      <circle class="mini-atom" cx="13" cy="12" r="2.3"/><circle class="mini-atom" cx="51" cy="12" r="2.3"/>
      <circle class="mini-atom" cx="13" cy="32" r="2.3"/><circle class="mini-atom" cx="51" cy="32" r="2.3"/>
      <circle class="mini-atom" cx="32" cy="4" r="2.3"/><circle class="mini-atom" cx="32" cy="40" r="2.3"/>
    </svg>`;
  }
  return `<svg class="mini" viewBox="0 0 64 44" aria-hidden="true">
    <path class="mini-cell" d="M18 13 32 7 46 13v16L32 41 18 35Z"/>
    <path class="mini-cell dim" d="M18 21 32 15 46 21M18 29 32 23 46 29M18 13v22M46 13v22"/>
    <circle class="mini-atom" cx="18" cy="13" r="2.2"/><circle class="mini-atom" cx="32" cy="7" r="2.2"/><circle class="mini-atom" cx="46" cy="13" r="2.2"/>
    <circle class="mini-atom" cx="32" cy="15" r="2.2"/><circle class="mini-atom" cx="25" cy="23" r="2.2"/><circle class="mini-atom" cx="39" cy="23" r="2.2"/>
    <circle class="mini-atom" cx="32" cy="31" r="2.2"/>
    <circle class="mini-atom" cx="18" cy="35" r="2.2"/><circle class="mini-atom" cx="32" cy="41" r="2.2"/><circle class="mini-atom" cx="46" cy="35" r="2.2"/>
  </svg>`;
}

function structureCards(): string {
  return (['fcc', 'bcc', 'hcp'] as StructureId[])
    .map((id) => {
      const meta = STRUCTURE_META[id];
      return `<button class="scard" type="button" data-structure="${id}" aria-pressed="${id === 'fcc'}" aria-label="切换到 ${meta.abbreviation} ${meta.name}">
        <span class="scard-top"><span class="scard-abbr">${meta.abbreviation}</span><span class="scard-current">当前</span>${miniSvg(id)}</span>
        <span class="scard-name">${meta.name}</span>
        <span class="scard-stats"><span>CN <b>${meta.coordinationNumber}</b></span><span>APF <b>${meta.apf.toFixed(3)}</b></span></span>
      </button>`;
    })
    .join('');
}

export function renderShell(root: HTMLElement): void {
  root.innerHTML = `
  <div class="app-grid">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">${icon('logo', 30)}</span>
        <span class="brand-text">
          <span class="brand-title">CRYSTAL ATLAS</span>
          <span class="brand-sub">金属晶体结构实验室</span>
        </span>
      </div>

      <div class="top-structure">
        <span class="top-badge" id="top-badge">FCC</span>
        <span class="top-names">
          <strong id="top-name">面心立方最密堆积</strong>
          <small id="top-en">FACE-CENTERED CUBIC</small>
        </span>
        <span class="top-chips" id="top-chips"></span>
      </div>

      <div class="top-actions">
        <button class="auto-button" id="auto-rotate-toggle" type="button" role="switch" aria-checked="true" aria-label="自动旋转">
          ${icon('rotate', 16)}
          <span class="auto-label">自动旋转</span>
          <span class="mini-switch" aria-hidden="true"><span class="mini-knob"></span></span>
        </button>
        <button class="btn" id="export-btn" type="button">
          ${icon('download', 15)}<span>导出</span>
        </button>
        <button class="btn icon-only" id="panel-toggle" type="button" aria-label="展开或收起控制台" aria-expanded="true" title="展开 / 收起控制台">
          ${icon('sliders', 17)}
        </button>
        <button class="btn icon-only mobile-only" id="mobile-settings" type="button" aria-label="打开设置" aria-expanded="false" aria-controls="panel">
          ${icon('settings', 17)}
        </button>
      </div>
    </header>

    <main class="stage" id="stage">
      <div class="stage-bg" aria-hidden="true"></div>
      <div class="stage-grid" aria-hidden="true"></div>
      <div class="stage-scan" aria-hidden="true"></div>
      <div class="stage-glow" aria-hidden="true"></div>
      <div class="vignette" aria-hidden="true"></div>
      <canvas id="crystal-canvas" aria-label="金属晶体三维视图，可拖动旋转"></canvas>
      <div class="label-layer" id="label-layer" aria-hidden="true"></div>

      <div class="stage-overlay">
        <section class="stage-title" aria-label="当前结构">
          <div class="eyebrow"><span class="live-dot"></span>STRUCTURE <span id="stage-index">01</span> / 03</div>
          <h1 id="stage-name">面心立方最密堆积</h1>
          <p class="stage-en" id="stage-en">FACE-CENTERED CUBIC</p>
          <div class="stage-chips" id="stage-chips"></div>
        </section>

        <div class="status-rail" id="status-rail">
          <div class="structure-dock" id="structure-dock" role="group" aria-label="结构选择">
            <span class="dock-label">结构 / LATTICE</span>
            <div class="dock-cards">${structureCards()}</div>
          </div>

          <div class="legend" id="legend" aria-label="图例">
            <span class="legend-title">图例 / LEGEND</span>
            <div class="legend-row"><span class="dot dot-atom"></span><span>金属原子</span><em id="legend-atom">r = 1</em></div>
            <div class="legend-row" id="legend-o-row"><span class="dot dot-o"></span><span>八面体 OCT</span><em id="legend-o">r/R 0.414</em></div>
            <div class="legend-row" id="legend-t-row"><span class="dot dot-t"></span><span>四面体 TET</span><em id="legend-t">r/R 0.225</em></div>
            <div class="legend-row" id="legend-ghost-row" hidden><span class="dot dot-ghost"></span><span>原子透视</span><em id="legend-ghost">范围外</em></div>
            <div class="legend-row"><span class="line-swatch"></span><span>虚线 + 角标</span><em>depth on</em></div>
          </div>

          <div class="hint" id="hint">
            <span class="hint-key">拖动</span> 旋转
            <span class="hint-sep"></span><span class="hint-key">滚轮</span> 缩放
            <span class="hint-sep"></span><span class="hint-key">1 / 2 / 3</span> 切换结构
          </div>
        </div>

        <div class="tooltip" id="tooltip" hidden>
          <span class="tooltip-tag" id="tooltip-tag"></span>
          <span class="tooltip-frac" id="tooltip-frac"></span>
          <span class="tooltip-meta" id="tooltip-meta"></span>
        </div>

        <div class="toast" id="toast" role="status" aria-live="polite" hidden>
          <span class="toast-dot"></span><span id="toast-text"></span>
        </div>
      </div>

      <div class="quick-dock" id="quick-dock" role="toolbar" aria-label="常驻快捷控制">
        <div class="qd-popover" id="qd-popover" hidden></div>
        <div class="qd-menu" id="qd-menu">
          <div class="qd-row">
            <button class="qd-btn" id="qd-reset" type="button" title="重置视角并回到适应视图状态 (R)" aria-label="重置视角">
              ${icon('recenter', 17)}<span>重置视角</span>
            </button>
            <button class="qd-btn" id="qd-fit" type="button" title="按当前可见内容适应视图" aria-label="适应视图">
              ${icon('fit', 17)}<span>适应视图</span>
            </button>
          </div>
          <div class="qd-sep" aria-hidden="true"></div>
          <div class="qd-row">
            <button class="qd-btn qd-rotate" id="qd-rotate" type="button" role="switch" aria-checked="true" title="自动旋转开关" aria-label="自动旋转">
              ${icon('rotate', 17)}<span>自动旋转</span>
            </button>
            <label class="qd-slider qd-speed" for="qd-speed">
              <span class="qd-slider-label">速度 <output id="qd-speed-out">0.6×</output></span>
              <input type="range" id="qd-speed" min="0.2" max="2" step="0.1" value="0.6" aria-label="自动旋转速度">
            </label>
          </div>
          <div class="qd-sep" aria-hidden="true"></div>
          <div class="qd-row">
            <button class="qd-btn" id="qd-atoms" type="button" role="switch" aria-checked="true" title="显示 / 隐藏原子" aria-label="显示原子">
              ${icon('eye', 17)}<span>显示原子</span>
            </button>
            <button class="qd-btn" id="qd-cell" type="button" role="switch" aria-checked="true" title="显示 / 隐藏晶胞线框" aria-label="晶胞">
              ${icon('cube', 17)}<span>晶胞</span>
            </button>
          </div>
          <div class="qd-row">
            <button class="qd-btn" id="qd-xray" type="button" role="switch" aria-checked="false" title="线框透视（晶胞线框穿透球体显示）" aria-label="线框透视">
              ${icon('layers', 17)}<span>线框透视</span>
            </button>
            <button class="qd-btn" id="qd-ghost" type="button" role="switch" aria-checked="false" title="原子透视（整簇半透明，便于看内部间隙）" aria-label="原子透视">
              ${icon('ghost', 17)}<span>原子透视</span>
            </button>
          </div>
          <label class="qd-slider" for="qd-radius">
            <span class="qd-slider-label">显示半径 <output id="qd-radius-out">0.50r</output></span>
            <input type="range" id="qd-radius" min="50" max="100" step="1" value="50" aria-label="球体显示半径">
          </label>
          <div class="qd-row">
            <button class="qd-btn" id="qd-range" type="button" title="显示范围：范围外球体切换为原子透视" aria-label="显示范围" aria-expanded="false" aria-haspopup="true">
              ${icon('fit', 17)}<span>显示范围</span>
            </button>
            <button class="qd-btn" id="qd-bg" type="button" title="背景配色" aria-label="背景" aria-expanded="false" aria-haspopup="true">
              ${icon('palette', 17)}<span>背景</span>
            </button>
          </div>
          <div class="qd-sep" aria-hidden="true"></div>
          <div class="qd-modes" role="group" aria-label="配色模式">
            <button type="button" data-dock-mode="radial" aria-pressed="true">内外层</button>
            <button type="button" data-dock-mode="stacking" aria-pressed="false">堆垛层</button>
            <button type="button" data-dock-mode="gold" aria-pressed="false">纯金</button>
          </div>
          <div class="qd-row">
            <button class="qd-btn qd-swatch-btn" id="qd-color" type="button" title="所有小球颜色调整（内外层 / 统一色）" aria-label="所有小球颜色调整" aria-expanded="false" aria-haspopup="true">
              <span class="qd-swatch" id="qd-swatch"></span><span>小球颜色</span>
            </button>
            <button class="qd-btn qd-restore-color" id="qd-color-restore" type="button" title="没有单独改过颜色的原子时不可用" aria-label="恢复默认颜色" disabled>
              ${icon('restore', 17)}<span>恢复默认色 <em id="qd-color-restore-count"></em></span>
            </button>
          </div>
          <button class="qd-btn qd-wide" id="qd-export" type="button" title="导出 PNG / WebP / GIF" aria-label="导出">
            ${icon('download', 17)}<span>导出 / EXPORT</span>
          </button>
        </div>
        <div class="qd-status" id="qd-status">0.50r · 范围 100% · 实心 63 · 透视 0</div>
        <button class="qd-fab" id="qd-fab" type="button" aria-label="快捷控制" aria-expanded="false" aria-controls="qd-menu">
          ${icon('sliders', 20)}
        </button>
      </div>

      <div class="atom-card" id="atom-card" hidden aria-label="选中原子操作">
        <div class="atom-card-head">
          <span>已选 <b id="atom-card-count">1</b> 个原子</span>
          <button class="atom-card-clear" id="atom-card-clear" type="button">清除</button>
        </div>
        <p class="atom-card-meta" id="atom-card-meta">—</p>
        <div class="atom-card-grid">
          <label class="atom-card-field" for="atom-card-color">
            <span>颜色</span>
            <input type="color" id="atom-card-color" value="#F6C453" aria-label="选中原子颜色">
          </label>
          <button class="btn-small" id="atom-card-color-default" type="button">默认色</button>
          <label class="atom-card-field wide" for="atom-card-size">
            <span>大小 <output id="atom-card-size-out">100%</output></span>
            <input type="range" id="atom-card-size" min="40" max="160" step="5" value="100">
          </label>
        </div>
        <div class="atom-card-actions">
          <button class="btn-small" id="atom-card-hide" type="button">隐藏所选</button>
          <button class="btn-small" id="atom-card-restore" type="button">恢复所选</button>
        </div>
        <p class="atom-card-hint">Ctrl / ⌘ / Shift + 单击多选 · 点空白清除</p>
      </div>

      <div class="loading" id="loading" aria-live="polite">
        <div class="loading-core"><span class="ring"></span><span class="loading-mark">${icon('logo', 34)}</span></div>
        <div class="loading-title">构建晶格</div>
        <div class="loading-sub" id="loading-sub">FCC · 63 ATOMS · r = 1</div>
      </div>

      <div class="fatal" id="fatal" hidden>
        <div class="fatal-mark">${icon('info', 26)}</div>
        <h2>无法启动 WebGL</h2>
        <p>当前浏览器或环境没有可用的 WebGL2 上下文。请开启硬件加速，或改用最新版 Chrome / Safari / Edge。</p>
      </div>
      <button class="panel-handle" id="panel-reopen" type="button" aria-label="收起实验控制台" title="收起 / 展开控制台" aria-expanded="true" aria-controls="panel">
        ${icon('chevron', 18, 'panel-handle-chevron')}<span class="panel-handle-text">控制台</span>
      </button>
    </main>

    <div class="sheet-backdrop" id="sheet-backdrop" hidden></div>
    <aside class="panel" id="panel" aria-label="晶体控制面板">
      <div class="panel-shell">
      <div class="panel-head">
        <div>
          <span class="panel-eyebrow">CONTROL DECK</span>
          <h2>实验控制台</h2>
        </div>
        <button class="panel-close" id="panel-close" type="button" aria-label="收起控制台" title="收起控制台">${icon('chevron', 18)}</button>
      </div>

      <div class="panel-scroll">
        <section class="psec is-open" data-section="data">
          <button class="ps-head" type="button" aria-expanded="true">
            <span class="ps-index">01</span><span class="ps-title">结构数据 <em>STRUCTURE</em></span>${icon('chevron', 16, 'ps-chevron')}
          </button>
          <div class="ps-body">
            <dl class="metric-grid">
              <div><dt>a / r</dt><dd id="data-ar">2.8284</dd></div>
              <div><dt>c / a</dt><dd id="data-ca">—</dd></div>
              <div><dt>配位数 CN</dt><dd id="data-cn">12</dd></div>
              <div><dt>APF</dt><dd id="data-apf">74.05%</dd></div>
              <div><dt>原子 / 胞</dt><dd id="data-atoms">4</dd></div>
              <div><dt>团簇原子</dt><dd id="data-cluster">63</dd></div>
            </dl>
            <div class="field cell-repeat-field" id="cell-repeat-field">
              <div class="field-label"><span>晶胞重复 <em>CELL REPEAT</em></span><em id="cell-repeat-note">2×2×2 超胞</em></div>
              <div class="segmented compact" role="group" aria-label="晶胞重复数">
                <button type="button" data-cell-repeat="1" aria-pressed="false" title="1×1×1 常规晶胞：8 角点 + 6 面心，含结构参数与 CN 的完整单胞">1×1×1</button>
                <button type="button" data-cell-repeat="2" aria-pressed="true" title="2×2×2 超胞外框（默认示意）">2×2×2</button>
              </div>
              <p class="micro-note" id="cell-repeat-hint">1×1×1 = 8 角点 + 6 面心（14 球 · 每胞 4 原子 · CN 12）；2×2×2 为超胞示意。HCP 固定 A-B-A 三层，不随此开关变化。</p>
            </div>
            <div class="cell-diagram-block">
              <div class="cell-diagram-head"><span>晶胞示意</span><em>SCHEMATIC · 等比投影</em></div>
              <div class="cell-diagram" id="cell-diagram"></div>
            </div>
            <div class="param-block" id="param-block">
              <div class="param-head"><span>结构参数沙盒</span><em>SCIENTIFIC · HCP c/a</em></div>
              <div class="param-controls" id="hcp-param-controls">
                <label for="hcp-ca">HCP c/a <output id="hcp-ca-out">1.633</output></label>
                <input type="range" id="hcp-ca" min="163.3" max="190" step="0.1" value="163.3" aria-label="HCP c/a 比例">
                <div class="param-drag">
                  <label for="hcp-ca-number">或精确输入</label>
                  <input type="number" id="hcp-ca-number" min="1.633" max="1.9" step="0.001" value="1.633" inputmode="decimal" aria-label="HCP c/a 精确输入">
                  <span class="param-drag-hint">越界值会被夹紧</span>
                </div>
                <div class="param-metrics">
                  <span>a/r <b id="param-ar">2.0000</b></span>
                  <span>c/r <b id="param-cr">3.2660</b></span>
                  <span>APF <b id="param-apf">74.05%</b></span>
                </div>
                <p class="param-note" id="param-note">硬球模型要求 c/a ≥ √(8/3) ≈ 1.633：更小的 c 会让相邻层原子重叠，因此下限被锁定；拖动滑块或输入数值会拉开层间距，并实时重算 APF、O/T 间隙半径与最近邻距离。r = 1 始终不变。</p>
                <div class="btn-row">
                  <button class="btn-small" id="hcp-ca-reset" type="button">恢复理想 c/a</button>
                </div>
              </div>
              <p class="param-lock" id="cubic-param-lock" hidden>立方结构：a/r 由硬球相切锁定（FCC = 2√2，BCC = 4/√3），没有可自由拖动的结构参数；切换到 HCP 可拖动 c/a 进行科学沙盒实验。</p>
            </div>
            <div class="line-note"><span>示例金属</span><b id="data-metals">Cu · Al · Au · Ag</b></div>
            <p class="cell-note" id="data-cellnote"></p>
            <div class="scale-note">${icon('cube', 18)}<span>同一比例尺 · 底层硬球 r = 1；默认显示 0.50r 仅作缩球示意，切换结构仍共用尺度。</span></div>
            <div class="btn-row">
              <button class="btn-small" id="reset-view-btn" type="button">重置视角</button>
              <button class="btn-small" id="fit-view-btn" type="button">适应视图</button>
            </div>
          </div>
        </section>

        <section class="psec is-open" data-section="look">
          <button class="ps-head" type="button" aria-expanded="true">
            <span class="ps-index">02</span><span class="ps-title">外观 <em>APPEARANCE</em></span>${icon('chevron', 16, 'ps-chevron')}
          </button>
          <div class="ps-body">
            <div class="field">
              <div class="field-label"><span>颜色模式</span><em id="color-mode-note">径向分层</em></div>
              <div class="segmented" role="group" aria-label="颜色模式">
                <button type="button" data-mode="radial" aria-pressed="true">内外层</button>
                <button type="button" data-mode="stacking" aria-pressed="false">堆垛层</button>
                <button type="button" data-mode="gold" aria-pressed="false">纯金</button>
              </div>
            </div>
            <div class="color-grid">
              <label class="color-field" for="color-inner">
                <span id="inner-label">内层</span>
                <span class="color-control"><input type="color" id="color-inner" value="#B87333" aria-label="内层颜色"><em id="color-inner-hex">#B87333</em></span>
              </label>
              <label class="color-field" for="color-outer">
                <span id="outer-label">外层</span>
                <span class="color-control"><input type="color" id="color-outer" value="#F6C453" aria-label="外层颜色"><em id="color-outer-hex">#F6C453</em></span>
              </label>
            </div>
            <div class="switch-row">
              <label for="toggle-autorotate">自动旋转 <em>AUTO ORBIT</em></label>
              <input type="checkbox" id="toggle-autorotate" class="switch" role="switch" checked>
            </div>
            <div class="range-row">
              <label for="speed">旋转速度 <output id="speed-out">0.6×</output></label>
              <input type="range" id="speed" min="0.2" max="2" step="0.1" value="0.6">
            </div>
            <div class="switch-row">
              <label for="toggle-cell">晶胞线框 <em>CELL FRAME</em></label>
              <input type="checkbox" id="toggle-cell" class="switch" role="switch" checked>
            </div>
            <div class="range-row">
              <div class="range-label-row">
                <label for="cell-width">线框粗细 <output id="cell-width-out">2.8 px · 自动</output></label>
                <button class="auto-chip is-on" id="cell-auto-btn" type="button" aria-pressed="true">自动</button>
              </div>
              <input type="range" id="cell-width" min="1" max="6" step="0.1" value="2.8">
            </div>
            <div class="range-row">
              <label for="cell-brightness">线框亮度 <output id="cell-brightness-out">85%</output></label>
              <input type="range" id="cell-brightness" min="30" max="100" step="1" value="85">
            </div>
            <div class="switch-row">
              <label for="toggle-xray">线框透视 <em>X-RAY</em></label>
              <input type="checkbox" id="toggle-xray" class="switch" role="switch">
            </div>
            <div class="switch-row">
              <label for="toggle-ghost">原子透视 <em>ATOM X-RAY</em></label>
              <input type="checkbox" id="toggle-ghost" class="switch" role="switch">
            </div>
            <div class="switch-row">
              <label for="toggle-atoms">显示原子 <em>ATOMS</em></label>
              <input type="checkbox" id="toggle-atoms" class="switch" role="switch" checked>
            </div>
          </div>
        </section>

        <section class="psec is-open" data-section="display">
          <button class="ps-head" type="button" aria-expanded="true">
            <span class="ps-index">03</span><span class="ps-title">显示 <em>DISPLAY</em></span>
            <span class="ps-badge" id="display-badge">缩球示意 · 实心 63 / 63</span>
            ${icon('chevron', 16, 'ps-chevron')}
          </button>
          <div class="ps-body">
            <div class="range-row">
              <label for="display-radius">球体显示半径 <output id="display-radius-out">0.50r · 50%</output></label>
              <div class="range-with-action">
                <input type="range" id="display-radius" min="50" max="100" step="1" value="50">
                <button class="btn-small" id="display-radius-reset" type="button">相切硬球 100%</button>
              </div>
            </div>
            <div class="range-row">
              <label for="display-range">显示范围 <output id="display-range-out">100%</output></label>
              <div class="range-with-action">
                <input type="range" id="display-range" min="40" max="100" step="1" value="100">
                <button class="btn-small" id="display-all-btn" type="button" aria-pressed="false">显示全部</button>
              </div>
              <span class="display-count">实心 <b id="display-visible-count">63</b> / <span id="display-total-count">63</span> 原子 · <em>原子透视</em> <b id="display-xray-count">0</b></span>
            </div>
            <button class="btn-small display-shell-btn" id="display-shell-btn" type="button" aria-pressed="false">配位壳（第一配位壳）· CN 12</button>
            <p class="cn-note" id="display-cn-note">FCC 的 CN = 12；配位壳 = 中心 + 12 邻居（13 球）。</p>
            <div class="switch-row">
              <label for="display-follow-sites">间隙位跟随显示范围 <em>FOLLOW RANGE</em></label>
              <input type="checkbox" id="display-follow-sites" class="switch" role="switch" checked>
            </div>
            <div class="display-actions">
              <button class="btn-small" id="display-reset-btn" type="button">重置显示</button>
            </div>
            <p class="micro-note">缩球只是显示缩放：底层 r = 1 硬球、最近邻 2、CN 与间隙坐标 / 半径比均未改变。调整显示范围时，范围外的球体不再消失，而是切换为「原子透视」半透明状态；手动隐藏的原子不参与拾取。</p>
          </div>
        </section>

        <section class="psec is-highlight" data-section="sites">
          <button class="ps-head" type="button" aria-expanded="false">
            <span class="ps-index">04</span><span class="ps-title">间隙位 <em>INTERSTITIALS</em></span>
            <span class="ps-badge" id="site-badge">O 32 · T 64</span>
            ${icon('chevron', 16, 'ps-chevron')}
          </button>
          <div class="ps-body">
            <div class="site-entry">
              <button class="btn-site-primary" id="site-enter-btn" type="button">显示间隙位 · OCT</button>
              <button class="btn-site-secondary" id="site-all-btn" type="button">显示全部位点</button>
            </div>
            <div class="toggle-pair">
              <label class="type-toggle type-o" for="toggle-site-o"><span class="dot dot-o"></span>八面体 OCT<input type="checkbox" id="toggle-site-o" class="switch" role="switch"></label>
              <label class="type-toggle type-t" for="toggle-site-t"><span class="dot dot-t"></span>四面体 TET<input type="checkbox" id="toggle-site-t" class="switch" role="switch"></label>
            </div>
            <div class="range-row">
              <label for="site-size">间隙球尺寸 <output id="site-size-out">70%</output></label>
              <input type="range" id="site-size" min="25" max="100" step="1" value="70">
              <span class="range-note">100% = 几何硬球上限（数据比例，不可超过）；实际半径随原子缩球同比缩放</span>
            </div>
            <div class="range-row">
              <label for="site-opacity">不透明度 <output id="site-opacity-out">60%</output></label>
              <input type="range" id="site-opacity" min="50" max="100" step="1" value="60">
            </div>
            <div class="switch-row">
              <label for="toggle-poly">配位多面体 <em>POLYHEDRON</em></label>
              <input type="checkbox" id="toggle-poly" class="switch" role="switch" checked>
            </div>
            <div class="switch-row">
              <label for="toggle-site-labels">显示间隙标签 <em>LABELS · ≤24</em></label>
              <input type="checkbox" id="toggle-site-labels" class="switch" role="switch">
            </div>
            <div class="switch-row">
              <label for="toggle-bonds">最近邻连线 <em>BONDS</em></label>
              <input type="checkbox" id="toggle-bonds" class="switch" role="switch">
            </div>
            <div class="field">
              <div class="field-label"><span>范围筛选</span><em>FILTER</em></div>
              <div class="segmented compact" role="group" aria-label="间隙位范围筛选">
                <button type="button" data-filter="all" aria-pressed="false">全部</button>
                <button type="button" data-filter="complete" aria-pressed="true">完整配位</button>
                <button type="button" data-filter="selected" aria-pressed="false">仅选中</button>
              </div>
            </div>
            <div class="count-chips" aria-label="间隙位计数">
              <span class="count-chip"><em>显示</em><b id="site-display">0</b></span>
              <span class="count-chip"><em>完整配位</em><b id="site-complete-count">0</b></span>
              <span class="count-chip"><em>理论</em><b id="site-theory">4/胞</b></span>
            </div>
            <p class="site-note" id="site-note"></p>
            <p class="site-range-note" id="site-range-note"></p>
            <div class="site-browser" aria-label="间隙位浏览器">
              <div class="browser-tabs" role="group" aria-label="间隙位类型">
                <button type="button" data-browser-type="O" aria-pressed="true">八面体 OCT</button>
                <button type="button" data-browser-type="T" aria-pressed="false">四面体 TET</button>
              </div>
              <div class="browser-nav-row">
                <button class="browser-nav" id="site-prev" type="button">上一个</button>
                <span class="browser-position" id="site-position">— / —</span>
                <button class="browser-nav" id="site-next" type="button">下一个</button>
              </div>
              <dl class="browser-meta">
                <div><dt>分数坐标</dt><dd id="site-frac">—</dd></div>
                <div><dt>配位 CN</dt><dd id="site-cn">—</dd></div>
                <div><dt>几何半径 r/R</dt><dd id="site-rmax">—</dd></div>
                <div><dt>状态</dt><dd><span class="site-state-badge" id="site-state">—</span></dd></div>
              </dl>
              <p class="site-neighbor-note" id="site-neighbor-note" hidden></p>
              <div class="browser-actions">
                <button class="btn-small" id="site-focus" type="button">聚焦</button>
                <button class="btn-small" id="site-copy" type="button">复制坐标</button>
                <button class="btn-small" id="site-center-btn" type="button" hidden>回到中心</button>
              </div>
            </div>
            <p class="micro-note">默认只显示完整配位的 OCT 位点；边界 complete=false 的位点不给多面体，并标注“边界欠配位”。标签最多 24 个。</p>
          </div>
        </section>

        <section class="psec is-open" data-section="edit">
          <button class="ps-head" type="button" aria-expanded="true">
            <span class="ps-index">05</span><span class="ps-title">原子编辑 <em>PER-ATOM</em></span>
            <span class="ps-badge quiet" id="edit-badge">—</span>
            ${icon('chevron', 16, 'ps-chevron')}
          </button>
          <div class="ps-body">
            <div class="switch-row">
              <label for="toggle-edit">原子交互 <em>PICK &amp; PAINT</em></label>
              <input type="checkbox" id="toggle-edit" class="switch" role="switch" checked>
            </div>
            <p class="micro-note">单击球体选中；Ctrl / ⌘ / Shift + 单击加入或移出多选；点击空白或 Esc 清除。选中后可在浮动卡片中改色、调整大小、隐藏。</p>
            <div class="atom-inspector" id="atom-inspector">
              <div class="inspector-empty" id="atom-empty">
                <span class="empty-mark">${icon('cube', 22)}</span>
                <span>未选择原子</span><em>单击模型中的球体即可选中，支持多选</em>
              </div>
              <div class="inspector-content" id="atom-content" hidden>
                <div class="inspector-head">
                  <span class="element-tag">M</span>
                  <span class="inspector-title"><b id="atom-kind">面心</b><small id="atom-struct">FCC · 通用金属</small></span>
                  <span class="layer-chip" id="atom-layer">壳层 2</span>
                </div>
                <dl class="inspector-grid">
                  <div><dt>已选</dt><dd><b id="atom-selected-count">1</b> 个原子</dd></div>
                  <div><dt>分数坐标</dt><dd id="atom-frac">(0.500, 0.500, 0.000)</dd></div>
                  <div><dt>层 / 位点</dt><dd id="atom-layer-detail">壳层 2 · face</dd></div>
                </dl>
                <label class="color-field wide" for="atom-color">
                  <span>选中颜色</span>
                  <span class="color-control"><input type="color" id="atom-color" value="#F6C453" aria-label="选中原子颜色"><em id="atom-color-hex">#F6C453</em></span>
                </label>
                <div class="range-row">
                  <label for="atom-size">显示大小 <output id="atom-size-out">100%</output></label>
                  <input type="range" id="atom-size" min="40" max="160" step="5" value="100">
                </div>
                <div class="btn-row">
                  <button class="btn-small" id="atom-hide" type="button">隐藏所选</button>
                  <button class="btn-small" id="atom-show-hidden" type="button">显示全部隐藏</button>
                  <button class="btn-small" id="atom-restore" type="button">恢复所选</button>
                </div>
                <div class="btn-row">
                  <button class="btn-small danger-quiet" id="reset-all-colors" type="button">重置全部原子编辑</button>
                </div>
                <p class="micro-note" id="atom-hidden-note" hidden></p>
              </div>
            </div>
            <p class="micro-note">逐球改色 / 大小 / 隐藏以 atom.id 存入 localStorage，刷新与切换结构后保留；底层晶体学数据始终不变。</p>
          </div>
        </section>

        <section class="psec" data-section="background">
          <button class="ps-head" type="button" aria-expanded="false">
            <span class="ps-index">06</span><span class="ps-title">背景 <em>BACKDROP</em></span>${icon('chevron', 16, 'ps-chevron')}
          </button>
          <div class="ps-body">
            <div class="bg-presets" role="group" aria-label="背景预设">
              <button type="button" class="bg-preset is-active" data-bg="deep" aria-pressed="true"><span class="bg-swatch deep"></span><span>深空蓝</span><em>DEEP</em></button>
              <button type="button" class="bg-preset" data-bg="aurora" aria-pressed="false"><span class="bg-swatch aurora"></span><span>极光青</span><em>AURORA</em></button>
              <button type="button" class="bg-preset" data-bg="gold" aria-pressed="false"><span class="bg-swatch gold"></span><span>黑金</span><em>BLACK GOLD</em></button>
            </div>
            <label class="color-field wide" for="bg-custom">
              <span>自定义底色</span>
              <span class="color-control"><input type="color" id="bg-custom" value="#0A2B4D" aria-label="自定义背景颜色"><em id="bg-hex">#0A2B4D</em></span>
            </label>
            <p class="micro-note">背景仅作用于页面；动画导出使用透明 alpha 通道，不包含此背景。</p>
          </div>
        </section>

        <section class="psec" data-section="interface">
          <button class="ps-head" type="button" aria-expanded="false">
            <span class="ps-index">07</span><span class="ps-title">界面 <em>INTERFACE</em></span>
            <span class="ps-badge quiet" id="ui-scale-badge">100%</span>
            ${icon('chevron', 16, 'ps-chevron')}
          </button>
          <div class="ps-body">
            <div class="field">
              <div class="field-label"><span>界面缩放 <em>UI SCALE</em></span><em>控制台 · 顶栏 · 常驻菜单</em></div>
              <div class="segmented" role="group" aria-label="界面缩放">
                <button type="button" data-ui-scale="0.9" aria-pressed="false">90%</button>
                <button type="button" data-ui-scale="1" aria-pressed="true">100%</button>
                <button type="button" data-ui-scale="1.15" aria-pressed="false">115%</button>
                <button type="button" data-ui-scale="1.3" aria-pressed="false">130%</button>
              </div>
              <p class="micro-note">缩放保存在本机，刷新后保持。常驻菜单默认已放大 25%，此比例会再叠加其上；画布与晶体尺寸不受影响。</p>
            </div>
          </div>
        </section>

        <footer class="panel-footer">
          <span>DISPLAY &amp; EXPORT</span>
          <span>r = 1 HARD SPHERES</span>
        </footer>
      </div>
      </div>
    </aside>

    <dialog class="export-dialog" id="export-dialog" aria-labelledby="export-title" aria-describedby="export-intro">
      <div class="dialog-head">
        <div><span class="panel-eyebrow">EXPORT · ANIMATION</span><h2 id="export-title">导出 360° 循环动画</h2></div>
        <button class="panel-close" id="export-close" type="button" aria-label="关闭导出弹窗">${icon('close', 18)}</button>
      </div>
      <div class="dialog-body">
        <p class="dialog-copy" id="export-intro">只导出 WebGL 晶体场景：原子、间隙球、晶胞线框与（可选）配位多面体。HUD、tooltip、背景 CSS 与选中目标环不会进入文件。</p>

        <fieldset class="export-group" id="export-options">
          <legend>格式</legend>
          <div class="export-formats" role="radiogroup" aria-label="导出格式">
            <label class="export-format-card is-selected" for="export-format-webp">
              <input type="radio" id="export-format-webp" name="export-format" value="webp" checked>
              <span class="export-format-body"><b>WebP</b><em>透明 alpha · 推荐</em><small>文件更小，边缘平滑</small></span>
            </label>
            <label class="export-format-card" for="export-format-gif">
              <input type="radio" id="export-format-gif" name="export-format" value="gif">
              <span class="export-format-body"><b>GIF</b><em>兼容性最好</em><small>1-bit alpha · 透明边缘有锯齿</small></span>
            </label>
          </div>

          <div class="export-controls">
            <label class="export-field" for="export-size">
              <span>尺寸</span>
              <select id="export-size">
                <option value="540">540 × 540</option>
                <option value="720">720 × 720</option>
                <option value="1080" selected>1080 × 1080</option>
                <option value="1440">1440 × 1440</option>
              </select>
            </label>
            <label class="export-field" for="export-duration">
              <span>时长</span>
              <select id="export-duration">
                <option value="1">1 s</option>
                <option value="2">2 s</option>
                <option value="3" selected>3 s</option>
                <option value="4">4 s</option>
                <option value="5">5 s</option>
              </select>
            </label>
            <label class="export-field" for="export-fps">
              <span>帧率</span>
              <select id="export-fps">
                <option value="24">24 fps</option>
                <option value="30" selected>30 fps</option>
              </select>
            </label>
            <label class="export-field" for="export-loop">
              <span>循环</span>
              <select id="export-loop">
                <option value="0" selected>无限</option>
                <option value="1">1 次</option>
              </select>
            </label>
          </div>

          <div class="export-row" id="export-quality-row">
            <label for="export-quality">WebP 质量 <output id="export-quality-out">92</output></label>
            <input type="range" id="export-quality" min="70" max="100" step="1" value="92">
          </div>

          <div class="export-row export-bg-row" id="export-bg-row">
            <span class="export-row-title">背景</span>
            <label class="export-radio"><input type="radio" id="export-bg-transparent" name="export-bg" value="transparent" checked><span>透明</span></label>
            <label class="export-radio"><input type="radio" id="export-bg-solid" name="export-bg" value="solid"><span>纯色</span></label>
            <label class="export-color" for="export-bg-color"><input type="color" id="export-bg-color" value="#061A33" aria-label="纯色背景颜色"><span id="export-bg-hex">#061A33</span></label>
          </div>

          <label class="export-check" for="export-include-poly">
            <input type="checkbox" id="export-include-poly">
            <span><b>包含当前选中位点的配位多面体</b><em>默认关闭；选中目标环永远不导出</em></span>
          </label>
          <p class="export-note" id="export-selection-note">当前未选中完整配位位点，导出仅包含原子、间隙球与晶胞线框。</p>
          <p class="export-warning" id="export-gif-note" hidden>GIF 只有 1-bit alpha：透明边缘会出现硬边/锯齿。需要平滑半透明请用 WebP；纯色背景可避免透明边缘。</p>
        </fieldset>

        <div class="export-summary" aria-label="导出摘要">
          <div><span>输出</span><b id="export-output-size">1080 × 1080</b></div>
          <div><span>帧数</span><b id="export-frames-estimate">90</b></div>
          <div><span>时长</span><b id="export-duration-estimate">3.0 s</b></div>
          <div><span>编码</span><b id="export-encoder-estimate">WebP · 92</b></div>
        </div>
        <p class="export-note" id="export-format-note">透明 WebP 使用 VP8X + ANIM + ANMF 容器，逐帧独立透明；Safari 等无原生 WebP 编码时自动使用 @jsquash/webp。</p>

        <div class="export-progress" id="export-progress" hidden>
          <div class="export-progress-head"><span id="export-progress-label">准备导出</span><b id="export-progress-count">0 / 0</b></div>
          <progress id="export-progress-bar" max="100" value="0" aria-label="导出进度"></progress>
          <p class="export-progress-hint">逐帧渲染并编码；导出期间场景暂停，可随时取消。取消后会恢复原视图。</p>
        </div>

        <div class="export-result" id="export-result" hidden>
          <div class="export-preview-frame">
            <img id="export-preview" alt="导出动画预览">
          </div>
          <dl class="export-result-stats">
            <div><dt>尺寸</dt><dd id="export-result-dimensions">—</dd></div>
            <div><dt>帧数</dt><dd id="export-result-frames">—</dd></div>
            <div><dt>文件大小</dt><dd id="export-result-size">—</dd></div>
            <div><dt>编码器</dt><dd id="export-result-encoder">—</dd></div>
          </dl>
          <p class="export-note" id="export-result-note">预览以棋盘格表示透明区域；部分浏览器会循环播放。</p>
        </div>

        <p class="export-error" id="export-error" role="alert" hidden></p>
      </div>
      <div class="dialog-foot">
        <button class="btn-small" id="export-cancel" type="button">关闭</button>
        <button class="btn-small" id="export-again" type="button" hidden>重新导出</button>
        <button class="btn-primary" id="export-start" type="button">开始导出</button>
        <button class="btn-primary" id="export-download" type="button" hidden>下载文件</button>
      </div>
    </dialog>
  </div>`;
}
