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
                if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
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
                    const dataURL = this._createDataURL(imageData);
                    extractedImages.push({
                        id: fileId,
                        format: imageFormat,
                        width,
                        height,
                        imageData,
                        dataURL,
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
        let pixels = new Uint8ClampedArray(width * height * 4);
        let p = offset;

        switch (imageFormat) {
            case 0x1888: // BGRA
                for (let i = 0; i < width * height * 4; i += 4) {
                    pixels[i + 2] = dataView.getUint8(p++); // B→store at B
                    pixels[i + 1] = dataView.getUint8(p++); // G
                    pixels[i + 0] = dataView.getUint8(p++); // R→store at R
                    pixels[i + 3] = dataView.getUint8(p++); // A
                }
                break;

            case 0x0565: // RGB565
                for (let i = 0; i < width * height * 4; i += 4) {
                    const c = dataView.getUint16(p, true); p += 2;
                    pixels[i + 0] = (c & 0xF800) >> 8;
                    pixels[i + 1] = (c & 0x07E0) >> 3;
                    pixels[i + 2] = (c & 0x001F) << 3;
                    pixels[i + 3] = 255;
                }
                break;

            case 0x0008: // 8-bit Greyscale
                for (let i = 0; i < width * height * 4; i += 4) {
                    const v = dataView.getUint8(p++);
                    pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
                    pixels[i + 3] = 255;
                }
                break;

            case 0x0004: // 4-bit Greyscale
                for (let i = 0; i < width * height * 4; i += 8) {
                    const byte = dataView.getUint8(p++);
                    const v1 = (byte >> 4) * 17;
                    const v2 = (byte & 0x0F) * 17;
                    pixels[i] = pixels[i + 1] = pixels[i + 2] = v1; pixels[i + 3] = 255;
                    pixels[i + 4] = pixels[i + 5] = pixels[i + 6] = v2; pixels[i + 7] = 255;
                }
                break;

            case 0x0064: { // 8-bit Paletted
                const paletteLength = dataView.getUint32(p, true); p += 4;
                const palette = [];
                for (let i = 0; i < paletteLength; i++) {
                    const b = dataView.getUint8(p++);
                    const g = dataView.getUint8(p++);
                    const r = dataView.getUint8(p++);
                    const a = dataView.getUint8(p++);
                    palette.push([r, g, b, a]);
                }
                for (let i = 0; i < width * height * 4; i += 4) {
                    const index = dataView.getUint8(p++);
                    const color = palette[index] || [0, 0, 0, 255];
                    pixels[i] = color[0]; pixels[i + 1] = color[1];
                    pixels[i + 2] = color[2]; pixels[i + 3] = color[3];
                }
                break;
            }

            case 0x0065: { // 16-bit Paletted
                const paletteLength = dataView.getUint32(p, true); p += 4;
                if (paletteLength > 65536) {
                    console.warn('[SilverDBUnpacker] Palette too large for 0x0065:', paletteLength);
                    return null;
                }
                const palette = [];
                for (let i = 0; i < paletteLength; i++) {
                    const b = dataView.getUint8(p++);
                    const g = dataView.getUint8(p++);
                    const r = dataView.getUint8(p++);
                    const a = dataView.getUint8(p++);
                    palette.push([r, g, b, a]);
                }
                for (let i = 0; i < width * height * 4; i += 4) {
                    const index = dataView.getUint16(p, true); p += 2;
                    const color = palette[index] || [0, 0, 0, 255];
                    pixels[i] = color[0]; pixels[i + 1] = color[1];
                    pixels[i + 2] = color[2]; pixels[i + 3] = color[3];
                }
                break;
            }

            default:
                return null;
        }

        return pixels;
    }

    _createDataURL(imageData) {
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        canvas.getContext('2d').putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }
}
