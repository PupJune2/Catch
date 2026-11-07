// Catch – Copyright (C) 2026 PupJune2 (https://junify.live)
// SPDX-License-Identifier: AGPL-3.0-only
// GNU AGPL-3.0 with additional terms (attribution required) – see LICENSE and NOTICE.md
/**
 * Das Homescreen-Widget "CatchDepartures" (Android, react-native-android-widget).
 *
 * Reine Funktionen ohne Hooks: Die Bibliothek wandelt das JSX in native RemoteViews um
 * (FlexWidget = LinearLayout, TextWidget = TextView, SvgWidget = Bild). Dieselbe Darstellung
 * zeigt die App als Vorschau (Android: natives WidgetPreview, sonst MirrorPreview).
 *
 * Inhalt: Haltestelle + Stand, optional die Hinweis-Lage einer Linie, dann die nächsten
 * Abfahrten (Zeit, Linie in Linienfarbe, Hinweis-Punkt in Farbe der Art, Ziel, Gleis/Steig, Verspätung).
 */
import type { ReactNode } from 'react';
import { FlexWidget, SvgWidget, TextWidget, type ColorProp } from 'react-native-android-widget';

import type { ActivityLevel } from '@/api/contract';
import { translate, type Lang } from '@/i18n';
import { KIND_COLOR } from '@/lib/kinds';
import { colors, fonts, levelStyle, modeColor } from '@/theme';
import type { WidgetLine } from './config';
import { upcoming, type WidgetDeparture, type WidgetLineStatus, type WidgetSnapshot } from './data';
import { clock, isTrackChanged, lineStatusText, shortName, trackText } from './labels';

export const WIDGET_NAME = 'CatchDepartures';

export type WidgetView =
  /** noch keine Haltestelle gewählt */
  | { kind: 'empty' }
  /** Daten (frisch oder – stale – der letzte Stand, weil gerade kein Netz da ist) */
  | { kind: 'data'; snapshot: WidgetSnapshot; stale: boolean; refreshing?: boolean }
  /** kein Netz und kein gespeicherter Stand */
  | { kind: 'error'; stopName?: string };

export interface DeparturesWidgetProps {
  view: WidgetView;
  lang: Lang;
  /** Größe in dp (aus WidgetInfo) */
  width: number;
  height: number;
  now: number;
  /** Deep-Link beim Tippen aufs Widget; ohne → App öffnen */
  openUri?: string;
}

const PAD_H = 14;
const PAD_V = 11;
const HEADER_H = 20;
const STATUS_H = 24;
const ROW_H = 21;
const ROW_GAP = 3;

const C = {
  bg: colors.bg as ColorProp,
  deep: colors.surfaceDeep as ColorProp,
  text: '#FFFFFF' as ColorProp,
  muted: colors.textMuted as ColorProp,
  faint: colors.textFaint as ColorProp,
  orange: colors.orange as ColorProp,
  lime: colors.lime as ColorProp,
};

const REFRESH_SVG = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;

const GHOST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 110"><path fill="#FFF4EE" d="M18 98 C10 94 7 86 7 76 L7 44 C7 20 26 4 50 4 C74 4 91 20 91 44 L91 70 C91 78 94 85 99 92 L95 101 C86 96 75 94 63 96 C49 98 35 102 18 98 Z"/><path fill="#2F2C33" d="M19 84 L17 46 C17 26 31 14 50 14 C69 14 81 27 81 46 L81 72 C81 76 82 79 84 82 C74 78 63 78 52 82 C41 86 30 89 19 84 Z"/><rect x="27" y="41" width="13" height="6.5" rx="3.25" fill="#FFF4EE"/><path fill="#FFF4EE" d="M58 30 C59.6 38.5 61.5 40.4 70 42 C61.5 43.6 59.6 45.5 58 54 C56.4 45.5 54.5 43.6 46 42 C54.5 40.4 56.4 38.5 58 30 Z"/></svg>`;

function hex(c?: string): string | undefined {
  if (!c) return undefined;
  const v = c.startsWith('#') ? c : `#${c}`;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined;
}

