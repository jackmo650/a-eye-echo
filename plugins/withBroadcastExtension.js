/**
 * Expo Config Plugin — Adds Broadcast Upload Extension for system audio capture.
 *
 * This plugin:
 *   1. Copies native Swift files into the iOS project
 *   2. Adds App Group entitlements for both main app and extension
 *   3. Adds the AEYEECHOBroadcast extension target to the Xcode project
 *   4. Updates the bridging header for React Native imports
 *   5. Embeds the extension in the main app bundle
 */
const {
  withXcodeProject,
  withEntitlementsPlist,
  withInfoPlist,
  withDangerousMod,
} = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const APP_GROUP = 'group.com.wallspace.aeyeecho';
const EXTENSION_NAME = 'AEYEECHOBroadcast';
const EXTENSION_BUNDLE_ID = 'com.wallspace.aeyeecho.broadcast';
const TEAM_ID = '9K65QDV874';
const APP_NAME = 'AEYEECHO';

function withBroadcastExtension(config) {
  // Skip entirely on Android — this plugin is iOS-only
  // (config plugins run for all platforms during prebuild)

  // Step 1: Add App Group to main app entitlements
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.security.application-groups'] = [APP_GROUP];
    return mod;
  });

  // Step 2: Copy native files into iOS project (runs after prebuild creates ios/)
  config = withDangerousMod(config, ['ios', (mod) => {
    const iosPath = path.join(mod.modRequest.projectRoot, 'ios');
    const pluginNativePath = path.join(mod.modRequest.projectRoot, 'plugins', 'native');

    // Copy broadcast extension files
    const extDst = path.join(iosPath, EXTENSION_NAME);
    fs.mkdirSync(extDst, { recursive: true });
    copyIfExists(pluginNativePath, extDst, 'SampleHandler.swift');
    copyIfExists(pluginNativePath, extDst, `${EXTENSION_NAME}.entitlements`);
    copyIfExists(pluginNativePath, extDst, 'BroadcastInfo.plist', 'Info.plist');

    // Copy native module files into main app
    const appDst = path.join(iosPath, APP_NAME);
    copyIfExists(pluginNativePath, appDst, 'AEyeEchoSystemAudio.swift');
    copyIfExists(pluginNativePath, appDst, 'AEyeEchoSystemAudio.m');
    copyIfExists(pluginNativePath, appDst, 'HandLandmarksPlugin.swift');
    copyIfExists(pluginNativePath, appDst, 'HandLandmarksPlugin.m');

    // Update bridging header — always write the full content
    const bridgingPath = path.join(appDst, `${APP_NAME}-Bridging-Header.h`);
    const bridgingContent = `//
//  Use this file to import your target's public headers that you would like to expose to Swift.
//

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import <VisionCamera/Frame.h>
#import <VisionCamera/VisionCameraProxyHolder.h>
`;
    fs.writeFileSync(bridgingPath, bridgingContent);

    // Fix Podfile.properties.json deployment target
    const podPropsPath = path.join(iosPath, 'Podfile.properties.json');
    if (fs.existsSync(podPropsPath)) {
      const podProps = JSON.parse(fs.readFileSync(podPropsPath, 'utf8'));
      podProps['ios.deploymentTarget'] = '16.0';
      fs.writeFileSync(podPropsPath, JSON.stringify(podProps, null, 2) + '\n');
    }

    // Update main app entitlements file
    const entPath = path.join(appDst, `${APP_NAME}.entitlements`);
    const entContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.application-groups</key>
\t<array>
\t\t<string>${APP_GROUP}</string>
\t</array>
</dict>
</plist>`;
    fs.writeFileSync(entPath, entContent);

    console.log(`[withBroadcastExtension] Copied native files`);
    return mod;
  }]);

  // Step 3: Modify Xcode project to add extension target + native module files
  config = withXcodeProject(config, (mod) => {
    const xcodeProject = mod.modResults;

    // Add native module files (AEyeEchoSystemAudio) to main app target's Sources
    const mainAppTarget = xcodeProject.getFirstTarget();
    const nativeFiles = [
      { name: 'AEyeEchoSystemAudio.swift', type: 'sourcecode.swift' },
      { name: 'AEyeEchoSystemAudio.m', type: 'sourcecode.c.objc' },
      { name: 'HandLandmarksPlugin.swift', type: 'sourcecode.swift' },
      { name: 'HandLandmarksPlugin.m', type: 'sourcecode.c.objc' },
    ];
    for (const { name: fileName, type: fileType } of nativeFiles) {
      xcodeProject.addSourceFile(
        `${APP_NAME}/${fileName}`,
        { target: mainAppTarget.uuid, lastKnownFileType: fileType },
        xcodeProject.findPBXGroupKey({ name: APP_NAME }) ||
        xcodeProject.findPBXGroupKey({ path: APP_NAME })
      );
    }
    console.log(`[withBroadcastExtension] Added native module files to ${APP_NAME} target`);

    // Check if extension target already exists
    const targets = xcodeProject.pbxNativeTargetSection();
    for (const key in targets) {
      if (targets[key].name === EXTENSION_NAME) {
        console.log(`[withBroadcastExtension] Target ${EXTENSION_NAME} already exists, skipping`);
        return mod;
      }
    }

    // Create extension group in project
    const extGroup = xcodeProject.addPbxGroup(
      ['SampleHandler.swift', 'Info.plist', `${EXTENSION_NAME}.entitlements`],
      EXTENSION_NAME,
      EXTENSION_NAME
    );

    // Add group to main group
    const mainGroupId = xcodeProject.getFirstProject().firstProject.mainGroup;
    xcodeProject.addToPbxGroup(extGroup.uuid, mainGroupId);

    // Add extension target
    const target = xcodeProject.addTarget(
      EXTENSION_NAME,
      'app_extension',
      EXTENSION_NAME,
      EXTENSION_BUNDLE_ID
    );

    // Add SampleHandler.swift to extension Sources build phase
    // Use addBuildPhase with the file directly — this properly creates
    // PBXBuildFile entries and links them to the build phase
    xcodeProject.addBuildPhase(
      [`${EXTENSION_NAME}/SampleHandler.swift`],
      'PBXSourcesBuildPhase',
      'Sources',
      target.uuid
    );

    // Add frameworks
    xcodeProject.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
    xcodeProject.addFramework('ReplayKit.framework', { target: target.uuid, link: true });

    // Add resources
    xcodeProject.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);

    // Configure build settings
    const configurations = xcodeProject.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      const cfg = configurations[key];
      if (cfg.buildSettings && cfg.name) {
        const configList = xcodeProject.pbxXCConfigurationList();
        for (const listKey in configList) {
          const list = configList[listKey];
          if (list.buildConfigurations) {
            const refs = list.buildConfigurations.map(c => c.value);
            if (refs.includes(key) &&
                target.pbxNativeTarget &&
                target.pbxNativeTarget.buildConfigurationList === listKey) {
              cfg.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${EXTENSION_BUNDLE_ID}"`;
              cfg.buildSettings.DEVELOPMENT_TEAM = TEAM_ID;
              cfg.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements"`;
              cfg.buildSettings.CODE_SIGN_STYLE = 'Automatic';
              cfg.buildSettings.INFOPLIST_FILE = `"${EXTENSION_NAME}/Info.plist"`;
              cfg.buildSettings.SWIFT_VERSION = '5.0';
              cfg.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2"';
              cfg.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = '16.0';
              cfg.buildSettings.GENERATE_INFOPLIST_FILE = 'NO';
              cfg.buildSettings.CURRENT_PROJECT_VERSION = '1';
              cfg.buildSettings.MARKETING_VERSION = '1.0';
              cfg.buildSettings.SKIP_INSTALL = 'YES';
            }
          }
        }
      }
    }

    // Embed extension in main app
    const mainTarget = xcodeProject.getFirstTarget();
    const embedPhase = xcodeProject.addBuildPhase(
      [],
      'PBXCopyFilesBuildPhase',
      'Embed App Extensions',
      mainTarget.uuid,
      'app_extension'
    );
    if (embedPhase && embedPhase.buildPhase) {
      embedPhase.buildPhase.dstSubfolderSpec = 13;
      embedPhase.buildPhase.dstPath = '""';
    }

    console.log(`[withBroadcastExtension] Added ${EXTENSION_NAME} target`);
    return mod;
  });

  return config;
}

function copyIfExists(srcDir, dstDir, srcName, dstName) {
  dstName = dstName || srcName;
  const srcPath = path.join(srcDir, srcName);
  const dstPath = path.join(dstDir, dstName);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, dstPath);
  }
}

module.exports = withBroadcastExtension;
