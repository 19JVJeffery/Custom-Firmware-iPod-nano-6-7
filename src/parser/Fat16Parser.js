/**
 * Fat16Parser.js
 *
 * Parses FAT16 disk images, supports Long File Names (LFN), and recursive search.
 *
 * Based on work by thgeraads (https://github.com/thgeraads/n7g)
 * Used with gratitude under open research principles.
 * See CREDITS.md for full attribution.
 */

export class Fat16Parser {
    constructor(arrayBuffer) {
        this.buffer = arrayBuffer;
        this.dataView = new DataView(arrayBuffer);
        this.textDecoder = new TextDecoder('utf-16le');
        this.dosTextDecoder = new TextDecoder('ascii');
        this._parseBootSector();
        this._readFat();
    }

    /**
     * Recursively lists all files in the filesystem.
     * @returns {object[]} Flat array of all file entries.
     */
    listAllFiles() {
        const rootEntries = this._readDirectory(0);
        return this._collectFiles(rootEntries);
    }

    _collectFiles(entries) {
        const result = [];
        for (const entry of entries) {
            if (!entry.isDirectory) {
                result.push(entry);
            } else {
                const subEntries = this._readDirectory(entry.firstCluster);
                result.push(...this._collectFiles(subEntries));
            }
        }
        return result;
    }

    /**
     * Finds a file by recursively searching the entire disk image.
     * @param {string} filename - The name of the file to find (case-insensitive).
     * @returns {object|null} The file entry object if found, otherwise null.
     */
    findFileRecursive(filename) {
        console.log(`[Fat16Parser] Searching for: ${filename}`);
        const rootEntries = this._readDirectory(0);
        return this._searchDirectory(rootEntries, filename.toUpperCase());
    }

