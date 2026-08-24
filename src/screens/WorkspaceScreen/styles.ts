import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    card: {
      margin: 8,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
    },
    emptyBox: {
      alignItems: 'center',
      paddingVertical: 32,
      gap: 8,
    },
    description: {
      color: theme.colors.onSurfaceVariant,
    },
    fileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
      gap: 4,
    },
    fileInfo: {
      flex: 1,
      minWidth: 0,
    },
    refresh: {
      alignSelf: 'flex-start',
      marginTop: 8,
    },
  });
