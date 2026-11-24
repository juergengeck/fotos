import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { ArrowUp, ChevronsUpDown } from 'lucide-react-native';
import {
  clampUnit,
  computeDockTopOffset,
  resolveTimelineSectionAtRatio,
  type FotosTimelineLayout,
} from '../services/FotosTimelineScrubberModel';
import { borderColor, palette } from '../../src/theme';

const SLIDER_HEIGHT = 86;
const HOLD_DELAY_MS = 260;

export interface FotosTimelineScrubberProps {
  layout: FotosTimelineLayout;
  progress: number;
  activeLabel?: string;
  onScrubToRatio: (ratio: number) => void;
  onScrollToTop: () => void;
  onScrubbingChange?: (scrubbing: boolean) => void;
}

/**
 * Mobile counterpart to fotos.browser's TimelineScrubber + FeedScrollControl:
 * a floating right-edge scroll dock with tap-to-top, hold-to-scrub, and a
 * direct-drag vertical timeline scale with proportional day ticks.
 */
export function FotosTimelineScrubber({
  layout,
  progress,
  activeLabel,
  onScrubToRatio,
  onScrollToTop,
  onScrubbingChange,
}: FotosTimelineScrubberProps) {
  const isDark = useColorScheme() === 'dark';
  const [scrubbing, setScrubbing] = useState(false);
  const [sliderDragging, setSliderDragging] = useState(false);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
  const [trackHeight, setTrackHeight] = useState(0);
  const [dockHeight, setDockHeight] = useState(0);

  const progressRef = useRef(progress);
  progressRef.current = clampUnit(progress);
  const scrubbingRef = useRef(scrubbing);
  scrubbingRef.current = scrubbing;
  const trackHeightRef = useRef(trackHeight);
  trackHeightRef.current = trackHeight;
  const dockHeightRef = useRef(dockHeight);
  dockHeightRef.current = dockHeight;
  const onScrubToRatioRef = useRef(onScrubToRatio);
  onScrubToRatioRef.current = onScrubToRatio;
  const onScrollToTopRef = useRef(onScrollToTop);
  onScrollToTopRef.current = onScrollToTop;
  const onScrubbingChangeRef = useRef(onScrubbingChange);
  onScrubbingChangeRef.current = onScrubbingChange;

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonGestureRef = useRef<{
    startRatio: number;
    wasScrubbing: boolean;
    entered: boolean;
    moved: boolean;
  } | null>(null);
  const sliderGestureRef = useRef<{
    startRatio: number;
  } | null>(null);

  const clearHold = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  useEffect(() => () => clearHold(), []);

  const updateScrubbing = (next: boolean) => {
    setScrubbing(next);
    scrubbingRef.current = next;
    onScrubbingChangeRef.current?.(next);
  };

  const buttonResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          clearHold();
          const currentScrubbing = scrubbingRef.current;
          buttonGestureRef.current = {
            startRatio: progressRef.current,
            wasScrubbing: currentScrubbing,
            entered: currentScrubbing,
            moved: false,
          };
          if (!currentScrubbing) {
            holdTimerRef.current = setTimeout(() => {
              holdTimerRef.current = null;
              if (!buttonGestureRef.current) return;
              buttonGestureRef.current.entered = true;
              setScrubRatio(buttonGestureRef.current.startRatio);
              updateScrubbing(true);
            }, HOLD_DELAY_MS);
          } else {
            setScrubRatio(progressRef.current);
          }
        },
        onPanResponderMove: (_event, gestureState) => {
          const gesture = buttonGestureRef.current;
          if (!gesture) return;
          if (Math.abs(gestureState.dy) > 6) {
            gesture.moved = true;
            if (!gesture.entered) {
              clearHold();
              gesture.entered = true;
              updateScrubbing(true);
            }
          }
          if (!gesture.entered) return;
          const travel = Math.max(1, trackHeightRef.current - dockHeightRef.current);
          const nextRatio = clampUnit(gesture.startRatio + gestureState.dy / travel);
          setScrubRatio(nextRatio);
          onScrubToRatioRef.current(nextRatio);
        },
        onPanResponderRelease: () => {
          const gesture = buttonGestureRef.current;
          clearHold();
          buttonGestureRef.current = null;
          setScrubRatio(null);
          if (!gesture) return;
          if (!gesture.entered) {
            onScrollToTopRef.current();
          } else if (gesture.wasScrubbing && !gesture.moved) {
            updateScrubbing(false);
          }
        },
        onPanResponderTerminate: () => {
          const gesture = buttonGestureRef.current;
          clearHold();
          buttonGestureRef.current = null;
          setScrubRatio(null);
          if (gesture) {
            onScrubToRatioRef.current(gesture.startRatio);
            updateScrubbing(gesture.wasScrubbing);
          }
        },
      }),
    [],
  );

  const sliderResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          const localY = event.nativeEvent.locationY;
          const initialRatio = Number.isFinite(localY)
            ? clampUnit(localY / SLIDER_HEIGHT)
            : progressRef.current;
          sliderGestureRef.current = { startRatio: initialRatio };
          setSliderDragging(true);
          setScrubRatio(initialRatio);
          onScrubbingChangeRef.current?.(true);
          onScrubToRatioRef.current(initialRatio);
        },
        onPanResponderMove: (_event, gestureState) => {
          const gesture = sliderGestureRef.current;
          if (!gesture) return;
          const nextRatio = clampUnit(gesture.startRatio + gestureState.dy / SLIDER_HEIGHT);
          setScrubRatio(nextRatio);
          onScrubToRatioRef.current(nextRatio);
        },
        onPanResponderRelease: () => {
          sliderGestureRef.current = null;
          setSliderDragging(false);
          setScrubRatio(null);
          onScrubbingChangeRef.current?.(scrubbingRef.current);
        },
        onPanResponderTerminate: () => {
          sliderGestureRef.current = null;
          setSliderDragging(false);
          setScrubRatio(null);
          onScrubbingChangeRef.current?.(scrubbingRef.current);
        },
      }),
    [],
  );

  if (layout.sections.length === 0 || layout.maxScroll <= 40) {
    return null;
  }

  const effectiveProgress = scrubRatio ?? clampUnit(progress);
  const isActivelyScrubbing = scrubbing || sliderDragging;
  const dockRatio = scrubbing ? effectiveProgress : 1;
  const dockTop = computeDockTopOffset(trackHeight, dockHeight, dockRatio);

  const previewSection = resolveTimelineSectionAtRatio(layout.sections, effectiveProgress);
  const displayLabel = isActivelyScrubbing
    ? (previewSection?.label ?? activeLabel)
    : (activeLabel ?? previewSection?.label);
  const shortActiveLabel = isActivelyScrubbing
    ? (previewSection?.shortLabel ?? layout.firstShortLabel)
    : (previewSection?.shortLabel ?? layout.firstShortLabel);

  const surfaceBg = isDark ? 'rgba(26, 28, 26, 0.88)' : 'rgba(255, 255, 255, 0.90)';
  const pillBg = isDark ? 'rgba(22, 24, 22, 0.94)' : 'rgba(23, 23, 23, 0.88)';
  const railColor = isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(23, 23, 23, 0.16)';
  const tickColor = isDark ? 'rgba(255, 255, 255, 0.42)' : 'rgba(23, 23, 23, 0.34)';
  const labelMuted = isDark ? 'rgba(245, 245, 245, 0.72)' : 'rgba(23, 23, 23, 0.62)';
  const labelPrimary = isDark ? '#f5f5f5' : '#171717';
  const stroke = borderColor(isDark);

  return (
    <View
      pointerEvents="box-none"
      style={styles.track}
      onLayout={(event) => setTrackHeight(event.nativeEvent.layout.height)}
    >
      <View
        pointerEvents="box-none"
        onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
        style={[
          styles.dockWrapper,
          trackHeight > 0 && dockHeight > 0
            ? { top: dockTop }
            : { bottom: 0 },
        ]}
      >
        {isActivelyScrubbing && displayLabel ? (
          <View pointerEvents="none" style={[styles.callout, { backgroundColor: pillBg }]}>
            <Text style={styles.calloutText} numberOfLines={1}>
              {displayLabel}
            </Text>
          </View>
        ) : null}

        <View style={styles.dockColumn} pointerEvents="box-none">
          <View
            accessibilityRole="button"
            accessibilityLabel={scrubbing ? 'Scrub gallery' : 'Scroll to top'}
            accessibilityHint="Tap to scroll to top, or hold and drag to scrub timeline"
            {...buttonResponder.panHandlers}
            style={[
              styles.actionButton,
              {
                backgroundColor: scrubbing ? palette.accent : surfaceBg,
                borderColor: scrubbing ? palette.accent : stroke,
              },
            ]}
          >
            {scrubbing ? (
              <ChevronsUpDown size={19} color="#ffffff" />
            ) : (
              <ArrowUp size={19} color={labelPrimary} />
            )}
          </View>

          <View
            style={[
              styles.scaleCard,
              {
                backgroundColor: surfaceBg,
                borderColor: isActivelyScrubbing ? palette.accent : stroke,
              },
            ]}
          >
            {shortActiveLabel ? (
              <Text style={[styles.activeDateText, { color: labelPrimary }]} numberOfLines={1}>
                {shortActiveLabel}
              </Text>
            ) : null}
            {layout.firstShortLabel ? (
              <Text style={[styles.boundText, { color: labelMuted }]} numberOfLines={1}>
                {layout.firstShortLabel}
              </Text>
            ) : null}

            <View
              accessibilityRole="adjustable"
              accessibilityLabel="Gallery timeline"
              {...sliderResponder.panHandlers}
              style={styles.sliderTouchArea}
            >
              <View pointerEvents="none" style={[styles.centerLine, { backgroundColor: railColor }]} />
              {layout.ticks.map((tick) => (
                <View
                  key={tick.key}
                  pointerEvents="none"
                  style={[
                    styles.tick,
                    {
                      backgroundColor: tickColor,
                      top: tick.ratio * SLIDER_HEIGHT,
                    },
                  ]}
                />
              ))}
              <View
                pointerEvents="none"
                style={[
                  styles.marker,
                  {
                    backgroundColor: palette.accent,
                    top: effectiveProgress * SLIDER_HEIGHT,
                  },
                ]}
              />
            </View>

            {layout.lastShortLabel ? (
              <Text style={[styles.boundText, { color: labelMuted }]} numberOfLines={1}>
                {layout.lastShortLabel}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    top: 8,
    bottom: 12,
    right: 8,
    left: 8,
    zIndex: 20,
  },
  dockWrapper: {
    position: 'absolute',
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  callout: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  calloutText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  dockColumn: {
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  scaleCard: {
    width: 56,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  activeDateText: {
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  boundText: {
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
  sliderTouchArea: {
    width: 44,
    height: SLIDER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    borderRadius: 1,
  },
  tick: {
    position: 'absolute',
    width: 10,
    height: 1.5,
    borderRadius: 1,
    transform: [{ translateY: -0.75 }],
  },
  marker: {
    position: 'absolute',
    width: 22,
    height: 3.5,
    borderRadius: 999,
    transform: [{ translateY: -1.75 }],
    shadowColor: palette.accent,
    shadowOpacity: 0.55,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
});
