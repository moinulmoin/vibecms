import { describe, it } from 'node:test'
import { strict as assert } from 'node:assert'
import { firstParagraph } from './first-paragraph.ts'

describe('firstParagraph', () => {
  it('ignores blank lines inside long backtick and tilde fences', () => {
    assert.equal(firstParagraph('````js\ncode\n\nmore code\n```\nstill code\n````\n\n~~~\nother code\n~~~\n\nReal prose.'), 'Real prose.')
  })

  it('keeps readable inline text and decodes entities', () => {
    assert.equal(firstParagraph('Read [the guide](https://example.com), ![diagram](image.png), `code`, <https://example.com>, **bold** &amp; &#39;escaped\\* text.'), "Read the guide, diagram, code, https://example.com, bold & 'escaped* text.")
  })

  it('skips headings, lists, quotes, tables, directives, images, HTML and indented code', () => {
    const markdown = '# Title\n\n- bullet\n1. numbered\n> quote\n| cell |\n::: note\n![alt](image.png)\n<div>HTML</div>\n    code\n\nActual paragraph\ncontinues here.'
    assert.equal(firstParagraph(markdown), 'Actual paragraph continues here.')
  })

  it('truncates at a word boundary including the ellipsis in the limit', () => {
    assert.equal(firstParagraph('Alpha beta gamma delta', 12), 'Alpha beta…')
    assert.equal(firstParagraph('Supercalifragilistic', 8), 'Superca…')
  })
})
