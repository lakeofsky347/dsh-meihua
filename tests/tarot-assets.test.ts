import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tarotAssets } from '../src/client/tarot-assets.ts';
import { TAROT_CARDS } from '../src/tarot/cards.ts';

test('all 78 historical Tarot assets are embedded offline and match their provenance hashes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/assets/tarot/assets-sources.json', import.meta.url), 'utf8'));
  const ids = [
    ...Array.from({ length: 22 }, (_, n) => `major-${String(n).padStart(2, '0')}`),
    ...['wands', 'cups', 'swords', 'pentacles'].flatMap(suit =>
      Array.from({ length: 14 }, (_, n) => `${suit}-${String(n + 1).padStart(2, '0')}`)),
  ];
  assert.deepEqual(Object.keys(tarotAssets).sort(), [...ids].sort());
  assert.deepEqual(TAROT_CARDS.map(card => card.id).sort(), [...ids].sort());
  assert.equal(manifest.cards.length, 78);
  assert.equal(new Set(manifest.cards.map((card: { id: string }) => card.id)).size, 78);
  assert.equal(new Set(manifest.cards.map((card: { asset: { sha256: string } }) => card.asset.sha256)).size, 78);
  for (const card of manifest.cards) {
    assert.equal(card.license.shortName, 'Public domain', card.id);
    assert.equal(card.source.author, 'Pamela Colman Smith', card.id);
    assert.equal(card.source.date, '1910', card.id);
    assert.match(card.source.description, /Pam-A/, card.id);
    assert.match(card.source.descriptionURL, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/, card.id);
    assert.equal(card.asset.width, 576, card.id);
    assert.equal(card.asset.height, 960, card.id);
    const uri = tarotAssets[card.id];
    assert.ok(uri, card.id);
    assert.ok(uri.startsWith('data:image/webp;base64,'), card.id);
    const embedded = Buffer.from(uri.slice('data:image/webp;base64,'.length), 'base64');
    const file = await readFile(new URL(`../src/assets/tarot/${card.id}.webp`, import.meta.url));
    assert.deepEqual(embedded, file, card.id);
    assert.equal(file.length, card.asset.bytes, card.id);
    assert.equal(file.toString('ascii', 0, 4), 'RIFF', card.id);
    assert.equal(file.toString('ascii', 8, 12), 'WEBP', card.id);
    assert.equal(createHash('sha256').update(file).digest('hex'), card.asset.sha256, card.id);
  }
});
