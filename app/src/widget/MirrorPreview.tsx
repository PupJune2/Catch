// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Vorschau des Widgets mit normalen React-Native-Views (Web/iOS – dort gibt es keinen nativen
 * Widget-Renderer). Übersetzt FlexWidget/TextWidget/SvgWidget in View/Text/SvgXml und bildet
 * dabei das Verhalten von Androids LinearLayout nach (Kinder nicht gestreckt, `flex` = Gewicht).
 * Auf Android zeigt PreviewSurface.android.tsx stattdessen das echte, nativ gerenderte Bild.
 */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import { SvgXml } from 'react-native-svg';

type AnyProps = Record<string, unknown> & { children?: ReactNode; style?: Record<string, unknown> };
type WidgetComponent = ((props: AnyProps) => ReactNode) & { __name__?: string };

const BOX_KEYS = [
  'margin',
  'marginHorizontal',
  'marginVertical',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'padding',
  'paddingHorizontal',
  'paddingVertical',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'borderWidth',
  'borderTopWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderColor',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderStyle',
  'backgroundColor',
] as const;

/** Größe/Gewicht wie im LinearLayout des Elternteils. */
function sizeStyle(s: Record<string, unknown>, parentRow: boolean | null): ViewStyle {
  const out: Record<string, unknown> = {};
  for (const k of BOX_KEYS) if (s[k] !== undefined) out[k] = s[k];
  const along = parentRow ? 'width' : 'height';
  for (const dim of ['width', 'height'] as const) {
    const v = s[dim];
    if (typeof v === 'number') out[dim] = v;
    else if (v === 'match_parent') {
      if (parentRow === null) out[dim] = '100%';
      else if (dim === along) out.flexGrow = 1;
      else out.alignSelf = 'stretch';
    }
  }
  if (typeof s.flex === 'number' && s.flex > 0) {
    out.flexGrow = s.flex;
    out.flexShrink = 1;
    out.minWidth = 0;
    out.minHeight = 0;
  } else {
    out.flexShrink = 0;
  }
  return out as ViewStyle;
}

function expand(node: ReactNode): ReactElement<AnyProps> | null {
  let el: ReactNode = node;
  // Eigene Bausteine (z. B. LineBadge) sind reine Funktionen → ausführen, bis ein Widget-Element kommt
  while (isValidElement(el) && typeof el.type === 'function' && !(el.type as WidgetComponent).__name__) {
    el = (el.type as WidgetComponent)(el.props as AnyProps);
  }
  return isValidElement(el) ? (el as ReactElement<AnyProps>) : null;
}

function renderNode(node: ReactNode, parentRow: boolean | null, key: string): ReactNode {
  const el = expand(node);
  if (!el) return null;
  const props = el.props;
  const s = props.style ?? {};

  if (el.type === FlexWidget) {
    const row = s.flexDirection === 'row';
    const style: ViewStyle = {
      ...sizeStyle(s, parentRow),
      flexDirection: row ? 'row' : 'column',
      alignItems: (s.alignItems as ViewStyle['alignItems']) ?? 'flex-start',
      justifyContent: (s.justifyContent as ViewStyle['justifyContent']) ?? 'flex-start',
      ...(typeof s.flexGap === 'number' ? { gap: s.flexGap } : null),
      ...(s.overflow === 'hidden' ? { overflow: 'hidden' } : null),
    };
    const kids: ReactNode[] = [];
    Children.toArray(props.children).forEach((c, i) => kids.push(renderNode(c, row, `${key}.${i}`)));
    return (
      <View key={key} style={style}>
        {kids}
      </View>
    );
  }

  if (el.type === TextWidget) {
    const style: TextStyle = {
      ...(sizeStyle(s, parentRow) as TextStyle),
      color: (s.color as string) ?? '#FFFFFF',
      fontSize: (s.fontSize as number) ?? 12,
      ...(s.fontFamily ? { fontFamily: s.fontFamily as string } : { fontWeight: s.fontWeight as TextStyle['fontWeight'] }),
      ...(s.textAlign ? { textAlign: s.textAlign as TextStyle['textAlign'] } : null),
      ...(typeof s.letterSpacing === 'number' ? { letterSpacing: s.letterSpacing } : null),
      ...(typeof s.lineHeight === 'number' ? { lineHeight: s.lineHeight } : null),
    };
    const truncate = props.truncate as 'START' | 'MIDDLE' | 'END' | undefined;
    return (
      <Text
        key={key}
        allowFontScaling={false}
        numberOfLines={(props.maxLines as number | undefined) ?? 0}
        ellipsizeMode={truncate === 'START' ? 'head' : truncate === 'MIDDLE' ? 'middle' : 'tail'}
        style={style}>
        {String(props.text ?? '')}
      </Text>
    );
  }

  if (el.type === SvgWidget) {
    const style = sizeStyle(s, parentRow);
    const xml = typeof props.svg === 'string' ? props.svg : null;
    return xml ? (
      <View key={key} style={style}>
        <SvgXml xml={xml} width="100%" height="100%" />
      </View>
    ) : null;
  }

  return null;
}

/** Zeichnet das Widget-JSX in einer Box der angegebenen Größe (dp). */
export function MirrorPreview({ element, width, height }: { element: ReactNode; width: number; height: number }) {
  return (
    <View style={{ width, height }} accessibilityRole="image">
      {renderNode(element, null, 'w')}
    </View>
  );
}
