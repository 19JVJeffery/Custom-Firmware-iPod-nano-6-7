/**
 * helpers.js
 *
 * Shared utility functions for NanoForge.
 */

/**
 * Formats a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Counts the number of unique RGBA colors in an ImageData object.
 * @param {ImageData} imageData
 * @returns {number}
 */
export function countUniqueColors(imageData) {
    const data = imageData.data;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
    }
    return colors.size;
}

/**
 * Returns a format name string for a SilverDB format code.
 * @param {number} format
 * @returns {string}
 */
export function formatName(format) {
    const names = {
        0x1888: 'BGRA32',
        0x0565: 'RGB565',
        0x0008: 'Grey8',
        0x0004: 'Grey4',
        0x0064: 'Idx8 (paletted)',
        0x0065: 'Idx16 (paletted)',
    };
    return names[format] || `0x${format.toString(16).padStart(4, '0')}`;
}

/**
 * Creates a canvas element from an ImageData.
 * @param {ImageData} imageData
 * @returns {HTMLCanvasElement}
 */
export function imageDataToCanvas(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    return canvas;
}

/**
 * Resizes an image (from a File or Blob) to fit within maxWidth × maxHeight,
 * then returns it as an ImageData.
 * @param {Blob} blob
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @returns {Promise<ImageData>}
 */
export async function resizeImageToFit(blob, targetWidth, targetHeight) {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, targetWidth, targetHeight);
    return ctx.getImageData(0, 0, targetWidth, targetHeight);
}

/**
 * Downloads a Blob as a file.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Formats an ISO timestamp to a short local string.
 * @param {string|Date} date
 * @returns {string}
 */
export function formatTimestamp(date) {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Clamps a number between min and max.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}
