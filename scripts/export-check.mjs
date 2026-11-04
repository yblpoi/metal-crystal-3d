#!/usr/bin/env node
/**
 * Export acceptance: real animated WebP / GIF files, decoded with
 * ffprobe/ffmpeg, plus the WebP fallback path and cancellation/restoration.
 *
 * Run with: npm run test:export
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, 'artifacts');
const PORT = 4174;
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited ${code}\n${Buffer.concat(stderr).toString()}`,
          ),
        );
      } else {
        resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() });
      }
    });
  });
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

async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,width,height,nb_read_frames,avg_frame_rate',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(stdout.toString());
  const stream = parsed.streams?.[0] ?? {};
  return {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    frames: Number.parseInt(String(stream.nb_read_frames), 10),
    fps: stream.avg_frame_rate,
  };
}

async function firstFrameRgba(file, width, height) {
  const { stdout } = await run('ffmpeg', [
    '-v',
    'error',
    '-i',
    file,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-',
  ]);
  const expected = width * height * 4;
  if (stdout.length !== expected) {
    throw new Error(`raw frame length ${stdout.length}, expected ${expected}`);
  }
  return stdout;
}

function alphaStats(buffer) {
  let alpha0 = 0;
  let alpha255 = 0;
  let alphaMid = 0;
  for (let offset = 3; offset < buffer.length; offset += 4) {
    const alpha = buffer[offset];
    if (alpha === 0) alpha0++;
    else if (alpha === 255) alpha255++;
    else alphaMid++;
  }
  return { alpha0, alpha255, alphaMid };
}

function pixelAt(buffer, width, x, y) {
  const offset = (y * width + x) * 4;
  return [buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]];
}

function opaqueCoverage(buffer) {
  let opaque = 0;
  for (let offset = 3; offset < buffer.length; offset += 4) {
    if (buffer[offset] > 128) opaque++;
  }
  return opaque / (buffer.length / 4);
}

function borderOpaque(buffer, width, height) {
  let count = 0;
  const check = (x, y) => {
    if (buffer[(y * width + x) * 4 + 3] > 0) count++;
  };
  for (let x = 0; x < width; x++) {
    check(x, 0);
    check(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    check(0, y);
    check(width - 1, y);
  }
  return count;
}

function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Bounding box of opaque gold atom pixels (cell lines are not gold). */
function goldBounds(buffer, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const r = buffer[offset];
      const g = buffer[offset + 1];
      const b = buffer[offset + 2];
      const a = buffer[offset + 3];
      if (a <= 128) continue;
      if (r < 60 || r <= g * 1.06 || g <= b * 1.04) continue;
      count++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX) return null;
  return {
    count,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    fraction: (maxX - minX + 1) / width,
  };
}

/**
 * Alpha-masked contrast against a solid background. `frame` is the
 * transparent export (RGBA), `composited` is the same frame already blended
 * onto the background by ffmpeg. Only pixels with alpha > 64 count as line
 * pixels, so empty canvas does not inflate the result.
 */
function contrastStats(composited, frame, width, height, background) {
  const bgL = luminance(background[0], background[1], background[2]);
  let linePixels = 0;
  let contrasting = 0;
  let nearBackground = 0;
  let nearWhite = 0;
  for (let offset = 0; offset < composited.length; offset += 4) {
    if (frame[offset + 3] <= 64) continue;
    linePixels++;
    const l = luminance(
      composited[offset],
      composited[offset + 1],
      composited[offset + 2],
    );
    const delta = Math.abs(l - bgL);
    if (delta > 0.15) contrasting++;
    else nearBackground++;
    if (l > 0.95) nearWhite++;
  }
  return { linePixels, contrasting, nearBackground, nearWhite };
}

async function openExport(page) {
  await page.click('#export-btn');
  await page.waitForFunction(() => document.querySelector('#export-dialog')?.open === true);
}

