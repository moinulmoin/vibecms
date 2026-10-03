import { expect, it } from 'vitest'
import { firstParagraph as coreFirstParagraph } from '@vc/core'
import { firstParagraph } from './post-fields'

it('uses the published extractor for the editor preview', () => {
  const markdown = '```js\ncode\n\nmore code\n```\n\n1. List\n\nRead [the guide](https://example.com) and `code`.'
  expect(firstParagraph).toBe(coreFirstParagraph)
  expect(firstParagraph(markdown)).toBe('Read the guide and code.')
})
