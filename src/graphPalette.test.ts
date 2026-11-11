import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GRAPH_COLOR_COUNT } from './graphPalette';

const stylesheet = readFileSync(
  new URL('./style.css', import.meta.url),
  'utf8',
);
const themes = [
  { name: 'dark', selector: '.app', badgeTint: 0.08 },
  { name: 'light', selector: ".app[data-theme='light']", badgeTint: 0.06 },
];

const themeTokens = (selector: string) => {
  const start = stylesheet.indexOf(`${selector} {`);
  assert.ok(start >= 0, `Missing ${selector} theme`);
  const block = stylesheet.slice(start, stylesheet.indexOf('}', start));
  return new Map(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
};

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => {
  assert.match(hex, /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);
  const full =
    hex.length === 4 ? hex.slice(1).replace(/./g, '$&$&') : hex.slice(1);
  return [0, 2, 4].map(
    (offset) => parseInt(full.slice(offset, offset + 2), 16) / 255,
  ) as Rgb;
};

const blend = (foreground: Rgb, background: Rgb, alpha: number): Rgb =>
  foreground.map(
    (channel, index) => channel * alpha + background[index] * (1 - alpha),
  ) as Rgb;

const luminance = (color: Rgb) => {
  const linear = color.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};

const contrast = (foreground: Rgb, background: Rgb) => {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
};

test('both CSS themes provide the complete shared graph palette without duplicate colors', () => {
  for (const theme of themes) {
    const tokens = themeTokens(theme.selector);
    const palette = [...tokens].filter(([name]) => /^graph-\d+$/.test(name));
    assert.deepEqual(
      palette.map(([name]) => name),
      Array.from({ length: GRAPH_COLOR_COUNT }, (_, index) => `graph-${index}`),
      `${theme.name} palette indices must match the renderer and color allocator`,
    );
    assert.equal(
      new Set(palette.map(([, color]) => color)).size,
      GRAPH_COLOR_COUNT,
    );
    for (const [, color] of palette) rgb(color);
  }
});

test('added graph colors retain readable text contrast on the app and tinted branch badges', () => {
  for (const theme of themes) {
    const tokens = themeTokens(theme.selector);
    const background = rgb(tokens.get('bg')!);
    const surface = rgb(tokens.get('surface')!);
    for (const index of [6, 7]) {
      const color = rgb(tokens.get(`graph-${index}`)!);
      // Canvas badges paint the surface at 35%, then the branch color at 6% or 8%.
      const badge = blend(
        color,
        blend(surface, background, 0.35),
        theme.badgeTint,
      );
      for (const [name, target] of [
        ['app', background],
        ['badge', badge],
      ] as const) {
        const ratio = contrast(color, target);
        assert.ok(
          ratio >= 4.5,
          `${theme.name} graph-${index} on ${name} has ${ratio.toFixed(2)}:1 contrast`,
        );
      }
    }
  }
});