async function closeExport(page) {
  if (await page.locator('#export-dialog').evaluate((element) => element.open)) {
    await page.locator('#export-cancel').click({ timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('#export-dialog')?.open === false);
  }
}

async function configure(page, options) {
  await page.locator('#export-format-webp').check({ force: true });
  if (options.format === 'gif') {
    await page.locator('#export-format-gif').check({ force: true });
  }
  await page.selectOption('#export-size', String(options.size));
  await page.selectOption('#export-duration', String(options.duration));
  await page.selectOption('#export-fps', String(options.fps));
  await page.selectOption('#export-loop', '0');
  if (options.background === 'solid') {
    await page.locator('#export-bg-solid').check({ force: true });
    await page.locator('#export-bg-color').evaluate((element, value) => {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, options.color ?? '#061A33');
  } else {
    await page.locator('#export-bg-transparent').check({ force: true });
  }
  if (options.quality !== undefined) {
    await page.locator('#export-quality').evaluate((element, value) => {
      element.value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, options.quality);
  }
}

async function startAndWait(page, timeout = 300000) {
  const started = Date.now();
  await page.locator('#export-start').click({ timeout: 120000 });
  await page.waitForFunction(
    () => {
      const result = document.querySelector('#export-result');
      const error = document.querySelector('#export-error');
      const running = window.__CRYSTAL_DEBUG__?.getExportState?.().running ?? false;
      return (
        (result && !result.hasAttribute('hidden')) ||
        (error && !error.hasAttribute('hidden') && !running)
      );
    },
    null,
    { timeout },
  );
  const elapsed = Date.now() - started;
  const error = await page.locator('#export-error').evaluate((element) =>
    element.hasAttribute('hidden') ? '' : element.textContent?.trim() ?? '',
  );
  if (error) throw new Error(`导出失败: ${error}`);
  return elapsed;
}

async function saveDownload(page, file) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#export-download'),
  ]);
  await download.saveAs(file);
  return download.suggestedFilename();
}

