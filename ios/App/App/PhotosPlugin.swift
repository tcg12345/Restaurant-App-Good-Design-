// PhotosPlugin.swift
//
// In-app Capacitor plugin that exposes the iOS PhotoKit library to the
// WebView so the Add Reel / Add Post flow can render an Instagram-style
// inline grid instead of bouncing through the system UIDocumentPicker.
//
// Methods (all called from JS via window.Capacitor.Plugins.PhotoLibrary):
//   - checkPermission()                       → { status }
//   - requestPermission()                     → { status }
//   - listMedia({ mediaType, limit, offset }) → { items: [{ id, type, durationSeconds, thumbnailDataUrl }] }
//   - getMedia({ id })                        → { path: "file:///...", mimeType }
//   - openSettings()                          → opens iOS Settings so the user
//                                                can upgrade from "Selected
//                                                Photos" to "All Photos".
//
// Permission status mirrors PHPhotoLibrary.authorizationStatus:
//   "notDetermined" | "restricted" | "denied" | "authorized" | "limited"
//
// Setup in Xcode (one-time):
//   1. Drag this file into the App target in Xcode's Project Navigator.
//      Make sure "Copy items if needed" is OFF (the file already lives in
//      ios/App/App/) and that the App target is checked.
//   2. Open Info.plist in Xcode and add a row:
//        Key:   Privacy - Photo Library Usage Description
//               (NSPhotoLibraryUsageDescription)
//        Type:  String
//        Value: We use your photo library so you can pick photos and
//               videos to share in posts and reels.
//   3. Clean build (⌘⇧K), then Run.
//
// Capacitor 7+ auto-discovers plugins decorated with @objc / CAPBridgedPlugin
// at app startup. No manual registration required in AppDelegate.

import Foundation
import Capacitor
import Photos
import UIKit
import MobileCoreServices
import UniformTypeIdentifiers

