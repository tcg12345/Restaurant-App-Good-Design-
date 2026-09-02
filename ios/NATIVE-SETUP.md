# iOS setup steps that are NOT in git

Most of the Xcode project is untracked (see `.gitignore` — only the
hand-written Swift and `PrivacyInfo.xcprivacy` under `ios/` are tracked).
That means some required native configuration exists **only in a local
checkout** and will silently be missing on a fresh clone. The symptom is
always the same: a permission-gated feature fails at runtime with no diff
anywhere explaining why.

Anything added here must be reapplied by hand after a fresh clone.

## `ios/App/App/Info.plist` — usage descriptions

House wording is "We use your X so you can Y." — first person plural, one
sentence, naming the concrete user-facing benefit. Keys currently needed:

| Key | String |
|---|---|
| `NSCameraUsageDescription` | We use your camera so you can take a photo or record a video to share in posts and reels. |
| `NSMicrophoneUsageDescription` | We use your microphone so videos you record include sound. |
| `NSPhotoLibraryUsageDescription` | We use your photo library so you can pick photos and videos to share in posts and reels. |
| `NSLocationWhenInUseUsageDescription` | We use your location to show nearby restaurants and distances. |
| `NSContactsUsageDescription` | We use your contacts so you can find friends you already know on GoodEats. |

A missing usage string is not a build error. On iOS the permission request
either fails outright or — as documented in `HomeLocationBar`'s
`getCurrentHomeLocation` — hangs silently, which is much harder to
diagnose than a crash.

## Custom Swift plugins — register them explicitly

Capacitor's runtime auto-discovery of app-target Swift plugins is
unreliable (see the comment at the top of `MainViewController.swift`): the
class can be in the binary and still not register, surfacing in JS as
`"X" plugin is not implemented on ios`. Every hand-written plugin is
registered in `capacitorDidLoad()`:

```swift
bridge?.registerPluginInstance(PhotoLibraryPlugin())
bridge?.registerPluginInstance(AppThemePlugin())
bridge?.registerPluginInstance(LiquidGlassPlugin())
```

Note this applies to **our own** Swift only. Plugins installed from npm
(`@capacitor-community/contacts`, `@capacitor/share`, …) live in
`node_modules` and are wired up by `npx cap sync ios`, which regenerates
`ios/App/CapApp-SPM/Package.swift`. Those need no manual step and no
`.pbxproj` edit — that is the main reason to prefer an npm plugin over
new app-target Swift when both would work.

## After changing native dependencies

```bash
npm run ios:sync   # vite build + npx cap sync ios
```

`cap sync` rewrites `Package.swift`; it never touches `Info.plist`.
