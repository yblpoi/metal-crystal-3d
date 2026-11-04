#!/usr/bin/env node
/**
 * Headless visual + interaction check for CRYSTAL ATLAS.
 * Uses playwright-core with its registered Chromium build.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, 'artifacts');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
// Playwright resolves the registered Chromium itself; set CHROMIUM_PATH only
// when the browser lives somewhere non-standard.
const CHROMIUM_PATH = process.env.CHROMIUM_PATH;

const results = [];
const consoleMessages = [];
const pageErrors = [];
const badResponses = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

function sha(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`vite dev server did not start on ${url}`);
}

async function scrollPanelTo(page, selector, offset = 8) {
  await page.evaluate(
    ({ sel, off }) => {
      const target = document.querySelector(sel);
      const scroller = document.querySelector('.panel-scroll');
      if (!target || !scroller) return;
      const top =
        scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - off;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    },
    { sel: selector, off: offset },
  );
}

async function settle(page, ms = 550) {
  await page.waitForTimeout(ms);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
      }),
  );
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  // Cross-platform: run vite.js through the current Node binary. Spawning
  // node_modules/.bin/vite fails on Windows (ENOENT: the shim has no .cmd suffix).
  const viteJs = path.join(ROOT, 'node_modules/vite/bin/vite.js');
  const server = spawn(
    process.execPath,
    [viteJs, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'none' },
    },
  );
  let serverLog = '';
  server.stdout.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverLog += chunk.toString();
  });

  let browser;
  try {
    await waitForServer(BASE);
    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      locale: 'zh-CN',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();

    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleMessages.push({
          type: message.type(),
          text: message.text(),
          location: message.location(),
        });
      }
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('response', (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    });

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__CRYSTAL_READY__ === true, null, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await settle(page, 800);

    // --- basic boot -------------------------------------------------
    const canvasBox = await page.locator('#crystal-canvas').boundingBox();
    record(
      'canvas 尺寸 > 0',
      Boolean(canvasBox && canvasBox.width > 0 && canvasBox.height > 0),
      canvasBox ? `${canvasBox.width}×${canvasBox.height}` : 'missing',
    );
    record(
      'WebGL2 上下文存在',
      await page.evaluate(() => Boolean(document.getElementById('crystal-canvas')?.getContext('webgl2'))),
    );
    record('初始结构标题为 FCC', (await page.locator('#top-name').textContent())?.includes('面心') ?? false);

    // --- display-only shrink / range defaults ----------------------
    const defaultDisplay = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      return {
        state: debug.getState(),
        display: debug.getDisplayInfo(),
        ui: {
          radiusValue: document.querySelector('#display-radius')?.value,
          radiusOut: document.querySelector('#display-radius-out')?.textContent,
          rangeValue: document.querySelector('#display-range')?.value,
          rangeOut: document.querySelector('#display-range-out')?.textContent,
          visible: document.querySelector('#display-visible-count')?.textContent,
          total: document.querySelector('#display-total-count')?.textContent,
          badge: document.querySelector('#display-badge')?.textContent,
          shell: document.querySelector('#display-shell-btn')?.textContent,
          cnNote: document.querySelector('#display-cn-note')?.textContent,
          follow: document.querySelector('#display-follow-sites')?.checked,
          legendO: getComputedStyle(document.querySelector('#legend-o-row')).display,
          legendT: getComputedStyle(document.querySelector('#legend-t-row')).display,
          yellowHint: Boolean(document.querySelector('.display-data-badge')),
        },
      };
    });
    record(
      '默认显示：0.50r / 100% / range / 跟随间隙位',
      Math.abs(defaultDisplay.state.atomDisplayRadius - 0.5) < 1e-9 &&
        Math.abs(defaultDisplay.state.displayRange - 1) < 1e-9 &&
        defaultDisplay.state.displayMode === 'range' &&
        defaultDisplay.state.followRangeForSites === true,
      JSON.stringify(defaultDisplay.state),
    );
    record(
      'FCC 默认 100% 范围显示全部 63 原子（无透视/隐藏）',
      defaultDisplay.display.visibleAtomCount === 63 &&
        defaultDisplay.display.xrayAtomIndices.length === 0 &&
        defaultDisplay.display.hiddenAtomIndices.length === 0,
      `${defaultDisplay.display.visibleAtomCount} / ${defaultDisplay.display.totalAtomCount} · xray ${defaultDisplay.display.xrayAtomIndices.length}`,
    );
    record(
      '显示区无重复黄色提示条，未开启间隙时隐藏 OCT/TET 图例',
      defaultDisplay.ui.yellowHint === false &&
        defaultDisplay.ui.legendO === 'none' &&
        defaultDisplay.ui.legendT === 'none',
      JSON.stringify({ yellow: defaultDisplay.ui.yellowHint, o: defaultDisplay.ui.legendO, t: defaultDisplay.ui.legendT }),
    );
    record(
      'UI 计数与可见实例一致且为 tabular 显示',
      Number(defaultDisplay.ui.visible) === defaultDisplay.display.visibleAtomCount &&
        Number(defaultDisplay.ui.total) === defaultDisplay.display.totalAtomCount &&
        defaultDisplay.ui.radiusOut?.includes('0.50r') &&
        defaultDisplay.ui.rangeOut?.includes('100%') &&
        defaultDisplay.ui.follow === true,
      JSON.stringify(defaultDisplay.ui),
    );
    record(
      '缩球 badge 与 CN 说明清楚（FCC/HCP 12）',
      Boolean(
        defaultDisplay.ui.badge?.includes('缩球') &&
          defaultDisplay.ui.cnNote?.includes('12') &&
          defaultDisplay.ui.shell?.includes('CN 12'),
      ),
      `${defaultDisplay.ui.badge} · ${defaultDisplay.ui.cnNote}`,
    );

    // radius slider: camera must not refit, spheres must really shrink
    const centerIndex = defaultDisplay.display.shellCenterIndex;
    const diameterAt50 = await page.evaluate(
      (index) => window.__CRYSTAL_DEBUG__.getAtomScreenDiameter(index),
      centerIndex,
    );
    const cameraBeforeRadius = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCamera().distance);
    await page.locator('#display-radius').evaluate((element) => {
      element.value = '100';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page, 350);
    const radius100 = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      display: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
      diameter: window.__CRYSTAL_DEBUG__.getAtomScreenDiameter(window.__CRYSTAL_DEBUG__.getDisplayInfo().shellCenterIndex),
      camera: window.__CRYSTAL_DEBUG__.getCamera().distance,
    }));
    record(
      '显示半径 100% 恢复相切（r=1，像素直径变大）',
      Math.abs(radius100.state.atomDisplayRadius - 1) < 1e-9 &&
        radius100.diameter > diameterAt50 * 1.7,
      `${diameterAt50.toFixed(1)} → ${radius100.diameter.toFixed(1)} px`,
    );
    record(
      '半径滑杆不自动 fit 相机',
      Math.abs(radius100.camera - cameraBeforeRadius) < 0.01,
      `${cameraBeforeRadius.toFixed(3)} → ${radius100.camera.toFixed(3)}`,
    );
    await page.locator('#display-radius').evaluate((element) => {
      element.value = '50';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page, 350);
    const radius50 = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      diameter: window.__CRYSTAL_DEBUG__.getAtomScreenDiameter(window.__CRYSTAL_DEBUG__.getDisplayInfo().shellCenterIndex),
    }));
    record(
      '显示半径 50% 明显变小',
      Math.abs(radius50.state.atomDisplayRadius - 0.5) < 1e-9 &&
        radius50.diameter < radius100.diameter * 0.6,
      `100% ${radius100.diameter.toFixed(1)} → 50% ${radius50.diameter.toFixed(1)} px`,
    );
    const cameraBeforeHardSphere = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCamera().distance);
    await page.locator('#display-radius-reset').click();
    await settle(page, 600);
    const afterHardSphere = await page.evaluate(() => ({
      radius: window.__CRYSTAL_DEBUG__.getState().atomDisplayRadius,
      camera: window.__CRYSTAL_DEBUG__.getCamera().distance,
    }));
    record(
      '“相切硬球 100%”按钮生效',
      Math.abs(afterHardSphere.radius - 1) < 1e-9,
      String(afterHardSphere.radius),
    );
    record(
      '“相切硬球 100%”按钮自动 fit',
      Math.abs(afterHardSphere.camera - cameraBeforeHardSphere) > 0.1,
      `${cameraBeforeHardSphere.toFixed(3)} → ${afterHardSphere.camera.toFixed(3)}`,
    );

    // range slider: counts come from real atom.radial thresholds
    const cameraBeforeRange = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCamera().distance);
    await page.locator('#display-range').evaluate((element) => {
      element.value = '100';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page, 350);
    const range100 = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      display: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
      uiVisible: document.querySelector('#display-visible-count')?.textContent,
      camera: window.__CRYSTAL_DEBUG__.getCamera().distance,
    }));
    record(
      '显示范围 100% 显示全部 63 原子',
      range100.state.displayMode === 'range' &&
        range100.display.visibleAtomCount === 63 &&
        range100.uiVisible === '63',
      `${range100.display.visibleAtomCount} · UI ${range100.uiVisible}`,
    );
    record(
      '范围滑杆不自动 fit 相机',
      Math.abs(range100.camera - cameraBeforeRange) < 0.01,
      `${cameraBeforeRange.toFixed(3)} → ${range100.camera.toFixed(3)}`,
    );
    await page.locator('#display-range').evaluate((element) => {
      element.value = '40';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page, 350);
    const range40 = await page.evaluate(() => ({
      display: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
      uiVisible: document.querySelector('#display-visible-count')?.textContent,
    }));
    record(
      '显示范围 40% 只剩中心原子，其余转原子透视',
      range40.display.visibleAtomCount === 1 &&
        range40.uiVisible === '1' &&
        range40.display.xrayAtomIndices.length === 62 &&
        range40.display.hiddenAtomIndices.length === 0,
      `${range40.display.visibleAtomCount} · UI ${range40.uiVisible} · xray ${range40.display.xrayAtomIndices.length}`,
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setAutoRotate(false));
    await settle(page, 250);
    // Return to the shipped 0.50r / 100% defaults before capturing "show all".
    await page.locator('#display-reset-btn').click();
    await settle(page, 350);
    await page.locator('#display-all-btn').click();
    await settle(page, 900);
    const allAtoms = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const canvas = document.getElementById('crystal-canvas').getBoundingClientRect();
      const rail = document.querySelector('.status-rail')?.getBoundingClientRect();
      return {
        state: debug.getState(),
        display: debug.getDisplayInfo(),
        camera: debug.getCamera().distance,
        extents: debug.getVisibleAtomScreenExtents(),
        safe: {
          left: canvas.left + 6,
          right: canvas.right - 6,
          top: canvas.top + 6,
          bottom: Math.min(canvas.bottom, rail ? rail.top : canvas.bottom) - 6,
        },
      };
    });
    record(
      '“显示全部”按钮切到 all 模式且范围滑杆到 100%',
      allAtoms.state.displayMode === 'all' &&
        Math.abs(allAtoms.state.displayRange - 1) < 1e-9 &&
        allAtoms.display.visibleAtomCount === 63,
      JSON.stringify({
        mode: allAtoms.state.displayMode,
        range: allAtoms.state.displayRange,
        count: allAtoms.display.visibleAtomCount,
      }),
    );
    // 自动 fit 应与显式 fitView() 收敛到同一相机距离（同一取景公式）。
    const refitDistance = await page.evaluate(async () => {
      const debug = window.__CRYSTAL_DEBUG__;
      debug.fitView();
      await new Promise((resolve) => setTimeout(resolve, 650));
      return debug.getCamera().distance;
    });
    record(
      '“显示全部”自动 fit 与显式适应视图一致',
      Math.abs(allAtoms.camera - refitDistance) < 0.05,
      `${allAtoms.camera.toFixed(3)} vs refit ${refitDistance.toFixed(3)}`,
    );
    const allOutside = allAtoms.extents.filter(
      (entry) =>
        entry.left < allAtoms.safe.left - 0.5 ||
        entry.right > allAtoms.safe.right + 0.5 ||
        entry.top < allAtoms.safe.top - 0.5 ||
        entry.bottom > allAtoms.safe.bottom + 0.5,
    );
    record(
      '“显示全部”全部可见原子（中心+半径）在 canvas 安全区内',
      allAtoms.extents.length === 63 && allOutside.length === 0,
      allOutside.length === 0
        ? `63 球 · safe ${Math.round(allAtoms.safe.left)}/${Math.round(allAtoms.safe.top)}/${Math.round(allAtoms.safe.right)}/${Math.round(allAtoms.safe.bottom)}`
        : `${allOutside.length} 出轨 · 首个 #${allOutside[0].index} ${JSON.stringify(allOutside[0])}`,
    );
    // Let the action toast expire so the bottom atom is not covered in the artifact.
    await page.waitForTimeout(1900);
    await page.screenshot({ path: path.join(ARTIFACTS, 'display-all-fcc.png') });
    // Same-button toggle: pressing the active preset again returns to range mode.
    await page.locator('#display-all-btn').click();
    await settle(page, 600);
    const allOff = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      button: document.querySelector('#display-all-btn')?.textContent ?? '',
      toast: document.querySelector('#toast-text')?.textContent ?? '',
    }));
    record(
      '“显示全部”同键开关：再次点击回到范围模式',
      allOff.state.displayMode === 'range' &&
        allOff.toast.includes('回到范围显示') &&
        allOff.button.includes('显示全部'),
      `${allOff.state.displayMode} · ${allOff.toast} · ${allOff.button}`,
    );
    await page.locator('#display-all-btn').click();
    await settle(page, 700);
    await page.locator('#display-reset-btn').click();
    await settle(page, 400);

    // coordination-shell button must be 13 for FCC and 9 for BCC
    const cameraBeforeShell = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCamera().distance);
    await page.locator('#display-shell-btn').click();
    await settle(page, 900);
    const shellFcc = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const canvas = document.getElementById('crystal-canvas').getBoundingClientRect();
      const rail = document.querySelector('.status-rail')?.getBoundingClientRect();
      return {
        state: debug.getState(),
        display: debug.getDisplayInfo(),
        camera: debug.getCamera().distance,
        button: document.querySelector('#display-shell-btn')?.textContent,
        extents: debug.getVisibleAtomScreenExtents(),
        safe: {
          left: canvas.left + 6,
          right: canvas.right - 6,
          top: canvas.top + 6,
          bottom: Math.min(canvas.bottom, rail ? rail.top : canvas.bottom) - 6,
        },
      };
    });
    record(
      'FCC 配位壳：13 球 / CN 12',
      shellFcc.state.displayMode === 'shell' &&
        shellFcc.display.visibleAtomCount === 13 &&
        shellFcc.display.shellCoordination === 12 &&
        shellFcc.button?.includes('CN 12'),
      JSON.stringify({
        mode: shellFcc.state.displayMode,
        count: shellFcc.display.visibleAtomCount,
        cn: shellFcc.display.shellCoordination,
      }),
    );
    record(
      'FCC 配位壳自动 fit 收紧构图',
      shellFcc.camera < cameraBeforeShell - 0.5,
      `${cameraBeforeShell.toFixed(3)} → ${shellFcc.camera.toFixed(3)}`,
    );
    const shellOutside = shellFcc.extents.filter(
      (entry) =>
        entry.left < shellFcc.safe.left - 0.5 ||
        entry.right > shellFcc.safe.right + 0.5 ||
        entry.top < shellFcc.safe.top - 0.5 ||
        entry.bottom > shellFcc.safe.bottom + 0.5,
    );
    record(
      'FCC 配位壳 13 球（中心+半径）在 canvas 安全区内',
      shellFcc.extents.length === 13 && shellOutside.length === 0,
      shellOutside.length === 0
        ? `13 球 · safe ${Math.round(shellFcc.safe.left)}/${Math.round(shellFcc.safe.top)}/${Math.round(shellFcc.safe.right)}/${Math.round(shellFcc.safe.bottom)}`
        : `${shellOutside.length} 出轨 · 首个 #${shellOutside[0].index} ${JSON.stringify(shellOutside[0])}`,
    );
    const shellFccVisual = await page.evaluate(() => ({
      visual: window.__CRYSTAL_DEBUG__.getShellVisualInfo(),
      ring: window.__CRYSTAL_DEBUG__.getShellRingInfo(),
      labels: Array.from(document.querySelectorAll('.scene-label-text')).map(
        (node) => node.textContent ?? '',
      ),
      display: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
    }));
    record(
      'FCC 配位壳：中心目标环 + “中心 · CN 12” + 12 顶点 cuboctahedron',
      shellFccVisual.ring.visible === true &&
        shellFccVisual.ring.index === shellFccVisual.display.shellCenterIndex &&
        Math.abs(shellFccVisual.ring.scale - 2.4 * 0.5) < 1e-6 &&
        shellFccVisual.labels.some((text) => text.includes('中心') && text.includes('CN 12')) &&
        shellFccVisual.visual.shape === 'cuboctahedron' &&
        shellFccVisual.visual.vertexCount === 12 &&
        shellFccVisual.visual.edgeCount === 24 &&
        shellFccVisual.visual.includesCentre === false,
      JSON.stringify(shellFccVisual),
    );
    await page.screenshot({ path: path.join(ARTIFACTS, 'display-shell-fcc.png') });

    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setStructure('bcc'));
    await settle(page, 950);
    const shellBcc = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      display: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
      button: document.querySelector('#display-shell-btn')?.textContent,
      cn: document.querySelector('#data-cn')?.textContent,
      note: document.querySelector('#display-cn-note')?.textContent,
    }));
    record(
      'BCC 配位壳：9 球 / CN 8，面板不凑 12',
      shellBcc.state.displayMode === 'shell' &&
        shellBcc.display.visibleAtomCount === 9 &&
        shellBcc.display.shellCoordination === 8 &&
        shellBcc.button?.includes('CN 8') &&
        shellBcc.cn === '8' &&
        shellBcc.note?.includes('真实 CN = 8'),
      JSON.stringify(shellBcc),
    );
    const shellBccVisual = await page.evaluate(() => ({
      visual: window.__CRYSTAL_DEBUG__.getShellVisualInfo(),
      ring: window.__CRYSTAL_DEBUG__.getShellRingInfo(),
      labels: Array.from(document.querySelectorAll('.scene-label-text')).map(
        (node) => node.textContent ?? '',
      ),
      noteSize: getComputedStyle(document.querySelector('#display-cn-note')).fontSize,
      noteBorder: getComputedStyle(document.querySelector('#display-cn-note')).borderLeftWidth,
    }));
    record(
      'BCC 配位壳是 cube（8 顶点 / 12 边），不是 12 顶点多面体',
      shellBccVisual.visual.shape === 'cube' &&
        shellBccVisual.visual.vertexCount === 8 &&
        shellBccVisual.visual.edgeCount === 12 &&
        shellBccVisual.visual.includesCentre === false &&
        shellBccVisual.ring.visible === true &&
        shellBccVisual.labels.some((text) => text.includes('中心') && text.includes('CN 8')),
      JSON.stringify(shellBccVisual),
    );
    record(
      'BCC CN 说明 10px + 左侧竖线',
      shellBccVisual.noteSize === '10px' && parseFloat(shellBccVisual.noteBorder) >= 2,
      `font ${shellBccVisual.noteSize} · border ${shellBccVisual.noteBorder}`,
    );
    await page.screenshot({ path: path.join(ARTIFACTS, 'display-shell-bcc.png') });

    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setStructure('hcp'));
    await settle(page, 950);
    const shellHcp = await page.evaluate(() => ({
      display: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
      visual: window.__CRYSTAL_DEBUG__.getShellVisualInfo(),
      ring: window.__CRYSTAL_DEBUG__.getShellRingInfo(),
      button: document.querySelector('#display-shell-btn')?.textContent,
      labels: Array.from(document.querySelectorAll('.scene-label-text')).map(
        (node) => node.textContent ?? '',
      ),
    }));
    record(
      'HCP 配位壳：13 球 / CN 12 / anticuboctahedron',
      shellHcp.display.visibleAtomCount === 13 &&
        shellHcp.display.shellCoordination === 12 &&
        shellHcp.button?.includes('CN 12') &&
        shellHcp.visual.shape === 'anticuboctahedron' &&
        shellHcp.visual.vertexCount === 12 &&
        shellHcp.visual.edgeCount === 24 &&
        shellHcp.visual.includesCentre === false &&
        shellHcp.ring.visible === true &&
        shellHcp.labels.some((text) => text.includes('中心') && text.includes('CN 12')),
      JSON.stringify(shellHcp),
    );
    await page.screenshot({ path: path.join(ARTIFACTS, 'display-shell-hcp.png') });
    // Same-button toggle: pressing the active shell preset closes it.
    await page.locator('#display-shell-btn').click();
    await settle(page, 700);
    const shellOff = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      button: document.querySelector('#display-shell-btn')?.textContent ?? '',
      toast: document.querySelector('#toast-text')?.textContent ?? '',
    }));
    record(
      '配位壳同键开关：再次点击关闭并回到范围模式',
      shellOff.state.displayMode === 'range' &&
        shellOff.button.includes('配位壳') &&
        shellOff.button.includes('CN 12'),
      `${shellOff.state.displayMode} · ${shellOff.button}`,
    );

    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setStructure('fcc'));
    await settle(page, 950);
    await page.locator('#display-reset-btn').click();
    await settle(page, 400);

    await page.locator('#export-btn').click();
    await settle(page, 300);
    const dialogOpen = await page.locator('#export-dialog').evaluate((element) => element.open);
    const exportUi = await page.evaluate(() => ({
      startEnabled: !document.querySelector('#export-start')?.hasAttribute('disabled'),
      size: document.querySelector('#export-size')?.value,
      frames: document.querySelector('#export-frames-estimate')?.textContent,
      intro: document.querySelector('#export-intro')?.textContent ?? '',
      transparent: document.querySelector('#export-bg-transparent')?.checked,
      gifNoteHidden: document.querySelector('#export-gif-note')?.hasAttribute('hidden'),
    }));
    record(
      '导出弹窗可用：WebP / 1080 / 3s / 30fps / 透明',
      dialogOpen &&
        exportUi.startEnabled &&
        exportUi.size === '1080' &&
        exportUi.frames === '90' &&
        exportUi.transparent === true &&
        exportUi.gifNoteHidden === true,
      `size ${exportUi.size}, frames ${exportUi.frames}`,
    );
    record(
      '导出说明明确只包含 WebGL 场景',
      exportUi.intro.includes('WebGL') && exportUi.intro.includes('选中目标环'),
    );
    await page.locator('#export-cancel').click();
    await settle(page, 250);

    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setAutoRotate(false));
    await settle(page, 350);

    // --- scale / framing across structures -------------------------
    const structureReports = [];
    for (const id of ['fcc', 'bcc', 'hcp']) {
      await page.evaluate((structure) => window.__CRYSTAL_DEBUG__.setStructure(structure), id);
      await settle(page, 950);
      const data = await page.evaluate(() => {
        const debug = window.__CRYSTAL_DEBUG__;
        const rail = document.querySelector('.status-rail')?.getBoundingClientRect();
        const canvas = document.getElementById('crystal-canvas')?.getBoundingClientRect();
        return {
          scale: debug.getScaleReference(),
          camera: debug.getCamera().distance,
          bounds: debug.getModelScreenBounds(),
          cell: debug.getCellInfo(),
          state: debug.getState(),
          display: debug.getDisplayInfo(),
          railTop: rail ? rail.top : null,
          canvas: canvas
            ? { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom }
            : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      });
      structureReports.push({ id, ...data });
      await page.screenshot({ path: path.join(ARTIFACTS, `${id}.png`) });
    }

    record(
      '三种结构默认 0.50r 缩球且范围 100% 显示全部原子',
      structureReports.every(
        (entry) =>
          entry.display.visibleAtomCount === entry.display.totalAtomCount &&
          entry.display.xrayAtomIndices.length === 0 &&
          Math.abs(entry.display.displayRadius - 0.5) < 1e-9 &&
          Math.abs(entry.state.displayRange - 1) < 1e-9,
      ),
      structureReports
        .map(
          (entry) =>
            `${entry.id}:${entry.display.visibleAtomCount}/${entry.display.totalAtomCount}`,
        )
        .join(' '),
    );
    const defaultCounts = Object.fromEntries(
      structureReports.map((entry) => [entry.id, entry.display.visibleAtomCount]),
    );
    const defaultTotals = Object.fromEntries(
      structureReports.map((entry) => [entry.id, entry.display.totalAtomCount]),
    );
    record(
      '默认可见数与团簇原子总数一致（FCC 63 / BCC 35 / HCP 57）',
      defaultCounts.fcc === defaultTotals.fcc &&
        defaultCounts.bcc === defaultTotals.bcc &&
        defaultCounts.hcp === defaultTotals.hcp &&
        defaultCounts.fcc === 63 &&
        defaultCounts.bcc === 35 &&
        defaultCounts.hcp === 57,
      JSON.stringify({ counts: defaultCounts, totals: defaultTotals }),
    );
    // 100% 显示范围下每种结构按自身取景半径 fit，像素/世界单位的比例必然不同；
    // 真正该一致的是「相机距离 / 取景半径」这一 fit 公式的比值。
    const fitRatios = structureReports.map((entry) => entry.camera / entry.display.fitRadius);
    record(
      '三种结构共用同一 fit 公式（相机距离 / 取景半径一致）',
      Math.max(...fitRatios) - Math.min(...fitRatios) < 0.02,
      fitRatios.map((value) => value.toFixed(4)).join(' / '),
    );
    for (const entry of structureReports) {
      const b = entry.bounds;
      const c = entry.canvas;
      const inside =
        Boolean(b && c) &&
        b.left >= c.left - 2 &&
        b.right <= c.right + 2 &&
        b.top >= c.top - 2 &&
        b.bottom <= c.bottom + 2;
      const clearsRail = Boolean(b && entry.railTop !== null) && b.bottom <= entry.railTop - 4;
      record(
        `${entry.id.toUpperCase()} 模型 bbox 在 canvas 内且不被 rail 遮挡`,
        inside && clearsRail,
        b
          ? `bottom ${b.bottom.toFixed(0)} / rail ${entry.railTop?.toFixed(0) ?? '—'}, width ${b.width.toFixed(0)}`
          : 'missing',
      );
      record(
        `${entry.id.toUpperCase()} 默认线框 2.8px+ / 双描边 / depthTest=true`,
        entry.cell.lineWidth >= 2.8 &&
          entry.cell.glow >= 0.18 &&
          entry.cell.glow <= 0.25 &&
          entry.cell.coreColor === '#2F6B82' &&
          entry.cell.haloColor === '#D8F3FF' &&
          entry.cell.depthTest === true &&
          entry.cell.xray === false &&
          entry.cell.dashed === true,
        JSON.stringify(entry.cell),
      );
      // 缩球后 fit 半径包含原子球面（cell + displayRadius），但仍须小于含角标的包围半径，
      // 说明角标没有把视图撑大。
      const excludesCorners =
        entry.id === 'hcp'
          ? entry.cell.cornerMarks === 0
          : entry.display.fitRadius < entry.display.cellCornerBoundsRadius - 1e-3 &&
            entry.display.cellBoundsRadius < entry.display.cellCornerBoundsRadius;
      record(
        `${entry.id.toUpperCase()} 角标跟随缩球且不撑大 fitBounds`,
        entry.cell.cornerSurfaceGap < 0.12 && excludesCorners,
        `gap ${entry.cell.cornerSurfaceGap.toFixed(4)} · fit ${entry.display.fitRadius.toFixed(3)} / cell ${entry.display.cellBoundsRadius.toFixed(3)} / corner ${entry.display.cellCornerBoundsRadius.toFixed(3)} · marks ${entry.cell.cornerMarks}`,
      );
    }
    record(
      '缩球后三种结构晶胞线框仍开启且 depth-tested（无线切球回归）',
      structureReports.every(
        (entry) => entry.state.showCell === true && entry.cell.depthTest === true && entry.cell.xray === false,
      ),
      structureReports.map((entry) => `${entry.id}:depth=${entry.cell.depthTest}`).join(' '),
    );

    // --- HCP translation / symmetry / cell anchor -----------------
    const hcpStats = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getVisibleAtomStats());
    const hcpShells = Object.entries(hcpStats.shells)
      .map(([distance, count]) => [Number(distance), count])
      .sort((a, b) => a[0] - b[0]);
    // 100% 显示范围下 HCP 团簇 57 原子全部为实心，壳层随距离对称展开。
    const expectedShells = [
      [0, 1],
      [2, 12],
      [Math.sqrt(8), 6],
      [Math.sqrt(12), 18],
      [4, 6],
      [Math.sqrt(20), 8],
      [Math.sqrt(24), 2],
      [Math.sqrt(28), 4],
    ];
    record(
      'HCP 默认 57 原子 = 1 + 12 + 6 + 18 + 6 + 8 + 2 + 4 对称壳层',
      hcpStats.count === 57 &&
        hcpShells.length === expectedShells.length &&
        expectedShells.every(
          ([distance, count], index) =>
            Math.abs(hcpShells[index][0] - distance) < 1e-3 && hcpShells[index][1] === count,
        ),
      JSON.stringify(hcpShells),
    );
    record(
      'HCP 三层各 19 原子，中心原子在原点',
      hcpStats.layers['0'] === 19 &&
        hcpStats.layers['1'] === 19 &&
        hcpStats.layers['2'] === 19 &&
        hcpStats.centerDistance < 1e-9,
      JSON.stringify({ layers: hcpStats.layers, centerDistance: hcpStats.centerDistance }),
    );
    // The prism is built from lattice vectors anchored on the bottom A layer, so
    // its axis runs through an A atom column (not through the B shell centre).
    const hcpC = 2 * Math.sqrt(8 / 3);
    const hcpInPlane = 2 / Math.sqrt(3);
    const hcpAnchor = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCellAnchorInfo());
    record(
      'HCP 六方棱柱锚点 = 底层 A 原子列（轴过 A 原子，高 c）',
      hcpAnchor.matchesShellCenter === false &&
        hcpAnchor.anchorKind === 'A' &&
        hcpAnchor.anchorLayer === 0 &&
        hcpAnchor.anchorAtomIndex >= 0 &&
        Math.abs(hcpAnchor.anchor[2] + hcpC / 2) < 1e-6 &&
        Math.abs(Math.hypot(hcpAnchor.anchor[0], hcpAnchor.anchor[1]) - hcpInPlane) < 1e-6,
      JSON.stringify(hcpAnchor),
    );

    await page.locator('#display-all-btn').click();
    await settle(page, 900);
    const hcpAll = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const canvas = document.getElementById('crystal-canvas').getBoundingClientRect();
      const rail = document.querySelector('.status-rail')?.getBoundingClientRect();
      return {
        display: debug.getDisplayInfo(),
        extents: debug.getVisibleAtomScreenExtents(),
        safe: {
          left: canvas.left + 6,
          right: canvas.right - 6,
          top: canvas.top + 6,
          bottom: Math.min(canvas.bottom, rail ? rail.top : canvas.bottom) - 6,
        },
      };
    });
    const hcpOutside = hcpAll.extents.filter(
      (entry) =>
        entry.left < hcpAll.safe.left - 0.5 ||
        entry.right > hcpAll.safe.right + 0.5 ||
        entry.top < hcpAll.safe.top - 0.5 ||
        entry.bottom > hcpAll.safe.bottom + 0.5,
    );
    record(
      'HCP “显示全部”57 球中心+半径也在 canvas 安全区内',
      hcpAll.display.visibleAtomCount === 57 &&
        hcpAll.extents.length === 57 &&
        hcpOutside.length === 0,
      hcpOutside.length === 0
        ? `57 球 · safe ${Math.round(hcpAll.safe.left)}/${Math.round(hcpAll.safe.top)}/${Math.round(hcpAll.safe.right)}/${Math.round(hcpAll.safe.bottom)}`
        : `${hcpOutside.length} 出轨 · 首个 #${hcpOutside[0].index}`,
    );
    await page.locator('#display-reset-btn').click();
    await settle(page, 450);

    // Corner ticks must only appear when the corner atom is actually visible.
    await page.evaluate(() => {
      window.__CRYSTAL_DEBUG__.setStructure('fcc');
      window.__CRYSTAL_DEBUG__.resetDisplay();
      window.__CRYSTAL_DEBUG__.setDisplay({ range: 1 });
    });
    await settle(page, 900);
    const cornersVisible = await page.evaluate(() => ({
      cell: window.__CRYSTAL_DEBUG__.getCellInfo(),
      display: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
    }));
    record(
      '角标只在可见角原子处出现（全显示时 8 组，贴球面 <0.12）',
      cornersVisible.cell.cornerMarks === 8 &&
        cornersVisible.cell.cornerSurfaceGap < 0.12 &&
        cornersVisible.display.fitRadius >= cornersVisible.display.cellBoundsRadius,
      `marks ${cornersVisible.cell.cornerMarks} · gap ${cornersVisible.cell.cornerSurfaceGap.toFixed(4)}`,
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.resetDisplay());
    await settle(page, 500);

    // --- HCP / BCC annotations -------------------------------------
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setStructure('bcc'));
    await settle(page, 900);
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.showInterstitials(true));
    await settle(page, 800);
    const bccNote = await page.locator('#site-note').textContent();
    record(
      'BCC 间隙说明标注扁八面体 2 近 + 4 远',
      Boolean(bccNote?.includes('扁八面体') && bccNote?.includes('2 近') && bccNote?.includes('4 远')),
      bccNote ?? '',
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.showInterstitials(false));
    await settle(page, 350);

    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setStructure('hcp'));
    await settle(page, 900);
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.showInterstitials(true));
    await settle(page, 700);
    const hcpNote = await page.locator('#site-note').textContent();
    record(
      'HCP 间隙说明区分六方棱柱与原胞计数',
      Boolean(hcpNote?.includes('六方棱柱') && hcpNote?.includes('原胞')),
      hcpNote ?? '',
    );
    const hcpCellNote = await page.locator('#data-cellnote').textContent();
    record(
      'HCP 结构说明标注 A 层 / B 层六方棱柱',
      Boolean(
        hcpCellNote?.includes('A 层') &&
          hcpCellNote?.includes('B 层') &&
          hcpCellNote?.includes('棱柱'),
      ),
      hcpCellNote ?? '',
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.showInterstitials(false));
    await settle(page, 350);

    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setStructure('fcc'));
    await settle(page, 900);

    // --- auto rotation ---------------------------------------------
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setAutoRotate(true));
    await settle(page, 500);
    const hashA = sha(await page.screenshot());
    await page.waitForTimeout(1100);
    const hashB = sha(await page.screenshot());
    record('自动旋转 1s 前后截图 hash 不同', hashA !== hashB, `${hashA.slice(0, 10)} → ${hashB.slice(0, 10)}`);
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setAutoRotate(false));
    await settle(page, 300);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    const autoBeforeSpace = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState().autoRotate);
    await page.keyboard.press('Space');
    await settle(page, 250);
    const autoAfterSpace = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState().autoRotate);
    record('Space 切换自动旋转', autoBeforeSpace !== autoAfterSpace, `${autoBeforeSpace} → ${autoAfterSpace}`);
    await page.keyboard.press('Space');
    await settle(page, 250);

    // --- drag ------------------------------------------------------
    const beforeCamera = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCamera());
    const stageBox = await page.locator('#stage').boundingBox();
    if (!stageBox) throw new Error('stage missing');
    const cx = stageBox.x + stageBox.width * 0.56;
    const cy = stageBox.y + stageBox.height * 0.45;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 130, cy + 45, { steps: 12 });
    await page.mouse.up();
    await settle(page, 900);
    const afterCamera = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCamera());
    const moved = Math.hypot(
      afterCamera.position[0] - beforeCamera.position[0],
      afterCamera.position[1] - beforeCamera.position[1],
      afterCamera.position[2] - beforeCamera.position[2],
    );
    record('鼠标拖动后相机位置变化', moved > 0.2, `Δ = ${moved.toFixed(2)}`);

    await page.evaluate(() => window.__CRYSTAL_DEBUG__.resetView());
    await settle(page, 800);

    // --- keyboard focus moves to the active card --------------------
    await page.keyboard.press('2');
    await settle(page, 800);
    const focusedCard = await page.evaluate(() => document.activeElement?.getAttribute('data-structure'));
    record('键盘切换后焦点在当前结构卡', focusedCard === 'bcc', String(focusedCard));
    await page.keyboard.press('1');
    await settle(page, 800);

    // --- hidden atoms must not be pickable -------------------------
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.__CRYSTAL_DEBUG__.setStructure('fcc');
      window.__CRYSTAL_DEBUG__.resetDisplay();
      window.__CRYSTAL_DEBUG__.setEditMode(true);
    });
    await settle(page, 800);
    // 新显示模型下缩小范围不再产生「隐藏」原子（改为原子透视），所以这里
    // 显式隐藏几个画面中部的原子，用来回归「隐藏原子不参与拾取」。
    const preHiddenIds = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const display = debug.getDisplayInfo();
      const hidden = [];
      for (let i = 0; i < display.totalAtomCount && hidden.length < 6; i++) {
        if (!debug.isAtomVisible(i)) continue;
        const point = debug.getAtomScreenPosition(i);
        if (!point || !point.inView) continue;
        if (point.x < 320 || point.y < 280) continue;
        if (!debug.selectAtomByIndex(i)) continue;
        const id = debug.getSelectedAtomIds()[0];
        debug.clearSelection();
        if (!id) continue;
        debug.setAtomHidden([id], true);
        hidden.push(id);
      }
      return hidden;
    });
    await settle(page, 450);
    const hiddenTarget = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const display = debug.getDisplayInfo();
      const canvas = document.getElementById('crystal-canvas')?.getBoundingClientRect();
      const rail = document.querySelector('.status-rail')?.getBoundingClientRect();
      if (!canvas) return null;
      const visiblePoints = [];
      for (let i = 0; i < display.totalAtomCount; i++) {
        if (!debug.isAtomVisible(i)) continue;
        const point = debug.getAtomScreenPosition(i);
        if (point && point.inView) visiblePoints.push(point);
      }
      for (const index of display.hiddenAtomIndices) {
        const point = debug.getAtomScreenPosition(index);
        if (
          !point ||
          !point.inView ||
          point.x < canvas.left + 100 ||
          point.x > canvas.right - 80 ||
          point.y < canvas.top + 160 ||
          point.y > (rail ? rail.top : canvas.bottom) - 60
        ) {
          continue;
        }
        let minDistance = Infinity;
        for (const visible of visiblePoints) {
          minDistance = Math.min(minDistance, Math.hypot(point.x - visible.x, point.y - visible.y));
        }
        if (minDistance > 34) return { index, ...point, minDistance };
      }
      return null;
    });
    record(
      '找到投影在空白处且已隐藏的原子',
      Boolean(hiddenTarget),
      hiddenTarget
        ? `index ${hiddenTarget.index} · nearest visible ${hiddenTarget.minDistance.toFixed(0)} px`
        : 'none',
    );
    if (hiddenTarget) {
      await page.mouse.click(hiddenTarget.x, hiddenTarget.y);
      await settle(page, 500);
      const hiddenSelection = await page.evaluate(
        (index) => ({
          selected: window.__CRYSTAL_DEBUG__.getState().selectedAtomId,
          visible: window.__CRYSTAL_DEBUG__.isAtomVisible(index),
        }),
        hiddenTarget.index,
      );
      record(
        '点击隐藏原子不会选中',
        hiddenSelection.selected === null && hiddenSelection.visible === false,
        JSON.stringify(hiddenSelection),
      );
    }
    // 还原上面为测试而隐藏的原子，避免影响后续逐球编辑用例。
    await page.evaluate((ids) => window.__CRYSTAL_DEBUG__.setAtomHidden(ids, false), preHiddenIds);
    await settle(page, 400);

    // --- per-atom editing ------------------------------------------
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setEditMode(true));
    const atomPoint = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const canvas = document.getElementById('crystal-canvas');
      const rail = document.querySelector('.status-rail');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const railTop = rail ? rail.getBoundingClientRect().top : rect.bottom;
      for (let i = 0; i < 80; i++) {
        if (!debug.isAtomVisible(i)) continue;
        const point = debug.getAtomScreenPosition(i);
        if (
          point &&
          point.inView &&
          point.x > rect.left + 380 &&
          point.x < rect.right - 80 &&
          point.y > rect.top + 170 &&
          point.y < railTop - 40
        ) {
          return { index: i, ...point };
        }
      }
      return null;
    });
    record('找到可点击的投影原子', Boolean(atomPoint), atomPoint ? `index ${atomPoint.index}` : 'none');

    if (atomPoint) {
      await page.mouse.click(atomPoint.x, atomPoint.y);
      await settle(page, 500);
      const selected = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState().selectedAtomId);
      const inspectorVisible = await page.locator('#atom-content').isVisible();
      const editRadius = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState().atomDisplayRadius);
      record(
        '缩球状态下点击原子仍可选中且检查器出现',
        Boolean(selected) && inspectorVisible && Math.abs(editRadius - 0.5) < 1e-9,
        `${selected ?? 'null'} · radius ${editRadius}`,
      );
      const selectionInfo = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getSelectionInfo());
      record(
        '选中提示为目标环且无 icosahedron cage',
        selectionInfo.mode === 'target-ring' && selectionInfo.hasCage === false,
        JSON.stringify(selectionInfo),
      );
      const labelText = await page.evaluate(
        () => document.querySelector('.scene-label-text')?.textContent ?? '',
      );
      record('选中标签为一行短文本', Boolean(labelText) && !labelText.includes('\n'), labelText);

      if (selected) {
        await page.locator('#atom-color').evaluate((element) => {
          const input = element;
          input.value = '#e06a3a';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(page, 300);
        const applied = await page.evaluate(
          (id) => window.__CRYSTAL_DEBUG__.getState().atomColors[id] ?? null,
          selected,
        );
        record('逐球改色写入状态', applied === '#E06A3A', String(applied));

        await page.mouse.move(atomPoint.x, atomPoint.y);
        await settle(page, 300);
        record('悬停显示 HTML tooltip', !(await page.locator('#tooltip').isHidden()));
        const tooltipBox = await page.locator('#tooltip').boundingBox();
        const railBox = await page.locator('.status-rail').boundingBox();
        record(
          'hover tooltip 不压底部 rail',
          Boolean(tooltipBox && railBox) && tooltipBox.y + tooltipBox.height <= railBox.y + 1,
          tooltipBox && railBox ? `tooltip bottom ${(tooltipBox.y + tooltipBox.height).toFixed(0)} / rail ${railBox.y.toFixed(0)}` : 'missing',
        );
        await scrollPanelTo(page, '.psec[data-section="edit"]', 4);
        await settle(page, 400);
        await page.screenshot({ path: path.join(ARTIFACTS, 'edit-mode.png') });

        await page.mouse.move(stageBox.x + 30, stageBox.y + 30);
        await settle(page, 350);
        const restoredLabelBox = await page.locator('.scene-label').first().boundingBox();
        record(
          '悬停结束后单行标签恢复且尺寸可测量',
          Boolean(restoredLabelBox && restoredLabelBox.width > 0 && restoredLabelBox.height < 40),
          restoredLabelBox ? `${restoredLabelBox.width.toFixed(0)}×${restoredLabelBox.height.toFixed(0)}` : 'missing',
        );

        await page.locator('#atom-restore').click();
        await settle(page, 300);
        const restored = await page.evaluate(
          (id) => window.__CRYSTAL_DEBUG__.getState().atomColors[id] ?? null,
          selected,
        );
        record('恢复此球默认生效', restored === null, String(restored));

        await page.locator('#display-range').evaluate((element) => {
          element.value = '40';
          element.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(page, 450);
        const hiddenAfterRange = await page.evaluate(
          (index) => {
            const debug = window.__CRYSTAL_DEBUG__;
            const display = debug.getDisplayInfo();
            return {
              selected: debug.getState().selectedAtomId,
              solid: debug.isAtomVisible(index),
              xray: display.xrayAtomIndices.includes(index),
              hidden: display.hiddenAtomIndices.includes(index),
              atomContentHidden: document.querySelector('#atom-content')?.hasAttribute('hidden'),
            };
          },
          atomPoint.index,
        );
        // 新语义：超出显示范围的球不消失，而是转为「原子透视」，选中状态与检查器保留。
        record(
          '选中原子超出范围后转为原子透视且保持选中',
          hiddenAfterRange.selected !== null &&
            hiddenAfterRange.solid === false &&
            hiddenAfterRange.xray === true &&
            hiddenAfterRange.hidden === false &&
            hiddenAfterRange.atomContentHidden === false,
          JSON.stringify(hiddenAfterRange),
        );
        await page.locator('#display-reset-btn').click();
        await settle(page, 400);
      }
    }

    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setEditMode(false));
    await settle(page, 400);

    // --- interstitials: curated default state ----------------------
    await page.evaluate(() => {
      window.__CRYSTAL_DEBUG__.setStructure('fcc');
      window.__CRYSTAL_DEBUG__.showInterstitials(true);
    });
    await settle(page, 900);
    // The body expansion only advances while frames are produced; under load a
    // fixed wait can land on the first frame of the 0fr -> 1fr transition.
    // Poll for the settled layout instead of assuming a wall-clock cadence.
    await page
      .waitForFunction(
        () => {
          const scroller = document.querySelector('.panel-scroll');
          const section = document.querySelector('.psec[data-section="sites"]');
          const body = section ? section.querySelector('.ps-body') : null;
          if (!scroller || !section || !body) return false;
          const sectionTop =
            section.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          return (
            section.classList.contains('is-open') &&
            body.getBoundingClientRect().height > 200 &&
            scroller.scrollTop > 100 &&
            sectionTop < 40
          );
        },
        { timeout: 4000 },
      )
      .catch(() => undefined);
    const siteState = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState());
    record(
      '间隙模式默认 OCT 开 / TET 关',
      siteState.showO === true && siteState.showT === false,
      `O ${siteState.showO}, T ${siteState.showT}`,
    );
    record(
      '间隙模式默认尺寸 70% / 透明度 60% / 完整配位',
      Math.abs(siteState.siteScale - 0.7) < 1e-6 &&
        Math.abs(siteState.siteOpacity - 0.6) < 1e-6 &&
        siteState.siteFilter === 'complete',
      `scale ${siteState.siteScale}, opacity ${siteState.siteOpacity}, filter ${siteState.siteFilter}`,
    );
    record('进入间隙模式自动选中中心 OCT 位点', Boolean(siteState.selectedSiteId), siteState.selectedSiteId ?? 'null');

    const panelScroll = await page.evaluate(() => {
      const scroller = document.querySelector('.panel-scroll');
      const section = document.querySelector('.psec[data-section="sites"]');
      if (!scroller || !section) return null;
      return {
        scrollTop: scroller.scrollTop,
        sectionTop: section.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
        expanded: section.classList.contains('is-open'),
      };
    });
    const panelDiag = await page.evaluate(() => {
      const scroller = document.querySelector('.panel-scroll');
      const section = document.querySelector('.psec[data-section="sites"]');
      const body = section?.querySelector('.ps-body');
      return {
        grid: document.querySelector('.app-grid')?.className,
        panelWidth: document.querySelector('#panel')?.getBoundingClientRect().width,
        scrollHeight: scroller?.scrollHeight,
        clientHeight: scroller?.clientHeight,
        overflow: scroller ? getComputedStyle(scroller).overflowY : null,
        bodyH: body?.getBoundingClientRect().height,
        rows: body ? getComputedStyle(body).gridTemplateRows : null,
        inert: body?.inert,
      };
    });
    record(
      '进入间隙模式自动展开并滚动到间隙位 section',
      Boolean(panelScroll && panelScroll.expanded && panelScroll.scrollTop > 100 && panelScroll.sectionTop < 40),
      JSON.stringify({ ...panelScroll, ...panelDiag }),
    );
    const toastBox = await page.locator('#toast').boundingBox();
    const railBoxForToast = await page.locator('.status-rail').boundingBox();
    record(
      'toast 位于底部 rail 上方',
      Boolean(toastBox && railBoxForToast) && toastBox.y + toastBox.height <= railBoxForToast.y + 1,
      toastBox && railBoxForToast
        ? `toast bottom ${(toastBox.y + toastBox.height).toFixed(0)} / rail ${railBoxForToast.y.toFixed(0)}`
        : 'missing',
    );

    const counts = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCounts());
    record(
      '默认间隙位显示数 <= 32 且不是 96',
      counts.O + counts.T <= 32 && counts.O + counts.T !== 96,
      `O ${counts.O}, T ${counts.T}`,
    );
    const siteMaterial = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getSiteMaterialInfo());
    record(
      '间隙球 renderOrder 2 / depthWrite true / 0.60',
      siteMaterial.renderOrder === 2 &&
        siteMaterial.depthWrite === true &&
        Math.abs(siteMaterial.opacity - 0.6) < 1e-6,
      JSON.stringify(siteMaterial),
    );
    const ghostInfo = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getGhostInfo());
    record(
      'ghost 使用 NormalBlending 0.08-0.10，宿主原子仍可读',
      ghostInfo.blending === 'NormalBlending' &&
        ghostInfo.opacity >= 0.08 &&
        ghostInfo.opacity <= 0.1 &&
        ghostInfo.depthWrite === false,
      JSON.stringify(ghostInfo),
    );
    const rangeNoteInfo = await page.evaluate(() => ({
      note: document.querySelector('#site-range-note')?.textContent ?? '',
      completeO: window.__CRYSTAL_DEBUG__.getCounts().completeO,
    }));
    record(
      '间隙范围说明写清“当前显示范围 N 个完整 OCT / 关闭跟随可看全部”',
      rangeNoteInfo.note.includes(`${rangeNoteInfo.completeO} 个完整 OCT`) &&
        rangeNoteInfo.note.includes('关闭') &&
        rangeNoteInfo.note.includes('全部'),
      rangeNoteInfo.note,
    );
    const browserState = await page.evaluate(() => ({
      position: document.getElementById('site-position')?.textContent,
      frac: document.getElementById('site-frac')?.textContent,
      cn: document.getElementById('site-cn')?.textContent,
      state: document.getElementById('site-state')?.textContent,
    }));
    record(
      '位点浏览器显示坐标 / CN / 状态',
      Boolean(browserState.frac && browserState.frac !== '—' && browserState.cn?.includes('6') && browserState.state?.includes('完整')),
      JSON.stringify(browserState),
    );

    const beforeNext = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState().selectedSiteId);
    await page.locator('#site-next').click();
    await settle(page, 450);
    const afterNext = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState().selectedSiteId);
    record('位点浏览器上一个/下一个切换选中', Boolean(afterNext) && afterNext !== beforeNext, `${beforeNext} → ${afterNext}`);
    await page.locator('#site-prev').click();
    await settle(page, 350);
    await page.screenshot({ path: path.join(ARTIFACTS, 'interstitials.png') });

    await page.screenshot({ path: path.join(ARTIFACTS, 'ghost.png') });

    // --- interstitial follow-range ---------------------------------
    const followOn = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const info = debug.getSiteVisibilityInfo();
      const counts = debug.getCounts();
      return {
        follow: debug.getState().followRangeForSites,
        display: debug.getDisplayInfo(),
        counts,
        visibleSites: info.filter((site) => site.visible).length,
        allNeighborsVisible: info
          .filter((site) => site.visible)
          .every((site) => site.allNeighborsVisible),
        uiVisible: document.querySelector('#site-display')?.textContent,
        uiComplete: document.querySelector('#site-complete-count')?.textContent,
        uiFollow: document.querySelector('#display-follow-sites')?.checked,
      };
    });
    record(
      '间隙位默认跟随范围：可见位点邻居全部可见',
      followOn.follow === true &&
        followOn.uiFollow === true &&
        followOn.visibleSites > 0 &&
        followOn.visibleSites === followOn.counts.O + followOn.counts.T &&
        followOn.visibleSites === followOn.display.visibleSiteCount &&
        followOn.allNeighborsVisible,
      JSON.stringify(followOn),
    );
    record(
      '间隙计数 显示 / 完整 / 理论 实时一致',
      Number(followOn.uiVisible) === followOn.visibleSites &&
        Number(followOn.uiComplete) ===
          followOn.counts.completeO + followOn.counts.completeT,
      `UI ${followOn.uiVisible}/${followOn.uiComplete} · layer ${followOn.visibleSites}/${
        followOn.counts.completeO + followOn.counts.completeT
      }`,
    );

    const visibleSiteCountBefore = followOn.visibleSites;
    await page.evaluate(() => {
      const toggle = document.querySelector('#display-follow-sites');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(page, 550);
    const followOff = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      return {
        follow: debug.getState().followRangeForSites,
        display: debug.getDisplayInfo(),
        visibleSites: debug.getSiteVisibilityInfo().filter((site) => site.visible).length,
        uiVisible: document.querySelector('#site-display')?.textContent,
      };
    });
    record(
      '关闭跟随后位点计数与面板保持一致',
      followOff.follow === false &&
        followOff.visibleSites > 0 &&
        Number(followOff.uiVisible) === followOff.visibleSites,
      `${visibleSiteCountBefore} → ${followOff.visibleSites}`,
    );

    // 100% 范围下所有原子都在 base 可见集里；为了构造“邻接原子在范围外”的位点，
    // 临时收窄显示范围（原子转为透视），再找 complete 但邻接不全的位点。
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setDisplay({ range: 0.6 }));
    await settle(page, 500);
    const siteInfoPartial = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getSiteVisibilityInfo());
    const partialSite = siteInfoPartial.find(
      (site) => site.complete && !site.allNeighborsVisible,
    );
    if (partialSite) {
      const focusedPartial = await page.evaluate(
        (id) => window.__CRYSTAL_DEBUG__.focusSite(id),
        partialSite.id,
      );
      await settle(page, 900);
      const partialState = await page.evaluate(() => ({
        selected: window.__CRYSTAL_DEBUG__.getState().selectedSiteId,
        noteHidden: document.querySelector('#site-neighbor-note')?.hasAttribute('hidden'),
        note: document.querySelector('#site-neighbor-note')?.textContent,
        poly: window.__CRYSTAL_DEBUG__.getSelectionPolyhedronInfo(),
      }));
      record(
        '隐藏邻居时不给配位多面体并显示范围提示',
        focusedPartial &&
          partialState.selected === partialSite.id &&
          partialState.noteHidden === false &&
          partialState.note?.includes('配位原子在显示范围外') &&
          partialState.poly.hasPolyhedron === false &&
          partialState.poly.neighborsVisible === false,
        JSON.stringify(partialState),
      );
    } else {
      record('隐藏邻居时不给配位多面体并显示范围提示', false, 'no complete site with hidden neighbours');
    }

    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setDisplay({ range: 1 }));
    await settle(page, 450);
    await page.evaluate(() => {
      const toggle = document.querySelector('#display-follow-sites');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(page, 700);
    const refollow = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const selected = debug.getState().selectedSiteId;
      const selectedVisible = selected
        ? debug.getSiteVisibilityInfo().find((site) => site.id === selected)?.visible === true
        : false;
      return {
        follow: debug.getState().followRangeForSites,
        selected,
        selectedVisible,
        visibleSites: debug.getDisplayInfo().visibleSiteCount,
      };
    });
    record(
      '重新跟随范围后按位点可见性保留/取消选中',
      refollow.follow === true &&
        refollow.visibleSites > 0 &&
        (refollow.selected === null || refollow.selectedVisible === true),
      JSON.stringify(refollow),
    );

    // --- show all sites: same-button toggle + loud density toast ----
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.showInterstitials(true));
    await settle(page, 700);
    const sitesBefore = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCounts());
    record(
      '同键开关前提：位点处于已显示状态',
      sitesBefore.O + sitesBefore.T > 0,
      `${sitesBefore.O + sitesBefore.T} 个`,
    );
    await page.locator('#site-all-btn').click();
    await settle(page, 600);
    const sitesOff = await page.evaluate(() => ({
      counts: window.__CRYSTAL_DEBUG__.getCounts(),
      state: window.__CRYSTAL_DEBUG__.getState(),
    }));
    record(
      '“显示全部位点”同键开关：再次点击关闭全部位点',
      sitesOff.counts.O + sitesOff.counts.T === 0 &&
        sitesOff.state.showO === false &&
        sitesOff.state.showT === false,
      JSON.stringify({ O: sitesOff.counts.O, T: sitesOff.counts.T }),
    );
    // Turning the last family off auto-collapses the "间隙位" section, which
    // hides the button; reopen it before toggling all sites back on.
    await page.locator('.psec[data-section="sites"] .ps-head').click();
    await settle(page, 350);
    await page.locator('#site-all-btn').click();
    await settle(page, 600);
    const allCounts = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCounts());
    const allToast = await page.locator('#toast-text').textContent();
    record(
      '“显示全部位点”为二级操作且提示密度',
      allCounts.O + allCounts.T > 32 && Boolean(allToast?.includes('密度')),
      `${allCounts.O + allCounts.T} 个 / ${allToast ?? ''}`,
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.showInterstitials(true));
    await settle(page, 700);

    // --- selected site label + polyhedron -------------------------
    const focused = await page.evaluate(() =>
      window.__CRYSTAL_DEBUG__.focusSite('fcc:O:0.500000,0.500000,0.500000'),
    );
    await settle(page, 1000);
    const focusedState = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState());
    record(
      '聚焦完整 O 位点',
      Boolean(focused) && focusedState.selectedSiteId === 'fcc:O:0.500000,0.500000,0.500000',
      focusedState.selectedSiteId ?? 'null',
    );
    const siteLabel = await page.evaluate(
      () => document.querySelector('.scene-label-text')?.textContent ?? '',
    );
    record('位点标签为 OCT · 6/6 一行文本', siteLabel.includes('OCT') && siteLabel.includes('6/6'), siteLabel);
    await page.screenshot({ path: path.join(ARTIFACTS, 'interstitials-range-out.png') });

    await page.locator('#toggle-site-labels').check();
    await settle(page, 500);
    const labelCount = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getLabelCount());
    record('全部间隙标签限制在 24 个以内', labelCount > 0 && labelCount <= 24, `${labelCount} 个标签`);
    await page.locator('#toggle-site-labels').uncheck();
    await settle(page, 300);

    // --- cell wireframe default (depth-tested dash) ----------------
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.__CRYSTAL_DEBUG__.showInterstitials(false);
      window.__CRYSTAL_DEBUG__.setEditMode(false);
      window.__CRYSTAL_DEBUG__.setStructure('hcp');
    });
    await settle(page, 900);
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.resetView());
    await settle(page, 700);
    const cellInfo = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCellInfo());
    record(
      'cell-wireframe 截图为 LineSegments2 虚线、2.8px 双描边、depth-tested',
      cellInfo.lineWidth >= 2.8 &&
        cellInfo.coreColor === '#2F6B82' &&
        cellInfo.haloColor === '#D8F3FF' &&
        cellInfo.depthTest === true &&
        cellInfo.dashed === true &&
        cellInfo.xray === false,
      JSON.stringify(cellInfo),
    );
    await scrollPanelTo(page, '.psec[data-section="data"]', 0);
    await settle(page, 400);
    await page.screenshot({ path: path.join(ARTIFACTS, 'cell-wireframe.png') });

    // --- cell style controls ---------------------------------------
    await page.evaluate(() => {
      const width = document.getElementById('cell-width');
      const brightness = document.getElementById('cell-brightness');
      if (!width || !brightness) throw new Error('cell style controls missing');
      width.value = '6';
      width.dispatchEvent(new Event('input', { bubbles: true }));
      brightness.value = '60';
      brightness.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page, 350);
    const adjusted = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      cell: window.__CRYSTAL_DEBUG__.getCellInfo(),
    }));
    record(
      '线框粗细/亮度控件真实生效（手动值优先）',
      adjusted.state.cellLineWidth === 6 &&
        Math.abs(adjusted.state.cellLineBrightness - 0.6) < 1e-6 &&
        adjusted.state.cellStyleAuto === false &&
        Math.abs(adjusted.cell.lineWidth - 6) < 1e-6 &&
        Math.abs(adjusted.cell.innerLineWidth - 2.8) < 1e-6 &&
        Math.abs(adjusted.cell.opacity - 0.6) < 1e-6,
      JSON.stringify(adjusted),
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setStructure('bcc'));
    await settle(page, 900);
    const retained = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      cell: window.__CRYSTAL_DEBUG__.getCellInfo(),
    }));
    record(
      '线框样式切换结构后保持',
      retained.state.structure === 'bcc' &&
        Math.abs(retained.cell.lineWidth - 6) < 1e-6 &&
        Math.abs(retained.cell.opacity - 0.6) < 1e-6,
      JSON.stringify(retained),
    );
    await page.locator('#cell-auto-btn').click();
    await settle(page, 400);
    const autoRestored = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      cell: window.__CRYSTAL_DEBUG__.getCellInfo(),
    }));
    record(
      '“自动”按钮恢复缩球态 2.8px / 85%',
      autoRestored.state.cellStyleAuto === true &&
        Math.abs(autoRestored.cell.lineWidth - 2.8) < 1e-6 &&
        Math.abs(autoRestored.cell.brightness - 0.85) < 1e-6,
      JSON.stringify(autoRestored),
    );
    // Same-button toggle: a second click pins the current style and exits auto.
    await page.locator('#cell-auto-btn').click();
    await settle(page, 400);
    const autoOff = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      cell: window.__CRYSTAL_DEBUG__.getCellInfo(),
    }));
    record(
      '“自动”同键开关：再次点击固定当前样式并退出自动',
      autoOff.state.cellStyleAuto === false &&
        Math.abs(autoOff.cell.lineWidth - 2.8) < 1e-6 &&
        Math.abs(autoOff.cell.brightness - 0.85) < 1e-6,
      JSON.stringify(autoOff),
    );
    await page.locator('#cell-auto-btn').click();
    await settle(page, 400);

    // --- x-ray -----------------------------------------------------
    await page.locator('#toggle-xray').check();
    await settle(page, 350);
    const xrayInfo = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCellInfo());
    record(
      '线框透视开启后 depthTest=false，双描边仍可读',
      xrayInfo.xray === true &&
        xrayInfo.depthTest === false &&
        xrayInfo.glow >= 0.18 &&
        xrayInfo.glow <= 0.25,
      JSON.stringify(xrayInfo),
    );
    await page.locator('#toggle-xray').uncheck();
    await settle(page, 300);

    // === round 2: persistent dock / folded panel / cell repeat ======
    await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      debug.setStructure('fcc');
      debug.resetDisplay();
      debug.setEditMode(false);
      debug.clearSelection();
      debug.setAutoRotate(false);
    });
    await settle(page, 900);
    await page.evaluate(() => {
      const button = document.querySelector('#qd-color-restore');
      if (button && !button.disabled) button.click();
    });
    await settle(page, 600);

    // Persistent menu sits in the bottom-right of the stage and stays visible.
    const dockBox = await page.evaluate(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const dock = document.querySelector('#quick-dock').getBoundingClientRect();
      const buttons = Array.from(document.querySelectorAll('#quick-dock .qd-btn')).map((node) => ({
        id: node.id,
        text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
      }));
      const status = document.querySelector('#qd-status');
      const menuRect = document.querySelector('#qd-menu').getBoundingClientRect();
      const restoreRect = document.querySelector('#qd-color-restore').getBoundingClientRect();
      const exportRect = document.querySelector('#qd-export').getBoundingClientRect();
      return {
        menu: { right: menuRect.right, left: menuRect.left },
        inset: {
          restoreRight: menuRect.right - restoreRect.right,
          exportRight: menuRect.right - exportRect.right,
          restoreLeft: restoreRect.left - menuRect.left,
        },
        stage: { right: stage.right, bottom: stage.bottom, width: stage.width, height: stage.height },
        dock: { right: dock.right, bottom: dock.bottom, width: dock.width, height: dock.height },
        buttons,
        sliders: {
          speed: document.querySelector('#qd-speed')?.value ?? null,
          radius: document.querySelector('#qd-radius')?.value ?? null,
        },
        restore: {
          disabled: document.querySelector('#qd-color-restore')?.disabled ?? null,
          count: (document.querySelector('#qd-color-restore-count')?.textContent || '').trim(),
        },
        status: status ? status.textContent || '' : '',
      };
    });
    const dockIds = dockBox.buttons.map((button) => button.id);
    const requiredDockIds = [
      'qd-reset',
      'qd-fit',
      'qd-rotate',
      'qd-color',
      'qd-color-restore',
      'qd-xray',
      'qd-ghost',
      'qd-atoms',
      'qd-cell',
      'qd-range',
      'qd-bg',
      'qd-export',
    ];
    record(
      '常驻菜单固定于舞台右下角',
      dockBox.dock.right > dockBox.stage.right - 60 &&
        dockBox.dock.bottom > dockBox.stage.bottom - 160 &&
        dockBox.dock.right <= dockBox.stage.right + 1 &&
        dockBox.dock.bottom <= dockBox.stage.bottom + 1,
      JSON.stringify({ stage: dockBox.stage, dock: dockBox.dock }),
    );
    record(
      '常驻菜单包含全部常驻按钮',
      requiredDockIds.every((id) => dockIds.includes(id)),
      dockBox.buttons.map((button) => button.id + ':' + button.text).join(' | '),
    );
    record(
      '常驻菜单按钮不越出菜单内边距',
      dockBox.inset.restoreRight >= 11 &&
        Math.abs(dockBox.inset.restoreRight - dockBox.inset.exportRight) < 0.6,
      JSON.stringify(dockBox.inset),
    );
    record(
      '常驻菜单内嵌速度与半径滑杆',
      dockBox.sliders.speed !== null && dockBox.sliders.radius !== null,
      JSON.stringify(dockBox.sliders),
    );
    record(
      '“恢复默认色”常驻且无改动时置灰',
      dockBox.restore.disabled === true && dockBox.restore.count === '',
      JSON.stringify(dockBox.restore),
    );
    record(
      '常驻菜单状态栏反映 0.50r / 100% / 实心 63',
      dockBox.status.includes('0.50r') && dockBox.status.includes('100%') && dockBox.status.includes('63'),
      dockBox.status,
    );

    // Dock toggles stay in sync with state and renderer.
    await page.locator('#qd-ghost').click();
    await settle(page, 600);
    const ghostOn = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      info: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
    }));
    record(
      '常驻菜单“原子透视”开关联动 ghostAtoms 与透视球数',
      ghostOn.state.ghostAtoms === true && ghostOn.info.xrayAtomIndices.length === 63,
      JSON.stringify({ xray: ghostOn.info.xrayAtomIndices.length, ghost: ghostOn.state.ghostAtoms }),
    );
    await page.locator('#qd-ghost').click();
    await settle(page, 500);

    await page.locator('#qd-xray').click();
    await settle(page, 500);
    const xrayOn = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      cell: window.__CRYSTAL_DEBUG__.getCellInfo(),
    }));
    record(
      '常驻菜单“线框透视”开关联动 cellXray',
      xrayOn.state.cellXray === true && xrayOn.cell.xray === true,
      JSON.stringify(xrayOn),
    );
    await page.locator('#qd-xray').click();
    await settle(page, 400);

    await page.locator('#qd-cell').click();
    await settle(page, 400);
    const cellOff = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      checked: document.querySelector('#qd-cell').getAttribute('aria-checked'),
    }));
    record(
      '常驻菜单“晶胞”同键开关可隐藏/显示',
      cellOff.state.showCell === false && cellOff.checked === 'false',
      JSON.stringify(cellOff),
    );
    await page.locator('#qd-cell').click();
    await settle(page, 400);

    await page.locator('#qd-atoms').click();
    await settle(page, 400);
    const atomsOff = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState());
    record('常驻菜单“显示原子”同键开关可隐藏球体', atomsOff.showAtoms === false, String(atomsOff.showAtoms));
    await page.locator('#qd-atoms').click();
    await settle(page, 600);

    // Colour popover: default gold outer / bronze inner, editable.
    await page.locator('#qd-color').click();
    await settle(page, 350);
    const colorPopover = await page.evaluate(() => {
      const popover = document.querySelector('#qd-popover');
      return {
        hidden: popover ? popover.hasAttribute('hidden') : null,
        expanded: document.querySelector('#qd-color').getAttribute('aria-expanded'),
        inner: document.querySelector('#qd-color-inner').value,
        outer: document.querySelector('#qd-color-outer').value,
        modes: document.querySelectorAll('[data-qd-mode]').length,
      };
    });
    record(
      '常驻菜单颜色面板显示内外层默认色与三种配色',
      colorPopover.hidden === false &&
        colorPopover.expanded === 'true' &&
        colorPopover.inner.toUpperCase() === '#B87333' &&
        colorPopover.outer.toUpperCase() === '#F6C453' &&
        colorPopover.modes === 3,
      JSON.stringify(colorPopover),
    );
    await page.evaluate(() => {
      const input = document.querySelector('#qd-color-inner');
      input.value = '#ab5b2a';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page, 400);
    const innerColor = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState());
    record('常驻菜单颜色面板可改内层颜色', innerColor.colorInner === '#AB5B2A', innerColor.colorInner);
    await page.evaluate(() => document.querySelector('#qd-pop-close').click());
    await settle(page, 300);

    // Range popover: out-of-range atoms turn x-ray instead of disappearing.
    await page.locator('#qd-range').click();
    await settle(page, 350);
    const rangeInitial = await page.evaluate(() => ({
      value: document.querySelector('#qd-range-input').value,
      out: document.querySelector('#qd-range-out').textContent,
    }));
    record(
      '常驻菜单显示范围面板初始 100%',
      rangeInitial.value === '100' && rangeInitial.out.trim() === '100%',
      JSON.stringify(rangeInitial),
    );
    await page.evaluate(() => {
      const input = document.querySelector('#qd-range-input');
      input.value = '60';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page, 600);
    const rangeShrunk = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      info: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
    }));
    record(
      '缩小显示范围后范围外球体转为原子透视而非消失',
      Math.abs(rangeShrunk.state.displayRange - 0.6) < 1e-6 &&
        rangeShrunk.info.hiddenAtomIndices.length === 0 &&
        rangeShrunk.info.xrayAtomIndices.length > 0,
      JSON.stringify({
        range: rangeShrunk.state.displayRange,
        hidden: rangeShrunk.info.hiddenAtomIndices.length,
        xray: rangeShrunk.info.xrayAtomIndices.length,
      }),
    );
    await page.evaluate(() => document.querySelector('#qd-range-all').click());
    await settle(page, 500);
    const rangeAll = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState());
    record('常驻菜单显示范围面板“显示全部”可切换', rangeAll.displayMode === 'all', rangeAll.displayMode);
    await page.evaluate(() => document.querySelector('#qd-range-all').click());
    await settle(page, 500);
    await page.evaluate(() => document.querySelector('#qd-pop-close').click());
    await settle(page, 300);

    // Background popover
    await page.locator('#qd-bg').click();
    await settle(page, 350);
    const bgCount = await page.evaluate(() => document.querySelectorAll('[data-qd-bg]').length);
    await page.evaluate(() => document.querySelector('[data-qd-bg="aurora"]').click());
    await settle(page, 500);
    const bgState = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState());
    record('常驻菜单背景面板切换背景', bgCount === 3 && bgState.background === 'aurora', String(bgState.background));
    await page.evaluate(() => document.querySelector('[data-qd-bg="deep"]').click());
    await settle(page, 400);
    await page.evaluate(() => document.querySelector('#qd-pop-close').click());
    await settle(page, 300);

    // Quick restore of per-atom colours.
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.resetDisplay());
    await settle(page, 500);
    await page.evaluate(() => {
      window.__CRYSTAL_DEBUG__.setAtomColor('fcc:corner:0.000000,0.000000,0.000000', '#E06A3A');
    });
    await settle(page, 400);
    const restoreVisible = await page.evaluate(() => {
      const button = document.querySelector('#qd-color-restore');
      const menuRect = document.querySelector('#qd-menu').getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const label = button.querySelector('span');
      return {
        disabled: button.disabled,
        count: document.querySelector('#qd-color-restore-count').textContent,
        colors: Object.keys(window.__CRYSTAL_DEBUG__.getState().atomColors || {}),
        inset: {
          restoreRight: menuRect.right - buttonRect.right,
          spanFits: label.scrollWidth <= label.clientWidth + 1,
        },
      };
    });
    record(
      '逐个颜色被修改后“恢复默认色”启用并显示计数',
      restoreVisible.disabled === false &&
        restoreVisible.colors.length === 1 &&
        restoreVisible.count.trim() === '1',
      JSON.stringify(restoreVisible),
    );
    record(
      '“恢复默认色”带计数时仍不贴住菜单边框',
      restoreVisible.inset.restoreRight >= 11 &&
        restoreVisible.inset.spanFits === true,
      JSON.stringify(restoreVisible.inset),
    );
    await page.locator('#qd-color-restore').click();
    await settle(page, 500);
    const restoreDone = await page.evaluate(() => ({
      disabled: document.querySelector('#qd-color-restore').disabled,
      count: document.querySelector('#qd-color-restore-count').textContent,
      colors: Object.keys(window.__CRYSTAL_DEBUG__.getState().atomColors || {}).length,
      toast: document.querySelector('#toast-text') ? document.querySelector('#toast-text').textContent : '',
    }));
    record(
      '常驻菜单“恢复默认色”一键清除并重新置灰',
      restoreDone.disabled === true &&
        restoreDone.count.trim() === '' &&
        restoreDone.colors === 0 &&
        String(restoreDone.toast).includes('默认颜色'),
      JSON.stringify(restoreDone),
    );

    // Reset view must also return to the fit-view state.
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setDisplay({ range: 0.6 }));
    await settle(page, 500);
    await page.locator('#qd-reset').click();
    await settle(page, 900);
    const resetInfo = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      toast: document.querySelector('#toast-text') ? document.querySelector('#toast-text').textContent : '',
      distance: window.__CRYSTAL_DEBUG__.getCamera().distance,
    }));
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.fitView());
    await settle(page, 650);
    const fitDistance = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCamera().distance);
    record(
      '重置视角同时回到适应视图',
      resetInfo.state.focusedSiteId === null &&
        String(resetInfo.toast).includes('适应视图') &&
        Math.abs(resetInfo.distance - fitDistance) < 0.05,
      JSON.stringify({ toast: resetInfo.toast, reset: resetInfo.distance, fit: fitDistance }),
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.resetDisplay());
    await settle(page, 700);

    // Folding the panel keeps the cube in place and leaves a reopen arrow.
    const beforeFold = await page.evaluate(() => ({
      camera: window.__CRYSTAL_DEBUG__.getCamera(),
      width: document.querySelector('#crystal-canvas').getBoundingClientRect().width,
    }));
    await page.locator('#panel-toggle').click();
    await settle(page, 800);
    const folded = await page.evaluate(() => {
      const grid = document.querySelector('.app-grid');
      const reopen = document.querySelector('#panel-reopen');
      const style = window.getComputedStyle(reopen);
      const rect = reopen.getBoundingClientRect();
      return {
        collapsed: grid ? grid.classList.contains('panel-collapsed') : null,
        reopenDisplay: style.display,
        reopenWidth: rect.width,
        reopenHeight: rect.height,
        toggleExpanded: document.querySelector('#panel-toggle').getAttribute('aria-expanded'),
        camera: window.__CRYSTAL_DEBUG__.getCamera(),
        width: document.querySelector('#crystal-canvas').getBoundingClientRect().width,
      };
    });
    record(
      '折叠实验控制台后留下展开箭头',
      folded.collapsed === true &&
        folded.reopenDisplay !== 'none' &&
        folded.reopenWidth > 8 &&
        folded.reopenHeight > 8 &&
        folded.toggleExpanded === 'false',
      JSON.stringify({ collapsed: folded.collapsed, display: folded.reopenDisplay, w: folded.reopenWidth, h: folded.reopenHeight }),
    );
    record(
      '折叠实验控制台不引起视角跳动',
      Math.abs(folded.camera.azimuth - beforeFold.camera.azimuth) < 1e-6 &&
        Math.abs(folded.camera.polar - beforeFold.camera.polar) < 1e-6 &&
        folded.width > beforeFold.width + 100,
      JSON.stringify({ azimuthBefore: beforeFold.camera.azimuth, azimuthAfter: folded.camera.azimuth, widthBefore: beforeFold.width, widthAfter: folded.width }),
    );
    await page.locator('#panel-reopen').click();
    await settle(page, 800);
    const unfolded = await page.evaluate(() => {
      const grid = document.querySelector('.app-grid');
      const reopen = document.querySelector('#panel-reopen');
      return {
        collapsed: grid ? grid.classList.contains('panel-collapsed') : null,
        reopenDisplay: window.getComputedStyle(reopen).display,
        reopenExpanded: reopen.getAttribute('aria-expanded'),
        panelWidth: document.querySelector('#panel').getBoundingClientRect().width,
      };
    });
    record(
      '展开箭头可恢复实验控制台',
      unfolded.collapsed === false &&
        unfolded.reopenDisplay !== 'none' &&
        unfolded.reopenExpanded === 'true' &&
        unfolded.panelWidth > 200,
      JSON.stringify(unfolded),
    );

    // The drawer arrow must stay at one height and flip direction, not jump.
    const arrowOpen = await page.evaluate(() => {
      const handle = document.querySelector('#panel-reopen');
      const chevron = handle.querySelector('.panel-handle-chevron');
      return {
        top: handle.getBoundingClientRect().top,
        transform: getComputedStyle(chevron).transform,
      };
    });
    await page.click('#panel-toggle');
    await settle(page, 620);
    const arrowClosed = await page.evaluate(() => {
      const handle = document.querySelector('#panel-reopen');
      const chevron = handle.querySelector('.panel-handle-chevron');
      return {
        top: handle.getBoundingClientRect().top,
        transform: getComputedStyle(chevron).transform,
        expanded: handle.getAttribute('aria-expanded'),
      };
    });
    record(
      '控制台箭头高度固定且方向随开合翻转',
      Math.abs(arrowOpen.top - arrowClosed.top) < 0.5 &&
        arrowOpen.transform !== arrowClosed.transform &&
        arrowClosed.expanded === 'false',
      JSON.stringify({ open: arrowOpen, closed: arrowClosed }),
    );
    await page.click('#panel-reopen');
    await settle(page, 620);

    // Durable dock controls: rotate switch, speed, radius and colour modes.
    const setRange = async (selector, value) => {
      await page.evaluate(
        ([sel, val]) => {
          const input = document.querySelector(sel);
          input.value = String(val);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
        [selector, value],
      );
      await settle(page, 260);
    };
    const rotateBefore = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState().autoRotate);
    await page.click('#qd-rotate');
    await settle(page, 260);
    const rotateAfter = await page.evaluate(() => ({
      autoRotate: window.__CRYSTAL_DEBUG__.getState().autoRotate,
      checked: document.querySelector('#qd-rotate').getAttribute('aria-checked'),
    }));
    record(
      '常驻菜单自动旋转开关可直接停转',
      rotateAfter.autoRotate === !rotateBefore &&
        rotateAfter.checked === String(rotateAfter.autoRotate),
      JSON.stringify({ before: rotateBefore, after: rotateAfter }),
    );
    await page.click('#qd-rotate');
    await settle(page, 200);

    await setRange('#qd-speed', 1.3);
    await setRange('#qd-radius', 72);
    const dockSliders = await page.evaluate(() => ({
      speed: window.__CRYSTAL_DEBUG__.getState().autoRotateSpeed,
      radius: window.__CRYSTAL_DEBUG__.getState().atomDisplayRadius,
      speedOut: document.querySelector('#qd-speed-out').textContent,
      radiusOut: document.querySelector('#qd-radius-out').textContent,
    }));
    record(
      '常驻菜单可连续调速与无级调显示半径',
      Math.abs(dockSliders.speed - 1.3) < 1e-6 &&
        Math.abs(dockSliders.radius - 0.72) < 1e-6 &&
        dockSliders.speedOut.includes('1.3') &&
        dockSliders.radiusOut.includes('0.72'),
      JSON.stringify(dockSliders),
    );

    await page.click('.qd-modes [data-dock-mode="gold"]');
    await settle(page, 320);
    const dockMode = await page.evaluate(() => ({
      colorMode: window.__CRYSTAL_DEBUG__.getState().colorMode,
      pressed: document.querySelector('.qd-modes [data-dock-mode="gold"]').getAttribute('aria-pressed'),
    }));
    record(
      '常驻菜单三态配色可直接切换',
      dockMode.colorMode === 'gold' && dockMode.pressed === 'true',
      JSON.stringify(dockMode),
    );

    // restore the defaults used by the rest of the suite
    await page.click('.qd-modes [data-dock-mode="radial"]');
    await setRange('#qd-speed', 0.6);
    await setRange('#qd-radius', 50);
    await settle(page, 380);

    // Interface scale: persisted, zooms the chrome without touching the scene.
    const scaleBefore = await page.evaluate(() => ({
      scale: window.__CRYSTAL_DEBUG__.getState().uiScale,
      panel: document.querySelector('#panel').getBoundingClientRect().width,
      canvas: document.querySelector('#crystal-canvas').getBoundingClientRect().width,
    }));
    await page.evaluate(() => {
      document.querySelector('[data-section="interface"] .ps-head').click();
    });
    await settle(page, 480);
    await page.click('[data-ui-scale="1.15"]');
    await settle(page, 700);
    const scaleAfter = await page.evaluate(() => ({
      scale: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'),
      ),
      inline: document.documentElement.style.getPropertyValue('--ui-scale'),
      stored: localStorage.getItem('crystal-atlas:ui-scale:v1'),
      panel: document.querySelector('#panel').getBoundingClientRect().width,
      canvas: document.querySelector('#crystal-canvas').getBoundingClientRect().width,
    }));
    record(
      '设置可缩放界面并保存在本机',
      Math.abs(scaleAfter.scale - 1.15) < 1e-6 &&
        scaleAfter.inline === '1.15' &&
        scaleAfter.stored === '1.15' &&
        scaleAfter.panel > scaleBefore.panel * 1.1 &&
        scaleAfter.canvas < scaleBefore.canvas,
      JSON.stringify({ before: scaleBefore, after: scaleAfter }),
    );
    await page.click('[data-ui-scale="1"]');
    await settle(page, 700);
    const scaleReset = await page.evaluate(() => ({
      scale: window.__CRYSTAL_DEBUG__.getState().uiScale,
      panel: document.querySelector('#panel').getBoundingClientRect().width,
    }));
    record(
      '界面缩放可恢复到 100%',
      Math.abs(scaleReset.scale - 1) < 1e-6 && Math.abs(scaleReset.panel - scaleBefore.panel) < 2,
      JSON.stringify(scaleReset),
    );

    // Secondary popovers must stay inside the stage at large UI scales.
    await page.click('[data-ui-scale="1.3"]');
    await settle(page, 700);
    const popoverFit = [];
    for (const id of ['qd-range', 'qd-bg', 'qd-color']) {
      await page.evaluate((triggerId) => document.getElementById(triggerId).click(), id);
      await settle(page, 340);
      popoverFit.push(
        await page.evaluate((triggerId) => {
          const pop = document.querySelector('#qd-popover');
          const rect = pop.getBoundingClientRect();
          const stageRect = document.querySelector('#stage').getBoundingClientRect();
          return {
            id: triggerId,
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            stageTop: Math.round(stageRect.top),
            stageBottom: Math.round(stageRect.bottom),
            inside:
              pop.hidden === false &&
              rect.top >= stageRect.top - 1 &&
              rect.bottom <= stageRect.bottom + 1 &&
              rect.left >= stageRect.left - 1 &&
              rect.right <= stageRect.right + 1,
          };
        }, id),
      );
      await page.evaluate((triggerId) => document.getElementById(triggerId).click(), id);
      await settle(page, 260);
    }
    record(
      '130% 缩放下常驻菜单二级浮层完整落在舞台内',
      popoverFit.every((item) => item.inside),
      JSON.stringify(popoverFit),
    );
    await page.click('[data-ui-scale="1"]');
    await settle(page, 700);

    // 1x1x1 primitive cell (cubic structures only).
    await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      debug.setStructure('fcc');
      debug.resetDisplay();
      debug.setAutoRotate(false);
    });
    await settle(page, 950);
    await scrollPanelTo(page, '#cell-repeat-field', 8);
    const repeatField = await page.evaluate(() => {
      const field = document.querySelector('#cell-repeat-field');
      return {
        hidden: field.hasAttribute('hidden'),
        note: document.querySelector('#cell-repeat-note').textContent,
        cellRepeat: window.__CRYSTAL_DEBUG__.getState().cellRepeat,
        total: window.__CRYSTAL_DEBUG__.getDisplayInfo().totalAtomCount,
      };
    });
    record(
      '立方结构默认 2×2×2 超胞 63 球',
      repeatField.hidden === false && repeatField.cellRepeat === 2 && repeatField.total === 63 && repeatField.note.includes('超胞'),
      JSON.stringify(repeatField),
    );
    await page.locator('[data-cell-repeat="1"]').click();
    await settle(page, 900);
    const oneCell = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      info: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
      cell: window.__CRYSTAL_DEBUG__.getCellInfo(),
      pressed: document.querySelector('[data-cell-repeat="1"]').getAttribute('aria-pressed'),
      note: document.querySelector('#cell-repeat-note').textContent,
      toast: document.querySelector('#toast-text') ? document.querySelector('#toast-text').textContent : '',
    }));
    record(
      '晶胞可切换为 1×1×1（FCC 14 球 / 8 角点）',
      oneCell.state.cellRepeat === 1 &&
        oneCell.info.totalAtomCount === 14 &&
        oneCell.cell.cornerMarks === 8 &&
        oneCell.pressed === 'true' &&
        oneCell.note.includes('14') &&
        String(oneCell.toast).includes('1×1×1'),
      JSON.stringify({ repeat: oneCell.state.cellRepeat, total: oneCell.info.totalAtomCount, corners: oneCell.cell.cornerMarks }),
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setStructure('hcp'));
    await settle(page, 950);
    const hcpRepeatField = await page.evaluate(() => {
      const field = document.querySelector('#cell-repeat-field');
      return { hidden: field.hasAttribute('hidden'), total: window.__CRYSTAL_DEBUG__.getDisplayInfo().totalAtomCount };
    });
    record(
      'HCP 固定三层，不显示晶胞倍数开关',
      hcpRepeatField.hidden === true && hcpRepeatField.total === 57,
      JSON.stringify(hcpRepeatField),
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setStructure('fcc'));
    await settle(page, 950);
    await scrollPanelTo(page, '#cell-repeat-field', 8);
    await page.locator('[data-cell-repeat="2"]').click();
    await settle(page, 900);
    const backToSuper = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getDisplayInfo());
    record('晶胞可切回 2×2×2 超胞', backToSuper.totalAtomCount === 63, String(backToSuper.totalAtomCount));

    // Ctrl-click multi select, then recolour / hide in bulk.
    await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      debug.setStructure('fcc');
      debug.resetDisplay();
      debug.setEditMode(true);
      debug.clearSelection();
      debug.setAutoRotate(false);
    });
    await settle(page, 800);
    const twoAtoms = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const rect = document.querySelector('#crystal-canvas').getBoundingClientRect();
      const rail = document.querySelector('.status-rail');
      const railTop = rail ? rail.getBoundingClientRect().top : rect.bottom;
      const total = debug.getDisplayInfo().totalAtomCount;
      const picked = [];
      for (let index = 0; index < total && picked.length < 2; index++) {
        if (!debug.isAtomVisible(index)) continue;
        const point = debug.getAtomScreenPosition(index);
        if (!point || !point.inView) continue;
        if (point.x < rect.left + 380 || point.x > rect.right - 80) continue;
        if (point.y < rect.top + 170 || point.y > railTop - 40) continue;
        if (picked.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < 90)) continue;
        picked.push({ index, x: point.x, y: point.y });
      }
      return picked;
    });
    record('找到两个可多选的投影原子', twoAtoms.length === 2, JSON.stringify(twoAtoms));
    await page.mouse.click(twoAtoms[0].x, twoAtoms[0].y);
    await settle(page, 450);
    await page.keyboard.down('Control');
    await page.mouse.click(twoAtoms[1].x, twoAtoms[1].y);
    await page.keyboard.up('Control');
    await settle(page, 450);
    const multi = await page.evaluate(() => ({
      ids: window.__CRYSTAL_DEBUG__.getSelectedAtomIds(),
      cardHidden: document.querySelector('#atom-card').hasAttribute('hidden'),
      count: document.querySelector('#atom-card-count').textContent,
    }));
    record(
      'Ctrl + 单击可多选原子',
      multi.ids.length === 2 && multi.cardHidden === false && multi.count.trim() === '2',
      JSON.stringify({ ids: multi.ids, count: multi.count }),
    );
    await page.evaluate(() => {
      const input = document.querySelector('#atom-card-color');
      input.value = '#7ad0ff';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page, 500);
    const multiColored = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getState().atomColors);
    record(
      '多选后统一改色作用于所有选中原子',
      multi.ids.every((id) => multiColored[id] === '#7AD0FF'),
      JSON.stringify(multiColored),
    );
    await page.locator('#atom-card-hide').click();
    await settle(page, 900);
    const multiHidden = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getAtomRenderInfo());
    record('多选后可批量隐藏原子', multiHidden.hidden === 2, JSON.stringify(multiHidden));
    await page.evaluate((ids) => window.__CRYSTAL_DEBUG__.setAtomHidden(ids, false), multi.ids);
    await settle(page, 900);
    const multiShown = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getAtomRenderInfo());
    record('恢复所选可撤销批量隐藏', multiShown.hidden === 0, JSON.stringify(multiShown));
    // setAtomHidden(..., false) routes through restoreAtomEdits(), which also
    // drops colour overrides, so repaint before testing the dock colour restore.
    await page.evaluate(
      (ids) => ids.forEach((id) => window.__CRYSTAL_DEBUG__.setAtomColor(id, '#7AD0FF')),
      multi.ids,
    );
    await settle(page, 400);
    await page.locator('#qd-color-restore').click();
    await settle(page, 500);
    const multiCleared = await page.evaluate(() => ({
      colors: Object.keys(window.__CRYSTAL_DEBUG__.getState().atomColors || {}).length,
      hidden: window.__CRYSTAL_DEBUG__.getAtomRenderInfo().hidden,
    }));
    record(
      '恢复默认色可撤销多选改色',
      multiCleared.colors === 0 && multiCleared.hidden === 0,
      JSON.stringify(multiCleared),
    );
    await page.mouse.click(twoAtoms[0].x, twoAtoms[0].y);
    await settle(page, 500);
    const single = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getSelectedAtomIds());
    record('普通点击替换当前选择', single.length === 1, JSON.stringify(single));
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.clearSelection());
    await settle(page, 300);

    // 2D cell diagrams: no stretched cuboid, HCP primitive cell + prism.
    const diagrams = {};
    for (const structure of ['fcc', 'bcc', 'hcp']) {
      await page.evaluate((id) => window.__CRYSTAL_DEBUG__.setStructure(id), structure);
      await settle(page, 950);
      await scrollPanelTo(page, '.cell-diagram-block', 8);
      diagrams[structure] = await page.evaluate(() => {
        const svg = document.querySelector('#cell-diagram svg');
        if (!svg) return null;
        const circles = Array.from(svg.querySelectorAll('circle')).map((node) => ({
          cx: Number(node.getAttribute('cx')),
          cy: Number(node.getAttribute('cy')),
          r: Number(node.getAttribute('r')),
        }));
        const texts = Array.from(svg.querySelectorAll('text')).map((node) => {
          const box = node.getBBox();
          return { text: node.textContent, x: box.x, right: box.x + box.width, y: box.y, bottom: box.y + box.height };
        });
        return { viewBox: svg.getAttribute('viewBox'), circles, texts };
      });
    }
    const fccDiagram = diagrams.fcc;
    const hcpDiagram = diagrams.hcp;
    const textsInside = (diagram) =>
      diagram.texts.every((box) => box.x >= 0 && box.right <= 268 + 1e-6 && box.y >= 0 && box.bottom <= 176 + 1e-6);
    const circlesInside = (diagram) =>
      diagram.circles.every((circle) =>
        Number.isFinite(circle.cx) &&
        Number.isFinite(circle.cy) &&
        circle.r > 0 &&
        circle.cx - circle.r >= -0.5 &&
        circle.cx + circle.r <= 268.5 &&
        circle.cy - circle.r >= -0.5 &&
        circle.cy + circle.r <= 176.5);
    record(
      'FCC 晶胞示意图为等比立方体并含 14 个球',
      fccDiagram &&
        fccDiagram.viewBox === '0 0 268 176' &&
        fccDiagram.circles.length === 14 &&
        circlesInside(fccDiagram) &&
        textsInside(fccDiagram) &&
        (() => {
          const fronts = fccDiagram.circles.filter((circle) => Math.abs(circle.r - 4.8) < 0.05);
          if (fronts.length !== 4) return false;
          const hasSquare = fronts.every((corner) =>
            fronts.some((other) => Math.abs(other.cy - corner.cy) < 1e-6 && Math.abs(Math.abs(other.cx - corner.cx) - 92) < 1e-6));
          const hasDepth = fronts.every((corner) =>
            fccDiagram.circles.some((other) => Math.abs(other.cx - (corner.cx + 30)) < 1e-6 && Math.abs(other.cy - (corner.cy - 22)) < 1e-6));
          return hasSquare && hasDepth;
        })(),
      JSON.stringify({ viewBox: fccDiagram ? fccDiagram.viewBox : null, circles: fccDiagram ? fccDiagram.circles.length : null }),
    );
    record(
      'BCC 晶胞示意图含 9 个球',
      diagrams.bcc && diagrams.bcc.viewBox === '0 0 268 176' && diagrams.bcc.circles.length === 9 && circlesInside(diagrams.bcc) && textsInside(diagrams.bcc),
      JSON.stringify({ circles: diagrams.bcc ? diagrams.bcc.circles.length : null }),
    );
    const hcpLabels = hcpDiagram ? hcpDiagram.texts.map((box) => box.text) : [];
    const leftColumn = hcpDiagram ? hcpDiagram.texts.filter((box) => box.right <= 136) : [];
    const rightColumn = hcpDiagram ? hcpDiagram.texts.filter((box) => box.x >= 136) : [];
    record(
      'HCP 晶胞示意图含原胞 + 六方棱柱共 26 个球',
      hcpDiagram && hcpDiagram.viewBox === '0 0 268 176' && hcpDiagram.circles.length === 26 && circlesInside(hcpDiagram) && textsInside(hcpDiagram),
      JSON.stringify({ circles: hcpDiagram ? hcpDiagram.circles.length : null, labels: hcpLabels }),
    );
    record(
      'HCP 示意图两列文字不重叠且内容正确',
      hcpLabels.includes('原胞 2 原子') &&
        hcpLabels.includes('A + B 基元') &&
        hcpLabels.includes('六方棱柱 6 原子') &&
        hcpLabels.some((label) => label.includes('12×1/6')) &&
        leftColumn.length > 0 &&
        rightColumn.length > 0 &&
        Math.max(...leftColumn.map((box) => box.right)) < Math.min(...rightColumn.map((box) => box.x)),
      JSON.stringify({ left: leftColumn.map((box) => box.text), right: rightColumn.map((box) => box.text) }),
    );
    // --- mobile ----------------------------------------------------
    await page.evaluate(() => {
      window.__CRYSTAL_DEBUG__.setStructure('fcc');
      window.__CRYSTAL_DEBUG__.showInterstitials(false);
      window.__CRYSTAL_DEBUG__.setEditMode(false);
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 1100);
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.resetView());
    await settle(page, 800);
    await page.screenshot({ path: path.join(ARTIFACTS, 'mobile.png') });
    const mobile = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const canvas = document.getElementById('crystal-canvas')?.getBoundingClientRect();
      const rail = document.querySelector('.status-rail')?.getBoundingClientRect();
      const auto = document.getElementById('auto-rotate-toggle')?.getBoundingClientRect();
      const settings = document.getElementById('mobile-settings')?.getBoundingClientRect();
      return {
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        inner: window.innerWidth,
        canvas: canvas ? { width: canvas.width, height: canvas.height, left: canvas.left, right: canvas.right } : null,
        railTop: rail ? rail.top : null,
        bounds: debug.getModelScreenBounds(),
        auto: auto ? { width: auto.width, height: auto.height } : null,
        settings: settings ? { width: settings.width, height: settings.height } : null,
        cardName: (() => {
          const node = document.querySelector('.scard-name');
          if (!node) return null;
          const style = getComputedStyle(node);
          return { overflow: style.overflow, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
        })(),
      };
    });
    record(
      '移动端无横向滚动',
      mobile.doc <= mobile.inner && mobile.body <= mobile.inner,
      `scrollWidth ${mobile.doc}/${mobile.body} ≤ ${mobile.inner}`,
    );
    record(
      '移动端缩球模型 50-85% viewport 且水平居中',
      Boolean(mobile.bounds) &&
        mobile.bounds.width >= mobile.inner * 0.5 &&
        mobile.bounds.width <= mobile.inner * 0.85 &&
        Math.abs((mobile.bounds.left + mobile.bounds.right) / 2 - mobile.inner / 2) < 30,
      mobile.bounds
        ? `${mobile.bounds.width.toFixed(0)} / ${mobile.inner} · centre ${(
            (mobile.bounds.left + mobile.bounds.right) /
            2
          ).toFixed(0)}`
        : 'missing',
    );
    record(
      '移动端模型底部不被 rail 遮挡',
      Boolean(mobile.bounds && mobile.railTop !== null) && mobile.bounds.bottom <= mobile.railTop - 4,
      mobile.bounds ? `bottom ${mobile.bounds.bottom.toFixed(0)} / rail ${mobile.railTop?.toFixed(0)}` : 'missing',
    );
    record(
      '移动端结构卡标题溢出省略',
      Boolean(mobile.cardName) &&
        mobile.cardName.overflow === 'hidden' &&
        mobile.cardName.textOverflow === 'ellipsis' &&
        mobile.cardName.whiteSpace === 'nowrap',
      JSON.stringify(mobile.cardName),
    );
    record(
      '移动端设置/自动旋转热区 >= 44px',
      Boolean(mobile.auto && mobile.settings) &&
        mobile.auto.width >= 44 &&
        mobile.auto.height >= 44 &&
        mobile.settings.width >= 44 &&
        mobile.settings.height >= 44,
      JSON.stringify({ auto: mobile.auto, settings: mobile.settings }),
    );
    record(
      '移动端 canvas 高度 >= 700',
      Boolean(mobile.canvas && mobile.canvas.height >= 700),
      mobile.canvas ? `${mobile.canvas.width}×${mobile.canvas.height}` : 'missing',
    );

    // mobile display section: scrollable, 44px range/button hit areas
    await page.locator('#mobile-settings').click();
    await settle(page, 400);
    const mobileAutoOpen = await page.evaluate(() => {
      const section = document.querySelector('.psec[data-section="display"]');
      const scroller = document.querySelector('.panel-scroll');
      if (!section || !scroller) return null;
      return {
        expanded: section.classList.contains('is-open'),
        scrollTop: scroller.scrollTop,
        sectionTop: section.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      };
    });
    record(
      '移动端打开 sheet 自动展开并定位“显示”section',
      Boolean(mobileAutoOpen && mobileAutoOpen.expanded && mobileAutoOpen.scrollTop > 0 && mobileAutoOpen.sectionTop < 80),
      JSON.stringify(mobileAutoOpen),
    );
    await scrollPanelTo(page, '.psec[data-section="display"]', 4);
    await settle(page, 300);
    const mobileDisplay = await page.evaluate(() => {
      const range = document.querySelector('#display-radius')?.getBoundingClientRect();
      const rangeReset = document.querySelector('#display-radius-reset')?.getBoundingClientRect();
      const shell = document.querySelector('#display-shell-btn')?.getBoundingClientRect();
      const reset = document.querySelector('#display-reset-btn')?.getBoundingClientRect();
      const section = document.querySelector('.psec[data-section="display"]');
      const scroller = document.querySelector('.panel-scroll');
      return {
        range: range ? { width: range.width, height: range.height } : null,
        rangeReset: rangeReset ? { width: rangeReset.width, height: rangeReset.height } : null,
        shell: shell ? { width: shell.width, height: shell.height } : null,
        reset: reset ? { width: reset.width, height: reset.height } : null,
        expanded: section?.classList.contains('is-open') ?? false,
        scrollTop: scroller?.scrollTop ?? 0,
        doc: document.documentElement.scrollWidth,
        inner: window.innerWidth,
        visibleText: document.querySelector('#display-visible-count')?.textContent,
      };
    });
    record(
      '移动端显示 section 可滚动且滑杆/按钮热区 >=44px',
      mobileDisplay.expanded &&
        mobileDisplay.scrollTop > 100 &&
        mobileDisplay.doc <= mobileDisplay.inner &&
        Boolean(mobileDisplay.range && mobileDisplay.range.height >= 44) &&
        Boolean(mobileDisplay.rangeReset && mobileDisplay.rangeReset.height >= 44) &&
        Boolean(mobileDisplay.shell && mobileDisplay.shell.height >= 44) &&
        Boolean(mobileDisplay.reset && mobileDisplay.reset.height >= 44),
      JSON.stringify(mobileDisplay),
    );
    await page.locator('#panel-close').click();
    await settle(page, 350);

    // mobile export sheet: full-screen, single-column options, 44px actions
    await page.locator('#export-btn').click();
    await page.waitForFunction(() => document.querySelector('#export-dialog')?.open === true);
    await settle(page, 250);
    const mobileExport = await page.evaluate(() => {
      const dialog = document.querySelector('#export-dialog');
      const rect = dialog?.getBoundingClientRect();
      const body = dialog?.querySelector('.dialog-body');
      const controls = dialog?.querySelector('.export-controls');
      const formats = dialog?.querySelector('.export-formats');
      const start = document.querySelector('#export-start')?.getBoundingClientRect();
      const cancel = document.querySelector('#export-cancel')?.getBoundingClientRect();
      const columns = (element) =>
        element ? getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
      return {
        open: Boolean(dialog?.open),
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        doc: document.documentElement.scrollWidth,
        controlColumns: columns(controls),
        formatColumns: columns(formats),
        bodyOverflow: body ? getComputedStyle(body).overflowY : '',
        scrollable: Boolean(body && body.scrollHeight > body.clientHeight),
        start: start ? { width: start.width, height: start.height } : null,
        cancel: cancel ? { width: cancel.width, height: cancel.height } : null,
      };
    });
    record(
      '移动端导出弹窗全屏 / 单列 / 可滚动 / 按钮 >=44px',
      mobileExport.open &&
        Math.abs(mobileExport.width - mobileExport.innerWidth) <= 1 &&
        Math.abs(mobileExport.height - mobileExport.innerHeight) <= 1 &&
        mobileExport.controlColumns === 1 &&
        mobileExport.formatColumns === 1 &&
        mobileExport.bodyOverflow === 'auto' &&
        mobileExport.scrollable &&
        Boolean(mobileExport.start && mobileExport.start.height >= 44) &&
        Boolean(mobileExport.cancel && mobileExport.cancel.height >= 44) &&
        mobileExport.doc <= mobileExport.innerWidth,
      JSON.stringify(mobileExport),
    );
    await page.screenshot({ path: path.join(ARTIFACTS, 'mobile-export.png') });
    await page.locator('#export-cancel').click();
    await settle(page, 300);

    // tapping an atom auto-opens the sheet at the per-atom section
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setEditMode(true));
    const mobileAtom = await page.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const rail = document.querySelector('.status-rail')?.getBoundingClientRect();
      const canvas = document.getElementById('crystal-canvas')?.getBoundingClientRect();
      if (!canvas) return null;
      for (let i = 0; i < 90; i++) {
        if (!debug.isAtomVisible(i)) continue;
        const point = debug.getAtomScreenPosition(i);
        if (
          point &&
          point.inView &&
          point.x > canvas.left + 60 &&
          point.x < canvas.right - 40 &&
          point.y > canvas.top + 130 &&
          point.y < (rail ? rail.top : canvas.bottom) - 40
        ) {
          return { index: i, ...point };
        }
      }
      return null;
    });
    record('移动端找到可点击原子', Boolean(mobileAtom), mobileAtom ? `index ${mobileAtom.index}` : 'none');
    if (mobileAtom) {
      await page.mouse.click(mobileAtom.x, mobileAtom.y);
      await settle(page, 900);
      const sheetOpen = (await page.locator('#panel').getAttribute('class'))?.includes('is-open') ?? false;
      const editExpanded = await page
        .locator('.psec[data-section="edit"] .ps-head')
        .getAttribute('aria-expanded');
      record('点选原子后自动打开 bottom sheet 并展开逐球着色', sheetOpen && editExpanded === 'true', `sheet ${sheetOpen}, edit ${editExpanded}`);
      const sheetBox = await page.locator('#panel').boundingBox();
      record(
        'bottom sheet 78dvh 以内',
        Boolean(sheetBox && sheetBox.height <= 844 * 0.79),
        sheetBox ? `height ${sheetBox.height.toFixed(0)}` : 'missing',
      );
      const closeBox = await page.locator('#panel-close').boundingBox();
      record(
        'bottom sheet 关闭按钮 >= 44px',
        Boolean(closeBox && closeBox.width >= 44 && closeBox.height >= 44),
        closeBox ? `${closeBox.width}×${closeBox.height}` : 'missing',
      );
      await page.screenshot({ path: path.join(ARTIFACTS, 'mobile-sheet.png') });
      await page.locator('#panel-close').click();
      await settle(page, 400);
    }

    // --- mobile Retina / LineMaterial resolution -------------------
    const retinaContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'zh-CN',
    });
    const retinaPage = await retinaContext.newPage();
    await retinaPage.goto(BASE, { waitUntil: 'domcontentloaded' });
    await retinaPage.waitForFunction(() => window.__CRYSTAL_READY__ === true, null, {
      timeout: 30000,
    });
    await retinaPage.evaluate(() => {
      window.__CRYSTAL_DEBUG__.setAutoRotate(false);
      window.__CRYSTAL_DEBUG__.setStructure('fcc');
    });
    await settle(retinaPage, 900);
    await retinaPage.evaluate(() => window.__CRYSTAL_DEBUG__.resetView());
    await settle(retinaPage, 700);
    await retinaPage.screenshot({ path: path.join(ARTIFACTS, 'mobile-retina.png') });
    const retina = await retinaPage.evaluate(() => {
      const debug = window.__CRYSTAL_DEBUG__;
      const canvas = document.getElementById('crystal-canvas');
      const rect = canvas?.getBoundingClientRect();
      return {
        dpr: window.devicePixelRatio,
        buffer: canvas ? [canvas.width, canvas.height] : null,
        css: rect ? [rect.width, rect.height] : null,
        cell: debug.getCellInfo(),
      };
    });
    record(
      '移动端 Retina：canvas 2x 缓冲区且 2.8px 线宽按 CSS 像素解析',
      retina.dpr === 2 &&
        Boolean(retina.buffer && retina.css) &&
        retina.buffer[0] === Math.round(retina.css[0] * 2) &&
        retina.cell.lineWidth >= 2.8 &&
        retina.cell.resolution[0] === Math.round(retina.css[0]),
      JSON.stringify(retina),
    );
    await retinaContext.close();

    // --- persistence ----------------------------------------------
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page, 500);
    await page.evaluate(() => {
      window.__CRYSTAL_DEBUG__.setStructure('fcc');
      window.__CRYSTAL_DEBUG__.setAtomColor('fcc:corner:0.000000,0.000000,0.000000', '#E06A3A');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__CRYSTAL_READY__ === true, null, { timeout: 30000 });
    await settle(page, 700);
    const persisted = await page.evaluate(
      () => window.__CRYSTAL_DEBUG__.getState().atomColors['fcc:corner:0.000000,0.000000,0.000000'] ?? null,
    );
    record('逐球颜色刷新后仍在 localStorage', persisted === '#E06A3A', String(persisted));
    await page.evaluate(() => localStorage.clear());

    // --- console / network ----------------------------------------
    const environmentWarnings = consoleMessages.filter((entry) =>
      // Edge 无头环境自带的 Permissions-Policy 提示与应用无关。
      /GL Driver Message|GPU stall due to ReadPixels|Permissions-Policy/.test(entry.text),
    );
    const appConsole = consoleMessages.filter((entry) => !environmentWarnings.includes(entry));
    record(
      '无应用 console error/warning',
      appConsole.length === 0,
      appConsole.map((entry) => `${entry.type}: ${entry.text}`).join(' | ').slice(0, 400),
    );
    record(
      'SwiftShader 截图读回警告仅来自环境',
      environmentWarnings.length <= 6,
      `${environmentWarnings.length} 条 GL Driver ReadPixels 警告（无头截图 readback）`,
    );
    record('无 pageerror', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
    record('无 404 / 失败响应', badResponses.length === 0, badResponses.join(' | ').slice(0, 300));

    const report = {
      generatedAt: new Date().toISOString(),
      executablePath: CHROMIUM_PATH ?? chromium.executablePath(),
      viewport: { desktop: '1440×900', mobile: '390×844' },
      screenshots: [
        'fcc.png',
        'bcc.png',
        'hcp.png',
        'display-shell-fcc.png',
        'display-shell-bcc.png',
        'display-shell-hcp.png',
        'interstitials.png',
        'interstitials-range-out.png',
        'edit-mode.png',
        'mobile.png',
        'mobile-retina.png',
        'mobile-export.png',
        'mobile-sheet.png',
        'cell-wireframe.png',
        'ghost.png',
      ],
      structureReports,
      results,
      consoleMessages,
      environmentWarnings,
      pageErrors,
      badResponses,
    };
    fs.writeFileSync(path.join(ARTIFACTS, 'visual-report.json'), JSON.stringify(report, null, 2));

    console.log('\n--- console ---');
    console.log(consoleMessages.length ? JSON.stringify(consoleMessages, null, 2) : 'clean');
    console.log('--- pageerrors ---');
    console.log(pageErrors.length ? pageErrors.join('\n') : 'clean');

    await context.close();
  } catch (error) {
    process.exitCode = 1;
    console.error('\nVISUAL CHECK ABORTED');
    console.error(error);
    console.error('\n--- vite log ---\n' + serverLog.slice(-3000));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

main();
