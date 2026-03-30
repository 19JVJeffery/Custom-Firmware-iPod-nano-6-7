/**
 * app.js
 *
 * NanoForge – Main Application Controller
 *
 * Coordinates IPSW parsing, asset display, replacement, patch tracking and export.
 * Runs entirely in the browser with no backend server required.
 */

import { IPSWUnpacker }    from '../parser/IPSWUnpacker.js';
import { MseUnpacker }     from '../parser/MseUnpacker.js';
import { Img1Unpacker }    from '../parser/Img1Unpacker.js';
import { Fat16Parser }     from '../parser/Fat16Parser.js';
import { SilverDBUnpacker } from '../parser/SilverDBUnpacker.js';
import { PatchManager }    from '../patches/patch-manager.js';
import { FirmwareBuilder } from '../builder/firmware-builder.js';
import { formatBytes, formatTimestamp, countUniqueColors } from '../utils/helpers.js';

import {
    IMPORTANT_ASSETS_6G, VALID_ASSET_ENDINGS_6G,
    DO_NOT_SHOW_6G, GROUP_MAP_6G, WALLPAPER_SAMPLE_6G,
} from '../data/assets-6g.js';
import {
    IMPORTANT_ASSETS_7G, VALID_ASSET_ENDINGS_7G,
    DO_NOT_SHOW_7G, GROUP_MAP_7G, WALLPAPER_SAMPLE_7G,
} from '../data/assets-7g.js';

// ─── Application State ────────────────────────────────────────────────────────
const state = {
    device:           null,       // '6g' | '7g'
    ipswFile:         null,
    ipswBuffer:       null,
    allImages:        [],         // All extracted SilverDB images
    originalSilverDB: null,       // Original SilverDB ArrayBuffer (for repacking)
    firmwareFiles:    [],         // List of filenames found in IPSW
    showAllMode:      false,
    canvasRefs:       {},         // assetId → {canvas, ctx}
};

const patches  = new PatchManager();
const builder  = new FirmwareBuilder(state);

// ─── Lazy dataURL helper ──────────────────────────────────────────────────────
// SilverDBUnpacker no longer pre-generates dataURLs for every image (which
// required a canvas.toDataURL() PNG encode per image, causing the painful
// startup delay). Instead, we generate the PNG dataURL on first access and
// cache it back onto the image object so subsequent reads are free.
let _dataURLCanvas = null;
function getImgDataURL(img) {
    if (img.dataURL) return img.dataURL;
    if (!_dataURLCanvas) _dataURLCanvas = document.createElement('canvas');
    _dataURLCanvas.width  = img.imageData.width;
    _dataURLCanvas.height = img.imageData.height;
    _dataURLCanvas.getContext('2d').putImageData(img.imageData, 0, 0);
    img.dataURL = _dataURLCanvas.toDataURL('image/png');
    return img.dataURL;
}

// ─── DOM References ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const screens = {
    welcome:   $('screen-welcome'),
    loading:   $('screen-loading'),
    workspace: $('screen-workspace'),
};

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    const content = $(`tab-${tabId}`);
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (content) content.classList.add('active');
    if (btn) btn.classList.add('active');
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// ─── Device Selection ─────────────────────────────────────────────────────────
document.querySelectorAll('.device-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        state.device = btn.dataset.device;
        document.querySelectorAll('.device-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        $('selected-device-label').textContent = state.device.toUpperCase();
        $('device-banner').classList.remove('hidden');
        $('upload-section').classList.remove('hidden');
        $('device-help').textContent =
            state.device === '6g'
                ? 'iPod nano 6th Gen (2010) – 240×240 display'
                : 'iPod nano 7th Gen (2012/2015) – 240×432 display';
    });
});

// ─── File Upload ──────────────────────────────────────────────────────────────
const ipswInput = $('ipsw-input');
const dropZone  = $('drop-zone');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});
dropZone.addEventListener('click', () => ipswInput.click());
ipswInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

