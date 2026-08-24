import React, {useCallback, useContext, useState} from 'react';
import {Alert, View} from 'react-native';
import Share from 'react-native-share';

import {observer} from 'mobx-react-lite';
import {Button, Card, Divider, Text} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Sheet} from '../../components';
import {useTheme} from '../../hooks';
import {L10nContext} from '../../utils';
import {formatByteSize} from '../../utils/fileAttachments';
import {
  type WorkspaceFileEntry,
  listWorkspaceFiles,
  readWorkspaceText,
  deleteWorkspaceFile,
} from '../../services/talents/workspaceFs';

import {createStyles} from './styles';

const PREVIEW_CHARS = 4000;

export const WorkspaceScreen: React.FC = observer(() => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const styles = createStyles(theme);
  const t = l10n.workspaceScreen;

  const [files, setFiles] = useState<WorkspaceFileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewName, setPreviewName] = useState<string | null>(null);
  // null = still reading, undefined = read failed (binary/large file).
  const [previewText, setPreviewText] = useState<string | null | undefined>(
    null,
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setFiles(await listWorkspaceFiles());
    } catch (error) {
      console.warn('[Workspace] listing failed:', error);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const openPreview = useCallback(async (entry: WorkspaceFileEntry) => {
    setPreviewName(entry.relPath);
    setPreviewText(null);
    try {
      const text = await readWorkspaceText(entry.absPath, PREVIEW_CHARS);
      setPreviewText(text);
    } catch {
      setPreviewText(undefined); // distinguish "not text" from "loading"
    }
  }, []);

  const confirmDelete = useCallback(
    (entry: WorkspaceFileEntry) => {
      Alert.alert(
        t.deleteTitle,
        t.deleteMessage.replace('{{name}}', entry.relPath),
        [
          {text: l10n.common.cancel, style: 'cancel'},
          {
            text: t.delete,
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteWorkspaceFile(entry.absPath);
              } catch (error) {
                console.warn('[Workspace] delete failed:', error);
              }
              await refresh();
            },
          },
        ],
      );
    },
    [t, l10n, refresh],
  );

  const shareFile = useCallback(async (entry: WorkspaceFileEntry) => {
    try {
      // react-native-share resolves the FileProvider URI on Android;
      // RN's built-in Share cannot hand local files to other apps.
      await Share.open({
        url: 'file://' + entry.absPath,
        title: entry.relPath,
        failOnCancel: false,
      });
    } catch (error) {
      // User-cancelled shares throw too; only real failures log.
      console.warn('[Workspace] share failed:', error);
    }
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Card elevation={0} style={styles.card}>
        <Card.Title
          title={l10n.screenTitles.workspace}
          subtitle={
            files.length > 0
              ? t.totalUsage
                  .replace('{{count}}', String(files.length))
                  .replace('{{size}}', formatByteSize(totalSize))
              : undefined
          }
          subtitleNumberOfLines={1}
        />
        <Card.Content>
          {isLoading ? (
            <Text variant="labelSmall" style={styles.description}>
              ...
            </Text>
          ) : files.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text variant="titleSmall">{t.emptyTitle}</Text>
              <Text variant="labelSmall" style={styles.description}>
                {t.emptyHint}
              </Text>
            </View>
          ) : (
            files.map(entry => (
              <View key={entry.relPath}>
                <Divider />
                <View style={styles.fileRow}>
                  <View style={styles.fileInfo}>
                    <Text variant="bodyMedium" numberOfLines={1}>
                      {entry.relPath}
                    </Text>
                    <Text
                      variant="labelSmall"
                      style={styles.description}
                      numberOfLines={1}>
                      {formatByteSize(entry.size)}
                    </Text>
                  </View>
                  <Button
                    compact
                    onPress={() => void openPreview(entry)}
                    testID={`workspace-preview-${entry.relPath}`}>
                    {t.view}
                  </Button>
                  <Button compact onPress={() => void shareFile(entry)}>
                    {t.share}
                  </Button>
                  <Button
                    compact
                    textColor={theme.colors.error}
                    onPress={() => confirmDelete(entry)}
                    testID={`workspace-delete-${entry.relPath}`}>
                    {t.delete}
                  </Button>
                </View>
              </View>
            ))
          )}
          <Divider />
          <Button compact onPress={() => void refresh()} style={styles.refresh}>
            {t.refresh}
          </Button>
        </Card.Content>
      </Card>

      <Sheet
        isVisible={previewName != null}
        onClose={() => setPreviewName(null)}
        title={previewName ?? undefined}
        displayFullHeight>
        <Sheet.ScrollView>
          <Text variant="labelSmall" style={styles.description}>
            {t.previewTitle}
          </Text>
          {previewText === null ? (
            <Text variant="labelSmall" style={styles.description}>
              ...
            </Text>
          ) : previewText === undefined ? (
            <Text variant="labelSmall" style={styles.description}>
              {t.notTextFile}
            </Text>
          ) : (
            <Text variant="bodySmall" selectable>
              {previewText}
            </Text>
          )}
        </Sheet.ScrollView>
      </Sheet>
    </SafeAreaView>
  );
});
