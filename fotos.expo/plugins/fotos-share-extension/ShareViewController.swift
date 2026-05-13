import Foundation
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private enum Constants {
    static let appGroupId = "group.fotos.ios"
    static let inboxRoot = "fotos-share-inbox"
    static let queueDirectory = "queue"
    static let filesDirectory = "files"
    static let manifestFileName = "manifest.json"
    static let maxItemCount = 12
  }

  private struct ManifestItem: Codable {
    let id: String
    let relativePath: String
    let originalName: String
    let mimeType: String?
    let createdAt: String
  }

  private struct Manifest: Codable {
    let batchId: String
    let createdAt: String
    let items: [ManifestItem]
  }

  private let activityIndicator = UIActivityIndicatorView(style: .large)
  private let titleLabel = UILabel()
  private let messageLabel = UILabel()
  private var didStartProcessing = false

  override func viewDidLoad() {
    super.viewDidLoad()

    view.backgroundColor = .systemBackground
    activityIndicator.translatesAutoresizingMaskIntoConstraints = false
    activityIndicator.startAnimating()

    titleLabel.translatesAutoresizingMaskIntoConstraints = false
    titleLabel.font = .preferredFont(forTextStyle: .headline)
    titleLabel.textAlignment = .center
    titleLabel.text = "fotos.one"

    messageLabel.translatesAutoresizingMaskIntoConstraints = false
    messageLabel.font = .preferredFont(forTextStyle: .body)
    messageLabel.textColor = .secondaryLabel
    messageLabel.textAlignment = .center
    messageLabel.numberOfLines = 0
    messageLabel.text = "Preparing shared items..."

    let stack = UIStackView(arrangedSubviews: [activityIndicator, titleLabel, messageLabel])
    stack.translatesAutoresizingMaskIntoConstraints = false
    stack.axis = .vertical
    stack.spacing = 16
    stack.alignment = .center

    view.addSubview(stack)

    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
      stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      messageLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 320),
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)

    guard !didStartProcessing else {
      return
    }

    didStartProcessing = true

    Task {
      await processSharedItems()
    }
  }

  @MainActor
  private func updateStatus(_ message: String, isLoading: Bool) {
    messageLabel.text = message
    if isLoading {
      activityIndicator.startAnimating()
    } else {
      activityIndicator.stopAnimating()
    }
  }

  private func processSharedItems() async {
    do {
      let batchId = UUID().uuidString.lowercased()
      let batchDirectory = try prepareBatchDirectory(batchId: batchId)
      let queuedItems = try await collectSharedItems(batchDirectory: batchDirectory)

      guard !queuedItems.isEmpty else {
        await updateStatus("Nothing importable was found in this share.", isLoading: false)
        await completeRequest(after: 0.8)
        return
      }

      let manifest = Manifest(
        batchId: batchId,
        createdAt: ISO8601DateFormatter().string(from: Date()),
        items: queuedItems
      )
      try writeManifest(manifest, batchDirectory: batchDirectory)

      let noun = queuedItems.count == 1 ? "item" : "items"
      await updateStatus("Saved \(queuedItems.count) \(noun) to the fotos.one inbox. Open the app to import them.", isLoading: false)
      await completeRequest(after: 1.0)
    } catch {
      NSLog("[fotosShareExtension] Failed to queue shared items: \(error.localizedDescription)")
      await updateStatus("fotos.one could not queue these shared items.", isLoading: false)
      await completeRequest(after: 1.0)
    }
  }

  private func prepareBatchDirectory(batchId: String) throws -> URL {
    guard let containerURL = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: Constants.appGroupId
    ) else {
      throw NSError(domain: "fotosShareExtension", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "App Group container is unavailable.",
      ])
    }

    let batchDirectory = containerURL
      .appendingPathComponent(Constants.inboxRoot, isDirectory: true)
      .appendingPathComponent(Constants.queueDirectory, isDirectory: true)
      .appendingPathComponent(batchId, isDirectory: true)
    let filesDirectory = batchDirectory.appendingPathComponent(Constants.filesDirectory, isDirectory: true)

    try FileManager.default.createDirectory(at: filesDirectory, withIntermediateDirectories: true)
    return batchDirectory
  }

  private func collectSharedItems(batchDirectory: URL) async throws -> [ManifestItem] {
    let extensionItems = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
    var manifestItems: [ManifestItem] = []
    let createdAt = ISO8601DateFormatter().string(from: Date())
    let filesDirectory = batchDirectory.appendingPathComponent(Constants.filesDirectory, isDirectory: true)

    for extensionItem in extensionItems {
      for attachment in extensionItem.attachments ?? [] {
        if manifestItems.count >= Constants.maxItemCount {
          return manifestItems
        }

        guard let typeIdentifier = preferredTypeIdentifier(for: attachment) else {
          continue
        }

        let preferredName = attachment.suggestedName ?? "shared-photo"
        let fileExtension = preferredFilenameExtension(for: attachment) ?? "dat"
        let destinationName = uniqueDestinationName(
          preferredName: preferredName,
          fileExtension: fileExtension,
          existingNames: Set(manifestItems.map(\.relativePath))
        )
        let relativePath = "\(Constants.filesDirectory)/\(destinationName)"
        let destinationURL = filesDirectory.appendingPathComponent(destinationName, isDirectory: false)

        try await copyItem(
          from: attachment,
          typeIdentifier: typeIdentifier,
          to: destinationURL
        )

        manifestItems.append(
          ManifestItem(
            id: UUID().uuidString.lowercased(),
            relativePath: relativePath,
            originalName: destinationName,
            mimeType: preferredMimeType(for: attachment, fileExtension: fileExtension),
            createdAt: createdAt
          )
        )
      }
    }

    return manifestItems
  }

  private func writeManifest(_ manifest: Manifest, batchDirectory: URL) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(manifest)
    let manifestURL = batchDirectory.appendingPathComponent(Constants.manifestFileName, isDirectory: false)
    try data.write(to: manifestURL, options: .atomic)
  }

  private func preferredTypeIdentifier(for provider: NSItemProvider) -> String? {
    let identifiers = [
      UTType.heic.identifier,
      UTType.jpeg.identifier,
      UTType.png.identifier,
      UTType.gif.identifier,
      UTType.tiff.identifier,
      UTType.webP.identifier,
      UTType.image.identifier,
      UTType.fileURL.identifier,
    ]

    for identifier in identifiers where provider.hasItemConformingToTypeIdentifier(identifier) {
      return identifier
    }

    return provider.registeredTypeIdentifiers.first
  }

  private func preferredFilenameExtension(for provider: NSItemProvider) -> String? {
    guard let identifier = preferredTypeIdentifier(for: provider), let type = UTType(identifier) else {
      return nil
    }

    return type.preferredFilenameExtension
  }

  private func preferredMimeType(for provider: NSItemProvider, fileExtension: String) -> String? {
    for identifier in provider.registeredTypeIdentifiers {
      if let type = UTType(identifier), let mimeType = type.preferredMIMEType {
        return mimeType
      }
    }

    return UTType(filenameExtension: fileExtension)?.preferredMIMEType
  }

  private func copyItem(
    from provider: NSItemProvider,
    typeIdentifier: String,
    to destinationURL: URL
  ) async throws {
    return try await withCheckedThrowingContinuation { continuation in
      provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }

        guard let url else {
          continuation.resume(
            throwing: NSError(
              domain: "fotosShareExtension",
              code: 2,
              userInfo: [NSLocalizedDescriptionKey: "Provider did not expose a file URL."]
            )
          )
          return
        }

        do {
          if FileManager.default.fileExists(atPath: destinationURL.path) {
            try FileManager.default.removeItem(at: destinationURL)
          }
          try FileManager.default.copyItem(at: url, to: destinationURL)
          continuation.resume(returning: ())
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func uniqueDestinationName(
    preferredName: String,
    fileExtension: String,
    existingNames: Set<String>
  ) -> String {
    let sanitizedStem = sanitizeFilenameComponent(preferredName.isEmpty ? "shared-photo" : preferredName)
    let ext = fileExtension.trimmingCharacters(in: CharacterSet(charactersIn: "."))
    let suffix = ext.isEmpty ? "" : ".\(ext)"
    var attempt = 0

    while true {
      let candidateStem = attempt == 0 ? sanitizedStem : "\(sanitizedStem)-\(attempt)"
      let candidate = "\(candidateStem)\(suffix)"
      let relativePath = "\(Constants.filesDirectory)/\(candidate)"
      if !existingNames.contains(relativePath) {
        return candidate
      }
      attempt += 1
    }
  }

  private func sanitizeFilenameComponent(_ value: String) -> String {
    let invalidCharacters = CharacterSet(charactersIn: "/:\\?%*|\"<>")
    let cleaned = value
      .components(separatedBy: invalidCharacters)
      .joined(separator: "-")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? "shared-photo" : cleaned
  }

  @MainActor
  private func completeRequest(after delay: TimeInterval) async {
    let nanoseconds = UInt64(delay * 1_000_000_000)
    try? await Task.sleep(nanoseconds: nanoseconds)
    extensionContext?.completeRequest(returningItems: nil)
  }
}