@objc(PhotoLibraryPlugin)
public class PhotoLibraryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotoLibraryPlugin"
    public let jsName = "PhotoLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
    ]

    // Re-use a single caching image manager so repeated thumbnail
    // requests during scroll don't thrash PhotoKit.
    private let imageManager = PHCachingImageManager()

    // MARK: - Permission

    @objc func checkPermission(_ call: CAPPluginCall) {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        call.resolve(["status": statusString(status)])
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            call.resolve(["status": self.statusString(status)])
        }
    }

    private func statusString(_ status: PHAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted:    return "restricted"
        case .denied:        return "denied"
        case .authorized:    return "authorized"
        case .limited:       return "limited"
        @unknown default:    return "denied"
        }
    }

    // MARK: - Listing

    @objc func listMedia(_ call: CAPPluginCall) {
        let mediaType = call.getString("mediaType") ?? "all" // "all" | "photo" | "video"
        let limit = call.getInt("limit") ?? 60
        let offset = call.getInt("offset") ?? 0
        let thumbnailSize = call.getInt("thumbnailSize") ?? 240

        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            call.reject("Photo library access not granted", "PERMISSION_DENIED")
            return
        }

        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        switch mediaType {
        case "photo":
            options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
        case "video":
            options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.video.rawValue)
        default:
            options.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d",
                                            PHAssetMediaType.image.rawValue,
                                            PHAssetMediaType.video.rawValue)
        }

        let assets = PHAsset.fetchAssets(with: options)
        let totalCount = assets.count
        guard offset < totalCount else {
            call.resolve(["items": [], "total": totalCount])
            return
        }

        let end = min(offset + limit, totalCount)
        let slice = (offset..<end).map { assets.object(at: $0) }

        // Thumbnail requests must be off-main; fan out and join on a barrier.
        // We use an opportunistic delivery mode so the first low-res thumb
        // resolves fast (no UI flash) and the high-quality version replaces
        // it in the same callback.
        let group = DispatchGroup()
        var resultMap: [String: [String: Any]] = [:]
        let resultLock = NSLock()

        let imageOptions = PHImageRequestOptions()
        imageOptions.deliveryMode = .opportunistic
        imageOptions.resizeMode = .fast
        imageOptions.isNetworkAccessAllowed = false
        imageOptions.isSynchronous = false

        for asset in slice {
            group.enter()
            let target = CGSize(width: thumbnailSize, height: thumbnailSize)
            imageManager.requestImage(
                for: asset,
                targetSize: target,
                contentMode: .aspectFill,
                options: imageOptions
            ) { image, info in
                // Skip the degraded callback — opportunistic mode delivers a
                // low-res first; we only want the final one in our payload.
                let isDegraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                if isDegraded { return }

                var entry: [String: Any] = [
                    "id": asset.localIdentifier,
                    "type": asset.mediaType == .video ? "video" : "photo",
                    "width": asset.pixelWidth,
                    "height": asset.pixelHeight,
                    "creationDate": (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
                ]
                if asset.mediaType == .video {
                    entry["durationSeconds"] = asset.duration
                }
                if let image = image, let data = image.jpegData(compressionQuality: 0.7) {
                    entry["thumbnailDataUrl"] = "data:image/jpeg;base64,\(data.base64EncodedString())"
                }

                resultLock.lock()
                resultMap[asset.localIdentifier] = entry
                resultLock.unlock()
                group.leave()
            }
        }

        group.notify(queue: .main) {
            // Preserve the fetch order (sorted by creationDate desc) — the
            // dictionary above is keyed for fast lookup, but the JS side
            // wants a stable array.
            let ordered = slice.compactMap { resultMap[$0.localIdentifier] }
            call.resolve(["items": ordered, "total": totalCount])
        }
    }

    // MARK: - Full file

    @objc func getMedia(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing required parameter: id")
            return
        }

        let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil)
        guard let asset = fetch.firstObject else {
            call.reject("Asset not found", "NOT_FOUND")
            return
        }

        if asset.mediaType == .video {
            exportVideo(asset, call: call)
        } else {
            exportImage(asset, call: call)
        }
    }

    private func exportImage(_ asset: PHAsset, call: CAPPluginCall) {
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.isSynchronous = false
        options.version = .current

        PHImageManager.default().requestImageDataAndOrientation(
            for: asset,
            options: options
        ) { data, uti, _, _ in
            guard let data = data else {
                call.reject("Failed to read image data")
                return
            }
            let ext = self.extensionFor(uti: uti) ?? "jpg"
            let mime = self.mimeFor(extension: ext) ?? "image/jpeg"
            do {
                let url = try self.writeToTemp(data: data, ext: ext)
                call.resolve(["path": url.absoluteString, "mimeType": mime])
            } catch {
                call.reject("Failed to write image to disk: \(error.localizedDescription)")
            }
        }
    }

    private func exportVideo(_ asset: PHAsset, call: CAPPluginCall) {
        let options = PHVideoRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true
        options.version = .current

        PHImageManager.default().requestAVAsset(
            forVideo: asset,
            options: options
        ) { avAsset, _, _ in
            // Most camera-roll videos resolve to an AVURLAsset whose URL is
            // already a file path — copy it into our app-temp dir so it
            // survives any PhotoKit cleanup before the WebView reads it.
            guard let urlAsset = avAsset as? AVURLAsset else {
                call.reject("Unsupported video asset")
                return
            }
            let sourceUrl = urlAsset.url
            let ext = sourceUrl.pathExtension.isEmpty ? "mov" : sourceUrl.pathExtension
            let mime = self.mimeFor(extension: ext) ?? "video/quicktime"
            do {
                let destUrl = self.tempFileURL(ext: ext)
                if FileManager.default.fileExists(atPath: destUrl.path) {
                    try FileManager.default.removeItem(at: destUrl)
                }
                try FileManager.default.copyItem(at: sourceUrl, to: destUrl)
                call.resolve(["path": destUrl.absoluteString, "mimeType": mime])
            } catch {
                call.reject("Failed to copy video to temp: \(error.localizedDescription)")
            }
        }
    }

    private func writeToTemp(data: Data, ext: String) throws -> URL {
        let url = tempFileURL(ext: ext)
        try data.write(to: url, options: .atomic)
        return url
    }

    private func tempFileURL(ext: String) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
    }

    private func extensionFor(uti: String?) -> String? {
        guard let uti = uti else { return nil }
        if #available(iOS 14.0, *) {
            return UTType(uti)?.preferredFilenameExtension
        }
        if let cfExt = UTTypeCopyPreferredTagWithClass(uti as CFString, kUTTagClassFilenameExtension)?.takeRetainedValue() {
            return cfExt as String
        }
        return nil
    }

    private func mimeFor(extension ext: String) -> String? {
        if #available(iOS 14.0, *) {
            return UTType(filenameExtension: ext)?.preferredMIMEType
        }
        if let uti = UTTypeCreatePreferredIdentifierForTag(kUTTagClassFilenameExtension, ext as CFString, nil)?.takeRetainedValue(),
           let mime = UTTypeCopyPreferredTagWithClass(uti, kUTTagClassMIMEType)?.takeRetainedValue() {
            return mime as String
        }
        return nil
    }

    // MARK: - Settings deep-link

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url) { ok in
                    call.resolve(["opened": ok])
                }
            } else {
                call.resolve(["opened": false])
            }
        }
    }
}
