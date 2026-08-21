# Tab bar glyphs

The source of truth for the four drawn tab icons. They are **not** compiled —
iOS has no public API for rendering an SVG from a bundled file, and the asset
catalog that could do it is gitignored (see `ios/.gitignore`), so the paths are
transcribed into `CGMutablePath` calls in `MainViewController.swift`
(`TabGlyph`). These files are here so the transcription has something to be
checked against.

All four are 24×24, `stroke-width` 1.75, round caps and joins, no fill. The
Swift side scales the whole drawing — stroke included — into the 28pt box a
tab bar glyph gets, so the proportions hold.

If you change one of these, change the matching path in `TabGlyph` and compare
them on screen. The arcs are all 90° corner rounds, which transcribe to
`addArc(tangent1End:tangent2End:radius:)` where the tangent corner is the point
the two adjacent segments would meet at.