    _searchDirectory(entries, targetFilenameUpper) {
        for (const entry of entries) {
            if (!entry.isDirectory && entry.name.toUpperCase() === targetFilenameUpper) {
                console.log(`[Fat16Parser] File found: ${entry.name}`);
                return entry;
            }
        }
        for (const entry of entries) {
            if (entry.isDirectory) {
                const subDirEntries = this._readDirectory(entry.firstCluster);
                const found = this._searchDirectory(subDirEntries, targetFilenameUpper);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * Extracts the content of a file entry.
     * @param {object} fileEntry - The file entry to extract.
     * @returns {ArrayBuffer|null} The file content, or null if invalid.
     */
    extractFile(fileEntry) {
        if (!fileEntry || fileEntry.isDirectory || fileEntry.size === 0) return null;

        const content = new Uint8Array(fileEntry.size);
        let bytesCopied = 0;
        let currentCluster = fileEntry.firstCluster;

        while (currentCluster > 0 && currentCluster < 0xFFF8 && bytesCopied < fileEntry.size) {
            const clusterOffset = this._getClusterOffset(currentCluster);
            const bytesToCopy = Math.min(this.clusterSize, fileEntry.size - bytesCopied);
            const sourceData = new Uint8Array(this.buffer, clusterOffset, bytesToCopy);
            content.set(sourceData, bytesCopied);
            bytesCopied += bytesToCopy;
            currentCluster = this._getNextCluster(currentCluster);
        }

        return content.buffer;
    }

    /**
     * Updates a file in the FAT16 image with new content.
     * Performs an in-place update if the new data fits within the original cluster chain.
     * @param {object} fileEntry - The file entry to update.
     * @param {ArrayBuffer} newData - The new file content.
     * @returns {ArrayBuffer} The modified disk image buffer, or null if it doesn't fit.
     */
    replaceFile(fileEntry, newData) {
        const newBytes = new Uint8Array(newData);
        const newSize = newBytes.length;

        // Count how many clusters the file currently occupies
        let clusterCount = 0;
        let currentCluster = fileEntry.firstCluster;
        const chain = [];
        while (currentCluster > 0 && currentCluster < 0xFFF8) {
            chain.push(currentCluster);
            clusterCount++;
            currentCluster = this._getNextCluster(currentCluster);
        }

        const maxFitSize = clusterCount * this.clusterSize;
        if (newSize > maxFitSize) {
            console.warn(`[Fat16Parser] New file (${newSize} bytes) exceeds original cluster allocation (${maxFitSize} bytes). Cannot replace in-place.`);
            return null;
        }

        // Clone the buffer
        const output = this.buffer.slice(0);
        const outputArr = new Uint8Array(output);

        // Write new data across the original cluster chain
        let bytesWritten = 0;
        for (const cluster of chain) {
            const clusterOffset = this._getClusterOffset(cluster);
            const bytesToWrite = Math.min(this.clusterSize, newSize - bytesWritten);
            if (bytesToWrite > 0) {
                outputArr.set(newBytes.subarray(bytesWritten, bytesWritten + bytesToWrite), clusterOffset);
                bytesWritten += bytesToWrite;
            }
            // Zero out remainder of last cluster
            if (bytesToWrite < this.clusterSize) {
                outputArr.fill(0, clusterOffset + bytesToWrite, clusterOffset + this.clusterSize);
            }
        }

        // Update file size in directory entry
        this._updateDirectoryEntrySize(output, fileEntry, newSize);

        return output;
    }

    _updateDirectoryEntrySize(buffer, fileEntry, newSize) {
        // Re-scan root directory to find the entry and update its size field
        const dv = new DataView(buffer);
        const processRange = (startOffset, endOffset) => {
            for (let offset = startOffset; offset < endOffset; offset += 32) {
                const firstByte = dv.getUint8(offset);
                if (firstByte === 0x00) return true;
                if (firstByte === 0xE5) continue;
                const attributes = dv.getUint8(offset + 11);
                if ((attributes & 0x0F) === 0x0F) continue; // LFN entry
                const firstCluster = dv.getUint16(offset + 26, true);
                if (firstCluster === fileEntry.firstCluster) {
                    dv.setUint32(offset + 28, newSize, true);
                    return true;
                }
            }
            return false;
        };

        // Search root directory
        processRange(this.rootDirStart, this.dataAreaStart);
    }

    _parseBootSector() {
        this.bytesPerSector = this.dataView.getUint16(11, true);
        this.sectorsPerCluster = this.dataView.getUint8(13);
        this.reservedSectors = this.dataView.getUint16(14, true);
        this.numFats = this.dataView.getUint8(16);
        this.rootEntries = this.dataView.getUint16(17, true);
        this.sectorsPerFat = this.dataView.getUint16(22, true);
        this.fatStart = this.reservedSectors * this.bytesPerSector;
        this.rootDirStart = this.fatStart + (this.numFats * this.sectorsPerFat * this.bytesPerSector);
        this.rootDirSectors = Math.ceil((this.rootEntries * 32) / this.bytesPerSector);
        this.dataAreaStart = this.rootDirStart + (this.rootDirSectors * this.bytesPerSector);
        this.clusterSize = this.sectorsPerCluster * this.bytesPerSector;
    }

    _readFat() {
        this.fat = new Uint16Array(this.buffer, this.fatStart, this.sectorsPerFat * this.bytesPerSector / 2);
    }

    _getNextCluster(currentCluster) {
        if (currentCluster >= this.fat.length) return 0xFFF8;
        return (this.fat[currentCluster] >= 0xFFF8) ? 0 : this.fat[currentCluster];
    }

    _parseLfnEntry(offset) {
        const partOffsets = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
        let name = '';
        for (const partOffset of partOffsets) {
            const charCode = this.dataView.getUint16(offset + partOffset, true);
            if (charCode === 0x0000 || charCode === 0xFFFF) return name;
            name += String.fromCharCode(charCode);
        }
        return name;
    }

    _readDirectory(startCluster) {
        const entries = [];
        let lfnBuffer = [];

        const processRange = (startOffset, endOffset) => {
            for (let offset = startOffset; offset < endOffset; offset += 32) {
                const firstByte = this.dataView.getUint8(offset);
                if (firstByte === 0x00) return true;
                if (firstByte === 0xE5) { lfnBuffer = []; continue; }
                const attributes = this.dataView.getUint8(offset + 11);
                if ((attributes & 0x0F) === 0x0F) {
                    lfnBuffer.unshift(this._parseLfnEntry(offset));
                } else {
                    const entry = this._parseShortEntry(offset);
                    if (entry) {
                        if (lfnBuffer.length > 0) { entry.name = lfnBuffer.join(''); lfnBuffer = []; }
                        if (entry.name !== '.' && entry.name !== '..') entries.push(entry);
                    }
                }
            }
            return false;
        };

        if (startCluster === 0) {
            processRange(this.rootDirStart, this.dataAreaStart);
        } else {
            let currentCluster = startCluster;
            while (currentCluster > 0 && currentCluster < 0xFFF8) {
                const clusterOffset = this._getClusterOffset(currentCluster);
                if (processRange(clusterOffset, clusterOffset + this.clusterSize)) break;
                currentCluster = this._getNextCluster(currentCluster);
            }
        }
        return entries;
    }

    _parseShortEntry(offset) {
        const attributes = this.dataView.getUint8(offset + 11);
        if ((attributes & 0x08) !== 0) return null;
        const rawName = new Uint8Array(this.buffer, offset, 8);
        const rawExt = new Uint8Array(this.buffer, offset + 8, 3);
        const name = this.dosTextDecoder.decode(rawName).trim();
        const ext = this.dosTextDecoder.decode(rawExt).trim();
        return {
            name: ext ? `${name}.${ext}` : name,
            isDirectory: (attributes & 0x10) !== 0,
            firstCluster: this.dataView.getUint16(offset + 26, true),
            size: this.dataView.getUint32(offset + 28, true),
        };
    }

    _getClusterOffset(cluster) {
        return this.dataAreaStart + (cluster - 2) * this.clusterSize;
    }
}
