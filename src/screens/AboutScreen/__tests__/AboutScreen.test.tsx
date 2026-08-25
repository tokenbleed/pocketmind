import React from 'react';
import {Alert, Linking} from 'react-native';
import {
  render as baseRender,
  fireEvent,
  act,
} from '../../../../jest/test-utils';
import {AboutScreen} from '../AboutScreen';
import {l10n} from '../../../locales';

const render = (ui: React.ReactElement, options: any = {}) =>
  baseRender(ui, {withBottomSheetProvider: true, ...options});

// Mock DeviceInfo
jest.mock('react-native-device-info', () => ({
  getVersion: jest.fn().mockReturnValue('1.0.0'),
  getBuildNumber: jest.fn().mockReturnValue('100'),
}));

// Mock Clipboard
jest.mock('@react-native-clipboard/clipboard', () => ({
  setString: jest.fn(),
}));

// Mock Linking - need to spy on the actual Linking object
const mockOpenURL = jest.fn().mockImplementation(() => Promise.resolve());
jest.spyOn(Linking, 'openURL').mockImplementation(mockOpenURL);

jest.spyOn(Alert, 'alert');

describe('AboutScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly', () => {
    const {getByText} = render(<AboutScreen />);

    expect(getByText('PocketMind')).toBeTruthy();
    expect(getByText('v1.0.0 (100)')).toBeTruthy();
    expect(getByText(l10n.en.about.supportProject)).toBeTruthy();
    expect(getByText(l10n.en.about.githubButton)).toBeTruthy();
  });

  it('copies version to clipboard when version button is pressed', () => {
    const {getByText} = render(<AboutScreen />);

    fireEvent.press(getByText('v1.0.0 (100)'));

    expect(Alert.alert).toHaveBeenCalledWith(
      l10n.en.about.versionCopiedTitle,
      l10n.en.about.versionCopiedDescription,
    );
  });

  it('opens GitHub URL when GitHub button is pressed', () => {
    const {getByText} = render(<AboutScreen />);

    fireEvent.press(getByText('Star on GitHub'));

    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://github.com/tokenbleed/pocketmind',
    );
  });

  it('opens feedback form when share thoughts button is pressed', async () => {
    const {getByText, findByText} = render(<AboutScreen />);

    fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    expect(await findByText(l10n.en.feedback.useCase.label)).toBeTruthy();
    expect(
      await findByText(l10n.en.feedback.featureRequests.label),
    ).toBeTruthy();
    expect(
      await findByText(l10n.en.feedback.generalFeedback.label),
    ).toBeTruthy();
    expect(
      await findByText(l10n.en.feedback.usageFrequency.label),
    ).toBeTruthy();
  });

  it('submits feedback successfully', async () => {
    const {findByText, getByText, findByPlaceholderText} = render(
      <AboutScreen />,
    );

    // Open feedback form
    fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    const useCaseInput = await findByPlaceholderText(
      l10n.en.feedback.useCase.placeholder,
    );
    fireEvent.changeText(useCaseInput, 'Test use case');

    const featureRequestsInput = await findByPlaceholderText(
      l10n.en.feedback.featureRequests.placeholder,
    );
    fireEvent.changeText(featureRequestsInput, 'Test feature request');

    const generalFeedbackInput = await findByPlaceholderText(
      l10n.en.feedback.generalFeedback.placeholder,
    );
    fireEvent.changeText(generalFeedbackInput, 'Test feedback');

    const dailyButton = await findByText(
      l10n.en.feedback.usageFrequency.options.daily,
    );
    fireEvent.press(dailyButton);

    // Submit form
    const submitButton = await findByText(l10n.en.feedback.submit);
    await act(async () => {
      fireEvent.press(submitButton);
    });

    expect(Linking.openURL).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://github.com/tokenbleed/pocketmind/issues/new',
      ),
    );
    const calledUrl = mockOpenURL.mock.calls[0][0] as string;
    expect(decodeURIComponent(calledUrl)).toContain('Test use case');
    expect(decodeURIComponent(calledUrl)).toContain('Test feature request');
    expect(decodeURIComponent(calledUrl)).toContain('Test feedback');
    expect(decodeURIComponent(calledUrl)).toContain('daily');
  });

  it('shows validation error when submitting empty feedback', async () => {
    const {getByText, findByText} = render(<AboutScreen />);

    // Open feedback form
    fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    // Submit empty form
    const submitButton = await findByText(l10n.en.feedback.submit);
    await act(async () => {
      fireEvent.press(submitButton);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      l10n.en.feedback.validation.required,
    );
    expect(Linking.openURL).not.toHaveBeenCalledWith(
      expect.stringContaining('/issues/new'),
    );
  });

  it('handles feedback submission error', async () => {
    mockOpenURL.mockRejectedValueOnce(new Error('API Error'));

    const {getByText, findByText, findByPlaceholderText} = render(
      <AboutScreen />,
    );

    // Open feedback form
    fireEvent.press(getByText(l10n.en.feedback.shareThoughtsButton));

    // Fill out form
    fireEvent.changeText(
      await findByPlaceholderText(l10n.en.feedback.useCase.placeholder),
      'Test use case',
    );

    // Submit form
    const submitButton = await findByText(l10n.en.feedback.submit);
    await act(async () => {
      fireEvent.press(submitButton);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'Error sending feedback. Please try again.',
    );
  });
});
