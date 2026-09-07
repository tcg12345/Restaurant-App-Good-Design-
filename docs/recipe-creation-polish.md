# Recipe creation polish

The web-link, scanned-photo, pasted-text, AI-recipe, and AI-idea flows use `RecipeCreation.css`, scoped to `.recipe-create` so manual creation and the existing method chooser keep their layouts. Guideline popovers opt into the same styling through `appearance="modern"`.

`RecipeGeneration` provides the shared animated recipe-card visual for imports, recipe generation, ideas, and combining ideas. Import progress is indeterminate. AI progress uses the existing measured estimate, is labeled estimated, and never displays completion before a response. Long requests remain cancelable; no timer claims that a server phase has completed. Reduced-motion users get a still illustration.

Inputs retain keyboard clearance through `--kb-height`, 16px text, and internal scrolling. Scan upload uses a native button. Photo imports, source text, and web links remain available after errors or cancellation. Canceled responses cannot deliver a draft. AI mode switches and dependent creation actions are disabled while ideas are being generated.

Validation: `npm test -- src/components/RecipeCreation.test.ts`, TypeScript, production build, and iOS asset sync. Browser checks use the actual import/generator components at phone sizes, with local mock services for all generation requests. Launch the isolated preview with `npx vite --config scripts/recipe-preview.vite.ts` and open `/scripts/recipe-creation-preview.html` on port 3012. It does not call AI services or use account quotas. Tests cover web/text/photo imports, late canceled responses, idea results, combination cancellation, and honest progress semantics.

## Faster builder navigation

The recipe chooser and all six builders now share one mounted sheet. Initial method selection is resolved before paint, avoiding a chooser flash when opening directly from Create. Method changes no longer wait for an outgoing full-height panel and a second incoming spring. The sheet opens in 220 ms and exits in 160 ms, with zero-duration presentation when Reduce Motion is enabled. The chooser height cap is removed when entering a full-height builder.

AI and dish setup/generation states switch immediately, with 140–160 ms content entrances. Recipe ideas, chooser options, and completion copy no longer accumulate stagger delays. Generation progress still follows real requests; network timing and cancellation behavior are unchanged.

Thirteen focused tests passed, covering every direct entry method, chooser-to-builder switches in the same surface, full-height layout ownership, imports, and generation/cancellation behavior. TypeScript/build and iOS sync passed. Visual inspection of this update was unavailable while the host Mac was locked.
