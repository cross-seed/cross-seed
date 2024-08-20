import { describe, expect, it } from 'vitest'

import { EP_REGEX } from '../src/constants'

describe('EP_REGEX', () => {
  it('matches episode titles', () => {
    const validTitles = [
      'My.Show.S01E01',
      // TODO: Add more valid titles
    ]

    validTitles.forEach(title => {
      expect(title).toMatch(EP_REGEX)
    })
  })

  it('does not match non-episode titles', () => {
    const invalidTitles = [
      'My.Show.S01',
      // TODO: Add more invalid titles
    ]

    invalidTitles.forEach(title => {
      expect(title).not.toMatch(EP_REGEX)
    })
  })
})
