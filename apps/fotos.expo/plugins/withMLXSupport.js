const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withPodfileProperties,
  withXcodeProject,
} = require('@expo/config-plugins');

const DEPLOYMENT_TARGET = '17.0';
const MODULE_FILE = 'VGERMLXModule.swift';
const BRIDGE_FILE = 'VGERMLXModuleBridge.m';

const PACKAGE_IDS = {
  mlxSwiftLm: '4D1A00302F9A100000000001',
  swiftHuggingFace: '4D1A00312F9A100000000001',
  swiftTransformers: '4D1A00322F9A100000000001',
};

const PRODUCT_IDS = {
  MLXLLM: '4D1A00202F9A100000000001',
  MLXLMCommon: '4D1A00212F9A100000000001',
  HuggingFace: '4D1A00232F9A100000000001',
  Tokenizers: '4D1A00242F9A100000000001',
};

const BUILD_FILE_IDS = {
  MLXLLM: '4D1A00102F9A100000000001',
  MLXLMCommon: '4D1A00112F9A100000000001',
  HuggingFace: '4D1A00132F9A100000000001',
  Tokenizers: '4D1A00142F9A100000000001',
};

const LEGACY_PRODUCTS = [
  {
    name: 'MLXHuggingFace',
    productId: '4D1A00222F9A100000000001',
    buildFileId: '4D1A00122F9A100000000001',
  },
];

const PACKAGES = [
  {
    id: PACKAGE_IDS.mlxSwiftLm,
    name: 'mlx-swift-lm',
    repositoryURL: 'https://github.com/ml-explore/mlx-swift-lm',
    minimumVersion: '3.31.3',
  },
  {
    id: PACKAGE_IDS.swiftHuggingFace,
    name: 'swift-huggingface',
    repositoryURL: 'https://github.com/huggingface/swift-huggingface',
    minimumVersion: '0.9.0',
  },
  {
    id: PACKAGE_IDS.swiftTransformers,
    name: 'swift-transformers',
    repositoryURL: 'https://github.com/huggingface/swift-transformers',
    minimumVersion: '1.3.0',
  },
];

const PRODUCTS = [
  { name: 'MLXLLM', packageId: PACKAGE_IDS.mlxSwiftLm },
  { name: 'MLXLMCommon', packageId: PACKAGE_IDS.mlxSwiftLm },
  { name: 'HuggingFace', packageId: PACKAGE_IDS.swiftHuggingFace },
  { name: 'Tokenizers', packageId: PACKAGE_IDS.swiftTransformers },
];

const BRIDGE_MODULE = String.raw`#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(VGERMLXModule, RCTEventEmitter)

RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(getUnavailableReason:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(getModelState:(NSString *)modelId
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(downloadModel:(NSString *)modelId
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(deleteModel:(NSString *)modelId
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(loadModel:(NSString *)modelId
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(unloadModel:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(generateResponse:(NSString *)modelId
                  prompt:(NSString *)prompt
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

RCT_EXTERN_METHOD(generateChatCompletion:(NSString *)modelId
                  messages:(NSArray *)messages
                  options:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolver
                  rejecter:(RCTPromiseRejectBlock)rejecter)

@end`;

