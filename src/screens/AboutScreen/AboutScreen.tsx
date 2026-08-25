import React, {useState, useContext} from 'react';
import {View, ScrollView, TouchableOpacity, Alert, Linking} from 'react-native';

import DeviceInfo from 'react-native-device-info';
import Clipboard from '@react-native-clipboard/clipboard';
import {Text, Button, SegmentedButtons} from 'react-native-paper';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {BuildInfo} from 'llama.rn';

import {CopyIcon, GithubIcon, ChevronRightIcon} from '../../assets/icons';

import {Sheet, TextInput} from '../../components';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {L10nContext} from '../../utils';
import {uiStore} from '../../store';

const GithubButtonIcon = ({color}: {color: string}) => (
  <GithubIcon stroke={color} />
);

const ChevronRightButtonIcon = ({color}: {color: string}) => (
  <ChevronRightIcon stroke={color} />
);

export const AboutScreen: React.FC = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme, insets);
  const l10n = useContext(L10nContext);
  const [showFeedback, setShowFeedback] = useState(false);

  const [appInfo, setAppInfo] = React.useState({
    version: '',
    build: '',
  });

  const [useCase, setUseCase] = useState('');
  const [featureRequests, setFeatureRequests] = useState('');
  const [generalFeedback, setGeneralFeedback] = useState('');
  const [usageFrequency, setUsageFrequency] = useState('');

  React.useEffect(() => {
    const version = DeviceInfo.getVersion();
    const buildNumber = DeviceInfo.getBuildNumber();
    setAppInfo({
      version,
      build: buildNumber,
    });
  }, []);

  const copyVersionToClipboard = () => {
    const versionString = `Version ${appInfo.version} (${appInfo.build})`;
    Clipboard.setString(versionString);
    Alert.alert(
      l10n.about.versionCopiedTitle,
      l10n.about.versionCopiedDescription,
    );
  };

  const handleSubmit = async () => {
    if (!useCase && !featureRequests && !generalFeedback) {
      Alert.alert(l10n.feedback.validation.required);
      return;
    }

    // No backend: feedback lands as a prefilled GitHub issue the user
    // reviews and submits themselves.
    const body = [
      useCase && `**Use case:** ${useCase}`,
      featureRequests && `**Feature requests:** ${featureRequests}`,
      generalFeedback && `**Feedback:** ${generalFeedback}`,
      usageFrequency && `**Usage frequency:** ${usageFrequency}`,
      `**App version:** ${appInfo.version} (${appInfo.build})`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const issueUrl = `https://github.com/tokenbleed/pocketmind/issues/new?title=${encodeURIComponent(
      'App feedback',
    )}&body=${encodeURIComponent(body)}`;

    try {
      await Linking.openURL(issueUrl);
      setShowFeedback(false);
      // Clear form
      setUseCase('');
      setFeatureRequests('');
      setGeneralFeedback('');
      setUsageFrequency('');
    } catch {
      Alert.alert('Error', l10n.feedback.error.general);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Text variant="titleLarge" style={styles.title}>
                PocketMind
              </Text>
              <Text variant="bodyMedium" style={styles.description}>
                {l10n.about.description}
              </Text>
              <View style={styles.versionContainer}>
                <TouchableOpacity
                  style={styles.versionButton}
                  onPress={copyVersionToClipboard}>
                  <Text style={styles.versionText}>
                    v{appInfo.version} ({appInfo.build})
                  </Text>
                  <CopyIcon
                    width={16}
                    height={16}
                    stroke={theme.colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              <Text style={styles.llamaBuildText}>
                llama.cpp {BuildInfo.number} ({BuildInfo.commit.substring(0, 7)}
                )
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{l10n.about.supportProject}</Text>
            <Text variant="bodyMedium" style={styles.description}>
              {l10n.about.supportProjectDescription}
            </Text>
            <Button
              mode="outlined"
              onPress={() =>
                Linking.openURL('https://github.com/tokenbleed/pocketmind')
              }
              style={styles.actionButton}
              icon={GithubButtonIcon}>
              {l10n.about.githubButton}
            </Button>
            <Text style={styles.orText}>{l10n.about.orBy}</Text>
            <Button
              mode="outlined"
              style={styles.actionButton}
              contentStyle={styles.feedbackButtonContent}
              icon={ChevronRightButtonIcon}
              onPress={() => setShowFeedback(true)}>
              {l10n.feedback.shareThoughtsButton}
            </Button>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{l10n.about.tour}</Text>
            <Text variant="bodyMedium" style={styles.description}>
              {l10n.about.tourDescription}
            </Text>
            <Button
              mode="outlined"
              onPress={() => uiStore.replayOnboarding()}
              style={styles.actionButton}
              icon={ChevronRightButtonIcon}>
              {l10n.about.showIntroButton}
            </Button>
          </View>

          <View style={styles.legalRow}>
            <Text
              style={styles.legalLink}
              onPress={() =>
                Linking.openURL(
                  'https://github.com/tokenbleed/pocketmind/blob/main/PRIVACY.md',
                )
              }>
              {l10n.about.privacyPolicy}
            </Text>
            <Text style={styles.legalSeparator}>·</Text>
            <Text
              style={styles.legalLink}
              onPress={() =>
                Linking.openURL(
                  'https://github.com/tokenbleed/pocketmind/blob/main/TERMS.md',
                )
              }>
              {l10n.about.termsOfService}
            </Text>
          </View>
        </View>
      </ScrollView>

      <Sheet
        title={l10n.feedback.title}
        isVisible={showFeedback}
        displayFullHeight
        onClose={() => setShowFeedback(false)}>
        <Sheet.ScrollView contentContainerStyle={styles.feedbackForm}>
          <View style={styles.field}>
            <Text style={styles.label}>{l10n.feedback.useCase.label}</Text>
            <TextInput
              defaultValue={useCase}
              onChangeText={setUseCase}
              placeholder={l10n.feedback.useCase.placeholder}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.featureRequests.label}
            </Text>
            <TextInput
              defaultValue={featureRequests}
              onChangeText={setFeatureRequests}
              placeholder={l10n.feedback.featureRequests.placeholder}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.generalFeedback.label}
            </Text>
            <TextInput
              defaultValue={generalFeedback}
              onChangeText={setGeneralFeedback}
              placeholder={l10n.feedback.generalFeedback.placeholder}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.usageFrequency.label}
            </Text>
            <SegmentedButtons
              value={usageFrequency}
              onValueChange={setUsageFrequency}
              buttons={[
                {
                  value: 'daily',
                  label: l10n.feedback.usageFrequency.options.daily,
                },
                {
                  value: 'weekly',
                  label: l10n.feedback.usageFrequency.options.weekly,
                },
                {
                  value: 'monthly',
                  label: l10n.feedback.usageFrequency.options.monthly,
                },
                {
                  value: 'rarely',
                  label: l10n.feedback.usageFrequency.options.rarely,
                },
              ]}
              style={styles.segmentedButtons}
            />
          </View>
        </Sheet.ScrollView>
        <Sheet.Actions>
          <View style={styles.secondaryButtons}>
            <Button mode="text" onPress={() => setShowFeedback(false)}>
              {l10n.common.cancel}
            </Button>
          </View>
          <Button mode="contained" onPress={handleSubmit}>
            {l10n.feedback.submit}
          </Button>
        </Sheet.Actions>
      </Sheet>
    </SafeAreaView>
  );
};
