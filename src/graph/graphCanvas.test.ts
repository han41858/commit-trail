import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { drawGraphCanvas } from './graphCanvas';
import { graphFrame } from './graphView';
import { graphColors } from './graphColors';

function renderer(t: TestContext) {
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () =>
    ({ getPropertyValue: () => '#fff' }) as unknown as CSSStyleDeclaration;
  t.after(() => {
    globalThis.getComputedStyle = original;
  });
  const clips: { x: number; width: number }[] = [];
  const context = new Proxy(
    {
      measureText: (text: string) => ({ width: [...text].length * 6 }),
      rect: (x: number, _y: number, width: number) => clips.push({ x, width }),
    },
    { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
  ) as unknown as CanvasRenderingContext2D;
  const name = 'feature/a-long-branch-name-next-to-commit-messages';
  return {
    clips,
    draw: (width: number, maxLane: number, top = 100) => {
      const frame = graphFrame(width, maxLane, width <= 800);
      const result = drawGraphCanvas(
        context,
        { scrollLeft: 0 } as HTMLElement,
        {
          ...frame,
          dpr: 1,
          view: { top, width, height: 600 },
          padding: 80,
          ordered: [],
          positions: new Map(),
          dates: [],
          edges: [],
          tones: graphColors([], [], 'main'),
          tracks: [
            {
              name,
              lane: maxLane,
              points: [
                { x: 48, y: 200 },
                { x: 48 + maxLane * frame.spacing, y: 1200 },
              ],
            },
          ],
          selected: '',
          theme: 'light',
          narrow: width <= 800,
          badgeHeight: 18,
          badgeGap: 2,
          displayNames: new Map([[name, name]]),
        },
        () => 1,
        false,
      );
      return { frame, badges: result.badges };
    },
  };
}

test('branch badge painting and hit areas stay out of the commit message column', (t) => {
  const render = renderer(t);
  for (const width of [96, 180, 390, 844, 1280]) {
    const maxLane = width < 180 ? 0 : width < 390 ? 1 : 2;
    const initial = render.draw(width, maxLane);
    assert(initial.frame.showMessages);
    assert.equal(initial.badges.length, 1);
    for (const top of [100, 104, 300, 600]) {
      const { frame, badges } = render.draw(width, maxLane, top);
      assert.equal(badges.length, 1);
      assert.equal(badges[0].text, initial.badges[0].text);
      assert.equal(badges[0].width, initial.badges[0].width);
      assert(badges[0].x + badges[0].width <= frame.messageX);
      const clip = render.clips.at(-1)!;
      assert(clip.x + clip.width <= frame.messageX);
    }
  }
});

test('badges can use the full graph column when commit messages are hidden', (t) => {
  const render = renderer(t);
  const { frame, badges } = render.draw(180, 20);
  assert.equal(frame.showMessages, false);
  assert.equal(badges.length, 1);
  assert(badges[0].x + badges[0].width > 90);
  assert(badges[0].x + badges[0].width <= 180);
});

function dateDrawing(t: TestContext, width: number, left = 0, maxLane = 0) {
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () =>
    ({ getPropertyValue: () => '#9aa9bd' }) as unknown as CSSStyleDeclaration;
  t.after(() => {
    globalThis.getComputedStyle = original;
  });
  const texts: {
    label: string;
    x: number;
    y: number;
    maxWidth: number;
    font: string;
    alpha: number;
    align: string;
  }[] = [];
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  const lines: { alpha: number; from: number; to: number }[] = [];
  const states: Record<string, unknown>[] = [];
  let from = 0,
    to = 0;
  const context = new Proxy(
    {
      measureText: (text: string) => ({ width: [...text].length * 9.5 }),
      fillText: (label: string, x: number, y: number, maxWidth: number) =>
        texts.push({
          label,
          x,
          y,
          maxWidth,
          font: context.font,
          alpha: context.globalAlpha,
          align: context.textAlign,
        }),
      fillRect: (x: number, y: number, width: number, height: number) =>
        boxes.push({ x, y, width, height }),
      moveTo: (x: number) => {
        from = x;
      },
      lineTo: (x: number) => {
        to = x;
      },
      stroke: () => lines.push({ alpha: context.globalAlpha, from, to }),
      save: () =>
        states.push({
          font: context.font,
          globalAlpha: context.globalAlpha,
          textAlign: context.textAlign,
          textBaseline: context.textBaseline,
        }),
      restore: () => Object.assign(context, states.pop()),
    },
    { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
  ) as unknown as CanvasRenderingContext2D;
  const dates = [
    {
      sha: 'month',
      kind: 'month' as const,
      label: new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(new Date(2026, 10, 3)),
    },
    { sha: 'fourth', kind: 'day' as const, label: '4' },
    { sha: 'fifth', kind: 'day' as const, label: '5' },
  ];
  const frame = graphFrame(width, maxLane, width <= 800);
  drawGraphCanvas(
    context,
    { scrollLeft: left } as HTMLElement,
    {
      ...frame,
      dpr: 1,
      view: { top: 100, width, height: 600 },
      padding: 80,
      ordered: [],
      positions: new Map(
        dates.map((date, index) => [date.sha, { x: 48, y: 200 + index * 31 }]),
      ),
      dates,
      edges: [],
      tones: graphColors([], [], 'main'),
      tracks: [],
      selected: '',
      theme: 'dark',
      narrow: true,
      badgeHeight: 18,
      badgeGap: 2,
      displayNames: new Map(),
    },
    () => 1,
    false,
  );
  return { dates, texts, boxes, lines, frame };
}

test('date separators keep monthly emphasis and distinct labels on adjacent 31px rows', (t) => {
  const { dates, texts, boxes, lines } = dateDrawing(t, 390);
  assert.deepEqual(
    texts.map((text) => text.label),
    dates.map((date) => date.label),
  );
  assert.equal(texts[0].font, '11px system-ui');
  assert.equal(texts[1].font, '10px system-ui');
  assert(texts[0].alpha > texts[1].alpha);
  assert(lines[0].alpha > lines[1].alpha);
  assert(lines.every((line) => line.from === 0 && line.to === 390));
  for (let index = 1; index < boxes.length; index++)
    assert(boxes[index - 1].y + boxes[index - 1].height <= boxes[index].y);
});

test('full Locale labels and their backgrounds fit narrow and fractional Split view columns', (t) => {
  for (const width of [390, 96, 24, 390 / 32]) {
    for (const left of [0, width / 4]) {
      const { dates, texts, boxes, lines } = dateDrawing(t, width, left);
      assert.equal(texts.length, dates.length);
      for (const [index, text] of texts.entries()) {
        assert.equal(text.label, dates[index].label);
        assert.equal(text.align, 'left');
        assert(text.maxWidth > 0);
        assert(text.x >= left && text.x + text.maxWidth <= left + width);
        assert(boxes[index].x >= left);
        assert(boxes[index].x + boxes[index].width <= left + width);
      }
      assert(
        lines.every((line) => line.from === left && line.to === left + width),
      );
    }
  }
});

test('left date labels and backgrounds stay outside commit messages while lines span the viewport', (t) => {
  for (const width of [96, 180, 390, 844, 1280]) {
    for (const left of [0, 37.5]) {
      for (const maxLane of [0, 20]) {
        const { dates, texts, boxes, lines, frame } = dateDrawing(
          t,
          width,
          left,
          maxLane,
        );
        assert.equal(texts.length, dates.length);
        for (const [index, text] of texts.entries()) {
          assert.equal(text.align, 'left');
          assert(text.x >= left && text.x - left <= 16);
          const right = text.x + text.maxWidth,
            backgroundRight = boxes[index].x + boxes[index].width;
          assert(right <= left + width && backgroundRight <= left + width);
          if (frame.showMessages) {
            assert(right < frame.messageX);
            assert(backgroundRight < frame.messageX);
          }
        }
        assert(
          lines.every((line) => line.from === left && line.to === left + width),
        );
      }
    }
  }
  const scrolled = dateDrawing(t, 390, 170);
  assert.equal(scrolled.texts.length, 0);
  assert.equal(scrolled.boxes.length, 0);
  assert.equal(scrolled.lines.length, scrolled.dates.length);
});
