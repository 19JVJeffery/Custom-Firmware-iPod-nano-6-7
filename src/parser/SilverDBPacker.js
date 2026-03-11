/**
 * SilverDBPacker.js
 *
 * Packs modified images back into SilverDB binary format.
 * Supports in-place modification and full rebuilds when sizes change.
 *
 * Part of NanoForge – https://github.com/19JVJeffery/Custom-Firmware-iPod-nano-6-7
 */

export class SilverDBPacker {
    /**
     * Rebuilds a SilverDB binary with modified images applied.
     *
     * @param {ArrayBuffer} originalBuffer - The original SilverDB binary.
     * @param {Map<string, HTMLCanvasElement>} modifications - Map of assetId → canvas with replacement image.
     * @returns {{buffer: ArrayBuffer, replacedCount: number, skippedIds: string[]}}
     */
    pack(originalBuffer, modifications) {
        const origDv = new DataView(originalBuffer);

        // Read original header (28 bytes)
        const magic     = origDv.getUint32(0, true);
        const code_page = origDv.getUint32(4, true);
        const table_type = origDv.getUint32(8, true);
        const fileCount = origDv.getUint32(16, true);
        const unk0      = origDv.getUint32(20, true);
        const unk1      = origDv.getUint32(24, true);

        const refTableStart = 28;

        // Parse all file references (including empty ones to preserve table structure)
        const allRefs = [];
        let pos = refTableStart;
        for (let i = 0; i < fileCount; i++) {
            const id         = origDv.getUint32(pos, true);
            const fileOffset = origDv.getUint32(pos + 4, true);
            const size       = origDv.getUint32(pos + 8, true);
            pos += 12;
            allRefs.push({ id, offset: fileOffset, size, valid: size > 0 && fileOffset > 0 });
        }
        const refEndOffset = pos; // 28 + fileCount * 12

        // Build image records: for each valid entry, produce a Uint8Array of the full record
        const imageRecords = []; // parallel to allRefs
        const skippedIds = [];
        let replacedCount = 0;

        for (const ref of allRefs) {
            if (!ref.valid) {
                imageRecords.push(null);
                continue;
            }

            const imgOffset = refEndOffset + ref.offset;

            // Read image header fields (32 bytes)
            const imageFormat = origDv.getUint16(imgOffset,      true);
            const file_unk0   = origDv.getUint16(imgOffset +  2, true);
            const rowLength   = origDv.getUint16(imgOffset +  4, true);
            const flags       = origDv.getUint16(imgOffset +  6, true);
            const file_unk1   = origDv.getUint32(imgOffset +  8, true);
            const file_unk2   = origDv.getUint32(imgOffset + 12, true);
            const height      = origDv.getUint32(imgOffset + 16, true);
            const width       = origDv.getUint32(imgOffset + 20, true);
            const fileId      = origDv.getUint32(imgOffset + 24, true);
            const origDataSize = origDv.getUint32(imgOffset + 28, true);

            const assetId = `${fileId}_${imageFormat.toString(16).padStart(4, '0')}`;

            if (modifications.has(assetId)) {
                const canvas = modifications.get(assetId);
                const ctx = canvas.getContext('2d');
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                if (imageData.width !== width || imageData.height !== height) {
                    console.warn(`[SilverDBPacker] Dimension mismatch for ${assetId}: expected ${width}×${height}, got ${imageData.width}×${imageData.height}`);
                    skippedIds.push(assetId);
                } else {
                    const pixelData = this._encodePixels(imageData, imageFormat);
                    if (pixelData) {
                        const newDataSize = pixelData.length;
                        const record = new Uint8Array(32 + newDataSize);
                        const recDv = new DataView(record.buffer);

                        recDv.setUint16(0,  imageFormat, true);
                        recDv.setUint16(2,  file_unk0,   true);
                        recDv.setUint16(4,  rowLength,   true);
                        recDv.setUint16(6,  flags,       true);
                        recDv.setUint32(8,  file_unk1,   true);
                        recDv.setUint32(12, file_unk2,   true);
                        recDv.setUint32(16, height,      true);
                        recDv.setUint32(20, width,       true);
                        recDv.setUint32(24, fileId,      true);
                        recDv.setUint32(28, newDataSize, true);
                        record.set(pixelData, 32);

                        imageRecords.push(record);
                        replacedCount++;
                        continue;
                    } else {
                        console.warn(`[SilverDBPacker] Could not encode format 0x${imageFormat.toString(16)} for ${assetId}`);
                        skippedIds.push(assetId);
                    }
                }
            }

            // Use original record (copy verbatim from source buffer)
            const origRecord = new Uint8Array(originalBuffer, imgOffset, ref.size);
            imageRecords.push(origRecord.slice());
        }

        // Compute new data-area offsets
        let dataAreaSize = 0;
        const newRefEntries = [];
        for (let i = 0; i < allRefs.length; i++) {
            const ref = allRefs[i];
            const record = imageRecords[i];
            if (!ref.valid || !record) {
                newRefEntries.push({ id: ref.id, offset: 0, size: 0 });
            } else {
                newRefEntries.push({ id: ref.id, offset: dataAreaSize, size: record.length });
                dataAreaSize += record.length;
            }
        }

        // Assemble the new binary
        const headerSize = 28;
        const refTableSize = fileCount * 12;
        const totalSize = headerSize + refTableSize + dataAreaSize;

        const output = new Uint8Array(totalSize);
        const outDv = new DataView(output.buffer);

        // Write header
        outDv.setUint32(0,  magic,      true);
        outDv.setUint32(4,  code_page,  true);
        outDv.setUint32(8,  table_type, true);
        // "paMB" at bytes 12-15
        output[12] = 0x70; // 'p'
        output[13] = 0x61; // 'a'
        output[14] = 0x4D; // 'M'
        output[15] = 0x42; // 'B'
        outDv.setUint32(16, fileCount, true);
        outDv.setUint32(20, unk0,      true);
        outDv.setUint32(24, unk1,      true);

        // Write reference table
        let refPos = headerSize;
        for (const entry of newRefEntries) {
            outDv.setUint32(refPos,     entry.id,     true);
            outDv.setUint32(refPos + 4, entry.offset, true);
            outDv.setUint32(refPos + 8, entry.size,   true);
            refPos += 12;
        }

        // Write image records
        let dataPos = headerSize + refTableSize;
        for (const record of imageRecords) {
            if (record) {
                output.set(record, dataPos);
                dataPos += record.length;
            }
        }

        return { buffer: output.buffer, replacedCount, skippedIds };
    }

