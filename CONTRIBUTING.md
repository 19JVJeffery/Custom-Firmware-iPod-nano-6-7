# Contributing to NanoForge

Thank you for your interest in contributing to NanoForge! This is an open research project
and all contributions are welcome.

---

## Ways to Contribute

### Bug Reports
Open a [GitHub Issue](https://github.com/19JVJeffery/Custom-Firmware-iPod-nano-6-7/issues) with:
- Browser and OS version
- Steps to reproduce the issue
- Any error messages from the browser console (F12 → Console)
- The firmware version you were using (if applicable)

### New Asset IDs
If you've identified firmware assets not in the current asset maps (`src/data/assets-6g.js`
or `src/data/assets-7g.js`), please open a PR or issue with:
- The asset ID(s) and format codes
- What the asset appears to be (icon, wallpaper, UI element, etc.)
- Which firmware version they appear in

### Parser Improvements
The parsers in `src/parser/` handle `IPSW → MSE → IMG1 → FAT16 → SilverDB`.
Improvements welcome for:
- Edge cases in parsing (unusual firmware versions)
- Performance optimisations for large files
- Better error messages

### SilverDB Packer
The `SilverDBPacker.js` currently supports all SilverDB pixel formats.
Improvements to the paletted format quantisation are especially welcome.

### New Features
Ideas for future features:
- Font replacement
- String/text resource editing
- Patch plugin system (JSON-defined patches)
- Diff viewer (original vs modified)
- Device detection from IPSW metadata

---

## Development Setup

NanoForge is a pure static web application — no build step required.

```bash
# Clone the repository
git clone https://github.com/19JVJeffery/Custom-Firmware-iPod-nano-6-7.git
cd Custom-Firmware-iPod-nano-6-7

# Serve locally (any static file server works)
# Option 1: Python
python3 -m http.server 8080

# Option 2: Node.js
npx serve .

# Option 3: VS Code Live Server extension
# Just open index.html with Live Server
```

Then open `http://localhost:8080` in your browser.

---

## Code Style

- **Vanilla JavaScript (ES Modules)** — no build tools, no frameworks
- **Modular** — each parser/utility is a standalone ES module
- **Documented** — JSDoc comments for all public methods
- **Attribution** — If you adapt code from another project, add attribution in the file header
  and update `CREDITS.md`

---

## Pull Request Guidelines

1. Fork the repository and create a feature branch
2. Make your changes with clear commit messages
3. Test in Chrome, Firefox, and Safari if possible
4. Open a PR with a description of what changed and why
5. Reference any related issues

---

## Research Contributions

If you have new reverse engineering findings about iPod nano firmware formats,
please document them in [RESEARCH.md](RESEARCH.md) or open an issue for discussion.

---

## Respect Prior Art

This project stands on the shoulders of the iPod reverse engineering community.
When contributing, please:
- Credit any tools or research you used
- Do not include copyrighted firmware blobs in the repository
- Do not include Apple signing keys or private cryptographic material
