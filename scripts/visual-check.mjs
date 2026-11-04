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
  const viteBin = path.join(ROOT, 'node_modules/.bin/vite');
  const server = spawn(viteBin, ['--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });
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
      '默认显示：0.68r / 62% / range / 跟随间隙位',
      Math.abs(defaultDisplay.state.atomDisplayRadius - 0.68) < 1e-9 &&
        Math.abs(defaultDisplay.state.displayRange - 0.62) < 1e-9 &&
        defaultDisplay.state.displayMode === 'range' &&
        defaultDisplay.state.followRangeForSites === true,
      JSON.stringify(defaultDisplay.state),
    );
    record(
      'FCC 默认可见原子 >10 且 <63（未堆满立方）',
      defaultDisplay.display.visibleAtomCount > 10 &&
        defaultDisplay.display.visibleAtomCount < 63,
      `${defaultDisplay.display.visibleAtomCount} / ${defaultDisplay.display.totalAtomCount}`,
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
        defaultDisplay.ui.radiusOut?.includes('0.68r') &&
        defaultDisplay.ui.rangeOut?.includes('62%') &&
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
    const diameterAt68 = await page.evaluate(
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
        radius100.diameter > diameterAt68 * 1.3,
      `${diameterAt68.toFixed(1)} → ${radius100.diameter.toFixed(1)} px`,
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
        radius50.diameter < diameterAt68 * 0.8,
      `${diameterAt68.toFixed(1)} → ${radius50.diameter.toFixed(1)} px`,
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
      '显示范围 40% 只剩中心原子',
      range40.display.visibleAtomCount === 1 && range40.uiVisible === '1',
      `${range40.display.visibleAtomCount} · UI ${range40.uiVisible}`,
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setAutoRotate(false));
    await settle(page, 250);
    // Return to the shipped 0.68r defaults before capturing "show all".
    await page.locator('#display-reset-btn').click();
    await settle(page, 350);
    const cameraBeforeAll = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCamera().distance);
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
    record(
      '“显示全部”自动 fit 到全部可见原子',
      allAtoms.camera > cameraBeforeAll + 0.5,
      `${cameraBeforeAll.toFixed(3)} → ${allAtoms.camera.toFixed(3)}`,
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
        Math.abs(shellFccVisual.ring.scale - 2.4 * 0.68) < 1e-6 &&
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
      '三种结构默认都保持缩球且未显示满团簇',
      structureReports.every(
        (entry) =>
          entry.display.visibleAtomCount > 10 &&
          entry.display.visibleAtomCount < entry.display.totalAtomCount &&
          Math.abs(entry.display.displayRadius - 0.68) < 1e-9,
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
    record(
      '默认可见数 FCC 19 / BCC 15 / HCP 19',
      defaultCounts.fcc === 19 && defaultCounts.bcc === 15 && defaultCounts.hcp === 19,
      JSON.stringify(defaultCounts),
    );
    const scales = structureReports.map((entry) => entry.scale);
    record(
      '三种结构原子屏幕直径一致',
      Math.max(...scales) - Math.min(...scales) < 0.5,
      scales.map((value) => value.toFixed(2)).join(' / ') + ' px',
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
      const excludesCorners =
        entry.id === 'hcp'
          ? entry.cell.cornerMarks === 0
          : entry.display.fitRadius <= entry.display.cellBoundsRadius + 1e-6 &&
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
    record(
      'HCP 默认 19 原子 = 1 + 12 + 6 对称壳层',
      hcpStats.count === 19 &&
        hcpShells.length === 3 &&
        Math.abs(hcpShells[0][0]) < 1e-6 &&
        hcpShells[0][1] === 1 &&
        Math.abs(hcpShells[1][0] - 2) < 1e-6 &&
        hcpShells[1][1] === 12 &&
        Math.abs(hcpShells[2][0] - Math.sqrt(8)) < 1e-3 &&
        hcpShells[2][1] === 6,
      JSON.stringify(hcpShells),
    );
    record(
      'HCP 三层分布 6 / 7 / 6，中心原子在原点',
      hcpStats.layers['0'] === 6 &&
        hcpStats.layers['1'] === 7 &&
        hcpStats.layers['2'] === 6 &&
        hcpStats.centerDistance < 1e-9,
      JSON.stringify({ layers: hcpStats.layers, centerDistance: hcpStats.centerDistance }),
    );
    const hcpAnchor = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getCellAnchorInfo());
    record(
      'HCP 六方棱柱锚点 = 配位壳中心原子',
      hcpAnchor.matchesShellCenter === true &&
        hcpAnchor.centerIndex === hcpStats.centerIndex &&
        Math.abs(hcpAnchor.anchor[0]) < 1e-9 &&
        Math.abs(hcpAnchor.anchor[1]) < 1e-9 &&
        Math.abs(hcpAnchor.anchor[2]) < 1e-9,
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
      'HCP 结构说明标注 3D 平移等价单胞 / 2D 标准 A 角',
      Boolean(hcpCellNote?.includes('平移') && hcpCellNote?.includes('A 角')),
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
        Boolean(selected) && inspectorVisible && Math.abs(editRadius - 0.68) < 1e-9,
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
          (index) => ({
            selected: window.__CRYSTAL_DEBUG__.getState().selectedAtomId,
            visible: window.__CRYSTAL_DEBUG__.isAtomVisible(index),
            atomContentHidden: document.querySelector('#atom-content')?.hasAttribute('hidden'),
          }),
          atomPoint.index,
        );
        record(
          '选中原子被范围隐藏后清除选择并隐藏检查器',
          hiddenAfterRange.selected === null &&
            hiddenAfterRange.visible === false &&
            hiddenAfterRange.atomContentHidden === true,
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
    record(
      '进入间隙模式自动展开并滚动到间隙位 section',
      Boolean(panelScroll && panelScroll.expanded && panelScroll.scrollTop > 100 && panelScroll.sectionTop < 40),
      JSON.stringify(panelScroll),
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
    const rangeNote = await page.evaluate(
      () => document.querySelector('#site-range-note')?.textContent ?? '',
    );
    record(
      '间隙范围说明写清“当前显示范围 6 个完整 OCT / 关闭跟随可看全部”',
      rangeNote.includes('6 个完整 OCT') &&
        rangeNote.includes('关闭') &&
        rangeNote.includes('全部'),
      rangeNote,
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

    const siteInfoBefore = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getSiteVisibilityInfo());
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
      '关闭跟随后显示更多间隙位',
      followOff.follow === false &&
        followOff.visibleSites > visibleSiteCountBefore &&
        Number(followOff.uiVisible) === followOff.visibleSites,
      `${visibleSiteCountBefore} → ${followOff.visibleSites}`,
    );

    const partialSite = siteInfoBefore.find(
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

    await page.evaluate(() => {
      const toggle = document.querySelector('#display-follow-sites');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(page, 700);
    const refollow = await page.evaluate(() => ({
      follow: window.__CRYSTAL_DEBUG__.getState().followRangeForSites,
      selected: window.__CRYSTAL_DEBUG__.getState().selectedSiteId,
      visibleSites: window.__CRYSTAL_DEBUG__.getDisplayInfo().visibleSiteCount,
    }));
    record(
      '重新跟随范围后隐藏位点取消选中',
      refollow.follow === true && refollow.selected === null && refollow.visibleSites > 0,
      JSON.stringify(refollow),
    );

    // --- show all: secondary, loud density toast -------------------
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
      '“自动”按钮恢复缩球态 2.8px / 82%',
      autoRestored.state.cellStyleAuto === true &&
        Math.abs(autoRestored.cell.lineWidth - 2.8) < 1e-6 &&
        Math.abs(autoRestored.cell.brightness - 0.82) < 1e-6,
      JSON.stringify(autoRestored),
    );

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
      '移动端缩球模型 50-64% viewport 且水平居中',
      Boolean(mobile.bounds) &&
        mobile.bounds.width >= mobile.inner * 0.5 &&
        mobile.bounds.width <= mobile.inner * 0.64 &&
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
      /GL Driver Message|GPU stall due to ReadPixels/.test(entry.text),
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
