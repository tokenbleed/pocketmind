import React from 'react';
import {View} from 'react-native';
import {IconButton, ProgressBar, Text, useTheme} from 'react-native-paper';
import {observer} from 'mobx-react';

import {L10nContext} from '../../utils';
import {sttStore} from '../../store/SttStore';
import {
  SttRecorder,
  SttPermissionDeniedError,
} from '../../services/stt/SttRecorder';
import {STT_MODELS} from '../../services/stt/catalog';

type Phase = 'idle' | 'recording' | 'transcribing' | 'error';

interface Props {
  /** Called with the final transcript; the caller owns insertion. */
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

/**
 * Composer mic button: records a mono 16 kHz WAV, transcribes it with the
 * installed whisper model, and hands the text back for insertion. The
 * transcript is never sent by itself, mirroring the share-sheet posture:
 * what lands in the composer stays an editable draft.
 *
 * With no model installed the button opens a small download sheet for the
 * selected (default: tiny) model instead of recording.
 */
export const SttMicButton = observer(
  ({onTranscript, disabled = false}: Props) => {
    const l10n = React.useContext(L10nContext);
    const theme = useTheme();
    const [phase, setPhase] = React.useState<Phase>('idle');
    const [elapsed, setElapsed] = React.useState(0);
    const [message, setMessage] = React.useState<string | null>(null);
    const [sheetVisible, setSheetVisible] = React.useState(false);
    const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

    React.useEffect(
      () => () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        SttRecorder.cancel().catch(() => undefined);
      },
      [],
    );

    const startTimer = () => {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    };
    const stopTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const handlePress = async () => {
      setMessage(null);
      if (phase === 'recording') {
        stopTimer();
        setPhase('transcribing');
        try {
          const wavPath = await SttRecorder.stop();
          const transcript = await sttStore.transcribe(wavPath);
          if (transcript) {
            onTranscript(transcript);
          } else {
            setMessage(l10n.stt.noSpeech);
          }
        } catch (err) {
          setPhase('error');
          setMessage(
            err instanceof Error
              ? err.message || l10n.stt.transcriptionFailed
              : l10n.stt.transcriptionFailed,
          );
          return;
        }
        setPhase('idle');
        return;
      }
      if (phase !== 'idle' && phase !== 'error') {
        return;
      }
      if (!sttStore.isModelReady) {
        setSheetVisible(true);
        return;
      }
      try {
        await SttRecorder.start();
        setPhase('recording');
        startTimer();
      } catch (err) {
        if (err instanceof SttPermissionDeniedError) {
          setMessage(l10n.stt.permissionDenied);
        } else {
          setMessage(
            err instanceof Error ? err.message : l10n.stt.recordingFailed,
          );
        }
        setPhase('error');
      }
    };

    const icon = phase === 'recording' ? 'stop' : 'microphone';

    return (
      <View style={styles.wrap}>
        {phase === 'transcribing' && (
          <Text
            variant="labelSmall"
            style={styles.label}
            testID="stt-transcribing">
            {l10n.stt.transcribing}
          </Text>
        )}
        {phase === 'recording' && (
          <Text
            variant="labelSmall"
            style={[styles.label, styles.recording]}
            testID="stt-timer">
            {formatElapsed(elapsed)}
          </Text>
        )}
        {message && phase !== 'recording' && (
          <Text variant="labelSmall" style={styles.label} numberOfLines={1}>
            {message}
          </Text>
        )}
        {sheetVisible && (
          <View
            style={[
              styles.sheet,
              {backgroundColor: theme.colors.elevation.level2},
            ]}
            testID="stt-download-sheet">
            <Text variant="labelMedium" style={styles.sheetTitle}>
              {l10n.stt.downloadTitle}
            </Text>
            <Text variant="bodySmall" style={styles.sheetText}>
              {l10n.stt.downloadBody}
            </Text>
            {STT_MODELS.map(entry => {
              const state = sttStore.modelStates.get(entry.id);
              return (
                <View key={entry.id} style={styles.sheetRow}>
                  <Text
                    variant="bodySmall"
                    style={[styles.sheetText, styles.grow]}
                    numberOfLines={1}>
                    {entry.label}
                  </Text>
                  {state?.status === 'downloading' ? (
                    <View style={styles.progressWrap}>
                      <ProgressBar
                        progress={state.progress}
                        style={styles.progressBar}
                        testID={`stt-progress-${entry.id}`}
                      />
                    </View>
                  ) : state?.status === 'ready' ? (
                    <IconButton
                      icon="check"
                      size={16}
                      onPress={() => {
                        sttStore.setSelectedModel(entry.id);
                        setSheetVisible(false);
                      }}
                      accessibilityLabel={entry.label}
                      testID={`stt-use-${entry.id}`}
                    />
                  ) : (
                    <IconButton
                      icon="download"
                      size={16}
                      onPress={() => sttStore.downloadModel(entry.id)}
                      accessibilityLabel={entry.label}
                      testID={`stt-download-${entry.id}`}
                    />
                  )}
                </View>
              );
            })}
            <IconButton
              icon="close"
              size={16}
              onPress={() => setSheetVisible(false)}
              style={styles.sheetClose}
              accessibilityLabel={l10n.common.cancel}
              testID="stt-sheet-close"
            />
          </View>
        )}
        <IconButton
          icon={icon}
          size={22}
          onPress={handlePress}
          disabled={disabled || phase === 'transcribing'}
          iconColor={phase === 'recording' ? theme.colors.error : undefined}
          accessibilityLabel={l10n.stt.micLabel}
          accessibilityRole="button"
          testID="stt-mic-button"
        />
      </View>
    );
  },
);

const formatElapsed = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const styles = {
  wrap: {flexDirection: 'row' as const, alignItems: 'center' as const},
  label: {maxWidth: 120},
  recording: {color: '#e53935'},
  sheet: {
    position: 'absolute' as const,
    bottom: 48,
    right: 0,
    width: 280,
    padding: 12,
    borderRadius: 8,
    elevation: 4,
  },
  sheetTitle: {fontWeight: 'bold' as const, marginBottom: 4},
  sheetText: {opacity: 0.9, marginBottom: 4},
  sheetRow: {flexDirection: 'row' as const, alignItems: 'center' as const},
  grow: {flex: 1},
  progressWrap: {flex: 1, paddingHorizontal: 8},
  progressBar: {height: 6},
  sheetClose: {position: 'absolute' as const, top: 0, right: 0},
};

export default SttMicButton;
