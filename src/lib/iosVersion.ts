import Constants from 'expo-constants';
import { Platform, NativeModules } from 'react-native';

/**
 * Returns true on iOS 26.0–26.5.
 *
 * On these versions, RN 0.81's TurboModule interop dispatches void methods on
 * background GCD threads, bypassing `methodQueue = dispatch_get_main_queue()`.
 * UIKit-touching modules throw ObjC exceptions from those threads, which
 * propagate to `ObjCTurboModule::performVoidMethodInvocation`, are re-thrown as
 * C++ exceptions, and abort the process because there is no C++ catch handler.
 * Apple fixed the underlying behavior in iOS 26.6.
 */
export function isAffectedIOSVersion(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    const constantsPlatform = Constants.platform as
      | { ios?: { systemVersion?: string } }
      | undefined;
    const candidates = [
      NativeModules.PlatformConstants?.osVersion,
      NativeModules.PlatformConstants?.systemVersion,
      constantsPlatform?.ios?.systemVersion,
      Platform.Version,
    ]
      .filter(value => value !== undefined && value !== null)
      .map(String);
    const osVersion = candidates.find(value => /^\d+\.\d+/.test(value)) ?? '';
    const match = osVersion.match(/^(\d+)\.(\d+)/);
    if (!match) return false;
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    if (major !== 26) return false;
    return minor < 6;
  } catch {
    return false;
  }
}
