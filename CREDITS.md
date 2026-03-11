# Credits

NanoForge is built on the shoulders of the iPod reverse engineering community.
This project would not exist without their foundational research and tooling.

---

## Core Parsers and Reverse Engineering

### n7g — thgeraads
- **Repository:** https://github.com/thgeraads/n7g
- **Contribution:** The IPSW parsing pipeline used in NanoForge is directly based on the
  client-side JavaScript parsers developed in the `n7g/asset-replacer-ui` project.
  This includes `IPSWUnpacker.js`, `MseUnpacker.js`, `Img1Unpacker.js`, `Fat16Parser.js`,
  and `SilverDBUnpacker.js`. The important asset ID lists for 6G and 7G devices also originate
  from this project.
- **Thank you** to thgeraads for doing the hard work of reverse engineering the SilverDB format
  and implementing a clean, modular JavaScript parser.

---

## Firmware Tools

### ipod_theme — nfzerox
- **Repository:** https://github.com/nfzerox/ipod_theme
- **Contribution:** Pioneered the workflow for unpacking and repacking iPod nano firmware,
  including extracting IMG1/MSE structures and repacking the SilverDB asset database.
  The firmware rebuild pipeline in NanoForge is informed by the Python scripts in this project.

### ipod_sun — CUB3D
- **Repository:** https://github.com/CUB3D/ipod_sun
- **Contribution:** Demonstrated code execution on the iPod nano using the CVE-2010-1797
  font exploit. This research enables custom firmware to be loaded on unmodified devices.
  NanoForge's "Export: Full IPSW Rebuild" feature is designed to produce files compatible
  with this exploit chain.

---

## Research and Documentation

### freemyipod
- **Website:** https://freemyipod.org
- **Contribution:** The foundational reverse engineering research on Apple S5L-based iPods
  (including the iPod nano 6G and 7G). Their documentation of firmware formats, bootloaders,
  and hardware internals underpins all community tooling.

### NanoVault — g0lder
- **Repository:** https://github.com/g0lder/NanoVault
- **Contribution:** Stock firmware archive and additional research on iPod nano firmware versions.

---

## Libraries

### fflate
- **Repository:** https://github.com/101arrowz/fflate
- **License:** MIT
- **Usage:** ZIP decompression and re-packing for IPSW files (client-side, no server needed)

### RgbQuant.js
- **Repository:** https://github.com/leeoniya/RgbQuant.js
- **License:** MIT
- **Usage:** Colour quantisation for converting replacement images into paletted SilverDB formats

---

## Contributing

If your work should be listed here but isn't, please open a GitHub issue or PR.
We want to make sure all prior art is properly credited.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute to NanoForge.
