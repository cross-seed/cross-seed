import { Searchee } from "../../src/searchee"

export const searcheeFactory = ((overrides: Partial<Searchee> = {}): Searchee => {
  return {
    title: "My.Show.S01E01",
    name: "My Show",
    files: [],
    length: 0,
    ...overrides,
  }
})

