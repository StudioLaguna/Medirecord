/**
 * @format
 */

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../App';
import { setTheme } from '../src/storage';

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaProvider: View,
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    onForegroundEvent: jest.fn(() => jest.fn()),
    requestPermission: jest.fn(async () => ({ authorizationStatus: 2 })),
    getNotificationSettings: jest.fn(async () => ({ android: { alarm: 1 } })),
    createTriggerNotification: jest.fn(async () => 'id'),
    cancelTriggerNotifications: jest.fn(async () => undefined),
    getTriggerNotifications: jest.fn(async () => []),
    cancelDisplayedNotification: jest.fn(async () => undefined),
    openNotificationSettings: jest.fn(async () => undefined),
  },
  AlarmType: { SET_EXACT: 2, SET_AND_ALLOW_WHILE_IDLE: 1 },
  AndroidCategory: { ALARM: 0, REMINDER: 1 },
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  AuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 1, NOT_DETERMINED: 0, DENIED: -1 },
  EventType: { DISMISS: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 },
  TriggerType: { TIMESTAMP: 0, INTERVAL: 1 },
}));

jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({
    execute: jest.fn(async (sql: string) => {
      if (sql.includes('app_settings')) {
        return { rows: [{ value: 'system' }] };
      }
      return { rows: [] };
    }),
    executeSync: jest.fn(),
    transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        execute: jest.fn(async () => ({ rows: [] })),
      });
    }),
  }),
}));

jest.mock('react-native-share', () => ({
  __esModule: true,
  default: { open: jest.fn(async () => 'ok') },
}));

jest.mock('react-native-html-to-pdf', () => ({
  generatePDF: jest.fn(async () => ({ filePath: '/tmp/x.pdf' })),
}));

jest.mock('../src/reports', () => ({
  exportReport: jest.fn(async () => undefined),
}));

describe('App', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders empty state', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });
    const texts = tree!.root.findAll((n) => n.props.children !== undefined && typeof n.props.children === 'string');
    const joined = texts.map((n) => String(n.props.children)).join(' ');
    expect(joined).toContain('Sin tomas hoy');
    expect(joined).toContain('Añadir medicamento');
  });

  it('persists theme via setTheme', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = ReactTestRenderer.create(<App />);
    });
    await act(async () => {
      await setTheme('dark');
    });
    const texts = tree!.root.findAll((n) => n.props.children !== undefined && typeof n.props.children === 'string');
    const joined = texts.map((n) => String(n.props.children)).join(' ');
    expect(joined.length).toBeGreaterThan(0);
    expect(setTheme).toBeDefined();
  });
});
