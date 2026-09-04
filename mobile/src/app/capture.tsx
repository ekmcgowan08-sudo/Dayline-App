import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CAPTURE } from '../constants/brand';
import { spacing } from '../constants/theme';
import { enqueueClipForUpload } from '../services/clips';
import { useAuthStore } from '../state/auth-store';
import { Button } from '../components/ui/Button';
import { Text } from '../components/ui/Text';
import { useTheme } from '../hooks/use-theme';
import * as FileSystem from 'expo-file-system/legacy';

type Phase = 'ready' | 'recording' | 'reviewing';

export default function Capture() {
  const theme = useTheme();
  const userId = useAuthStore((s) => s.session?.user.id);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [phase, setPhase] = useState<Phase>('ready');
  const [countdown, setCountdown] = useState<number>(CAPTURE.clipSeconds);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const player = useVideoPlayer(recordedUri ?? null, (p) => {
    p.loop = true;
  });

  useEffect(() => {
    if (phase === 'reviewing' && recordedUri) player.play();
    return () => {
      if (phase !== 'reviewing') player.pause();
    };
  }, [phase, recordedUri, player]);

  useEffect(() => {
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, []);

  const permissionsGranted = camPerm?.granted && micPerm?.granted;

  async function startRecording() {
    if (!cameraRef.current || phase !== 'ready') return;
    setPhase('recording');
    setCountdown(CAPTURE.clipSeconds);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    AccessibilityInfo.announceForAccessibility('Recording started, five seconds');

    countdownTimer.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);

    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: CAPTURE.clipSeconds });
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (video?.uri) {
        setRecordedUri(video.uri);
        setPhase('reviewing');
      } else {
        setPhase('ready');
      }
    } catch {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      setPhase('ready');
    }
  }

  async function handleRetake() {
    if (recordedUri) await FileSystem.deleteAsync(recordedUri, { idempotent: true }).catch(() => {});
    setRecordedUri(null);
    setPhase('ready');
  }

  function handleUse() {
    if (!recordedUri || !userId) return;
    enqueueClipForUpload(userId, recordedUri, CAPTURE.clipSeconds * 1000);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.back();
  }

  async function handleCancel() {
    if (recordedUri) await FileSystem.deleteAsync(recordedUri, { idempotent: true }).catch(() => {});
    router.back();
  }

  if (!permissionsGranted) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: '#000' }]}>
        <Text variant="heading" color="#fff" style={styles.center}>
          Camera & microphone access needed
        </Text>
        <Text variant="body" color="#ccc" style={[styles.center, { marginVertical: spacing.md }]}>
          Dayline needs both to record your five-second moment. Nothing is
          shared until you choose to.
        </Text>
        <Button
          label="Allow access"
          onPress={async () => {
            await requestCamPerm();
            await requestMicPerm();
          }}
        />
        <Button label="Not now" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  if (phase === 'reviewing' && recordedUri) {
    return (
      <View style={styles.container}>
        <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />
        <View style={styles.reviewControls}>
          <Button label="Retake" variant="secondary" onPress={handleRetake} />
          <Button label="Use this clip" onPress={handleUse} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode="video" />

      <Pressable onPress={handleCancel} style={styles.closeBtn} accessibilityLabel="Cancel capture" accessibilityRole="button">
        <Ionicons name="close" size={28} color="#fff" />
      </Pressable>

      {phase === 'ready' ? (
        <Pressable
          onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          style={styles.flipBtn}
          accessibilityLabel="Switch camera"
          accessibilityRole="button"
        >
          <Ionicons name="camera-reverse-outline" size={28} color="#fff" />
        </Pressable>
      ) : null}

      {phase === 'recording' ? (
        <View style={styles.countdownWrap} accessibilityLiveRegion="polite">
          <Text variant="display" color="#fff">
            {countdown}
          </Text>
        </View>
      ) : null}

      <View style={styles.bottomControls}>
        <Pressable
          onPress={startRecording}
          disabled={phase === 'recording'}
          accessibilityRole="button"
          accessibilityLabel={phase === 'recording' ? 'Recording' : 'Record five seconds'}
          style={[styles.recordButton, phase === 'recording' && { borderColor: theme.accentCoral }]}
        >
          <View style={[styles.recordButtonInner, phase === 'recording' && styles.recordButtonInnerActive]} />
        </Pressable>
        <Text variant="caption" color="#fff" style={{ marginTop: spacing.sm }}>
          {phase === 'recording' ? 'Recording…' : 'Tap to capture 5 seconds'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', textAlign: 'center', paddingHorizontal: spacing.xl },
  closeBtn: { position: 'absolute', top: 56, left: spacing.lg, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  flipBtn: { position: 'absolute', top: 56, right: spacing.lg, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  countdownWrap: { position: 'absolute', top: '20%', alignSelf: 'center' },
  bottomControls: { position: 'absolute', bottom: 56, alignSelf: 'center', alignItems: 'center' },
  recordButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  recordButtonInnerActive: { width: 32, height: 32, borderRadius: 8, backgroundColor: 'red' },
  reviewControls: {
    position: 'absolute',
    bottom: 56,
    flexDirection: 'row',
    gap: spacing.md,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: spacing.xl,
  },
});
