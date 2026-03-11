/**
 * firmware-builder.js
 *
 * Handles all firmware export and download operations for NanoForge.
 *
 * Export modes:
 *   1. PNG ZIP  – Modified assets as individual PNGs in a ZIP archive.
 *                 Compatible with ipod_theme and n7g workflows.
 *   2. SilverDB – Modified SilverDB binary (SilverImagesDB.LE.bin).
 *   3. Full IPSW Rebuild (Experimental) – Attempts a full in-browser IPSW rebuild.
 *                 ⚠️ The resulting IPSW has an INVALID signature and cannot be
 *                 loaded on unmodified hardware. Use with ipod_sun / ipod_theme tools.
 */

import { IPSWUnpacker } from '../parser/IPSWUnpacker.js';
import { MseUnpacker }  from '../parser/MseUnpacker.js';
import { Img1Unpacker } from '../parser/Img1Unpacker.js';
import { Fat16Parser }  from '../parser/Fat16Parser.js';
import { SilverDBPacker } from '../parser/SilverDBPacker.js';
import { downloadBlob, formatBytes } from '../utils/helpers.js';

export class FirmwareBuilder {
    /**
     * @param {object} state - Reference to the global app state
     */
    constructor(state) {
        this.state = state;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Export Mode 1: PNG ZIP
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Downloads all modified assets as individual PNGs inside a ZIP archive.
     * @param {Map<string, HTMLCanvasElement>} modifications
     * @param {function} [onProgress] - (pct: number, msg: string) => void
     */
    async downloadPngZip(modifications, onProgress) {
        if (modifications.size === 0) throw new Error('No modified assets to export.');

        onProgress?.(0, 'Preparing PNG ZIP…');

        const entries = {};
        let i = 0;
        for (const [assetId, canvas] of modifications.entries()) {
            const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
            const buf = await blob.arrayBuffer();
            entries[`${assetId}.png`] = new Uint8Array(buf);
            onProgress?.(Math.round((++i / modifications.size) * 90), `Adding ${assetId}.png…`);
        }

        const zipData = fflate.zipSync(entries, { level: 9 });
        const zipBlob = new Blob([zipData], { type: 'application/zip' });

        onProgress?.(100, `Done – ${formatBytes(zipBlob.size)}`);
        downloadBlob(zipBlob, 'NanoForge_Modified_Assets.zip');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Export Mode 2: Modified SilverDB binary
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Downloads a modified SilverImagesDB.LE.bin with replacements applied.
     * @param {ArrayBuffer} originalSilverDB
     * @param {Map<string, HTMLCanvasElement>} modifications
     * @param {function} [onProgress]
     */
    async downloadSilverDB(originalSilverDB, modifications, onProgress) {
        if (!originalSilverDB) throw new Error('Original SilverDB not loaded. Parse an IPSW first.');
        if (modifications.size === 0) throw new Error('No modifications to apply.');

        onProgress?.(10, 'Packing modified SilverDB…');

        const packer = new SilverDBPacker();
        const { buffer, replacedCount, skippedIds } = packer.pack(originalSilverDB, modifications);

        if (skippedIds.length > 0) {
            console.warn('[FirmwareBuilder] Skipped assets:', skippedIds);
        }

        onProgress?.(90, `Replaced ${replacedCount} assets, skipped ${skippedIds.length}`);

        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        onProgress?.(100, `Done – ${formatBytes(blob.size)}`);
        downloadBlob(blob, 'SilverImagesDB.LE.bin');

        return { replacedCount, skippedIds };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Export Mode 3: Full IPSW Rebuild (Experimental)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Attempts a full in-browser IPSW rebuild with modified SilverDB.
     *
     * Pipeline:
     *   Modified SilverDB → FAT16 update → IMG1 repack → MSE update → IPSW repack
     *
     * ⚠️ WARNING: The IMG1 signature will be ZEROED (invalid).
     *   The resulting IPSW cannot be loaded on stock hardware.
     *   Use ipod_sun or ipod_theme exploit tooling to flash.
     *
     * @param {ArrayBuffer} ipswBuffer - Original IPSW ArrayBuffer
     * @param {ArrayBuffer} originalSilverDB - Original SilverDB
     * @param {Map<string, HTMLCanvasElement>} modifications
     * @param {function} [onProgress]
     * @returns {Promise<{skippedIds: string[], replacedCount: number}>}
     */
    async rebuildIPSW(ipswBuffer, originalSilverDB, modifications, onProgress) {
        if (!ipswBuffer)       throw new Error('IPSW not loaded.');
        if (!originalSilverDB) throw new Error('Original SilverDB not loaded.');
        if (modifications.size === 0) throw new Error('No modifications to apply.');

        onProgress?.(5, 'Step 1/5 – Packing modified SilverDB…');
        const packer = new SilverDBPacker();
        const { buffer: newSilverDB, replacedCount, skippedIds } = packer.pack(originalSilverDB, modifications);

        onProgress?.(15, 'Step 2/5 – Re-extracting FAT16 image…');
        const ipsw = new IPSWUnpacker(ipswBuffer);
        const firmwareMSEBuf = await ipsw.findAndExtract('Firmware.MSE');
        if (!firmwareMSEBuf) throw new Error('Firmware.MSE not found in IPSW.');

        const mse = new MseUnpacker(firmwareMSEBuf);
        const rsrcMeta = mse.findImageByType('rsrc');
        if (!rsrcMeta) throw new Error('rsrc partition not found in MSE.');
        const rsrcImg1Buf = mse.extractImage(rsrcMeta);

        const img1 = new Img1Unpacker();
        const { bodyBin } = await img1.unpack(rsrcImg1Buf);

        onProgress?.(35, 'Step 3/5 – Updating FAT16 filesystem…');
        const fat = new Fat16Parser(bodyBin);
        const dbEntry = fat.findFileRecursive('SilverImagesDB.LE.bin');
        if (!dbEntry) throw new Error('SilverImagesDB.LE.bin not found in FAT16.');

        const newBodyBin = fat.replaceFile(dbEntry, newSilverDB);
        if (!newBodyBin) {
            throw new Error(
                `SilverDB too large for in-place FAT16 update. ` +
                `Try using "Download SilverDB" and applying with ipod_theme instead.`
            );
        }

        onProgress?.(55, 'Step 4/5 – Repacking IMG1 (signature will be zeroed)…');
        const newRsrcImg1 = img1.repack(rsrcImg1Buf, newBodyBin);

        onProgress?.(70, 'Step 5/5 – Repacking MSE and IPSW…');
        const newMSEBuf = mse.replaceImage(rsrcMeta, newRsrcImg1);
        const newIPSWBuf = await ipsw.repack('Firmware.MSE', newMSEBuf);

        const blob = new Blob([newIPSWBuf], { type: 'application/zip' });
        onProgress?.(100, `Done – ${formatBytes(blob.size)} (signature invalid)`);

        downloadBlob(blob, 'NanoForge_Custom_Firmware.ipsw');
        return { replacedCount, skippedIds };
    }
}
