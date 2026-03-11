/**
 * Img1Unpacker.js
 *
 * Parses and unpacks IMG1 format files (Apple firmware image format).
 *
 * Based on work by thgeraads (https://github.com/thgeraads/n7g)
 * Used with gratitude under open research principles.
 * See CREDITS.md for full attribution.
 */

export class Img1Unpacker {
    /**
     * Unpacks an IMG1 file from an ArrayBuffer.
     * @param {ArrayBuffer} arrayBuffer - The raw binary data.
     * @returns {Promise<object>} Resolves to an object containing the extracted components.
     */
    async unpack(arrayBuffer) {
        const dataView = new DataView(arrayBuffer);
        const textDecoder = new TextDecoder('ascii');
        let offset = 0;

        console.log('[Img1Unpacker] Reading header...');

        const magic = textDecoder.decode(new Uint8Array(arrayBuffer, offset, 4));
        offset += 4;
        const version = textDecoder.decode(new Uint8Array(arrayBuffer, offset, 3));
        offset += 3;

        if (version !== '2.0') {
            throw new Error(`[Img1Unpacker] Unsupported version: ${version}. Expected "2.0"`);
        }

        const signature_format = dataView.getUint8(offset); offset++;
        const entry_point = dataView.getUint32(offset, true); offset += 4;
        const body_length = dataView.getUint32(offset, true); offset += 4;
        offset += 4; // Skip data_length
        offset += 4; // Skip footer_offset
        const footer_length = dataView.getUint32(offset, true); offset += 4;

        const saltBytes = new Uint8Array(arrayBuffer, offset, 32); offset += 32;
        const unk0 = dataView.getUint16(offset, true); offset += 2;
        const unk1 = dataView.getUint16(offset, true); offset += 2;
        const header_signatureBytes = new Uint8Array(arrayBuffer, offset, 16); offset += 16;
        const header_leftover = dataView.getUint32(offset, true); offset += 4;

        const headerData = {
            magic,
            version,
            signature_format,
            entry_point: `0x${entry_point.toString(16).padStart(8, '0')}`,
            body_length,
            footer_length,
            salt: this._toHexString(saltBytes),
            unk0,
            unk1,
            header_signature: this._toHexString(header_signatureBytes),
            header_leftover: `0x${header_leftover.toString(16).padStart(8, '0')}`
        };

        console.log('[Img1Unpacker] Header:', headerData);

        const bodyOffset = 0x400;
        const bodyBin = arrayBuffer.slice(bodyOffset, bodyOffset + body_length);
        console.log(`[Img1Unpacker] Extracted body.bin: ${bodyBin.byteLength} bytes`);

        const signOffset = bodyOffset + body_length;
        const signBin = arrayBuffer.slice(signOffset, signOffset + 0x80);

        const certOffset = signOffset + 0x80;
        const certBin = arrayBuffer.slice(certOffset, certOffset + footer_length);

        return { headerData, bodyBin, signBin, certBin, bodyOffset };
    }

    /**
     * Rebuilds an IMG1 file with a replaced body.
     * NOTE: The resulting image has an invalidated signature and will not
     * pass hardware verification without additional exploit tooling.
     * @param {ArrayBuffer} originalImg1 - The original IMG1 buffer.
     * @param {ArrayBuffer} newBody - The new body data (FAT16 image).
     * @returns {ArrayBuffer} The rebuilt IMG1 buffer.
     */
    repack(originalImg1, newBody) {
        const dataView = new DataView(originalImg1);
        const bodyOffset = 0x400;
        const newBodyArr = new Uint8Array(newBody);

        // Build: original header (0x400) + new body + zeroed signature (0x80) + original cert
        const origSignOffset = bodyOffset + dataView.getUint32(12, true); // original body_length
        const footer_length = dataView.getUint32(20, true);
        const origCertOffset = origSignOffset + 0x80;
        const certBin = new Uint8Array(originalImg1, origCertOffset, footer_length);

        const totalSize = bodyOffset + newBodyArr.length + 0x80 + footer_length;
        const output = new Uint8Array(totalSize);

        // Copy original header
        output.set(new Uint8Array(originalImg1, 0, bodyOffset), 0);

        // Update body_length in header
        new DataView(output.buffer).setUint32(12, newBodyArr.length, true);

        // Write new body
        output.set(newBodyArr, bodyOffset);

        // Zero out signature (will be invalid)
        // (already zeroed by Uint8Array constructor)

        // Copy original certificate
        output.set(certBin, bodyOffset + newBodyArr.length + 0x80);

        return output.buffer;
    }

    _toHexString(bytes) {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
}
