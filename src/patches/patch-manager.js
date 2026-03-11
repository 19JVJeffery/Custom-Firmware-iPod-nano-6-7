/**
 * patch-manager.js
 *
 * Tracks and manages all modifications made to firmware assets in the current session.
 * Acts as the source of truth for what has been changed.
 */

import { formatTimestamp } from '../utils/helpers.js';

export class PatchManager {
    constructor() {
        /** @type {Map<string, {canvas: HTMLCanvasElement, originalDataURL: string, timestamp: string, description: string}>} */
        this.modifications = new Map();

        /** @type {Array<{timestamp: string, assetId: string, action: string, description: string}>} */
        this.log = [];

        this._listeners = [];
    }

    /**
     * Records a new asset replacement.
     * @param {string} assetId - The asset identifier (e.g. "229442200_0064")
     * @param {HTMLCanvasElement} canvas - The replacement canvas
     * @param {string} originalDataURL - The original asset's data URL (for undo)
     * @param {string} [description] - Human-readable description
     */
    record(assetId, canvas, originalDataURL, description = '') {
        const timestamp = new Date().toISOString();
        const action = this.modifications.has(assetId) ? 'updated' : 'replaced';
        this.modifications.set(assetId, { canvas, originalDataURL, timestamp, description });
        this.log.push({ timestamp, assetId, action, description });
        this._notify();
    }

    /**
     * Reverts a single asset to its original.
     * @param {string} assetId
     * @returns {boolean} true if an entry was removed.
     */
    revert(assetId) {
        if (!this.modifications.has(assetId)) return false;
        const ts = new Date().toISOString();
        this.modifications.delete(assetId);
        this.log.push({ timestamp: ts, assetId, action: 'reverted', description: 'Reverted to original' });
        this._notify();
        return true;
    }

    /**
     * Clears all modifications.
     */
    clear() {
        const ts = new Date().toISOString();
        const count = this.modifications.size;
        this.modifications.clear();
        if (count > 0) {
            this.log.push({ timestamp: ts, assetId: '*', action: 'cleared', description: `Cleared all ${count} modifications` });
        }
        this.log = [];
        this._notify();
    }

    /**
     * Returns whether there are any pending modifications.
     * @returns {boolean}
     */
    hasChanges() {
        return this.modifications.size > 0;
    }

    /**
     * Returns the count of modified assets.
     * @returns {number}
     */
    count() {
        return this.modifications.size;
    }

    /**
     * Registers a callback to be called whenever the patch list changes.
     * @param {function} fn
     */
    onChange(fn) {
        this._listeners.push(fn);
    }

    /**
     * Returns a formatted summary of all active patches.
     * @returns {Array<{assetId: string, timestamp: string, description: string}>}
     */
    getSummary() {
        return Array.from(this.modifications.entries()).map(([assetId, v]) => ({
            assetId,
            timestamp: v.timestamp,
            description: v.description || `Replaced asset ${assetId}`,
        }));
    }

    /**
     * Returns a formatted activity log (all actions including reverts).
     * @returns {Array<{timestamp: string, assetId: string, action: string, description: string}>}
     */
    getLog() {
        return [...this.log].reverse();
    }

    _notify() {
        for (const fn of this._listeners) {
            try { fn(); } catch (e) { console.error('[PatchManager] Listener error:', e); }
        }
    }
}
