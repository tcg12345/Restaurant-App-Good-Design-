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
// Access level is .readWrite: the plugin only ever reads assets (full-file
// exports land in the app's own temp directory), but PhotoKit offers no
// read-only level — PHAccessLevel is just .addOnly | .readWrite, and
// .addOnly can't fetch assets at all.
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
import AVFoundation
import UniformTypeIdentifiers

@objc(PhotoLibraryPlugin)
public class PhotoLibraryPlugin: CAPPlugin, CAPBridgedPlugin, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    public let identifier = "PhotoLibraryPlugin"
    public let jsName = "PhotoLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMedia", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickCamera", returnType: CAPPluginReturnPromise),
    ]

    // Re-use a single caching image manager so repeated thumbnail
    // requests during scroll don't thrash PhotoKit.
    private let imageManager = PHCachingImageManager()
    // Held across the UIImagePickerController round-trip so the delegate
    // callbacks can resolve the right JS promise.
    private var cameraPickCall: CAPPluginCall?

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
        options.deliveryMode = .automatic
        options.isNetworkAccessAllowed = true
        options.version = .current

        PHImageManager.default().requestAVAsset(
            forVideo: asset,
            options: options
        ) { avAsset, _, _ in
            // Return PhotoKit's own URL — no copy. For local-library videos
            // this is a stable path inside the Photos container that the
            // app has read access to via the photo-library entitlement, so
            // the WebView can stream it through Capacitor.convertFileSrc
            // without us first burning N seconds copying gigabytes around.
            guard let urlAsset = avAsset as? AVURLAsset else {
                call.reject("Unsupported video asset")
                return
            }
            let sourceUrl = urlAsset.url
            let ext = sourceUrl.pathExtension.isEmpty ? "mov" : sourceUrl.pathExtension
            let mime = self.mimeFor(extension: ext) ?? "video/quicktime"
            call.resolve(["path": sourceUrl.absoluteString, "mimeType": mime])
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
        return UTType(uti)?.preferredFilenameExtension
    }

    private func mimeFor(extension ext: String) -> String? {
        return UTType(filenameExtension: ext)?.preferredMIMEType
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

    // MARK: - Camera capture
    //
    // Presents UIImagePickerController in camera mode. The user gets the
    // standard iOS shutter UI; on confirm we save the captured media to
    // our temp dir and resolve with `{ path, mimeType, mediaType, ... }`
    // (or `{ cancelled: true }` if they back out).
    //
    // REQUIRES Info.plist entries — iOS terminates the app on first frame
    // access otherwise:
    //   - NSCameraUsageDescription      (always)
    //   - NSMicrophoneUsageDescription  (for video — audio recording)

    @objc func pickCamera(_ call: CAPPluginCall) {
        let mediaType = call.getString("mediaType") ?? "all" // "photo" | "video" | "all"

        DispatchQueue.main.async {
            guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                call.reject("Camera not available on this device", "NO_CAMERA")
                return
            }
            // Only request media types the camera actually offers. Setting
            // mediaTypes to a type that isn't in availableMediaTypes throws
            // UIKit's "No available types for source" exception — which is
            // what crashed video capture when "public.movie" was set blindly.
            let available = UIImagePickerController.availableMediaTypes(for: .camera) ?? []
            let imageType = UTType.image.identifier   // "public.image"
            let movieType = UTType.movie.identifier   // "public.movie"

            let desired: [String]
            switch mediaType {
            case "photo": desired = [imageType]
            case "video": desired = [movieType]
            default:      desired = [imageType, movieType]
            }
            let types = desired.filter { available.contains($0) }
            guard !types.isEmpty else {
                let what = mediaType == "video" ? "Video" : (mediaType == "photo" ? "Photo" : "Camera")
                call.reject("\(what) capture isn't available on this device's camera.", "NO_MEDIA_TYPES")
                return
            }

            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.mediaTypes = types
            // Open straight into the right mode when that type is supported.
            if mediaType == "video" {
                picker.cameraCaptureMode = .video
                picker.videoQuality = .typeHigh
            } else if mediaType == "photo" {
                picker.cameraCaptureMode = .photo
            } else if types.contains(movieType) {
                picker.videoQuality = .typeHigh
            }
            picker.delegate = self
            picker.modalPresentationStyle = .fullScreen
            self.cameraPickCall = call

            guard let presenter = self.bridge?.viewController else {
                self.cameraPickCall = nil
                call.reject("Cannot present camera UI")
                return
            }
            presenter.present(picker, animated: true)
        }
    }

    public func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        picker.dismiss(animated: true)
        guard let call = self.cameraPickCall else { return }
        self.cameraPickCall = nil

        // Video — UIImagePickerController hands back a temp file URL that
        // gets cleaned up shortly after this callback. Move it under our
        // own /tmp/photos so the upload pipeline has time to read it.
        if let mediaURL = info[.mediaURL] as? URL {
            let ext = mediaURL.pathExtension.isEmpty ? "mov" : mediaURL.pathExtension
            let mime = self.mimeFor(extension: ext) ?? "video/quicktime"
            do {
                let dest = self.tempFileURL(ext: ext)
                if FileManager.default.fileExists(atPath: dest.path) {
                    try FileManager.default.removeItem(at: dest)
                }
                try FileManager.default.moveItem(at: mediaURL, to: dest)
                let avAsset = AVURLAsset(url: dest)
                let duration = CMTimeGetSeconds(avAsset.duration)
                call.resolve([
                    "path": dest.absoluteString,
                    "mimeType": mime,
                    "mediaType": "video",
                    "durationSeconds": duration.isFinite ? duration : 0,
                ])
            } catch {
                call.reject("Failed to save captured video: \(error.localizedDescription)")
            }
            return
        }

        // Photo
        if let image = info[.originalImage] as? UIImage {
            guard let data = image.jpegData(compressionQuality: 0.92) else {
                call.reject("Failed to encode captured photo")
                return
            }
            do {
                let url = try self.writeToTemp(data: data, ext: "jpg")
                call.resolve([
                    "path": url.absoluteString,
                    "mimeType": "image/jpeg",
                    "mediaType": "photo",
                    "width": Int(image.size.width * image.scale),
                    "height": Int(image.size.height * image.scale),
                ])
            } catch {
                call.reject("Failed to save captured photo: \(error.localizedDescription)")
            }
            return
        }

        call.reject("Unsupported camera result")
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        if let call = self.cameraPickCall {
            self.cameraPickCall = nil
            call.resolve(["cancelled": true])
        }
    }
}
