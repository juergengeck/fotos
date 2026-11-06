const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} = require('@expo/config-plugins');

const EXTENSION_NAME = 'fotosShareExtension';
const EXTENSION_BUNDLE_ID = 'fotos.ios.share';
const APP_GROUP_ID = 'group.fotos.ios';
const DEPLOYMENT_TARGET = '17.0';
const TEMPLATE_DIR = path.join(__dirname, 'fotos-share-extension');
const EXTENSION_DIR = EXTENSION_NAME;
const EXTENSION_SWIFT_FILE = 'ShareViewController.swift';
const EXTENSION_INFO_PLIST = `${EXTENSION_NAME}-Info.plist`;
const EXTENSION_ENTITLEMENTS = `${EXTENSION_NAME}.entitlements`;
const EXTENSION_PRODUCT = `${EXTENSION_NAME}.appex`;

function getAppleTeamId(config) {
  return config?.ios?.appleTeamId || config?.expo?.ios?.appleTeamId || null;
}

function withFotosShareExtensionFiles(config) {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const iosRoot = modConfig.modRequest.platformProjectRoot;
      const destinationDir = path.join(iosRoot, EXTENSION_DIR);
      fs.mkdirSync(destinationDir, { recursive: true });

      for (const filename of [EXTENSION_SWIFT_FILE, EXTENSION_INFO_PLIST, EXTENSION_ENTITLEMENTS]) {
        const source = path.join(TEMPLATE_DIR, filename);
        const destination = path.join(destinationDir, filename);
        if (!fs.existsSync(destination)) {
          fs.copyFileSync(source, destination);
        }
      }

      return modConfig;
    },
  ]);
}

function withFotosShareExtensionEntitlements(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    const existingGroups = Array.isArray(modConfig.modResults['com.apple.security.application-groups'])
      ? modConfig.modResults['com.apple.security.application-groups']
      : [];

    modConfig.modResults['com.apple.security.application-groups'] = Array.from(
      new Set([...existingGroups, APP_GROUP_ID]),
    );

    return modConfig;
  });
}

function withFotosShareExtensionXcodeProject(config) {
  return withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const projectRoot = modConfig.modRequest.platformProjectRoot;
    const projectName = getIosProjectName(projectRoot);
    const appleTeamId = getAppleTeamId(modConfig);
    const appTarget = project.getTarget('com.apple.product-type.application');

    if (!appTarget) {
      throw new Error('[withFotosShareExtension] Could not find iOS application target.');
    }

    IOSConfig.XcodeUtils.ensureGroupRecursively(project, EXTENSION_DIR);

    let targetUuid = findTargetUuidByName(project, EXTENSION_NAME);
    if (!targetUuid) {
      const target = project.addTarget(
        EXTENSION_NAME,
        'app_extension',
        EXTENSION_DIR,
        EXTENSION_BUNDLE_ID,
      );
      targetUuid = target.uuid;
    }

    ensureTargetBuildPhases(project, targetUuid);
    ensureTargetDependencySections(project);
    ensureTargetDependency(project, appTarget.uuid, targetUuid);
    ensureEmbedAppExtensionsPhase(project, appTarget.uuid);
    ensureExtensionGroupFiles(project, EXTENSION_DIR, targetUuid);
    ensureExtensionBuildSettings(project, targetUuid, appleTeamId);
    ensureExtensionProductIsEmbedded(project, appTarget.uuid);
    normalizeExtensionProductComments(project, appTarget.uuid);

    return modConfig;
  });
}

function getIosProjectName(projectRoot) {
  const projectFile = fs
    .readdirSync(projectRoot)
    .find((entry) => entry.endsWith('.xcodeproj') && entry !== 'Pods.xcodeproj');

  if (!projectFile) {
    throw new Error(`[withFotosShareExtension] Could not find an iOS .xcodeproj in ${projectRoot}.`);
  }

  return path.basename(projectFile, '.xcodeproj');
}

function findTargetUuidByName(project, name) {
  const section = project.pbxNativeTargetSection() || {};
  for (const [key, value] of Object.entries(section)) {
    if (key.endsWith('_comment')) {
      continue;
    }
    if (stripQuotes(value.name) === name) {
      return key;
    }
  }
  return null;
}

function ensureTargetBuildPhases(project, targetUuid) {
  ensureBuildPhase(project, targetUuid, 'PBXSourcesBuildPhase', 'Sources');
  ensureBuildPhase(project, targetUuid, 'PBXFrameworksBuildPhase', 'Frameworks');
  ensureBuildPhase(project, targetUuid, 'PBXResourcesBuildPhase', 'Resources');
}