const SWIFT_MODULE = String.raw`import Foundation
import React

#if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
import HuggingFace
import MLXLLM
import MLXLMCommon
import Tokenizers
#endif

@objc(VGERMLXModule)
final class VGERMLXModule: RCTEventEmitter {
  private var hasListeners = false

  #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
  private var loadedModelId: String?
  private var loadedContainer: ModelContainer?
  private var loadingModelId: String?
  private var loadingTask: Task<ModelContainer, Error>?
  #endif

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override static func moduleName() -> String! {
    "VGERMLXModule"
  }

  override func supportedEvents() -> [String]! {
    [
      "VGERMLXDownloadProgress",
      "VGERMLXToken",
    ]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc(isAvailable:rejecter:)
  func isAvailable(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
    resolver(Self.supportsMLXRuntime)
    #else
    resolver(false)
    #endif
  }

  @objc(getUnavailableReason:rejecter:)
  func getUnavailableReason(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
    resolver(Self.supportsMLXRuntime ? nil : Self.mlxUnavailableReason)
    #else
    resolver("MLX Swift packages are not linked into the iOS app target.")
    #endif
  }

  @objc(getModelState:resolver:rejecter:)
  func getModelState(
    _ modelId: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
    if loadedModelId == modelId, loadedContainer != nil {
      resolver(modelState(status: "ready", modelId: modelId))
      return
    }

    do {
      resolver(modelState(status: try isModelCached(modelId) ? "installed" : "not_installed", modelId: modelId))
    } catch {
      rejectError(rejecter, code: "MLX_STATE_ERROR", error: error)
    }
    #else
    rejecter("MLX_NOT_LINKED", "MLX Swift packages are not linked into the iOS app target.", nil)
    #endif
  }

  @objc(downloadModel:resolver:rejecter:)
  func downloadModel(
    _ modelId: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
    runMLXTask(rejecter: rejecter) {
      let repo = try self.repoID(modelId)
      _ = try await VGERHubDownloader().download(
        id: repo.description,
        revision: "main",
        matching: VGERHubDownloader.modelSnapshotPatterns,
        useLatest: false
      ) { [weak self] progress in
        self?.emitDownloadProgress(modelId: modelId, progress: progress.fractionCompleted * 100)
      }
      resolver(self.modelState(status: "installed", modelId: modelId))
    }
    #else
    rejecter("MLX_NOT_LINKED", "MLX Swift packages are not linked into the iOS app target.", nil)
    #endif
  }

  @objc(deleteModel:resolver:rejecter:)
  func deleteModel(
    _ modelId: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
    do {
      if loadedModelId == modelId {
        loadedModelId = nil
        loadedContainer = nil
      }

      let repo = try repoID(modelId)
      let fileManager = FileManager.default
      let repoDirectory = try VGERHubDownloader.localModelDirectory(id: repo.description, revision: "main")

      if fileManager.fileExists(atPath: repoDirectory.path) {
        try fileManager.removeItem(at: repoDirectory)
      }

      resolver(modelState(status: "not_installed", modelId: modelId))
    } catch {
      rejectError(rejecter, code: "MLX_DELETE_ERROR", error: error)
    }
    #else
    rejecter("MLX_NOT_LINKED", "MLX Swift packages are not linked into the iOS app target.", nil)
    #endif
  }

  @objc(loadModel:resolver:rejecter:)
  func loadModel(
    _ modelId: String,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
    runMLXTask(rejecter: rejecter) {
      _ = try await self.loadContainer(modelId: modelId)
      resolver(self.modelState(status: "ready", modelId: modelId))
    }
    #else
    rejecter("MLX_NOT_LINKED", "MLX Swift packages are not linked into the iOS app target.", nil)
    #endif
  }

  @objc(unloadModel:rejecter:)
  func unloadModel(
    _ resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
    loadingTask?.cancel()
    loadingTask = nil
    loadingModelId = nil
    loadedModelId = nil
    loadedContainer = nil
    #endif
    resolver(nil)
  }

  @objc(generateResponse:prompt:options:resolver:rejecter:)
  func generateResponse(
    _ modelId: String,
    prompt: String,
    options: NSDictionary?,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
    runMLXTask(rejecter: rejecter) {
      let message = Chat.Message.user(prompt)
      let output = try await self.generate(modelId: modelId, messages: [message], options: options)
      resolver(output)
    }
    #else
    rejecter("MLX_NOT_LINKED", "MLX Swift packages are not linked into the iOS app target.", nil)
    #endif
  }

  @objc(generateChatCompletion:messages:options:resolver:rejecter:)
  func generateChatCompletion(
    _ modelId: String,
    messages: [[String: Any]],
    options: NSDictionary?,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
    runMLXTask(rejecter: rejecter) {
      let chat = try self.chatMessages(from: messages)
      let output = try await self.generate(modelId: modelId, messages: chat, options: options)
      resolver(output)
    }
    #else
    rejecter("MLX_NOT_LINKED", "MLX Swift packages are not linked into the iOS app target.", nil)
    #endif
  }

  private func modelState(status: String, modelId: String) -> [String: Any] {
    [
      "status": status,
      "modelId": modelId,
    ]
  }

  private func rejectError(
    _ rejecter: RCTPromiseRejectBlock,
    code: String,
    error: Error
  ) {
    rejecter(code, error.localizedDescription, error)
  }

  #if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
  private func runMLXTask(
    rejecter: @escaping RCTPromiseRejectBlock,
    operation: @escaping () async throws -> Void
  ) {
    guard Self.supportsMLXRuntime else {
      rejecter("MLX_UNAVAILABLE", Self.mlxUnavailableReason, nil)
      return
    }

    Task {
      do {
        try await operation()
      } catch {
        rejectError(rejecter, code: "MLX_OPERATION_ERROR", error: error)
      }
    }
  }

  private static var supportsMLXRuntime: Bool {
    #if targetEnvironment(simulator)
    return false
    #else
    if #available(iOS 17.0, *) {
      return true
    }
    return false
    #endif
  }

  private static var mlxUnavailableReason: String {
    #if targetEnvironment(simulator)
    return "MLX inference is not available in the iOS Simulator because MLX aborts while initializing the Metal GPU device. Run this build on a physical iOS device to use MLX models."
    #else
    return "MLX Swift requires iOS 17.0 or newer."
    #endif
  }

  private func repoID(_ modelId: String) throws -> Repo.ID {
    guard let repo = Repo.ID(rawValue: modelId) else {
      throw VGERMLXError.invalidModelId(modelId)
    }
    return repo
  }

  private func isModelCached(_ modelId: String) throws -> Bool {
    let repo = try repoID(modelId)
    return try VGERHubDownloader.isModelDownloaded(id: repo.description, revision: "main")
  }

  private func loadContainer(modelId: String) async throws -> ModelContainer {
    if loadedModelId == modelId, let loadedContainer {
      return loadedContainer
    }

    if let loadingTask {
      if loadingModelId == modelId {
        return try await loadingTask.value
      }
      throw VGERMLXError.modelLoadInProgress(loadingModelId ?? "unknown")
    }

    let task = Task<ModelContainer, Error> {
      let configuration = ModelConfiguration(id: modelId)
      return try await LLMModelFactory.shared.loadContainer(
        from: VGERHubDownloader(),
        using: VGERHuggingFaceTokenizerLoader(),
        configuration: configuration
      ) { [weak self] (progress: Progress) in
        self?.emitDownloadProgress(modelId: modelId, progress: progress.fractionCompleted * 100)
      }
    }

    loadingModelId = modelId
    loadingTask = task

    do {
      let container = try await task.value
      loadedModelId = modelId
      loadedContainer = container
      loadingModelId = nil
      loadingTask = nil
      return container
    } catch {
      loadingModelId = nil
      loadingTask = nil
      throw error
    }
  }

  private func generate(
    modelId: String,
    messages: [Chat.Message],
    options: NSDictionary?
  ) async throws -> String {
    let container = try await loadContainer(modelId: modelId)
    let parameters = generateParameters(from: options)
    let input = UserInput(chat: messages)
    let lmInput = try await container.prepare(input: input)
    let stream = try await container.generate(input: lmInput, parameters: parameters)
    var output = ""

    for await generation in stream {
      if Task.isCancelled {
        throw CancellationError()
      }
      if let chunk = generation.chunk, !chunk.isEmpty {
        output += chunk
        emitToken(modelId: modelId, token: chunk)
      }
    }

    return output
  }

  private func chatMessages(from payload: [[String: Any]]) throws -> [Chat.Message] {
    try payload.map { item in
      guard let role = item["role"] as? String else {
        throw VGERMLXError.invalidMessage("Missing role")
      }
      guard let content = item["content"] as? String else {
        throw VGERMLXError.invalidMessage("Missing content")
      }

      switch role {
      case "system":
        return Chat.Message.system(content)
      case "user":
        return Chat.Message.user(content)
      case "assistant":
        return Chat.Message.assistant(content)
      case "tool":
        return Chat.Message.tool(content)
      default:
        throw VGERMLXError.invalidMessage("Unsupported role: \(role)")
      }
    }
  }

  private func generateParameters(from options: NSDictionary?) -> GenerateParameters {
    let maxTokens = (options?["maxNewTokens"] as? NSNumber)?.intValue ?? 256
    let temperature = (options?["temperature"] as? NSNumber)?.floatValue ?? 0.7
    let topP = (options?["topP"] as? NSNumber)?.floatValue ?? 0.9

    return GenerateParameters(
      maxTokens: maxTokens,
      temperature: temperature,
      topP: topP
    )
  }

  private func emitDownloadProgress(modelId: String, progress: Double) {
    emit(name: "VGERMLXDownloadProgress", body: [
      "modelId": modelId,
      "progress": progress,
    ])
  }

  private func emitToken(modelId: String, token: String) {
    emit(name: "VGERMLXToken", body: [
      "modelId": modelId,
      "token": token,
    ])
  }

  private func emit(name: String, body: [String: Any]) {
    guard hasListeners else {
      return
    }

    DispatchQueue.main.async { [weak self] in
      self?.sendEvent(withName: name, body: body)
    }
  }
  #endif
}

#if canImport(MLXLLM) && canImport(MLXLMCommon) && canImport(HuggingFace) && canImport(Tokenizers)
private struct VGERHubDownloader: MLXLMCommon.Downloader {
  static let modelSnapshotPatterns = [
    "*.json",
    "*.safetensors",
    "*.model",
    "*.txt",
    "*.jinja",
  ]

  private let upstream: HuggingFace.HubClient

  init(_ upstream: HuggingFace.HubClient = HuggingFace.HubClient()) {
    self.upstream = upstream
  }

  func download(
    id: String,
    revision: String?,
    matching patterns: [String],
    useLatest: Bool,
    progressHandler: @Sendable @escaping (Foundation.Progress) -> Void
  ) async throws -> URL {
    guard let repo = HuggingFace.Repo.ID(rawValue: id) else {
      throw VGERMLXError.invalidModelId(id)
    }

    let resolvedRevision = revision ?? "main"
    let destination = try Self.localModelDirectory(id: id, revision: resolvedRevision)
    if try Self.isModelDownloaded(id: id, revision: resolvedRevision) {
      return destination
    }

    let fileManager = FileManager.default
    if fileManager.fileExists(atPath: destination.path) {
      try fileManager.removeItem(at: destination)
    }
    try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)

    return try await upstream.downloadSnapshot(
      of: repo,
      to: destination,
      revision: resolvedRevision,
      matching: patterns,
      progressHandler: { @MainActor progress in
        progressHandler(progress)
      }
    )
  }

  static func isModelDownloaded(id: String, revision: String) throws -> Bool {
    let directory = try localModelDirectory(id: id, revision: revision)
    var isDirectory = ObjCBool(false)
    guard FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory),
          isDirectory.boolValue
    else {
      return false
    }

    let contents = try FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil
    )
    return contents.contains { $0.pathExtension == "safetensors" }
  }

  static func localModelDirectory(id: String, revision: String) throws -> URL {
    guard let cacheRoot = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw VGERMLXError.cacheDirectoryUnavailable
    }

    return cacheRoot
      .appendingPathComponent("vger-mlx-models", isDirectory: true)
      .appendingPathComponent(safePathComponent(id), isDirectory: true)
      .appendingPathComponent(safePathComponent(revision), isDirectory: true)
  }

  private static func safePathComponent(_ raw: String) -> String {
    raw.map { character in
      character.isLetter || character.isNumber || character == "." || character == "-" || character == "_"
        ? character
        : "-"
    }.reduce(into: "") { result, character in
      result.append(character)
    }
  }
}

private struct VGERHuggingFaceTokenizerLoader: MLXLMCommon.TokenizerLoader {
  func load(from directory: URL) async throws -> any MLXLMCommon.Tokenizer {
    let upstream = try await Tokenizers.AutoTokenizer.from(modelFolder: directory)
    return VGERHuggingFaceTokenizer(upstream)
  }
}

private struct VGERHuggingFaceTokenizer: MLXLMCommon.Tokenizer {
  private let upstream: any Tokenizers.Tokenizer

  init(_ upstream: any Tokenizers.Tokenizer) {
    self.upstream = upstream
  }

  func encode(text: String, addSpecialTokens: Bool) -> [Int] {
    upstream.encode(text: text, addSpecialTokens: addSpecialTokens)
  }

  func decode(tokenIds: [Int], skipSpecialTokens: Bool) -> String {
    upstream.decode(tokens: tokenIds, skipSpecialTokens: skipSpecialTokens)
  }

  func convertTokenToId(_ token: String) -> Int? {
    upstream.convertTokenToId(token)
  }

  func convertIdToToken(_ id: Int) -> String? {
    upstream.convertIdToToken(id)
  }

  var bosToken: String? { upstream.bosToken }
  var eosToken: String? { upstream.eosToken }
  var unknownToken: String? { upstream.unknownToken }

  func applyChatTemplate(
    messages: [[String: any Sendable]],
    tools: [[String: any Sendable]]?,
    additionalContext: [String: any Sendable]?
  ) throws -> [Int] {
    do {
      return try upstream.applyChatTemplate(
        messages: messages,
        tools: tools,
        additionalContext: additionalContext
      )
    } catch Tokenizers.TokenizerError.missingChatTemplate {
      throw MLXLMCommon.TokenizerError.missingChatTemplate
    }
  }
}

private enum VGERMLXError: LocalizedError {
  case invalidModelId(String)
  case modelLoadInProgress(String)
  case invalidMessage(String)
  case cacheDirectoryUnavailable

  var errorDescription: String? {
    switch self {
    case .invalidModelId(let modelId):
      return "Invalid MLX model id: \(modelId)"
    case .modelLoadInProgress(let modelId):
      return "Another MLX model is already loading: \(modelId)"
    case .invalidMessage(let reason):
      return "Invalid chat message payload: \(reason)"
    case .cacheDirectoryUnavailable:
      return "Unable to resolve an app cache directory for MLX model storage"
    }
  }
}
#endif`;

