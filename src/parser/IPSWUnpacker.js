/**
 * IPSWUnpacker.js
 *
 * Unpacks IPSW archives (ZIP files) using fflate and extracts a specific file.
 *
 * Based on work by thgeraads (https://github.com/thgeraads/n7g)
 * Used with gratitude under open research principles.
 * See CREDITS.md for full attribution.
 */

export class IPSWUnpacker {
    constructor(arrayBuffer) {
        this.buffer = new Uint8Array(arrayBuffer);
    }

    /**
     * Lists all files inside the IPSW archive.
     * @returns {Promise<string[]>} Array of filenames in the archive.
     */
    listFiles() {
        return new Promise((resolve, reject) => {
            const files = [];
            const unzipper = new fflate.Unzip(file => {
                files.push(file.name);
                // We do not call file.start() since we only need the filename metadata.
            });
            unzipper.onend = (err) => {
                if (err) reject(err);
                else resolve(files);
            };
            unzipper.push(this.buffer, true);
        });
    }

    /**
     * Finds and extracts a single file from the IPSW archive.
     * @param {string} targetFilename - The full path/name of the file to find (case-insensitive).
     * @returns {Promise<ArrayBuffer|null>} The file's content as an ArrayBuffer, or null if not found.
     */
    findAndExtract(targetFilename) {
        return new Promise((resolve, reject) => {
            const targetUpper = targetFilename.toUpperCase();
            let foundFile = false;

            const unzipper = new fflate.Unzip(file => {
                if (file.name.toUpperCase().endsWith(targetUpper)) {
                    foundFile = true;
                    console.log(`[IPSWUnpacker] Found target file: ${file.name}`);
                    const chunks = [];

                    file.ondata = (err, chunk, final) => {
                        if (err) { reject(err); return; }
                        chunks.push(chunk);
                        if (final) {
                            const combined = new Uint8Array(
                                chunks.reduce((acc, val) => acc + val.length, 0)
                            );
                            let offset = 0;
                            for (const chunk of chunks) {
                                combined.set(chunk, offset);
                                offset += chunk.length;
                            }
                            resolve(combined.buffer);
                        }
                    };
                    file.start();
                }
            });

            unzipper.onend = (err) => {
                if (err) reject(err);
                else if (!foundFile) resolve(null);
            };

            unzipper.push(this.buffer, true);
        });
    }

    /**
     * Repacks a modified file into the IPSW archive.
     * @param {string} targetFilename - The filename to replace (case-insensitive match).
     * @param {ArrayBuffer} newData - The new file data.
     * @returns {Promise<ArrayBuffer>} The repacked IPSW as an ArrayBuffer.
     */
    async repack(targetFilename, newData) {
        const targetUpper = targetFilename.toUpperCase();

        return new Promise((resolve, reject) => {
            const allFiles = {};

            const unzipper = new fflate.Unzip(file => {
                const chunks = [];
                file.ondata = (err, chunk, final) => {
                    if (err) { reject(err); return; }
                    chunks.push(chunk);
                    if (final) {
                        const combined = new Uint8Array(
                            chunks.reduce((acc, val) => acc + val.length, 0)
                        );
                        let offset = 0;
                        for (const chunk of chunks) {
                            combined.set(chunk, offset);
                            offset += chunk.length;
                        }
                        if (file.name.toUpperCase().endsWith(targetUpper)) {
                            allFiles[file.name] = new Uint8Array(newData);
                        } else {
                            allFiles[file.name] = combined;
                        }
                    }
                };
                file.start();
            });

            unzipper.onend = (err) => {
                if (err) { reject(err); return; }
                try {
                    const zipped = fflate.zipSync(allFiles, { level: 0 });
                    resolve(zipped.buffer);
                } catch (e) {
                    reject(e);
                }
            };

            unzipper.push(this.buffer, true);
        });
    }
}
