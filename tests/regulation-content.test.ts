import assert from 'node:assert/strict';
import test from 'node:test';
import { regulationChapters } from '../src/content/regulation';

test('regulation clauses remain sequential across every content block', () => {
  regulationChapters.forEach((chapter, chapterIndex) => {
    chapter.blocks.forEach((block, blockIndex) => {
      assert.equal(block.number, `${chapterIndex + 1}.${blockIndex + 1}.`);
    });
  });
});

test('chapter one keeps the published schedule and award numbering', () => {
  const chapter = regulationChapters[0];
  const schedule = chapter.blocks[3];
  const award = chapter.blocks[4];

  assert.equal(schedule.kind, 'schedule');
  assert.equal(schedule.number, '1.4.');
  assert.deepEqual(schedule.items, [
    '05h:00m - Concentração dos atletas.',
    '05h:30m - Abertura do evento.',
    '06h:00m - Largada geral 5km e 10km.',
    '08h:00m - Aniversário FUNPACE (AFTER com DJ).',
  ]);
  assert.equal(award.kind, 'clause');
  assert.equal(award.number, '1.5.');
  assert.equal(award.text, 'Premiação entre 08h e 09h.');
});
