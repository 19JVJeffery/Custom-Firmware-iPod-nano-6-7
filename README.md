# NanoForge

**Browser-based firmware modification toolkit for iPod nano 6th and 7th generation.**

[![GitHub Pages](https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-blue)](https://19JVJeffery.github.io/Custom-Firmware-iPod-nano-6-7)

> ⚠️ **Warning:** Modifying and flashing custom firmware may permanently brick your device. This tool is for **research and development purposes only**. Always keep a backup of your original firmware.

---

## Features

- **IPSW Loader** – Upload an `.ipsw` file and parse it entirely in-browser
- **Firmware Explorer** – Inspect IPSW archive contents, MSE partition table, IMG1 headers, and FAT16 filesystem
- **Asset Browser** – Browse all firmware images grouped by category (App Icons, Wallpapers, UI Elements)
- **Asset Replacement** – Upload PNG replacements for any asset (drag-and-drop supported)
- **Group Sync** – Apply one replacement image to an entire wallpaper group (solid, dotted, stripes, circles)
- **Patch Manager** – Track all modifications with timestamps and descriptions
- **Export: PNG ZIP** – Download modified assets as a ZIP for use with `ipod_theme`
- **Export: SilverDB** – Download a rebuilt `SilverImagesDB.LE.bin` binary
- **Export: IPSW Rebuild** *(Experimental)* – Attempt a full in-browser IPSW rebuild

## Getting Started

1. Open [NanoForge](https://19JVJeffery.github.io/Custom-Firmware-iPod-nano-6-7) in a modern desktop browser
2. Select your iPod model (6G or 7G)
3. Drop or browse to your `.ipsw` firmware file
4. Wait for parsing to complete (~5–15 seconds depending on file size)
5. Browse assets and upload replacements
6. Export your modified firmware

## Where to get firmware files

Stock IPSW files can be found in:
- [NanoVault Stock Firmware Archive](https://github.com/g0lder/NanoVault/tree/main/Stock) by g0lder
- Apple's firmware distribution servers (via third-party IPSW download sites)

> If you encounter a **"Unknown compression type: 8"** error, use a stock IPSW or one rebuilt with [ipod_theme](https://github.com/nfzerox/ipod_theme).

## IPSW Parsing Pipeline

```
IPSW (.ipsw / ZIP)
  └── Firmware.MSE          ← Apple MSE partition container
        └── rsrc.img1       ← Apple IMG1 format (v2.0)
              └── body.bin  ← FAT16 disk image
                    └── SilverImagesDB.LE.bin  ← Asset database
                          └── Images           ← BGRA / RGB565 / Greyscale / Paletted
```

## Supported Image Formats

| Format Code | Name               | Description                      |
|-------------|--------------------|----------------------------------|
| `0x1888`    | BGRA32             | 32-bit full colour with alpha    |
| `0x0565`    | RGB565             | 16-bit colour (wallpapers)       |
| `0x0008`    | Grey8              | 8-bit greyscale                  |
| `0x0004`    | Grey4              | 4-bit greyscale (packed)         |
| `0x0064`    | Indexed8 (paletted)| 8-bit palette (≤255 colours)     |
| `0x0065`    | Indexed16 (paletted)| 16-bit palette (≤65535 colours) |

## Export Options

### PNG ZIP (Recommended)
Downloads all modified assets as PNGs in a ZIP archive. Use with:
- [ipod_theme](https://github.com/nfzerox/ipod_theme) – full IPSW repacking with valid signing
- [n7g asset replacer](https://github.com/thgeraads/n7g) – server-assisted IPSW builder

### SilverDB Binary
Downloads a rebuilt `SilverImagesDB.LE.bin` with all modifications applied in the correct binary format.

### Full IPSW Rebuild *(Experimental)*
Attempts a complete in-browser rebuild:
```
Modified SilverDB → FAT16 update → IMG1 repack → MSE update → IPSW repack
```
> ⚠️ The IMG1 RSA signature will be **zeroed and invalid**. The resulting IPSW cannot be loaded on stock hardware. Use with [ipod_sun](https://github.com/CUB3D/ipod_sun) or [ipod_theme](https://github.com/nfzerox/ipod_theme) exploit tooling.

## Architecture

```
/
├── index.html              Main SPA entry point
├── public/
│   └── style.css           Dark theme CSS
└── src/
    ├── parser/
    │   ├── IPSWUnpacker.js     IPSW (ZIP) extraction
    │   ├── MseUnpacker.js      MSE partition parser
    │   ├── Img1Unpacker.js     IMG1 format parser/rebuilder
    │   ├── Fat16Parser.js      FAT16 filesystem reader/writer
    │   ├── SilverDBUnpacker.js SilverDB image decoder
    │   └── SilverDBPacker.js   SilverDB image encoder
    ├── data/
    │   ├── assets-6g.js        6G important asset IDs
    │   └── assets-7g.js        7G important asset IDs
    ├── patches/
    │   └── patch-manager.js    Modification tracking
    ├── builder/
    │   └── firmware-builder.js Export pipeline
    ├── ui/
    │   └── app.js              Main application controller
    └── utils/
        └── helpers.js          Shared utilities
```

## Credits

This project builds on the work of the iPod reverse engineering community. See [CREDITS.md](CREDITS.md) for full attribution.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Research

See [RESEARCH.md](RESEARCH.md) for technical notes on the firmware format and reverse engineering findings.

## License

This project is open source. See individual file headers for attribution of adapted code.
All original code in this repository is provided under the MIT License.

---

*NanoForge – Because every iPod deserves a second life.*