async function handleFile(file) {
    if (!state.device) {
        showNotification('Please select your device model first.', 'warn');
        return;
    }
    if (!file.name.toLowerCase().endsWith('.ipsw')) {
        showNotification('Please select a valid .ipsw file.', 'error');
        return;
    }

    state.ipswFile   = file;
    state.allImages  = [];
    state.canvasRefs = {};
    patches.clear();

    showScreen('loading');
    setProgress(0, `Reading ${file.name} (${formatBytes(file.size)})…`);

    try {
        state.ipswBuffer = await file.arrayBuffer();
        await parseIPSW(state.ipswBuffer);
    } catch (err) {
        console.error('[NanoForge] Parsing failed:', err);
        setProgress(0, '');
        showScreen('welcome');
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// ─── IPSW Parsing Pipeline ────────────────────────────────────────────────────
async function parseIPSW(buffer) {
    setProgress(5, 'Opening IPSW archive…');
    const ipsw = new IPSWUnpacker(buffer);

    setProgress(10, 'Listing IPSW contents and extracting Firmware.MSE…');
    const { files: ipswFiles, data: firmwareMSEBuf } = await ipsw.listAndExtract('Firmware.MSE');
    state.firmwareFiles = ipswFiles;
    renderFirmwareTree(state.firmwareFiles, formatBytes(buffer.byteLength), state.ipswFile.name);
    if (!firmwareMSEBuf) throw new Error('Firmware.MSE not found. Is this a valid iPod nano IPSW?');

    setProgress(30, 'Parsing MSE partition table…');
    const mse      = new MseUnpacker(firmwareMSEBuf);
    const rsrcMeta = mse.findImageByType('rsrc');
    if (!rsrcMeta) throw new Error('rsrc partition not found in Firmware.MSE.');
    renderPartitionTable(mse.getImages());

    setProgress(45, 'Extracting rsrc.img1…');
    const rsrcImg1Buf = mse.extractImage(rsrcMeta);

    setProgress(55, 'Unpacking IMG1 body…');
    const img1      = new Img1Unpacker();
    const { headerData, bodyBin } = await img1.unpack(rsrcImg1Buf);
    renderImg1Header(headerData);

    setProgress(65, 'Reading FAT16 filesystem…');
    const fat      = new Fat16Parser(bodyBin);
    const allFiles = fat.listAllFiles();
    renderFat16Files(allFiles);

    const dbEntry  = fat.findFileRecursive('SilverImagesDB.LE.bin');
    if (!dbEntry) throw new Error('SilverImagesDB.LE.bin not found in FAT16 filesystem.');

    setProgress(70, `Extracting SilverDB (${formatBytes(dbEntry.size)})…`);
    const dbBuf = fat.extractFile(dbEntry);
    state.originalSilverDB = dbBuf instanceof ArrayBuffer ? dbBuf : dbBuf.buffer;

    setProgress(75, 'Decoding SilverDB images…');
    const silver = new SilverDBUnpacker();
    state.allImages = await silver.unpack(state.originalSilverDB, ({ processed, total }) => {
        const pct = 75 + Math.round((processed / total) * 20);
        setProgress(pct, `Decoding image ${processed} / ${total}…`);
    });

    setProgress(95, 'Rendering asset grid…');
    await renderAssets();

    setProgress(100, `Loaded ${state.allImages.length} images from ${state.ipswFile.name}`);
    setTimeout(() => showScreen('workspace'), 300);
    showTab('assets');
    updatePatchPanel();
    updateExportPanel();
}

// ─── Screen Management ────────────────────────────────────────────────────────
function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
        el.classList.toggle('hidden', key !== name);
    });
}

function setProgress(pct, msg) {
    const bar  = $('progress-bar');
    const text = $('progress-text');
    if (bar)  bar.style.width  = `${pct}%`;
    if (text) text.textContent = msg;
}