function withMLXModuleFile(config) {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const projectRoot = modConfig.modRequest.platformProjectRoot;
      const projectName = getIosProjectName(projectRoot);
      const modulePath = path.join(projectRoot, projectName, MODULE_FILE);
      const bridgePath = path.join(projectRoot, projectName, BRIDGE_FILE);
      fs.writeFileSync(modulePath, SWIFT_MODULE);
      fs.writeFileSync(bridgePath, BRIDGE_MODULE);
      return modConfig;
    },
  ]);
}

function withMLXDeploymentTarget(config) {
  config = withPodfileProperties(config, (modConfig) => {
    modConfig.modResults['ios.deploymentTarget'] = DEPLOYMENT_TARGET;
    return modConfig;
  });

  return withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const configurations = project.hash.project.objects.XCBuildConfiguration || {};

    for (const [key, value] of Object.entries(configurations)) {
      if (key.endsWith('_comment') || !value.buildSettings) {
        continue;
      }
      value.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
    }

    return modConfig;
  });
}

function withMLXEntitlements(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    if (shouldEnableMemoryEntitlements()) {
      modConfig.modResults['com.apple.developer.kernel.extended-virtual-addressing'] = true;
      modConfig.modResults['com.apple.developer.kernel.increased-memory-limit'] = true;
    } else {
      delete modConfig.modResults['com.apple.developer.kernel.extended-virtual-addressing'];
      delete modConfig.modResults['com.apple.developer.kernel.increased-memory-limit'];
    }
    return modConfig;
  });
}

