// Disable native iOS autolinking for modules whose void methods crash on
// iOS 26.0–26.5. RN 0.81's TurboModule interop dispatches void method
// invocations on background GCD threads, bypassing methodQueue = main_queue.
// Any module that touches UIKit from those threads throws an ObjC exception
// that propagates to __cxa_rethrow and aborts the process. Apple fixed the
// behavior in iOS 26.6.
//
// react-native-reanimated: no code in this app imports it directly.
// react-native-gesture-handler: GestureHandlerRootView becomes a plain View;
//   RN's built-in gesture system handles all tap/scroll gestures used here.
module.exports = {
  dependencies: {
    'react-native-reanimated': {
      platforms: { ios: null },
    },
    'react-native-gesture-handler': {
      platforms: { ios: null },
    },
  },
};
