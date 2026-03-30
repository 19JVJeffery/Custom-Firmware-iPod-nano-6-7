/**
 * SilverDBUnpacker.js
 *
 * Parses and extracts images from SilverDB (.bin) archives found on iPod Nanos.
 * Supports formats: BGRA (0x1888), RGB565 (0x0565), 8-bit grey (0x0008),
 * 4-bit grey (0x0004), 8-bit paletted (0x0064), 16-bit paletted (0x0065).
 *
 * Based on work by thgeraads (https://github.com/thgeraads/n7g)
 * Used with gratitude under open research principles.
 * See CREDITS.md for full attribution.
 */

export class SilverDBUnpacker {
    /**
     * Unpacks a SilverDB archive from an ArrayBuffer.
     * @param {ArrayBuffer} arrayBuffer - The raw binary data.
     * @param {function} [onProgress] - Optional progress callback: ({processed, total}) => void
     * @returns {Promise<object[]>} Array of image objects with: {id, format, width, height, imageData, dataURL}
     */
    async unpack(arrayBuffer, onProgress) {
        const dataView = new DataView(arrayBuffer);
        let offset = 0;

        // Main header (28 bytes total)
        if (dataView.getUint32(offset, true) !== 0x03) throw new Error('[SilverDBUnpacker] Invalid magic number.');
        offset += 4;
        offset += 4; // Skip code_page
        offset += 4; // Skip table_type
        const tableTypeStr = String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4));
        offset += 4;
        if (tableTypeStr !== 'paMB') throw new Error(`[SilverDBUnpacker] Unsupported table type: "${tableTypeStr}". Expected "paMB".`);
        const fileCount = dataView.getUint32(offset, true);
        offset += 4;
        offset += 8; // Skip unk0, unk1

        // File reference table
        const fileReferences = [];
        for (let i = 0; i < fileCount; i++) {
            const id = dataView.getUint32(offset, true);
            const fileOffset = dataView.getUint32(offset + 4, true);
            const size = dataView.getUint32(offset + 8, true);
            offset += 12;
            if (size > 0 && fileOffset > 0) {
                fileReferences.push({ id, offset: fileOffset, size });
            }
        }
        const refEndOffset = offset;

        const extractedImages = [];

        for (let i = 0; i < fileReferences.length; i++) {
            const fileRef = fileReferences[i];

            if (onProgress && typeof onProgress === 'function') {
                // Yield to the browser every 50 images to keep the UI responsive
                // without the overhead of 4 ms+ setTimeout delays on every batch of 10.
                if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
                onProgress({ processed: i + 1, total: fileReferences.length });
            }

            try {
                const imageHeaderOffset = refEndOffset + fileRef.offset;
                let p = imageHeaderOffset;

                const imageFormat = dataView.getUint16(p, true); p += 2;
                p += 2; // skip file_unk0
                const rowLength = dataView.getUint16(p, true); p += 2;
                const flags = dataView.getUint16(p, true); p += 2;
                p += 8; // skip file_unk1, file_unk2
                const height = dataView.getUint32(p, true); p += 4;
                const width = dataView.getUint32(p, true); p += 4;
                const fileId = dataView.getUint32(p, true); p += 4;
                const dataSize = dataView.getUint32(p, true); p += 4;

                const pixelDataOffset = p;
                const pixels = this._parsePixelData(dataView, pixelDataOffset, {
                    imageFormat, rowLength, height, width, dataSize
                });

                if (pixels) {
                    const imageData = new ImageData(pixels, width, height);
                    // dataURL is intentionally omitted here; it is generated lazily
                    // by the UI only for the assets that are actually displayed,
                    // avoiding hundreds of expensive PNG-encoding canvas.toDataURL()
                    // calls for images that may never be shown.
                    extractedImages.push({
                        id: fileId,
                        format: imageFormat,
                        width,
                        height,
                        imageData,
                        dataURL: null,
                        // Preserve header fields for repacking
                        _headerOffset: imageHeaderOffset,
                        _rowLength: rowLength,
                        _flags: flags,
                    });
                }
            } catch (e) {
                console.warn(`[SilverDBUnpacker] Skipping file ID ${fileRef.id}:`, e.message);
            }
        }

        console.log(`[SilverDBUnpacker] Extracted ${extractedImages.length} images.`);
        return extractedImages;
    }

    _parsePixelData(dataView, offset, { imageFormat, rowLength, height, width, dataSize }) {
        const pixels = new Uint8ClampedArray(width * height * 4);
        const buf = dataView.buffer;
        let p = offset;

        switch (imageFormat) {
            case 0x1888: { // BGRA → RGBA
                // Use a typed Uint8Array view instead of per-byte DataView calls to
                // avoid method-call overhead on every byte across potentially millions
                // of pixels spread across hundreds of images.
                const src = new Uint8Array(buf, p, width * height * 4);
                for (let i = 0; i < src.length; i += 4) {
                    pixels[i]     = src[i + 2]; // R (was at B position)
                    pixels[i + 1] = src[i + 1]; // G
                    pixels[i + 2] = src[i];     // B (was at R position)
                    pixels[i + 3] = src[i + 3]; // A
                }
                break;
            }

            case 0x0565: { // RGB565 → RGBA
                const src = new Uint8Array(buf, p, width * height * 2);
                for (let s = 0, d = 0; d < pixels.length; s += 2, d += 4) {
                    // Reconstruct the 16-bit value from two bytes (little-endian)
                    const c = src[s] | (src[s + 1] << 8);
                    pixels[d]     = (c & 0xF800) >> 8;
                    pixels[d + 1] = (c & 0x07E0) >> 3;
                    pixels[d + 2] = (c & 0x001F) << 3;
                    pixels[d + 3] = 255;
                }
                break;
            }

            case 0x0008: { // 8-bit Greyscale
                const src = new Uint8Array(buf, p, width * height);
                for (let s = 0, d = 0; s < src.length; s++, d += 4) {
                    pixels[d] = pixels[d + 1] = pixels[d + 2] = src[s];
                    pixels[d + 3] = 255;
                }
                break;
            }

            case 0x0004: { // 4-bit Greyscale
                const src = new Uint8Array(buf, p, Math.ceil(width * height / 2));
                for (let s = 0, d = 0; s < src.length; s++, d += 8) {
                    const v1 = (src[s] >> 4) * 17;
                    const v2 = (src[s] & 0x0F) * 17;
                    pixels[d]     = pixels[d + 1] = pixels[d + 2] = v1; pixels[d + 3] = 255;
                    pixels[d + 4] = pixels[d + 5] = pixels[d + 6] = v2; pixels[d + 7] = 255;
                }
                break;
            }

            case 0x0064: { // 8-bit Paletted
                const paletteLength = dataView.getUint32(p, true); p += 4;
                const src = new Uint8Array(buf);
                // Build a flat Uint32 palette (RGBA as little-endian uint32) for
                // O(1) lookup without array-of-arrays allocation per pixel.
                const palette32 = new Uint32Array(paletteLength);
                for (let i = 0; i < paletteLength; i++, p += 4) {
                    // Stored as BGRA; convert to RGBA for ImageData
                    // LE uint32 bytes: [R, G, B, A]
                    palette32[i] = (src[p + 3] << 24) | (src[p] << 16) | (src[p + 1] << 8) | src[p + 2];
                }
                const dstU32 = new Uint32Array(pixels.buffer);
                const indices = new Uint8Array(buf, p, width * height);
                for (let i = 0; i < indices.length; i++) {
                    dstU32[i] = palette32[indices[i]] ?? 0xFF000000;
                }
                break;
            }

            case 0x0065: { // 16-bit Paletted
                const paletteLength = dataView.getUint32(p, true); p += 4;
                if (paletteLength > 65536) {
                    console.warn('[SilverDBUnpacker] Palette too large for 0x0065:', paletteLength);
                    return null;
                }
                const src = new Uint8Array(buf);
                const palette32 = new Uint32Array(paletteLength);
                for (let i = 0; i < paletteLength; i++, p += 4) {
                    palette32[i] = (src[p + 3] << 24) | (src[p] << 16) | (src[p + 1] << 8) | src[p + 2];
                }
                const dstU32 = new Uint32Array(pixels.buffer);
                const indexSrc = new Uint8Array(buf, p, width * height * 2);
                for (let s = 0, d = 0; d < dstU32.length; s += 2, d++) {
                    const index = indexSrc[s] | (indexSrc[s + 1] << 8);
                    dstU32[d] = palette32[index] ?? 0xFF000000;
                }
                break;
            }

            default:
                return null;
        }

        return pixels;
    }
}