function shouldEnableMemoryEntitlements() {
  return process.env.VGER_ENABLE_IOS_MEMORY_ENTITLEMENTS === '1' ||
    process.env.EAS_BUILD_PROFILE === 'production';
}

function withMLXXcodeProject(config) {
  return withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const projectRoot = modConfig.modRequest.platformProjectRoot;
    const projectName = getIosProjectName(projectRoot);
    const nativeTarget = project.getTarget('com.apple.product-type.application');

    if (!nativeTarget) {
      throw new Error('[withMLXSupport] Could not find iOS application target.');
    }

    ensureNativeSourceFile(project, projectName, nativeTarget.uuid, MODULE_FILE);
    ensureNativeSourceFile(project, projectName, nativeTarget.uuid, BRIDGE_FILE);
    ensureSwiftPackages(project, nativeTarget.target);

    return modConfig;
  });
}

function getIosProjectName(projectRoot) {
  const projectFile = fs
    .readdirSync(projectRoot)
    .find((entry) => entry.endsWith('.xcodeproj') && entry !== 'Pods.xcodeproj');

  if (!projectFile) {
    throw new Error(`[withMLXSupport] Could not find an iOS .xcodeproj in ${projectRoot}.`);
  }

  return path.basename(projectFile, '.xcodeproj');
}