function ensureBuildPhase(project, targetUuid, isa, comment) {
  if (!project.buildPhaseObject(isa, comment, targetUuid)) {
    project.addBuildPhase([], isa, comment, targetUuid);
  }
}

function ensureTargetDependencySections(project) {
  const objects = project.hash.project.objects;
  objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};
  objects.PBXTargetDependency = objects.PBXTargetDependency || {};
}

function ensureTargetDependency(project, fromTargetUuid, toTargetUuid) {
  const nativeTarget = project.pbxNativeTargetSection()[fromTargetUuid];
  nativeTarget.dependencies = nativeTarget.dependencies || [];

  const objects = project.hash.project.objects;
  const dependencySection = objects.PBXTargetDependency || {};
  const hasDependency = nativeTarget.dependencies.some((entry) => {
    const dependency = dependencySection[entry.value];
    return dependency?.target === toTargetUuid;
  });

  if (!hasDependency) {
    project.addTargetDependency(fromTargetUuid, [toTargetUuid]);
  }
}

function ensureEmbedAppExtensionsPhase(project, appTargetUuid) {
  const nativeTarget = project.pbxNativeTargetSection()[appTargetUuid];
  const copyFilesSection = project.hash.project.objects.PBXCopyFilesBuildPhase || {};

  const existingPhase = nativeTarget.buildPhases.find((entry) => {
    const phase = copyFilesSection[entry.value];
    return phase?.dstSubfolderSpec === 13;
  });

  if (existingPhase) {
    renameCopyFilesPhase(project, existingPhase.value, 'Embed App Extensions');
    return;
  }

  const created = project.addBuildPhase(
    [EXTENSION_PRODUCT],
    'PBXCopyFilesBuildPhase',
    'Embed App Extensions',
    appTargetUuid,
    'app_extension',
  );
  renameCopyFilesPhase(project, created.uuid, 'Embed App Extensions');
}

function renameCopyFilesPhase(project, phaseUuid, comment) {
  const nativeTargets = project.pbxNativeTargetSection() || {};
  const phaseSection = project.hash.project.objects.PBXCopyFilesBuildPhase || {};
  phaseSection[phaseUuid] = phaseSection[phaseUuid] || {};
  phaseSection[phaseUuid].name = `"${comment}"`;
  phaseSection[`${phaseUuid}_comment`] = comment;

  for (const target of Object.values(nativeTargets)) {
    if (!target || !Array.isArray(target.buildPhases)) {
      continue;
    }
    for (const phase of target.buildPhases) {
      if (phase.value === phaseUuid) {
        phase.comment = comment;
      }
    }
  }
}

function ensureExtensionGroupFiles(project, groupName, targetUuid) {
  const relativeSwiftPath = `${EXTENSION_DIR}/${EXTENSION_SWIFT_FILE}`;
  const relativeInfoPath = `${EXTENSION_DIR}/${EXTENSION_INFO_PLIST}`;
  const relativeEntitlementsPath = `${EXTENSION_DIR}/${EXTENSION_ENTITLEMENTS}`;

  ensureSourceFile(project, groupName, targetUuid, relativeSwiftPath);
  ensurePlainFile(project, groupName, relativeInfoPath);
  ensurePlainFile(project, groupName, relativeEntitlementsPath);
}

function ensureSourceFile(project, groupName, targetUuid, filepath) {
  const group = project.pbxGroupByName(groupName);
  if (!group) {
    throw new Error(`[withFotosShareExtension] Missing Xcode group ${groupName}.`);
  }

  const basename = path.basename(filepath);
  const groupKey = project.findPBXGroupKey({ name: groupName });
  let child = group.children.find((entry) => entry.comment === basename);

  if (!child) {
    project.addFile(filepath, groupKey);
    child = group.children.find((entry) => entry.comment === basename);
  }

  if (!child?.value) {
    throw new Error(`[withFotosShareExtension] Could not find source file reference for ${basename}.`);
  }

  normalizeGroupFileReference(project, groupName, filepath);
  removeBuildFileFromOtherSourcesPhases(project, targetUuid, child.value);
  ensureBuildFileInSourcesPhase(project, targetUuid, child.value, basename);
}

function ensurePlainFile(project, groupName, filepath) {
  const group = project.pbxGroupByName(groupName);
  if (!group) {
    throw new Error(`[withFotosShareExtension] Missing Xcode group ${groupName}.`);
  }

  const basename = path.basename(filepath);
  if (!group.children.some((entry) => entry.comment === basename)) {
    const groupKey = project.findPBXGroupKey({ name: groupName });
    project.addFile(filepath, groupKey);
  }

  normalizeGroupFileReference(project, groupName, filepath);
}

