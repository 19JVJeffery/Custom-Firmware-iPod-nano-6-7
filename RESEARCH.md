# Research Notes

Technical documentation of iPod nano firmware formats and reverse engineering findings
relevant to NanoForge development.

---

## Device Overview

| Model    | Year | Screen     | CPU        | Flash  | IPSW Identifier    |
|----------|------|------------|------------|--------|--------------------|
| nano 6G  | 2010 | 240×240    | Apple S5L8728 | 8/16 GB | iPod1,1            |
| nano 7G  | 2012 | 240×432    | Apple S5L8747 | 16 GB  | iPod2,1 (2012)     |
| nano 7G  | 2015 | 240×432    | Apple S5L8747 | 16 GB  | iPod2,1 (2015)     |

---

## IPSW File Format

An IPSW file is a standard ZIP archive. Key contents:
- `Firmware.MSE` — The main firmware image (MSE partition container)
- `Firmware.plist` — Firmware metadata (may not always be present)
- Various `.sig` and restore support files

---

## MSE Partition Format

`Firmware.MSE` is a custom Apple container that holds multiple firmware partitions.

**Partition Table:**
Located at offset `0x5000` in the MSE file. Contains up to 16 slots of 40 bytes each.

Each entry:
```
Offset  Size  Field
0       4     Target (4-char string, stored byte-reversed)
4       4     Type   (4-char string, stored byte-reversed)
8       4     Unknown
12      4     dev_offset
16      4     length
20      4     address
24      4     entry_offset
28      4     Unknown
32      4     version
36      4     load_address
```

Actual data for a partition starts at `dev_offset + 0x1000` in the MSE file.

**Known partition types:**
- `rsrc` — Resource partition (contains SilverImagesDB.LE.bin)
- `osos` — OS image
- `dtre` — Device tree
- `disk` — Disk partition

---

## IMG1 Format (v2.0)

Used for all firmware partitions in the nano 6G/7G.

**Header (0x400 bytes total):**
```
Offset  Size  Field
0       4     Magic ("img1" in ASCII)
4       3     Version ("2.0" in ASCII)
7       1     signature_format
8       4     entry_point
12      4     body_length
16      4     data_length
20      4     footer_offset
24      4     footer_length
28      32    salt (random bytes)
60      2     unk0
62      2     unk1
64      16    header_signature (RSA over header)
80      4     header_leftover
(padding to 0x400)
```

**After header:**
- `body` (body_length bytes) — The actual partition data (FAT16 for rsrc)
- `sign.bin` (0x80 bytes) — RSA signature over body hash (SHA-1)
- `cert.bin` (footer_length bytes) — Apple certificate chain

**Signature:**
The signature is an RSA-2048 signature over the SHA-1 hash of the body.
The signing key is an Apple private key not publicly known. Without this key, rebuilt IMG1
files will have an invalid signature and will not load on unmodified hardware.

---

## FAT16 Filesystem

The `rsrc` partition body is a FAT16 disk image. Standard FAT16 structure:
- Boot sector at offset 0
- FAT (File Allocation Table)
- Root directory
- Data area

**Key file:** `SilverImagesDB.LE.bin` — Located in the root or a subdirectory.

---

## SilverDB Format (SilverImagesDB.LE.bin)

A custom Apple binary format for storing UI images.

**Main Header (28 bytes):**
```
Offset  Size  Field
0       4     Magic = 0x00000003
4       4     code_page
8       4     table_type
12      4     "paMB" (4 ASCII chars)
16      4     fileCount
20      4     unk0
24      4     unk1
```

**File Reference Table** (fileCount × 12 bytes, starts at offset 28):
```
Offset  Size  Field
0       4     id (image ID)
4       4     offset (from end of reference table)
8       4     size (total record size including 32-byte header)
```

**Image Record** (at refEndOffset + ref.offset):
```
Offset  Size  Field
0       2     imageFormat
2       2     file_unk0
4       2     rowLength
6       2     flags
8       4     file_unk1
12      4     file_unk2
16      4     height
20      4     width
24      4     fileId
28      4     dataSize (pixel data size)
32      *     pixel data
```

### Image Formats

| Code     | Name          | Bytes/pixel | Notes                              |
|----------|---------------|-------------|------------------------------------|
| `0x1888` | BGRA32        | 4           | Full-colour with alpha (stored BGRA) |
| `0x0565` | RGB565        | 2           | 16-bit colour, no alpha            |
| `0x0008` | Grey8         | 1           | 8-bit greyscale                    |
| `0x0004` | Grey4         | 0.5         | 4-bit greyscale, 2 pixels per byte |
| `0x0064` | Indexed8      | 1 + palette | Palette (BGRA, ≤255 entries) + 1-byte indices |
| `0x0065` | Indexed16     | 2 + palette | Palette (BGRA, ≤65535 entries) + 2-byte indices |

For paletted formats, pixel data begins with:
- `4 bytes` — palette entry count (uint32 LE)
- `count × 4 bytes` — palette entries as BGRA

---

## CVE-2010-1797 (Font Exploit)

The `ipod_sun` project demonstrates code execution on iPod nano devices using a heap overflow
in Apple's TrueType font parser. This exploit allows loading unsigned firmware images.

- **CVE:** CVE-2010-1797
- **Vector:** Malformed TrueType font embedded in firmware
- **Effect:** Arbitrary code execution in firmware context
- **Research:** [ipod_sun by CUB3D](https://github.com/CUB3D/ipod_sun)

This exploit is the primary mechanism for loading NanoForge-built custom firmware on
unmodified devices.

---

## Known Firmware Versions

| Device | Version | Build       | Notes                          |
|--------|---------|-------------|--------------------------------|
| 6G     | 1.2     | 36B10147    | Last official release for 6G   |
| 7G     | 1.1.2   | 39A10023    | Last official release for 7G   |
| 7G     | 1.0.1   | 39A10014    | 2015 variant                   |

---

## Further Reading

- [freemyipod.org](https://freemyipod.org) — Foundational iPod reverse engineering
- [ipod_theme](https://github.com/nfzerox/ipod_theme) — Firmware unpacking tools and scripts
- [n7g by thgeraads](https://github.com/thgeraads/n7g) — JavaScript IPSW parsing pipeline
- [NanoVault](https://github.com/g0lder/NanoVault) — Stock firmware archive and research
