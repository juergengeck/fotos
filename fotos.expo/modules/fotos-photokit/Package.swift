// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FotosPhotoKitHashing",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "BitfieldHasher", targets: ["BitfieldHasher"])],
    targets: [
        .target(name: "BitfieldHasher"),
        .target(name: "PhotoKitSupport"),
        .testTarget(name: "BitfieldHasherTests", dependencies: ["BitfieldHasher"]),
        .testTarget(name: "PhotoKitSupportTests", dependencies: ["PhotoKitSupport"]),
    ]
)
