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
                // Must call file.start() so fflate can advance past each file's
                // compressed data (IPSW archives use streaming ZIP with data
                // descriptors, meaning the size is unknown until decompressed).
                file.ondata = () => {};
                file.start();
            });
            // Register deflate handler so fflate can decompress method-8 entries.
            // 7G 2015 IPSWs use deflate compression; without this registration,
            // fflate.Unzip only handles method 0 (stored) and crashes on method 8.
            unzipper.register(fflate.UnzipInflate);
            // fflate.Unzip has no onend callback — push() is synchronous when all
            // data is provided at once with final=true, so resolve after it returns.
            try {
                unzipper.push(this.buffer, true);
                resolve(files);
            } catch (e) {
                reject(e);
            }
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
                } else {
                    // Skip non-target files; fflate still needs to advance past
                    // their compressed data to reach subsequent entries.
                    file.ondata = () => {};
                    file.start();
                }
            });
            // Register deflate handler for method-8 entries (7G 2015 IPSWs use
            // deflate compression; fflate.Unzip only registers method 0 by default).
            unzipper.register(fflate.UnzipInflate);

            // fflate.Unzip has no onend callback — push() is synchronous when all
            // data is provided at once with final=true. Resolve/reject after it returns.
            // If the file was found, resolve(combined.buffer) was already called from
            // inside ondata; in that case !foundFile is false and resolve(null) is skipped.
            try {
                unzipper.push(this.buffer, true);
                if (!foundFile) resolve(null);
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Lists all files in the IPSW archive AND extracts one target file in a
     * single ZIP decompression pass, avoiding the double-pass overhead of
     * calling listFiles() followed by findAndExtract() separately.
     * @param {string} targetFilename - The file to extract (case-insensitive).
     * @returns {Promise<{files: string[], data: ArrayBuffer|null}>}
     */
    listAndExtract(targetFilename) {
        const targetUpper = targetFilename.toUpperCase();
        return new Promise((resolve, reject) => {
            const files = [];
            let extractedData = null;

            const unzipper = new fflate.Unzip(file => {
                files.push(file.name);
                if (file.name.toUpperCase().endsWith(targetUpper)) {
                    console.log(`[IPSWUnpacker] Found target file: ${file.name}`);
                    const chunks = [];
                    file.ondata = (err, chunk, final) => {
                        if (err) { reject(err); return; }
                        chunks.push(chunk);
                        if (final) {
                            const combined = new Uint8Array(
                                chunks.reduce((acc, c) => acc + c.length, 0)
                            );
                            let offset = 0;
                            for (const c of chunks) { combined.set(c, offset); offset += c.length; }
                            extractedData = combined.buffer;
                        }
                    };
                } else {
                    file.ondata = () => {};
                }
                file.start();
            });
            unzipper.register(fflate.UnzipInflate);
            // fflate.Unzip has no onend callback — push() is synchronous when all
            // data is provided at once with final=true, so resolve after it returns.
            try {
                unzipper.push(this.buffer, true);
                resolve({ files, data: extractedData });
            } catch (e) {
                reject(e);
            }
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
            // Register deflate handler for method-8 entries (7G 2015 IPSWs use
            // deflate compression; fflate.Unzip only registers method 0 by default).
            unzipper.register(fflate.UnzipInflate);

            // fflate.Unzip has no onend callback — push() is synchronous when all
            // data is provided at once with final=true. After push() returns, all
            // files have been collected in allFiles; zip them synchronously.
            try {
                unzipper.push(this.buffer, true);
                const zipped = fflate.zipSync(allFiles, { level: 0 });
                resolve(zipped.buffer);
            } catch (e) {
                reject(e);
            }
        });
    }
}
