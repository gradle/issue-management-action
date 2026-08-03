import { getLinkedPrNumbers } from '../src/linked-prs'

const repo = { owner: 'gradle', repo: 'gradle' }

describe('getLinkedPrNumbers', () => {
  const cases: [string, number, number[]][] = [
    ['with a single pr', 29651, [30821]],
    ['with no prs', 28694, []],
    ['with parent', 30902, [30901]],
    ['with multiple prs', 15826, [27268]]
  ]

  it.each(cases)(
    'resolves an issue %s (#%s)',
    async (_hint, issueNumber, expectedPrs) => {
      const actual = await getLinkedPrNumbers(repo, { number: issueNumber })

      expect(actual.slice().sort((a, b) => a - b)).toEqual(expectedPrs)
    },
    30_000
  )
})