    /**
     * Encodes ImageData pixels into the target SilverDB format.
     * @param {ImageData} imageData
     * @param {number} imageFormat - SilverDB format constant
     * @returns {Uint8Array|null} Encoded pixel data, or null if format unsupported.
     */
    _encodePixels(imageData, imageFormat) {
        const { width, height, data } = imageData;

        switch (imageFormat) {
            case 0x1888: { // BGRA, 4 bytes/pixel
                const result = new Uint8Array(width * height * 4);
                for (let i = 0, p = 0; i < data.length; i += 4) {
                    result[p++] = data[i + 2]; // B
                    result[p++] = data[i + 1]; // G
                    result[p++] = data[i + 0]; // R
                    result[p++] = data[i + 3]; // A
                }
                return result;
            }

            case 0x0565: { // RGB565, 2 bytes/pixel
                const result = new Uint8Array(width * height * 2);
                const dv = new DataView(result.buffer);
                for (let i = 0, p = 0; i < data.length; i += 4, p += 2) {
                    const r = (data[i]     >> 3) & 0x1F;
                    const g = (data[i + 1] >> 2) & 0x3F;
                    const b = (data[i + 2] >> 3) & 0x1F;
                    dv.setUint16(p, (r << 11) | (g << 5) | b, true);
                }
                return result;
            }

            case 0x0008: { // 8-bit Greyscale
                const result = new Uint8Array(width * height);
                for (let i = 0, j = 0; i < data.length; i += 4, j++) {
                    result[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
                }
                return result;
            }

            case 0x0004: { // 4-bit Greyscale, 2 pixels/byte
                const result = new Uint8Array(Math.ceil(width * height / 2));
                for (let i = 0, j = 0; i < data.length; i += 8, j++) {
                    const v1 = Math.round((0.299 * data[i]     + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 17);
                    const v2 = Math.round((0.299 * data[i + 4] + 0.587 * data[i + 5] + 0.114 * data[i + 6]) / 17);
                    result[j] = ((v1 & 0x0F) << 4) | (v2 & 0x0F);
                }
                return result;
            }

            case 0x0064: { // 8-bit Paletted (≤255 colors)
                if (typeof RgbQuant === 'undefined') {
                    console.warn('[SilverDBPacker] RgbQuant library not loaded. Ensure the RgbQuant script tag is included before this module.');
                    return null;
                }
                return this._encodePaletted(imageData, 255, 1);
            }

            case 0x0065: { // 16-bit Paletted (≤65535 colors)
                if (typeof RgbQuant === 'undefined') {
                    console.warn('[SilverDBPacker] RgbQuant library not loaded. Ensure the RgbQuant script tag is included before this module.');
                    return null;
                }
                return this._encodePaletted(imageData, 65535, 2);
            }

            default:
                console.warn(`[SilverDBPacker] Unsupported image format: 0x${imageFormat.toString(16)}`);
                return null;
        }
    }

    /**
     * Quantizes and encodes an image into paletted format.
     * @param {ImageData} imageData
     * @param {number} maxColors - Max palette size.
     * @param {number} indexBytes - Bytes per palette index (1 or 2).
     * @returns {Uint8Array}
     */
    _encodePaletted(imageData, maxColors, indexBytes) {
        const { width, height } = imageData;

        const q = new RgbQuant({
            colors: maxColors,
            method: 2,
            initColors: 4096,
            minHueCols: 256,
            dithKern: null,
        });
        q.sample(imageData);

        // Get flat RGBA palette array
        const flatPalette = q.palette(true);
        const paletteCount = flatPalette.length / 4;

        // Build lookup map: "r,g,b,a" → index
        const paletteMap = new Map();
        for (let i = 0; i < paletteCount; i++) {
            const r = flatPalette[i * 4];
            const g = flatPalette[i * 4 + 1];
            const b = flatPalette[i * 4 + 2];
            const a = flatPalette[i * 4 + 3];
            paletteMap.set(`${r},${g},${b},${a}`, i);
        }

        // Quantize all pixels
        const quantizedRGBA = q.reduce(imageData, true);

        // Build output: 4 bytes (paletteCount) + palette (4 bytes each) + indices
        const totalSize = 4 + paletteCount * 4 + width * height * indexBytes;
        const result = new Uint8Array(totalSize);
        const dv = new DataView(result.buffer);

        dv.setUint32(0, paletteCount, true);
        let p = 4;

        // Write palette as BGRA
        for (let i = 0; i < paletteCount; i++) {
            result[p++] = flatPalette[i * 4 + 2]; // B
            result[p++] = flatPalette[i * 4 + 1]; // G
            result[p++] = flatPalette[i * 4 + 0]; // R
            result[p++] = flatPalette[i * 4 + 3]; // A
        }

        // Write indices
        for (let i = 0; i < quantizedRGBA.length; i += 4) {
            const r = quantizedRGBA[i];
            const g = quantizedRGBA[i + 1];
            const b = quantizedRGBA[i + 2];
            const a = quantizedRGBA[i + 3];
            const idx = paletteMap.get(`${r},${g},${b},${a}`) ?? 0;
            if (indexBytes === 1) {
                result[p++] = idx & 0xFF;
            } else {
                dv.setUint16(p, idx & 0xFFFF, true);
                p += 2;
            }
        }

        return result;
    }
}
