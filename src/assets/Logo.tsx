import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';

export type LogoSize = 'tiny' | 'small' | 'medium' | 'large' | 'xlarge';

const SIZE_MAP: Record<LogoSize, number> = {
  tiny: 24,
  small: 32,
  medium: 44,
  large: 60,
  xlarge: 88,
};

const FONT_MAP: Record<LogoSize, number> = {
  tiny: 13,
  small: 15,
  medium: 17,
  large: 20,
  xlarge: 24,
};

interface MarkProps {
  size?: LogoSize;
  backgroundColor?: string;
  foregroundColor?: string;
  style?: ViewStyle;
}

export function LogoMark({
  size = 'medium',
  backgroundColor,
  foregroundColor,
  style,
}: MarkProps): React.JSX.Element {
  const d = SIZE_MAP[size];
  const bar = Math.max(3, Math.round(d * 0.09));
  const cross = d * 0.52;
  const s = StyleSheet.create({
    box: {
      width: d,
      height: d,
      borderRadius: d * 0.28,
      backgroundColor: backgroundColor ?? '#2A9D8F',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#0E3A47',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.18,
      shadowRadius: 5,
      elevation: 3,
    },
    cross: { width: cross, height: cross },
    v: {
      position: 'absolute',
      left: (cross - bar) / 2,
      top: 0,
      width: bar,
      height: cross,
      borderRadius: bar / 2,
      backgroundColor: foregroundColor ?? '#FFFFFF',
    },
    h: {
      position: 'absolute',
      top: (cross - bar) / 2,
      left: 0,
      height: bar,
      width: cross,
      borderRadius: bar / 2,
      backgroundColor: foregroundColor ?? '#FFFFFF',
    },
    pill: {
      position: 'absolute',
      right: d * 0.1,
      bottom: d * 0.12,
      width: d * 0.3,
      height: d * 0.17,
      borderRadius: d * 0.09,
      backgroundColor: 'rgba(255,255,255,0.35)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.65)',
    },
  });
  return (
    <View style={[s.box, style]}>
      <View style={s.cross}>
        <View style={s.v} />
        <View style={s.h} />
      </View>
      <View style={s.pill} />
    </View>
  );
}

interface LogoProps extends MarkProps {
  titleColor?: string;
  subtitleColor?: string;
  compact?: boolean;
}

export function Logo({
  size = 'medium',
  backgroundColor,
  foregroundColor,
  titleColor,
  subtitleColor,
  compact = false,
  style,
}: LogoProps): React.JSX.Element {
  const fs = FONT_MAP[size];
  const s = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    title: {
      fontSize: fs,
      fontWeight: '800',
      color: titleColor ?? '#14424C',
      letterSpacing: 0.2,
    },
    sub: {
      fontSize: Math.max(9, Math.round(fs * 0.52)),
      fontWeight: '600',
      color: subtitleColor ?? '#6B8F94',
      letterSpacing: 1.4,
      marginTop: compact ? 0 : 1,
    },
  });
  return (
    <View style={[s.row, style]}>
      <LogoMark size={size} backgroundColor={backgroundColor} foregroundColor={foregroundColor} />
      <View>
        <Text style={s.title}>MediRecord</Text>
        {!compact ? <Text style={s.sub}>MIS MEDICINAS</Text> : null}
      </View>
    </View>
  );
}

export function LogoIcon(props: MarkProps): React.JSX.Element {
  return <LogoMark {...props} />;
}

export function LogoSplash(props: Omit<LogoProps, 'compact'>): React.JSX.Element {
  return <Logo {...props} />;
}
