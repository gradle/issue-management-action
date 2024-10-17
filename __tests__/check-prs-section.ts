// this is a quick test to check the getLinkedPrNumbers function
// install ts-node with npm install -g ts-node
// run this file with ts-node __tests__/check-prs-section.ts

import assert from 'node:assert'
import { getLinkedPrNumbers } from '../src/linked-prs'

const repo = {
  owner: 'gradle',
  repo: 'gradle'
}

function setsAreEqual(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every(value => b.has(value))
}

async function test_issue(hint: string, issue_number: number, expected_prs: number[]): Promise<void> {
  const issue = {
    number: issue_number
  }
  console.log(`\nChecking issue #${issue_number} - ${hint}`)
  const actual_numbers = await getLinkedPrNumbers(repo, issue)
  assert(setsAreEqual(new Set(actual_numbers), new Set(expected_prs)), `FAIL: expected ${expected_prs} but got ${actual_numbers}`)
  console.log('PASS')
}

async function test_all(): Promise<void> {
  await test_issue('with a single pr', 29651, [30821])
  await test_issue('with no prs', 28694, [])
  await test_issue('with parent', 30902, [30901])
  await test_issue('with multiple prs', 15826, [27268])
}

test_all()
