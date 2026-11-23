Pod::Spec.new do |s|
  s.name = 'FotosPhotoKit'
  s.version = '0.1.0'
  s.summary = 'Read-only PhotoKit originals, metadata, thumbnails and library changes for Fotos.'
  s.description = s.summary
  s.license = { :type => 'CC-BY-NC-SA-4.0' }
  s.author = 'Fotos'
  s.homepage = 'https://fotos.one'
  s.source = { :git => 'https://github.com/juergengeck/fotos.git' }
  s.platform = :ios, '15.1'
  s.swift_version = '5.9'
  s.static_framework = true
  s.frameworks = 'Photos', 'ImageIO', 'UIKit', 'CryptoKit', 'UniformTypeIdentifiers'
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/*.swift', 'Sources/BitfieldHasher/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