function approx(value, expected, tolerance) {
  return Math.abs(value - expected) <= tolerance;
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
      acceptDownloads: true,
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
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setAutoRotate(false));
    await page.waitForTimeout(400);

    const rendererBefore = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getRendererInfo());
    record(
      '启动后 renderer 为屏幕尺寸',
      rendererBefore.width > 2 && rendererBefore.height > 2 && !rendererBefore.exporting,
      `${rendererBefore.width}×${rendererBefore.height} @ ${rendererBefore.pixelRatio}x`,
    );

    const displayBefore = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      display: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
    }));
    record(
      '导出前为默认缩球视图（0.68r / 19 原子）',
      Math.abs(displayBefore.state.atomDisplayRadius - 0.68) < 1e-9 &&
        displayBefore.state.displayMode === 'range' &&
        displayBefore.display.visibleAtomCount === 19,
      JSON.stringify(displayBefore),
    );

    // --- 540 / 1s / 24fps transparent WebP -------------------------
    await openExport(page);
    await configure(page, { format: 'webp', size: 540, duration: 1, fps: 24, background: 'transparent' });
    await page.screenshot({ path: path.join(ARTIFACTS, 'export-dialog.png') });
    const webpElapsed = await startAndWait(page);
    await page.screenshot({ path: path.join(ARTIFACTS, 'export-dialog-result.png') });
    const webpFile = path.join(ARTIFACTS, 'test-export.webp');
    const webpName = await saveDownload(page, webpFile);
    record(
      'WebP 下载文件名符合命名规则',
      webpName === 'crystal-atlas-fcc-540px-1s-24fps.webp',
      webpName,
    );
    const webpProbe = await probe(webpFile);
    record(
      'ffprobe: WebP 540×540 / 24 帧',
      (webpProbe.codec === 'webp' || webpProbe.codec === 'webp_anim') &&
        webpProbe.width === 540 &&
        webpProbe.height === 540 &&
        webpProbe.frames === 24,
      JSON.stringify(webpProbe),
    );
    const webpFrame = await firstFrameRgba(webpFile, 540, 540);
    const webpAlpha = alphaStats(webpFrame);
    const webpCoverage = opaqueCoverage(webpFrame);
    const webpBorder = borderOpaque(webpFrame, 540, 540);
    const wCorners = [
      pixelAt(webpFrame, 540, 0, 0),
      pixelAt(webpFrame, 540, 539, 0),
      pixelAt(webpFrame, 540, 0, 539),
      pixelAt(webpFrame, 540, 539, 539),
    ];
    const wCenter = pixelAt(webpFrame, 540, 270, 270);
    record(
      'WebP alpha: 透明与不透明像素同时存在',
      webpAlpha.alpha0 > 0 && webpAlpha.alpha255 > 0,
      JSON.stringify(webpAlpha),
    );
    record(
      'WebP 四角透明 / 中心不透明',
      wCorners.every((pixel) => pixel[3] === 0) && wCenter[3] === 255,
      `corners ${wCorners.map((p) => p[3]).join(',')} / center ${wCenter.join(',')}`,
    );
    record(
      'WebP 中心像素为金色（r > g > b）',
      wCenter[0] > wCenter[1] && wCenter[1] > wCenter[2] && wCenter[0] > 60,
      wCenter.join(','),
    );
    record(
      'WebP 首帧覆盖面积符合 19 个缩球（非满团簇）',
      webpCoverage > 0.015 && webpCoverage < 0.32,
      `opaque ${(webpCoverage * 100).toFixed(2)}%`,
    );
    record(
      'WebP 首帧边缘无裁切（边框全透明）',
      webpBorder === 0,
      `border alpha>0: ${webpBorder}`,
    );
    record('WebP 540/1s 导出耗时记录', webpElapsed > 0 && webpElapsed < 180000, `${(webpElapsed / 1000).toFixed(2)} s`);
    const webpGold = goldBounds(webpFrame, 540, 540);
    record(
      '透明导出球簇宽度约占画面 49%（46-53%）',
      Boolean(webpGold) &&
        webpGold.fraction >= 0.46 &&
        webpGold.fraction <= 0.53,
      webpGold
        ? `gold ${webpGold.width}px = ${(webpGold.fraction * 100).toFixed(1)}% · bbox ${webpGold.width}×${webpGold.height}`
        : 'no gold pixels',
    );
    await closeExport(page);

    // --- cell-only export: white / dark line contrast --------------
    await page.locator('#toggle-atoms').uncheck();
    await page.waitForTimeout(450);
    await openExport(page);
    await configure(page, { format: 'webp', size: 540, duration: 1, fps: 24, background: 'transparent' });
    await startAndWait(page);
    const cellFile = path.join(ARTIFACTS, 'test-export-cell.webp');
    await saveDownload(page, cellFile);
    await closeExport(page);
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', cellFile, '-frames:v', '1',
      path.join(ARTIFACTS, 'export-frame-cell.png'),
    ]);
    for (const [background, name] of [
      ['white', 'export-frame-cell-white.png'],
      ['0x061A33', 'export-frame-cell-dark.png'],
    ]) {
      await run('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=${background}:s=540x540`,
        '-i', path.join(ARTIFACTS, 'export-frame-cell.png'),
        '-filter_complex', '[0:v][1:v]overlay=shortest=1:format=auto',
        '-frames:v', '1', path.join(ARTIFACTS, name),
      ]);
    }
    const cellFrame = await firstFrameRgba(path.join(ARTIFACTS, 'export-frame-cell.png'), 540, 540);
    const cellWhite = await firstFrameRgba(path.join(ARTIFACTS, 'export-frame-cell-white.png'), 540, 540);
    const cellDark = await firstFrameRgba(path.join(ARTIFACTS, 'export-frame-cell-dark.png'), 540, 540);
    const cellWhiteContrast = contrastStats(cellWhite, cellFrame, 540, 540, [255, 255, 255]);
    const cellDarkContrast = contrastStats(cellDark, cellFrame, 540, 540, [6, 26, 51]);
    record(
      '白底导出线框：深青芯仍与白底可辨（不是白线/灰雾）',
      cellWhiteContrast.linePixels > 500 &&
        cellWhiteContrast.contrasting / cellWhiteContrast.linePixels > 0.25 &&
        cellWhiteContrast.nearWhite / cellWhiteContrast.linePixels < 0.5,
      `line ${cellWhiteContrast.linePixels}px · contrast ${(
        (cellWhiteContrast.contrasting / cellWhiteContrast.linePixels) *
        100
      ).toFixed(1)}% · near-white ${(
        (cellWhiteContrast.nearWhite / cellWhiteContrast.linePixels) *
        100
      ).toFixed(1)}%`,
    );
    record(
      '深蓝底导出线框：浅色 halo 与底色可辨',
      cellDarkContrast.linePixels > 500 &&
        cellDarkContrast.contrasting / cellDarkContrast.linePixels > 0.4,
      `line ${cellDarkContrast.linePixels}px · contrast ${(
        (cellDarkContrast.contrasting / cellDarkContrast.linePixels) *
        100
      ).toFixed(1)}%`,
    );
    await page.locator('#toggle-atoms').check();
    await page.waitForTimeout(450);

    // --- shell export: ring is UI-only, polyhedron is content ------
    await page.evaluate(() => {
      window.__CRYSTAL_DEBUG__.setStructure('fcc');
      window.__CRYSTAL_DEBUG__.setDisplay({ mode: 'shell' });
    });
    await page.waitForTimeout(750);
    await openExport(page);
    await configure(page, { format: 'webp', size: 540, duration: 1, fps: 24, background: 'transparent' });
    await page.locator('#export-start').click({ timeout: 120000 });
    await page.waitForTimeout(500);
    const shellDuringExport = await page.evaluate(() => ({
      ring: window.__CRYSTAL_DEBUG__.getShellRingInfo(),
      visual: window.__CRYSTAL_DEBUG__.getShellVisualInfo(),
      exporting: window.__CRYSTAL_DEBUG__.getRendererInfo().exporting,
    }));
    await page.waitForFunction(
      () => {
        const result = document.querySelector('#export-result');
        const running = window.__CRYSTAL_DEBUG__?.getExportState?.().running ?? false;
        return result && !result.hasAttribute('hidden') && !running;
      },
      null,
      { timeout: 300000 },
    );
    await saveDownload(page, path.join(ARTIFACTS, 'test-export-shell.webp'));
    await page.locator('#export-close').click();
    await page.waitForFunction(() => document.querySelector('#export-dialog')?.open === false);
    const shellAfterExport = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getShellRingInfo());
    record(
      '导出时中心目标环隐藏，配位多面体保留',
      shellDuringExport.exporting === true &&
        shellDuringExport.ring.visible === false &&
        shellDuringExport.visual.visible === true &&
        shellDuringExport.visual.shape === 'cuboctahedron' &&
        shellDuringExport.visual.vertexCount === 12 &&
        shellAfterExport.visible === true,
      JSON.stringify({ during: shellDuringExport, after: shellAfterExport }),
    );
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.resetDisplay());
    await page.waitForTimeout(450);

    // --- 540 / 1s / 24fps transparent GIF --------------------------
    await openExport(page);
    await configure(page, { format: 'gif', size: 540, duration: 1, fps: 24, background: 'transparent' });
    const gifElapsed = await startAndWait(page);
    const gifFile = path.join(ARTIFACTS, 'test-export.gif');
    const gifName = await saveDownload(page, gifFile);
    record(
      'GIF 下载文件名符合命名规则',
      gifName === 'crystal-atlas-fcc-540px-1s-24fps.gif',
      gifName,
    );
    const gifProbe = await probe(gifFile);
    record(
      'ffprobe: GIF 540×540 / 24 帧',
      gifProbe.codec === 'gif' &&
        gifProbe.width === 540 &&
        gifProbe.height === 540 &&
        gifProbe.frames === 24,
      JSON.stringify(gifProbe),
    );
    const gifFrame = await firstFrameRgba(gifFile, 540, 540);
    const gifAlpha = alphaStats(gifFrame);
    record(
      'GIF 1-bit alpha: 存在透明，无中间 alpha',
      gifAlpha.alpha0 > 0 && gifAlpha.alphaMid === 0,
      JSON.stringify(gifAlpha),
    );
    const gCorners = [
      pixelAt(gifFrame, 540, 0, 0),
      pixelAt(gifFrame, 540, 539, 0),
      pixelAt(gifFrame, 540, 0, 539),
      pixelAt(gifFrame, 540, 539, 539),
    ];
    record(
      'GIF 四角透明',
      gCorners.every((pixel) => pixel[3] === 0),
      gCorners.map((p) => p[3]).join(','),
    );
    record('GIF 540/1s 导出耗时记录', gifElapsed > 0 && gifElapsed < 180000, `${(gifElapsed / 1000).toFixed(2)} s`);
    await closeExport(page);

    // --- solid background WebP -------------------------------------
    await openExport(page);
    await configure(page, {
      format: 'webp',
      size: 540,
      duration: 1,
      fps: 24,
      background: 'solid',
      color: '#123456',
    });
    await startAndWait(page);
    const solidFile = path.join(ARTIFACTS, 'test-export-solid.webp');
    await saveDownload(page, solidFile);
    const solidProbe = await probe(solidFile);
    const solidFrame = await firstFrameRgba(solidFile, 540, 540);
    const sCorners = [
      pixelAt(solidFrame, 540, 0, 0),
      pixelAt(solidFrame, 540, 539, 0),
      pixelAt(solidFrame, 540, 0, 539),
      pixelAt(solidFrame, 540, 539, 539),
    ];
    const solidAlpha = alphaStats(solidFrame);
    record(
      '纯色 WebP 四角 alpha=255 且 RGB 接近所选色',
      sCorners.every(
        (pixel) =>
          pixel[3] === 255 &&
          approx(pixel[0], 0x12, 10) &&
          approx(pixel[1], 0x34, 10) &&
          approx(pixel[2], 0x56, 10),
      ),
      `${JSON.stringify(sCorners[0])} alpha255 ${solidAlpha.alpha255}/${540 * 540}`,
    );
    record(
      '纯色 WebP 尺寸/帧数正确',
      solidProbe.width === 540 && solidProbe.height === 540 && solidProbe.frames === 24,
      JSON.stringify(solidProbe),
    );
    await closeExport(page);

    // --- full-radius / all-atom control export for coverage --------
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setDisplay({ radius: 1, mode: 'all' }));
    await page.waitForTimeout(500);
    const fullDisplayBefore = await page.evaluate(() => ({
      state: window.__CRYSTAL_DEBUG__.getState(),
      display: window.__CRYSTAL_DEBUG__.getDisplayInfo(),
    }));
    await openExport(page);
    await configure(page, { format: 'webp', size: 540, duration: 1, fps: 24, background: 'transparent' });
    await startAndWait(page);
    const fullViewFile = path.join(ARTIFACTS, 'test-export-full.webp');
    await saveDownload(page, fullViewFile);
    const fullViewProbe = await probe(fullViewFile);
    const fullViewFrame = await firstFrameRgba(fullViewFile, 540, 540);
    const fullViewCoverage = opaqueCoverage(fullViewFrame);
    const fullViewBorder = borderOpaque(fullViewFrame, 540, 540);
    record(
      '满球对照导出确实为 63 原子 / 100% r',
      fullDisplayBefore.display.visibleAtomCount === 63 &&
        Math.abs(fullDisplayBefore.state.atomDisplayRadius - 1) < 1e-9 &&
        fullViewProbe.frames === 24,
      JSON.stringify({ display: fullDisplayBefore.display, probe: fullViewProbe }),
    );
    record(
      '缩球导出覆盖率显著小于满球对照',
      webpCoverage < fullViewCoverage * 0.72,
      `shrink ${(webpCoverage * 100).toFixed(2)}% < full ${(fullViewCoverage * 100).toFixed(2)}%`,
    );
    record(
      '满球对照导出边缘无裁切',
      fullViewBorder === 0,
      `border alpha>0: ${fullViewBorder}`,
    );
    await closeExport(page);
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.resetDisplay());
    await page.waitForTimeout(500);

    // --- cancellation restores the live renderer -------------------
    const rendererPreCancel = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getRendererInfo());
    await openExport(page);
    await configure(page, { format: 'webp', size: 1080, duration: 5, fps: 30, background: 'transparent' });
    await page.locator('#export-start').click({ timeout: 120000 });
    await page.waitForTimeout(500);
    await page.click('#export-cancel');
    await page.waitForFunction(
      () => {
        const progress = document.querySelector('#export-progress');
        const start = document.querySelector('#export-start');
        return (
          progress?.hasAttribute('hidden') === true &&
          start?.hasAttribute('hidden') === false &&
          window.__CRYSTAL_DEBUG__?.getExportState?.().running === false
        );
      },
      null,
      { timeout: 60000 },
    );
    const rendererPostCancel = await page.evaluate(() => window.__CRYSTAL_DEBUG__.getRendererInfo());
    const cancelUi = await page.evaluate(() => ({
      downloadHidden: document.querySelector('#export-download')?.hasAttribute('hidden'),
      resultHidden: document.querySelector('#export-result')?.hasAttribute('hidden'),
      note: document.querySelector('#export-error')?.textContent ?? '',
      dialogOpen: document.querySelector('#export-dialog')?.open,
    }));
    record(
      '取消后 renderer 尺寸 / 像素比恢复',
      rendererPostCancel.width === rendererPreCancel.width &&
        rendererPostCancel.height === rendererPreCancel.height &&
        rendererPostCancel.pixelRatio === rendererPreCancel.pixelRatio &&
        rendererPostCancel.exporting === false,
      `${rendererPostCancel.width}×${rendererPostCancel.height} @ ${rendererPostCancel.pixelRatio}x`,
    );
    record(
      '取消后无下载、无结果、UI 恢复',
      cancelUi.downloadHidden === true &&
        cancelUi.resultHidden === true &&
        cancelUi.dialogOpen === true &&
        cancelUi.note.includes('已取消'),
      JSON.stringify(cancelUi),
    );
    await closeExport(page);

    // --- full 1080 / 3s / 30fps -----------------------------------
    await openExport(page);
    await configure(page, { format: 'webp', size: 1080, duration: 3, fps: 30, background: 'transparent' });
    const fullElapsed = await startAndWait(page, 900000);
    const fullFile = path.join(ARTIFACTS, 'test-export-1080.webp');
    const fullName = await saveDownload(page, fullFile);
    const fullProbe = await probe(fullFile);
    const fullFrame = await firstFrameRgba(fullFile, 1080, 1080);
    const fullAlpha = alphaStats(fullFrame);
    const fullSize = fs.statSync(fullFile).size;
    record(
      'ffprobe: 1080×1080 / 90 帧完整 WebP',
      (fullProbe.codec === 'webp' || fullProbe.codec === 'webp_anim') &&
        fullProbe.width === 1080 &&
        fullProbe.height === 1080 &&
        fullProbe.frames === 90,
      JSON.stringify(fullProbe),
    );
    record(
      '1080 WebP alpha 正确且文件非空',
      fullAlpha.alpha0 > 0 && fullAlpha.alpha255 > 0 && fullSize > 100000,
      `${JSON.stringify(fullAlpha)}, ${(fullSize / 1024 / 1024).toFixed(2)} MB`,
    );
    record(
      '1080/3s/30fps 导出耗时记录',
      fullElapsed > 0,
      `${(fullElapsed / 1000).toFixed(2)} s · ${fullName}`,
    );
    await closeExport(page);

    // --- forced @jsquash fallback ---------------------------------
    await page.goto(`${BASE}/?forceWebpFallback=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__CRYSTAL_READY__ === true, null, { timeout: 30000 });
    await page.evaluate(() => window.__CRYSTAL_DEBUG__.setAutoRotate(false));
    await page.waitForTimeout(300);
    await openExport(page);
    await configure(page, { format: 'webp', size: 540, duration: 1, fps: 24, background: 'transparent' });
    const fallbackElapsed = await startAndWait(page, 180000);
    const fallbackEncoder = await page
      .locator('#export-result-encoder')
      .textContent()
      .catch(() => '');
    const fallbackFile = path.join(ARTIFACTS, 'test-export-fallback.webp');
    await saveDownload(page, fallbackFile);
    const fallbackProbe = await probe(fallbackFile);
    const fallbackFrame = await firstFrameRgba(fallbackFile, 540, 540);
    const fallbackAlpha = alphaStats(fallbackFrame);
    record(
      '@jsquash fallback 真实可用（UI 标注）',
      Boolean(fallbackEncoder?.includes('jsquash')),
      fallbackEncoder ?? '',
    );
    record(
      'fallback WebP 540×540 / 24 帧 / alpha',
      (fallbackProbe.codec === 'webp' || fallbackProbe.codec === 'webp_anim') &&
        fallbackProbe.width === 540 &&
        fallbackProbe.height === 540 &&
        fallbackProbe.frames === 24 &&
        fallbackAlpha.alpha0 > 0 &&
        fallbackAlpha.alpha255 > 0,
      `${JSON.stringify(fallbackProbe)} · ${(fallbackElapsed / 1000).toFixed(2)} s`,
    );
    await closeExport(page);

    // --- extract and composite frames -----------------------------
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', webpFile, '-frames:v', '1',
      path.join(ARTIFACTS, 'export-frame-webp.png'),
    ]);
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', gifFile, '-frames:v', '1',
      path.join(ARTIFACTS, 'export-frame-gif.png'),
    ]);
    for (const [background, name] of [
      ['white', 'export-frame-webp-white.png'],
      ['0x061A33', 'export-frame-webp-dark.png'],
    ]) {
      await run('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=${background}:s=540x540`,
        '-i', path.join(ARTIFACTS, 'export-frame-webp.png'),
        '-filter_complex', '[0:v][1:v]overlay=shortest=1:format=auto',
        '-frames:v', '1', path.join(ARTIFACTS, name),
      ]);
    }
    record('ffmpeg 抽帧与白/深蓝底合成完成', true, 'artifacts/export-frame-*.png');

    // --- console hygiene ------------------------------------------
    const swiftshaderNoise = consoleMessages.filter((message) =>
      /ReadPixels|GPU stall|GL Driver Message|SwiftShader|software WebGL/i.test(message.text),
    );
    const realConsole = consoleMessages.filter((message) => !swiftshaderNoise.includes(message));
    record('无页面异常', pageErrors.length === 0, pageErrors.join(' | '));
    record(
      'console 0 error / 0 warning（SwiftShader readback 噪声除外）',
      realConsole.length === 0,
      realConsole.map((message) => `${message.type}: ${message.text}`).join(' | ') ||
        `SwiftShader 噪声 ${swiftshaderNoise.length} 条`,
    );
    record('无 4xx/5xx 资源加载', badResponses.length === 0, badResponses.join(' | '));
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }

  fs.writeFileSync(
    path.join(ARTIFACTS, 'export-report.json'),
    JSON.stringify({ results, consoleMessages, pageErrors, badResponses }, null, 2),
  );
  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