function ensureNativeSourceFile(project, projectName, targetUuid, filename) {
  const group = project.pbxGroupByName(projectName);
  if (!group) {
    throw new Error(`[withMLXSupport] Could not find Xcode group: ${projectName}`);
  }

  const hasFile = group.children.some((child) => child.comment === filename);
  if (!hasFile) {
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: filename,
      groupName: projectName,
      project,
      targetUuid,
    });
  }

  normalizeNativeSourceFilePath(project, group, projectName, filename);
}

function normalizeNativeSourceFilePath(project, group, projectName, filename) {
  const child = group.children.find((entry) => entry.comment === filename);
  if (!child?.value) {
    throw new Error(`[withMLXSupport] Could not find Xcode source reference for ${filename}`);
  }

  const fileReference = project.hash.project.objects.PBXFileReference?.[child.value];
  if (!fileReference) {
    throw new Error(`[withMLXSupport] Missing PBXFileReference for ${filename}`);
  }

  fileReference.name = filename;
  fileReference.path = `${projectName}/${filename}`;
  fileReference.sourceTree = '"<group>"';
}

function ensureSwiftPackages(project, nativeTarget) {
  const objects = project.hash.project.objects;
  const pbxProject = findFirstObject(objects.PBXProject);
  const frameworksPhase = findFrameworksBuildPhase(project, nativeTarget);

  objects.XCRemoteSwiftPackageReference = objects.XCRemoteSwiftPackageReference || {};
  objects.XCSwiftPackageProductDependency = objects.XCSwiftPackageProductDependency || {};
  objects.PBXBuildFile = objects.PBXBuildFile || {};
  pbxProject.packageReferences = pbxProject.packageReferences || [];
  nativeTarget.packageProductDependencies = nativeTarget.packageProductDependencies || [];
  frameworksPhase.files = frameworksPhase.files || [];

  removeLegacyProducts(objects, nativeTarget, frameworksPhase);

  for (const pkg of PACKAGES) {
    if (!hasPackageReference(objects.XCRemoteSwiftPackageReference, pkg.repositoryURL)) {
      objects.XCRemoteSwiftPackageReference[pkg.id] = {
        isa: 'XCRemoteSwiftPackageReference',
        repositoryURL: `"${pkg.repositoryURL}"`,
        requirement: {
          kind: 'upToNextMajorVersion',
          minimumVersion: pkg.minimumVersion,
        },
      };
      objects.XCRemoteSwiftPackageReference[`${pkg.id}_comment`] = `XCRemoteSwiftPackageReference "${pkg.name}"`;
    }

    pushUnique(pbxProject.packageReferences, pkg.id, `XCRemoteSwiftPackageReference "${pkg.name}"`);
  }

  for (const product of PRODUCTS) {
    const productId = PRODUCT_IDS[product.name];
    const buildFileId = BUILD_FILE_IDS[product.name];
    const pkg = PACKAGES.find((entry) => entry.id === product.packageId);

    objects.XCSwiftPackageProductDependency[productId] = {
      isa: 'XCSwiftPackageProductDependency',
      package: product.packageId,
      package_comment: `XCRemoteSwiftPackageReference "${pkg.name}"`,
      productName: product.name,
    };
    objects.XCSwiftPackageProductDependency[`${productId}_comment`] = product.name;

    objects.PBXBuildFile[buildFileId] = {
      isa: 'PBXBuildFile',
      productRef: productId,
      productRef_comment: product.name,
    };
    objects.PBXBuildFile[`${buildFileId}_comment`] = `${product.name} in Frameworks`;

    pushUnique(nativeTarget.packageProductDependencies, productId, product.name);
    pushUnique(frameworksPhase.files, buildFileId, `${product.name} in Frameworks`);
  }
}

