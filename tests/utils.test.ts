import { describe, expect, it } from 'vitest'

import { Searchee, File } from "../src/searchee"
import { MediaType, humanReadableSize, getMediaType, sanitizeUrl } from '../src/utils'

describe('humanReadableSize', () => {
  it('returns a human-readable size', () => {
    expect(humanReadableSize(123)).toBe('123 B')
    expect(humanReadableSize(1234)).toBe('1.23 kB')
    expect(humanReadableSize(1000 * 1234)).toBe('1.23 MB')
  })

  it('truncates number when byte size is exact', () => {
    expect(humanReadableSize(1000)).toBe('1 kB')
  })
})

describe('getMediaType', () => {
  it('returns MediaType.EPISODE if the title matches EP_REGEX', () => {
    expect(getMediaType({ title: 'My.Show.S01E01' } as Searchee)).toBe(MediaType.EPISODE)
  })

  it('returns MediaType.SEASON if the title matches SEASON_REGEX', () => {
    expect(getMediaType({ title: 'My.Show.S01' } as Searchee)).toBe(MediaType.SEASON)
  })

  describe('when testing for video files by extension', () => {
    it('returns MediaType.MOVIE if the title matches MOVIE_REGEX', () => {
      const file = { name: 'media.mp4', length: 1, path: '/tmp/media.mp4' } as File
      expect(getMediaType({ title: 'My.Movie.2021', files: [file] } as Searchee)).toBe(MediaType.MOVIE)
    })

    it('returns MediaType.ANIME if the title matches ANIME_REGEX', () => {
      const file = { name: 'media.mp4', length: 1, path: '/tmp/media.mp4' } as File
      expect(getMediaType({ title: '[GRP] My.Anime - 001', files: [file] } as Searchee)).toBe(MediaType.ANIME)
    })

    it('returns MediaType.VIDEO if the title does not match MOVIE_REGEX or ANIME_REGEX', () => {
      const file = { name: 'media.mp4', length: 1, path: '/tmp/media.mp4' } as File
      expect(getMediaType({ title: 'My.Video', files: [file] } as Searchee)).toBe(MediaType.VIDEO)
    })
  })

  describe('when testing RAR archives', () => {
    it('returns MediaType.MOVIE if the title matches MOVIE_REGEX', () => {
      const file = { name: 'media.rar', length: 1, path: '/tmp/media.rar' } as File
      expect(getMediaType({ title: 'My.Movie.2021', files: [file] } as Searchee)).toBe(MediaType.MOVIE)
    })

    it('returns MediaType.AUDIO if one of the other files has an audio extension', () => {
      const archive = { name: 'media.rar', length: 1, path: '/tmp/media.rar' } as File
      const audio = { name: 'media.mp3', length: 1, path: '/tmp/media.mp3' } as File
      expect(getMediaType({ title: 'My.Video', files: [archive, audio] } as Searchee)).toBe(MediaType.AUDIO)
    })

    it('returns MediaType.BOOK if one of the other files has a book extension', () => {
      const archive = { name: 'media.rar', length: 1, path: '/tmp/media.rar' } as File
      const book = { name: 'media.epub', length: 1, path: '/tmp/media.epub' } as File
      expect(getMediaType({ title: 'My.Video', files: [archive, book] } as Searchee)).toBe(MediaType.BOOK)
    })

    it('returns MediaType.OTHER if the title does not match MOVIE_REGEX', () => {
      const file = { name: 'media.rar', length: 1, path: '/tmp/media.rar' } as File
      expect(getMediaType({ title: 'My.Other', files: [file] } as Searchee)).toBe(MediaType.OTHER)
    })
  })

  describe('when testing fallback behaviour', () => {
    it('returns MediaType.AUDIO if the file has an audio extension', () => {
      const file = { name: 'media.mp3', length: 1, path: '/tmp/media.mp3' } as File
      expect(getMediaType({ title: 'unknown', files: [file] } as Searchee)).toBe(MediaType.AUDIO)
    })

    it('returns MediaType.BOOK if the file has a book extension', () => {
      const file = { name: 'media.epub', length: 1, path: '/tmp/media.epub' } as File
      expect(getMediaType({ title: 'unknown', files: [file] } as Searchee)).toBe(MediaType.BOOK)
    })

    it('returns MediaType.OTHER if the media type cannot be determined', () => {
      const file = { name: 'media.xyz', length: 1, path: '/tmp/media.xyz' } as File
      expect(getMediaType({ title: 'unknown', files: [file] } as Searchee)).toBe(MediaType.OTHER)
    })
  })
})

describe('sanitizeUrl', () => {
  it('returns a string', () => {
    expect(sanitizeUrl('https://example.com/path')).toBe('https://example.com/path')
  })

  it('returns a string from URL object', () => {
    expect(sanitizeUrl(new URL('https://example.com/path'))).toBe('https://example.com/path')
  })

  it('appends a trailing slash to the host if the path is absent', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com/')
  })

  it('strips the query string', () => {
    expect(sanitizeUrl('https://example.com/path?query=string')).toBe('https://example.com/path')
  })
})
