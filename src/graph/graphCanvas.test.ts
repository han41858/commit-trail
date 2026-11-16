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
          months: [],
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