function removeLegacyProducts(objects, nativeTarget, frameworksPhase) {
  for (const product of LEGACY_PRODUCTS) {
    removeReference(nativeTarget.packageProductDependencies, product.productId, product.name);
    removeReference(frameworksPhase.files, product.buildFileId, `${product.name} in Frameworks`);

    delete objects.XCSwiftPackageProductDependency?.[product.productId];
    delete objects.XCSwiftPackageProductDependency?.[`${product.productId}_comment`];
    delete objects.PBXBuildFile?.[product.buildFileId];
    delete objects.PBXBuildFile?.[`${product.buildFileId}_comment`];
  }
}

function removeReference(items, value, comment) {
  if (!Array.isArray(items)) {
    return;
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].value === value || items[index].comment === comment) {
      items.splice(index, 1);
    }
  }
}

function findFirstObject(section) {
  for (const [key, value] of Object.entries(section || {})) {
    if (!key.endsWith('_comment')) {
      return value;
    }
  }
  throw new Error('[withMLXSupport] Missing PBXProject section.');
}

function findFrameworksBuildPhase(project, nativeTarget) {
  const phase = nativeTarget.buildPhases.find((entry) => entry.comment === 'Frameworks');
  if (!phase) {
    throw new Error('[withMLXSupport] Could not find Frameworks build phase.');
  }

  const frameworksPhase = project.hash.project.objects.PBXFrameworksBuildPhase[phase.value];
  if (!frameworksPhase) {
    throw new Error('[withMLXSupport] Frameworks build phase is missing from project.');
  }

  return frameworksPhase;
}

function hasPackageReference(section, repositoryURL) {
  return Object.entries(section || {}).some(([key, value]) => (
    !key.endsWith('_comment') && value.repositoryURL === `"${repositoryURL}"`
  ));
}

function pushUnique(items, value, comment) {
  if (!items.some((item) => item.value === value || item.comment === comment)) {
    items.push({ value, comment });
  }
}

function withMLXSupport(config) {
  config = withMLXModuleFile(config);
  config = withMLXDeploymentTarget(config);
  config = withMLXEntitlements(config);
  config = withMLXXcodeProject(config);
  return config;
}

module.exports = createRunOncePlugin(withMLXSupport, 'vger-mlx-support', '1.0.0');
