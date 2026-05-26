import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('dashboard styles match nested react-resizable handles', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(css, /\.react-grid-item \.react-resizable-handle/)
  assert.doesNotMatch(css, /\.react-grid-item:hover > \.react-resizable-handle/)
  assert.doesNotMatch(css, /\.react-grid-item > \.react-resizable-handle/)
})
