/**
 * MseUnpacker.js
 *
 * Parses Firmware.MSE files and extracts image partitions.
 *
 * Based on work by thgeraads (https://github.com/thgeraads/n7g)
 * Used with gratitude under open research principles.
 * See CREDITS.md for full attribution.
 */

export class MseUnpacker {
    constructor(arrayBuffer) {
        this.buffer = arrayBuffer;
        this.dataView = new DataView(arrayBuffer);
        this.textDecoder = new TextDecoder('ascii');
        this.images = [];
        this._unpack();
    }

    /**
     * Returns all parsed image partition metadata.
     * @returns {object[]} Array of image metadata objects.
     */
    getImages() {
        return this.images;
    }

    /**
     * Finds an image partition within the MSE file by its type.
     * @param {string} type - The four-character type (e.g., "rsrc").
     * @returns {object|null} The metadata object for the found image, or null.
     */
    findImageByType(type) {
        return this.images.find(img => img.type === type) || null;
    }

    /**
     * Extracts the data for a given image partition.
     * @param {object} imageMetadata - The metadata object for the image to extract.
     * @returns {ArrayBuffer|null} An ArrayBuffer containing the image data, or null if invalid.
     */
    extractImage(imageMetadata) {
        if (!imageMetadata) return null;

        const startOffset = imageMetadata.dev_offset + 0x1000;
        const readLength = imageMetadata.length + 0x800;

        if (startOffset + readLength > this.buffer.byteLength) {
            console.error('[MseUnpacker] Calculated read length exceeds buffer bounds.', {
                startOffset, readLength, bufferLength: this.buffer.byteLength
            });
            return null;
        }

        console.log(`[MseUnpacker] Extracting ${imageMetadata.type}.img1: offset=${startOffset}, length=${readLength}`);
        return this.buffer.slice(startOffset, startOffset + readLength);
    }

    /**
     * Replaces a partition's data in the MSE buffer.
     * @param {object} imageMetadata - The partition to replace.
     * @param {ArrayBuffer} newData - The new partition data.
     * @returns {ArrayBuffer} The modified MSE buffer.
     */
    replaceImage(imageMetadata, newData) {
        const startOffset = imageMetadata.dev_offset + 0x1000;
        const output = this.buffer.slice(0);
        const dest = new Uint8Array(output);
        const src = new Uint8Array(newData);
        dest.set(src, startOffset);
        return output;
    }

    /**
     * Internal method to parse the MSE header table.
     * @private
     */
    _unpack() {
        const tableOffset = 0x5000;
        const numSlots = 16;
        const entrySize = 40;

        for (let i = 0; i < numSlots; i++) {
            const currentOffset = tableOffset + (i * entrySize);
            const firstWord = this.dataView.getUint32(currentOffset, true);
            if (firstWord === 0) continue;

            const pieces = [];
            for (let j = 0; j < entrySize; j += 4) {
                pieces.push(new Uint8Array(this.buffer, currentOffset + j, 4));
            }

            // Target and type strings are stored reversed in the file
            const imageTarget = this.textDecoder.decode(pieces[0].slice().reverse());
            const imageType = this.textDecoder.decode(pieces[1].slice().reverse());

            const image = {
                target: imageTarget,
                type: imageType,
                dev_offset: this.dataView.getUint32(currentOffset + 12, true),
                length: this.dataView.getUint32(currentOffset + 16, true),
                address: this.dataView.getUint32(currentOffset + 20, true),
                entry_offset: this.dataView.getUint32(currentOffset + 24, true),
                version: this.dataView.getUint32(currentOffset + 32, true),
                load_address: this.dataView.getUint32(currentOffset + 36, true),
            };

            this.images.push(image);
        }
        console.log('[MseUnpacker] Parsed MSE image table:', this.images);
    }
}
