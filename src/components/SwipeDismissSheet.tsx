/**
 * SwipeDismissSheet
 *
 * Bottom-sheet wrapper. Swipe-to-dismiss was removed — the gesture was too
 * easy to trigger accidentally and every sheet already has an X button.
 *
 * We still use a GestureDetector with a Pan gesture here so that any downward
 * swipe on the sheet is consumed by gesture-handler and never falls through to
 * the backdrop TouchableOpacity behind it (which would dismiss the modal).
 * Taps inside the sheet work normally because the pan gesture fails on
 * stationary touches and releases them back to the RN responder system.
 */

import React, { useMemo } from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

interface Props {
  onDismiss: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  paddingBottom?: number;
}

export function SwipeDismissSheet({ style, children }: Props) {
  // Created inside the component (not at module level) so the gesture runtime
  // is guaranteed to be ready, and hot reloads don't hit an uninitialized host.
  const blockPan = useMemo(
    () => Gesture.Pan().activeOffsetY(10).onUpdate(() => {}),
    []
  );

  return (
    <GestureDetector gesture={blockPan}>
      <View style={style}>
        {children}
      </View>
    </GestureDetector>
  );
}