function isLight(h: string): boolean {
  const n = parseInt(h.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170;
}

function badgeColors(line: WidgetLine): { bg: ColorProp; fg: ColorProp } {
  const bg = hex(line.color) ?? modeColor[line.mode] ?? modeColor.OTHER;
  const fg = hex(line.textColor) ?? (isLight(bg) ? colors.textOnLight : '#FFFFFF');
  return { bg: bg as ColorProp, fg: fg as ColorProp };
}

/** Wie viele Abfahrten passen in die Höhe? */
export function rowsFor(height: number, withStatus: boolean): number {
  const avail = height - 2 * PAD_V - HEADER_H - (withStatus ? STATUS_H + ROW_GAP : 0);
  return Math.max(1, Math.min(6, Math.floor(avail / (ROW_H + ROW_GAP))));
}

function LineBadge({ line }: { line: WidgetLine }) {
  const { bg, fg } = badgeColors(line);
  return (
    <FlexWidget
      style={{
        height: 18,
        paddingHorizontal: 6,
        borderRadius: 6,
        backgroundColor: bg,
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      <TextWidget
        text={line.name}
        maxLines={1}
        allowFontScaling={false}
        style={{ fontSize: 11, fontFamily: fonts.extrabold, fontWeight: '800', color: fg }}
      />
    </FlexWidget>
  );
}

/**
 * Nimmt den restlichen Platz der Zeile ein (TextWidget selbst kennt kein `flex`): LinearLayout mit
 * Gewicht 1, der Text darin füllt die Breite und wird mit "…" gekürzt.
 */
function Grow({ children, marginLeft }: { children: ReactNode; marginLeft?: number }) {
  return <FlexWidget style={{ flex: 1, marginLeft, justifyContent: 'center' }}>{children}</FlexWidget>;
}

function Dot({ color, size = 7 }: { color: ColorProp; size?: number }) {
  return <FlexWidget style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

function Header({ title, right, rightColor, showRefresh }: { title: string; right: string; rightColor: ColorProp; showRefresh: boolean }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: HEADER_H }}>
      <SvgWidget svg={GHOST_SVG} style={{ width: 15, height: 16, marginRight: 7 }} />
      <Grow>
        <TextWidget
          text={title}
          maxLines={1}
          truncate="END"
          allowFontScaling={false}
          style={{ width: 'match_parent', fontSize: 14, fontFamily: fonts.bold, fontWeight: '700', color: C.text }}
        />
      </Grow>
      {right ? (
        <TextWidget
          text={right}
          maxLines={1}
          allowFontScaling={false}
          style={{ fontSize: 10.5, fontFamily: fonts.medium, fontWeight: '500', color: rightColor, marginLeft: 6 }}
        />
      ) : null}
      {showRefresh ? (
        <FlexWidget
          clickAction="REFRESH"
          style={{ paddingLeft: 8, paddingVertical: 2, height: HEADER_H, justifyContent: 'center', alignItems: 'center' }}>
          <SvgWidget svg={REFRESH_SVG(colors.textMuted)} style={{ width: 14, height: 14 }} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );
}

function statusColor(level: ActivityLevel): ColorProp {
  return levelStyle[level].color as ColorProp;
}

function LineStatusRow({ status, lang, now }: { status: WidgetLineStatus; lang: Lang; now: number }) {
  const color = statusColor(status.level);
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: `catch://line/${encodeURIComponent(status.line.key)}` }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        width: 'match_parent',
        height: STATUS_H,
        marginTop: ROW_GAP,
        paddingHorizontal: 6,
        borderRadius: 10,
        backgroundColor: C.deep,
      }}>
      <LineBadge line={status.line} />
      <FlexWidget style={{ width: 7 }} />
      <Dot color={status.level === 'active' && status.lastKind ? (KIND_COLOR[status.lastKind] as ColorProp) : color} size={8} />
      <Grow marginLeft={6}>
        <TextWidget
          text={lineStatusText(lang, status, now)}
          maxLines={1}
          truncate="END"
          allowFontScaling={false}
          style={{ width: 'match_parent', fontSize: 11.5, fontFamily: fonts.semibold, fontWeight: '600', color }}
        />
      </Grow>
    </FlexWidget>
  );
}