// ─── Firmware Explorer ────────────────────────────────────────────────────────
function renderFirmwareTree(files, totalSize, filename) {
    const el = $('firmware-tree');
    if (!el) return;
    el.innerHTML = `
        <div class="info-row"><span class="info-label">File:</span><span class="info-value">${filename}</span></div>
        <div class="info-row"><span class="info-label">Size:</span><span class="info-value">${totalSize}</span></div>
        <div class="info-row"><span class="info-label">Files in IPSW:</span><span class="info-value">${files.length}</span></div>
        <details class="file-tree"><summary>Contents</summary><ul>
        ${files.map(f => `<li class="tree-item">${escHtml(f)}</li>`).join('')}
        </ul></details>`;
}

function renderPartitionTable(images) {
    const el = $('partition-table');
    if (!el) return;
    el.innerHTML = images.map(img => `
        <div class="partition-row">
            <span class="ptype">${escHtml(img.type)}</span>
            <span class="ptarget">${escHtml(img.target)}</span>
            <span class="plen">${formatBytes(img.length)}</span>
        </div>`).join('');
}

function renderImg1Header(h) {
    const el = $('img1-info');
    if (!el) return;
    el.innerHTML = `
        <div class="info-row"><span class="info-label">Magic:</span><span class="info-value">${escHtml(h.magic)}</span></div>
        <div class="info-row"><span class="info-label">Version:</span><span class="info-value">${escHtml(h.version)}</span></div>
        <div class="info-row"><span class="info-label">Entry:</span><span class="info-value">${escHtml(h.entry_point)}</span></div>
        <div class="info-row"><span class="info-label">Body len:</span><span class="info-value">${formatBytes(h.body_length)}</span></div>`;
}

function renderFat16Files(files) {
    const el = $('fat16-files');
    if (!el) return;
    el.innerHTML = `<details class="file-tree"><summary>${files.length} files in FAT16</summary><ul>
        ${files.map(f => `<li class="tree-item ${f.name.endsWith('.bin') ? 'highlight' : ''}">${escHtml(f.name)} <span class="file-size">(${formatBytes(f.size)})</span></li>`).join('')}
        </ul></details>`;
}

// ─── Asset Grid ───────────────────────────────────────────────────────────────
const DEVICE_CONFIG = {
    '6g': { important: IMPORTANT_ASSETS_6G, validEndings: VALID_ASSET_ENDINGS_6G, doNotShow: DO_NOT_SHOW_6G, groupMap: GROUP_MAP_6G },
    '7g': { important: IMPORTANT_ASSETS_7G, validEndings: VALID_ASSET_ENDINGS_7G, doNotShow: DO_NOT_SHOW_7G, groupMap: GROUP_MAP_7G },
};

async function renderAssets() {
    const grid      = $('asset-grid-inner');
    if (!grid) return;

    const cfg = DEVICE_CONFIG[state.device];
    if (!cfg) return;

    const all = state.allImages;

    // Build filter function
    const filterFn = (img) => {
        const id = `${img.id}_${img.format.toString(16).padStart(4, '0')}`;
        if (cfg.doNotShow.includes(id)) return false;
        if (state.showAllMode) return cfg.validEndings.some(e => id.endsWith(e));
        return Object.values(cfg.important).flat().includes(id);
    };

    const filtered = all.filter(filterFn);
    grid.innerHTML = '';
    state.canvasRefs = {};

    const groups = [
        { key: 'appIcons',   title: 'App Icons' },
        { key: 'wallpapers', title: 'Wallpapers' },
        { key: 'UIelements', title: 'UI Elements' },
    ];

    if (state.showAllMode) {
        const wrapper = document.createElement('div');
        wrapper.className = 'asset-group-content';
        for (const img of filtered) {
            const assetId = `${img.id}_${img.format.toString(16).padStart(4, '0')}`;
            wrapper.appendChild(createAssetCard(img, assetId, cfg));
        }
        grid.appendChild(wrapper);
    } else {
        for (const { key, title } of groups) {
            const groupItems = filtered.filter(img => {
                const id = `${img.id}_${img.format.toString(16).padStart(4, '0')}`;
                return cfg.important[key]?.includes(id);
            });
            if (groupItems.length === 0) continue;

            const section = document.createElement('section');
            section.className = 'asset-group';
            section.innerHTML = `<h3 class="asset-group-title">${title} <span class="badge">${groupItems.length}</span></h3>`;
            const content = document.createElement('div');
            content.className = 'asset-group-content';
            for (const img of groupItems) {
                const assetId = `${img.id}_${img.format.toString(16).padStart(4, '0')}`;
                content.appendChild(createAssetCard(img, assetId, cfg));
            }
            section.appendChild(content);
            grid.appendChild(section);
        }
    }

    $('asset-count').textContent = `${filtered.length} asset${filtered.length !== 1 ? 's' : ''}`;
}

