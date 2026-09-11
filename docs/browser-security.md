# Browser security policy

Production response headers are defined in `vercel.json`. Vite production preview applies the same headers; development leaves HMR unrestricted. These HTTP headers apply to the hosted website, not the bundled Capacitor document.

The enforced policy permits app scripts from the same origin, PostHog's documented asset hosts, and the Google Cast script paths used by Mux. Inline JavaScript, inline event handlers, data/blob script elements and string-based `eval` are blocked. The existing before-paint theme bootstrap has an exact SHA-256 allowance, so dark-mode startup remains immediate. `npm run build` checks this hash; review and update it in `vercel.json` whenever that script changes. A static nonce must not replace it.

Mapbox requires WebAssembly and blob workers. Mux also uses blob workers for playback. React, Motion and player components require inline styles, which remain allowed; this does not allow inline JavaScript. Fonts and the web manifest come from the app origin. HTML form posts stay on the app origin; OAuth and Stripe Checkout use navigation to their external pages rather than embedded forms.

Images, media and fetches may use HTTPS because imported recipe covers, image export/cache paths and upload URLs can originate outside the built-in providers. Supabase's websocket endpoint is explicitly allowed. A narrower connection allowlist runs in report-only mode; it must not be switched to enforcement until legitimate external-photo and upload flows are accounted for. This policy reduces script-injection exposure but does not provide a complete network-exfiltration boundary.

`security_policy_violation` events go only to the existing first-party analytics collector and respect its opt-out/admin settings. Reports include a fixed provider category, directive and blocked/report-only outcome, with deduplication and a 20-report document limit. They never include URL paths, query strings, arbitrary hostnames, signed URLs, script samples or user-entered contents. These diagnostics start with the app bundle, so an error that prevents the bundle loading still needs browser-console inspection. No browser `report-uri` endpoint is configured.

## Source references

- [MDN CSP reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)
- [Mapbox security requirements](https://docs.mapbox.com/mapbox-gl-js/guides/security-and-testing/)
- [Mux policy requirements](https://www.mux.com/docs/core/content-security-policy)
- [PostHog policy requirements](https://posthog.com/docs/advanced/content-security-policy)