function DepartureRowW({ d, lang }: { d: WidgetDeparture; lang: Lang }) {
  const delay = d.delayMin ?? 0;
  const changed = isTrackChanged(d);
  const track = trackText(lang, d.line.mode, d.track || d.plannedTrack);
  const right = d.cancelled ? translate(lang, 'dep.cancelled') : track;
  const rightColor = d.cancelled || changed ? C.orange : C.muted;
  const delayText = d.cancelled ? '' : delay > 0 ? `+${delay}` : d.realtime ? '+0' : '';
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', height: ROW_H, marginTop: ROW_GAP }}>
      <TextWidget
        text={clock(lang, d.plannedTime)}
        maxLines={1}
        allowFontScaling={false}
        style={{ width: 40, fontSize: 13, fontFamily: fonts.bold, fontWeight: '700', color: d.cancelled ? C.faint : C.text }}
      />
      <LineBadge line={d.line} />
      {d.activeKind ? (
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
          <FlexWidget style={{ width: 5 }} />
          <Dot color={KIND_COLOR[d.activeKind] as ColorProp} />
        </FlexWidget>
      ) : null}
      <Grow marginLeft={7}>
        <TextWidget
          text={shortName(d.headsign)}
          maxLines={1}
          truncate="END"
          allowFontScaling={false}
          style={{
            width: 'match_parent',
            fontSize: 12.5,
            fontFamily: fonts.medium,
            fontWeight: '500',
            color: d.cancelled ? C.muted : C.text,
          }}
        />
      </Grow>
      {right ? (
        <TextWidget
          text={right}
          maxLines={1}
          allowFontScaling={false}
          style={{ marginLeft: 6, fontSize: 10.5, fontFamily: fonts.semibold, fontWeight: '600', color: rightColor }}
        />
      ) : null}
      <TextWidget
        text={delayText}
        maxLines={1}
        allowFontScaling={false}
        style={{
          width: 26,
          textAlign: 'right',
          fontSize: 11.5,
          fontFamily: fonts.bold,
          fontWeight: '700',
          color: delay > 0 ? C.orange : C.lime,
        }}
      />
    </FlexWidget>
  );
}

function Message({ title, hint }: { title: string; hint?: string }) {
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', justifyContent: 'center', alignItems: 'center' }}>
      <TextWidget
        text={title}
        maxLines={2}
        allowFontScaling={false}
        style={{ fontSize: 13, fontFamily: fonts.semibold, fontWeight: '600', color: C.text, textAlign: 'center' }}
      />
      {hint ? (
        <TextWidget
          text={hint}
          maxLines={2}
          allowFontScaling={false}
          style={{ marginTop: 3, fontSize: 11, fontFamily: fonts.medium, fontWeight: '500', color: C.muted, textAlign: 'center' }}
        />
      ) : null}
    </FlexWidget>
  );
}

export function DeparturesWidget({ view, lang, width, height, now, openUri }: DeparturesWidgetProps) {
  const tr = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate(lang, key, params);
  const root = {
    width: 'match_parent' as const,
    height: 'match_parent' as const,
    backgroundColor: C.bg,
    borderRadius: 22,
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
  };
  const click = openUri ? { clickAction: 'OPEN_URI', clickActionData: { uri: openUri } } : { clickAction: 'OPEN_APP' };

  if (view.kind === 'empty') {
    return (
      <FlexWidget {...click} accessibilityLabel={tr('widget.w.empty')} style={root}>
        <Header title="Catch" right="" rightColor={C.muted} showRefresh={false} />
        <Message title={tr('widget.w.empty')} hint={tr('widget.w.emptyHint')} />
      </FlexWidget>
    );
  }

  if (view.kind === 'error') {
    return (
      <FlexWidget {...click} accessibilityLabel={tr('widget.w.noConnection')} style={root}>
        <Header title={view.stopName ? shortName(view.stopName) : 'Catch'} right="" rightColor={C.muted} showRefresh />
        <Message title={tr('widget.w.noConnection')} />
      </FlexWidget>
    );
  }

  const { snapshot, stale, refreshing } = view;
  const status = snapshot.lineStatus;
  const rows = upcoming(snapshot.departures, now).slice(0, rowsFor(height, !!status));
  const time = clock(lang, snapshot.fetchedAt);
  const right = refreshing ? tr('widget.w.updating') : stale ? tr('widget.w.offlineAt', { time }) : time;
  // Breite egal: Zeilen kürzen das Ziel; `width` nur für künftige Varianten (z. B. schmale 2×2)
  void width;

  return (
    <FlexWidget {...click} accessibilityLabel={shortName(snapshot.stopName)} style={root}>
      <Header title={shortName(snapshot.stopName)} right={right} rightColor={stale ? C.orange : C.muted} showRefresh />
      {status ? <LineStatusRow status={status} lang={lang} now={now} /> : null}
      {rows.length ? (
        rows.map((d) => <DepartureRowW key={`${d.tripId}-${d.plannedTime}`} d={d} lang={lang} />)
      ) : stale ? (
        <Message title={tr('widget.w.noConnection')} />
      ) : (
        <Message title={tr('widget.w.noDepartures')} />
      )}
    </FlexWidget>
  );
}