function normalizeGroupFileReference(project, groupName, filepath) {
  const group = project.pbxGroupByName(groupName);
  const basename = path.basename(filepath);
  const child = group?.children.find((entry) => entry.comment === basename);
  if (!child?.value) {
    throw new Error(`[withFotosShareExtension] Could not find Xcode file reference for ${basename}.`);
  }

  const fileReference = project.hash.project.objects.PBXFileReference?.[child.value];
  if (!fileReference) {
    throw new Error(`[withFotosShareExtension] Missing PBXFileReference for ${basename}.`);
  }

  fileReference.name = basename;
  fileReference.path = filepath;
  fileReference.sourceTree = '"<group>"';
}

function ensureBuildFileInSourcesPhase(project, targetUuid, fileRefUuid, basename) {
  const buildFileSection = project.pbxBuildFileSection() || {};
  const sourcesPhase = project.pbxSourcesBuildPhaseObj(targetUuid);

  if (!sourcesPhase) {
    throw new Error('[withFotosShareExtension] Sources build phase is missing from extension target.');
  }

  const existingBuildEntry = sourcesPhase.files?.find((entry) => entry.comment === `${basename} in Sources`);
  if (existingBuildEntry) {
    return;
  }

  let buildFileUuid = null;
  for (const [key, value] of Object.entries(buildFileSection)) {
    if (key.endsWith('_comment')) {
      continue;
    }
    if (value.fileRef === fileRefUuid) {
      buildFileUuid = key;
      break;
    }
  }

  if (!buildFileUuid) {
    buildFileUuid = project.generateUuid();
    buildFileSection[buildFileUuid] = {
      isa: 'PBXBuildFile',
      fileRef: fileRefUuid,
      fileRef_comment: basename,
    };
    buildFileSection[`${buildFileUuid}_comment`] = `${basename} in Sources`;
  }

  sourcesPhase.files = sourcesPhase.files || [];
  sourcesPhase.files.push({
    value: buildFileUuid,
    comment: `${basename} in Sources`,
  });
}

function removeBuildFileFromOtherSourcesPhases(project, targetUuid, fileRefUuid) {
  const buildFileSection = project.pbxBuildFileSection() || {};
  const buildFileUuids = Object.entries(buildFileSection)
    .filter(([key, value]) => !key.endsWith('_comment') && value.fileRef === fileRefUuid)
    .map(([key]) => key);

  if (buildFileUuids.length === 0) {
    return;
  }

  const nativeTargetSection = project.pbxNativeTargetSection() || {};
  for (const [candidateTargetUuid, target] of Object.entries(nativeTargetSection)) {
    if (candidateTargetUuid.endsWith('_comment') || candidateTargetUuid === targetUuid || !target) {
      continue;
    }

    const sourcesPhase = project.pbxSourcesBuildPhaseObj(candidateTargetUuid);
    if (!sourcesPhase?.files) {
      continue;
    }

    sourcesPhase.files = sourcesPhase.files.filter((entry) => !buildFileUuids.includes(entry.value));
  }
}

function ensureExtensionBuildSettings(project, targetUuid, appleTeamId) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  if (!target) {
    throw new Error('[withFotosShareExtension] Extension target is missing from PBXNativeTarget.');
  }

  for (const [, configuration] of IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
    project,
    target.buildConfigurationList,
  )) {
    configuration.buildSettings = configuration.buildSettings || {};
    configuration.buildSettings.APPLICATION_EXTENSION_API_ONLY = 'YES';
    configuration.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_DIR}/${EXTENSION_ENTITLEMENTS}"`;
    configuration.buildSettings.INFOPLIST_FILE = `"${EXTENSION_DIR}/${EXTENSION_INFO_PLIST}"`;
    configuration.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
    configuration.buildSettings.LD_RUNPATH_SEARCH_PATHS =
      '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"';
    configuration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${EXTENSION_BUNDLE_ID}"`;
    configuration.buildSettings.PRODUCT_NAME = `"${EXTENSION_NAME}"`;
    configuration.buildSettings.SKIP_INSTALL = 'YES';
    configuration.buildSettings.SWIFT_VERSION = '5.0';
    configuration.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
    if (appleTeamId) {
      configuration.buildSettings.CODE_SIGN_STYLE = 'Automatic';
      configuration.buildSettings.DEVELOPMENT_TEAM = appleTeamId;
    }
  }
}