function createAssetCard(img, assetId, cfg) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.dataset.assetId = assetId;

    // Original preview – generate the dataURL lazily (only for displayed assets)
    const origImg = document.createElement('img');
    origImg.src    = getImgDataURL(img);
    origImg.width  = img.width;
    origImg.height = img.height;
    origImg.className = 'asset-thumb pixelated';
    origImg.title  = 'Original';

    // Replacement canvas
    const canvas = document.createElement('canvas');
    canvas.width  = img.width;
    canvas.height = img.height;
    canvas.className = 'asset-thumb pixelated replacement-canvas';
    canvas.title = 'Drop replacement here';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#444';
    ctx.font = `${Math.min(12, img.width / 4)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('+', canvas.width / 2, canvas.height / 2 + 4);

    state.canvasRefs[assetId] = { canvas, ctx, origImg };

    // File input (hidden)
    const fileInput = document.createElement('input');
    fileInput.type   = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'hidden';
    fileInput.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (file) await applyReplacement(assetId, img, file, canvas, ctx, cfg);
    });

    // Click canvas to trigger file input
    canvas.addEventListener('click', () => fileInput.click());

    // Drag-and-drop on canvas
    canvas.addEventListener('dragover',  e => { e.preventDefault(); canvas.classList.add('drag-over'); });
    canvas.addEventListener('dragleave', ()  => canvas.classList.remove('drag-over'));
    canvas.addEventListener('drop', async e => {
        e.preventDefault();
        canvas.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) await applyReplacement(assetId, img, file, canvas, ctx, cfg);
    });

    // Info label
    const info = document.createElement('div');
    info.className = 'asset-info';
    info.innerHTML = `<span class="asset-id">${assetId}</span><br>
        <span class="asset-dim">${img.width}×${img.height}</span>
        <span class="asset-fmt">${img.format.toString(16).padStart(4, '0')}</span>`;

    // Buttons row
    const btnRow = document.createElement('div');
    btnRow.className = 'asset-btn-row';

    const syncBtn = document.createElement('button');
    syncBtn.className = 'btn-sm';
    syncBtn.textContent = 'Sync to group';
    syncBtn.title = 'Apply this replacement to all assets in the same wallpaper group';
    syncBtn.addEventListener('click', () => syncToGroup(assetId, canvas, img, cfg));

    const revertBtn = document.createElement('button');
    revertBtn.className = 'btn-sm btn-danger';
    revertBtn.textContent = 'Revert';
    revertBtn.title = 'Revert to original';
    revertBtn.addEventListener('click', () => revertAsset(assetId, canvas, ctx, img));

    btnRow.append(syncBtn, revertBtn);

    card.append(origImg, canvas, info, btnRow, fileInput);
    return card;
}

async function applyReplacement(assetId, img, file, canvas, ctx, cfg) {
    const bmp = await createImageBitmap(file);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    canvas.classList.add('modified');

    const idata    = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const colorStr = `${countUniqueColors(idata)} colors`;

    patches.record(
        assetId,
        canvas,
        getImgDataURL(img),
        `${file.name} → ${assetId} (${canvas.width}×${canvas.height}, ${colorStr})`
    );
    updatePatchPanel();
    updateExportPanel();
    showNotification(`Replaced ${assetId}`, 'success');
}

function revertAsset(assetId, canvas, ctx, img) {
    patches.revert(assetId);
    // Restore original image to canvas
    const origImg = new Image();
    origImg.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(origImg, 0, 0);
    };
    origImg.src = getImgDataURL(img);
    canvas.classList.remove('modified');
    updatePatchPanel();
    updateExportPanel();
    showNotification(`Reverted ${assetId}`, 'info');
}

async function syncToGroup(assetId, srcCanvas, img, cfg) {
    if (!patches.modifications.has(assetId)) {
        showNotification('Upload a replacement first before syncing to group.', 'warn');
        return;
    }
    const group = getGroupForId(assetId, cfg.groupMap);
    if (!group) {
        showNotification('This asset is not part of a sync group.', 'info');
        return;
    }
    const groupIds = cfg.groupMap[group];
    let count = 0;

    for (const id of groupIds) {
        if (id === assetId || !(id in state.canvasRefs)) continue;
        const { canvas: tgtCanvas, ctx: tgtCtx } = state.canvasRefs[id];

        const srcImageData = srcCanvas.getContext('2d').getImageData(0, 0, srcCanvas.width, srcCanvas.height);
        const tmpImg = new Image();
        tmpImg.src = srcCanvas.toDataURL();
        await tmpImg.decode();

        tgtCtx.clearRect(0, 0, tgtCanvas.width, tgtCanvas.height);
        tgtCtx.drawImage(tmpImg, 0, 0, tgtCanvas.width, tgtCanvas.height);
        tgtCanvas.classList.add('modified');

        patches.record(id, tgtCanvas, state.canvasRefs[id].origImg?.src || '', `Synced from ${assetId}`);
        count++;
    }

    updatePatchPanel();
    updateExportPanel();
    showNotification(`Synced to ${count} assets in group "${group}".`, 'success');
}

function getGroupForId(assetId, groupMap) {
    for (const [group, ids] of Object.entries(groupMap)) {
        if (ids.includes(assetId)) return group;
    }
    return null;
}

// ─── Toggle: Show All / Show Important ────────────────────────────────────────
$('toggle-all-btn')?.addEventListener('click', async () => {
    state.showAllMode = !state.showAllMode;
    $('toggle-all-btn').textContent = state.showAllMode ? 'Show Important Only' : 'Show All Assets';
    await renderAssets();
});

// ─── Patch Panel ──────────────────────────────────────────────────────────────
function updatePatchPanel() {
    const list    = $('patch-list');
    if (!list) return;

    const summary = patches.getSummary();
    const count = summary.length;
    // Update all patch count indicators
    [$('patch-count'), $('patch-count-detail')].forEach(el => { if (el) el.textContent = count; });

    if (summary.length === 0) {
        list.innerHTML = '<p class="empty-msg">No modifications yet. Upload replacement images in the Assets tab.</p>';
        return;
    }

    list.innerHTML = summary.map(p => `
        <div class="patch-item">
            <span class="patch-id">${escHtml(p.assetId)}</span>
            <span class="patch-desc">${escHtml(p.description)}</span>
            <span class="patch-time">${formatTimestamp(p.timestamp)}</span>
        </div>`).join('');
}

// ─── Export Panel ─────────────────────────────────────────────────────────────
function updateExportPanel() {
    const countEl = $('export-mod-count');
    if (countEl) countEl.textContent = patches.count();
}

function setExportStatus(msg, type = 'info') {
    const el = $('export-status');
    if (el) { el.textContent = msg; el.className = `export-status ${type}`; }
}

function setExportProgress(pct, msg) {
    const bar  = $('export-progress-bar');
    const text = $('export-progress-text');
    if (bar)  bar.style.width  = `${pct}%`;
    if (text) text.textContent = msg || '';
    const wrap = $('export-progress-wrap');
    if (wrap) wrap.classList.toggle('hidden', pct === 0 || pct === 100);
}

$('btn-export-zip')?.addEventListener('click', async () => {
    if (!patches.hasChanges()) { showNotification('No modifications to export.', 'warn'); return; }
    try {
        setExportProgress(0, '');
        await builder.downloadPngZip(patches.modifications, (pct, msg) => setExportProgress(pct, msg));
        setExportStatus(`Downloaded ${patches.count()} modified PNGs as ZIP.`, 'success');
    } catch (e) {
        setExportStatus(`Error: ${e.message}`, 'error');
        console.error(e);
    }
});

$('btn-export-silverdb')?.addEventListener('click', async () => {
    if (!state.originalSilverDB) { showNotification('Parse an IPSW first.', 'warn'); return; }
    if (!patches.hasChanges())   { showNotification('No modifications to export.', 'warn'); return; }
    try {
        setExportProgress(0, '');
        const { replacedCount, skippedIds } = await builder.downloadSilverDB(
            state.originalSilverDB, patches.modifications, (pct, msg) => setExportProgress(pct, msg)
        );
        let msg = `Downloaded SilverDB with ${replacedCount} replacements.`;
        if (skippedIds.length) msg += ` (${skippedIds.length} skipped – check console)`;
        setExportStatus(msg, 'success');
    } catch (e) {
        setExportStatus(`Error: ${e.message}`, 'error');
        console.error(e);
    }
});

$('btn-export-ipsw')?.addEventListener('click', async () => {
    if (!state.ipswBuffer)       { showNotification('Parse an IPSW first.', 'warn'); return; }
    if (!state.originalSilverDB) { showNotification('SilverDB not extracted.', 'warn'); return; }
    if (!patches.hasChanges())   { showNotification('No modifications to apply.', 'warn'); return; }

    if (!confirm(
        '⚠️  Experimental: Full IPSW Rebuild\n\n' +
        'The rebuilt IPSW will have an INVALID firmware signature.\n' +
        'It CANNOT be loaded on unmodified hardware.\n\n' +
        'Use with ipod_sun or ipod_theme exploit tooling only.\n\n' +
        'Continue?'
    )) return;

    try {
        setExportProgress(1, 'Starting full IPSW rebuild…');
        const { replacedCount, skippedIds } = await builder.rebuildIPSW(
            state.ipswBuffer, state.originalSilverDB, patches.modifications,
            (pct, msg) => setExportProgress(pct, msg)
        );
        let msg = `Rebuilt IPSW with ${replacedCount} replacements (signature invalid).`;
        if (skippedIds.length) msg += ` ${skippedIds.length} asset(s) skipped.`;
        setExportStatus(msg, 'warn');
    } catch (e) {
        setExportStatus(`Error: ${e.message}`, 'error');
        console.error(e);
    }
});

$('btn-clear-patches')?.addEventListener('click', () => {
    if (!patches.hasChanges()) return;
    if (!confirm('Clear all modifications?')) return;
    patches.clear();
    // Reset all canvas refs
    for (const { canvas, ctx, origImg } of Object.values(state.canvasRefs)) {
        canvas.classList.remove('modified');
        if (origImg) {
            const img = new Image();
            img.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); };
            img.src = origImg.src;
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    updatePatchPanel();
    updateExportPanel();
    showNotification('All modifications cleared.', 'info');
});

// ─── New Firmware Button (return to upload) ──────────────────────────────────
$('btn-new-firmware')?.addEventListener('click', () => {
    if (patches.hasChanges() && !confirm('You have unsaved modifications. Load a new firmware anyway?')) return;
    state.ipswBuffer = null;
    state.allImages  = [];
    state.originalSilverDB = null;
    patches.clear();
    showScreen('welcome');
});

// ─── Notifications ────────────────────────────────────────────────────────────
function showNotification(msg, type = 'info') {
    const container = $('notifications');
    if (!container) return;
    const note = document.createElement('div');
    note.className = `notification notification-${type}`;
    note.textContent = msg;
    container.appendChild(note);
    setTimeout(() => note.classList.add('fade-out'), 3000);
    setTimeout(() => note.remove(), 3500);
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── Initialise ──────────────────────────────────────────────────────────────
showScreen('welcome');
showTab('assets');
console.log('[NanoForge] Ready. No server required.');