function ensureExtensionProductIsEmbedded(project, appTargetUuid) {
  const nativeTarget = project.pbxNativeTargetSection()[appTargetUuid];
  const copyFilesSection = project.hash.project.objects.PBXCopyFilesBuildPhase || {};
  const buildFileSection = project.pbxBuildFileSection() || {};
  const fileReferenceSection = project.pbxFileReferenceSection() || {};

  const extensionBuildFileUuid = Object.entries(buildFileSection).find(([key, value]) => (
    !key.endsWith('_comment') &&
    value.fileRef &&
    stripQuotes(fileReferenceSection[value.fileRef]?.path) === EXTENSION_PRODUCT
  ))?.[0];

  if (!extensionBuildFileUuid) {
    throw new Error('[withFotosShareExtension] Missing PBXBuildFile for extension product.');
  }

  const embedPhaseRef = nativeTarget.buildPhases.find((entry) => {
    const phase = copyFilesSection[entry.value];
    return phase?.dstSubfolderSpec === 13;
  });

  if (!embedPhaseRef) {
    throw new Error('[withFotosShareExtension] Missing Embed App Extensions phase.');
  }

  const embedPhase = copyFilesSection[embedPhaseRef.value];
  embedPhase.files = embedPhase.files || [];
  if (!embedPhase.files.some((entry) => entry.value === extensionBuildFileUuid)) {
    embedPhase.files.push({
      value: extensionBuildFileUuid,
      comment: `${EXTENSION_PRODUCT} in Embed App Extensions`,
    });
  }
}

function normalizeExtensionProductComments(project, appTargetUuid) {
  const nativeTarget = project.pbxNativeTargetSection()[appTargetUuid];
  const copyFilesSection = project.hash.project.objects.PBXCopyFilesBuildPhase || {};
  const buildFileSection = project.pbxBuildFileSection() || {};
  const fileReferenceSection = project.pbxFileReferenceSection() || {};

  const embedPhaseRef = nativeTarget.buildPhases.find((entry) => {
    const phase = copyFilesSection[entry.value];
    return phase?.dstSubfolderSpec === 13;
  });

  if (!embedPhaseRef) {
    return;
  }

  renameCopyFilesPhase(project, embedPhaseRef.value, 'Embed App Extensions');
  const embedPhase = copyFilesSection[embedPhaseRef.value];
  embedPhase.files = embedPhase.files || [];

  for (const entry of embedPhase.files) {
    const buildFile = buildFileSection[entry.value];
    const fileReference = buildFile?.fileRef ? fileReferenceSection[buildFile.fileRef] : null;
    if (stripQuotes(fileReference?.path) === EXTENSION_PRODUCT) {
      entry.comment = `${EXTENSION_PRODUCT} in Embed App Extensions`;
      buildFileSection[`${entry.value}_comment`] = `${EXTENSION_PRODUCT} in Embed App Extensions`;
    }
  }
}

function stripQuotes(value) {
  return typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value;
}

function withFotosShareExtension(config) {
  config = withFotosShareExtensionFiles(config);
  config = withFotosShareExtensionEntitlements(config);
  config = withFotosShareExtensionXcodeProject(config);
  return config;
}

module.exports = createRunOncePlugin(withFotosShareExtension, 'fotos-share-extension', '1.0.0');
module.exports.EXTENSION_NAME = EXTENSION_NAME;
module.exports.applyFotosShareExtensionToProject = (project, options = {}) => {
  const appTarget = project.getTarget('com.apple.product-type.application');
  if (!appTarget) {
    throw new Error('[withFotosShareExtension] Could not find iOS application target.');
  }

  IOSConfig.XcodeUtils.ensureGroupRecursively(project, EXTENSION_DIR);

  let targetUuid = findTargetUuidByName(project, EXTENSION_NAME);
  if (!targetUuid) {
    targetUuid = project.addTarget(
      EXTENSION_NAME,
      'app_extension',
      EXTENSION_DIR,
      EXTENSION_BUNDLE_ID,
    ).uuid;
  }

  ensureTargetBuildPhases(project, targetUuid);
  ensureTargetDependencySections(project);
  ensureTargetDependency(project, appTarget.uuid, targetUuid);
  ensureEmbedAppExtensionsPhase(project, appTarget.uuid);
  ensureExtensionGroupFiles(project, EXTENSION_DIR, targetUuid);
  ensureExtensionBuildSettings(project, targetUuid, options.appleTeamId || null);
  ensureExtensionProductIsEmbedded(project, appTarget.uuid);
  normalizeExtensionProductComments(project, appTarget.uuid);

  return project;
};
