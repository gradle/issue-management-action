import * as core from '@actions/core'
import * as common from './common'
import { GitHub, Context } from './types'
import * as cheerio from 'cheerio'

const pendingDecisionLabel = 'pending:release-notes'
const hasNotesLabel = 'has:release-notes'
const notReleaseNoteWorthyLabel = 'has:release-notes-decision'

const worthyLabels = new Set<string>(['a:feature', 'a:regression', 'a:performance-improvement', 'a:epic'])
const highlyVotedIssueThreshold = 20

// prettier-ignore
const releaseNotesPaths = new Set<string>([
  'subprojects/docs/src/docs/release/notes.md',
  'platforms/documentation/docs/src/docs/release/notes.md'
])

function shouldHaveReleaseNotes(issue: any): boolean {
  const labels = issue.labels.nodes.map((label: any) => label.name)

  // prettier-ignore
  const noteWorthy =
    labels.some((label: string) => worthyLabels.has(label)) ||
    issue.reactions.totalCount >= highlyVotedIssueThreshold

  // prettier-ignore
  const excluded =
    labels.includes(notReleaseNoteWorthyLabel) ||
    labels.includes(hasNotesLabel) //in case notes are updated in an unrelated PR

  return noteWorthy && !excluded
}

// see https://github.com/orgs/community/discussions/24492
// and https://github.com/orgs/community/discussions/24367#discussioncomment-3243930
async function getLinkedPrNumbers(context: Context, issue: any): Promise<number[]> {
  const response = await fetch(`https://github.com/${context.repo.owner}/${context.repo.repo}/issues/${issue.number}`)
  const html = await response.text()
  const document = cheerio.load(html)
  const prNumbers = Array.from(document('development-menu form span a'))
    .map(element => document(element).attr('href'))
    .filter(url => url != null && url.length > 0)
    .map(url => parseInt(url!.split('/').pop()!)) //eslint-disable-line @typescript-eslint/no-non-null-assertion
    .filter(id => !isNaN(id))

  return Array.from(new Set(prNumbers))
}

async function hasReleaseNotes(github: GitHub, context: Context, issue: any): Promise<boolean> {
  const linkedPrNumbers = await getLinkedPrNumbers(context, issue)
  if (linkedPrNumbers.length === 0) {
    return false
  }
  // prettier-ignore
  const queryBody: string = linkedPrNumbers.map((number: number) => `
    pr${number}: pullRequest(number: ${number}) {
      number
      files(first: 100) {
      nodes { path }
    }
  `).join('') // prettier-ignore

  const response: any = await github.graphql(
    `query($owner: String!, $name: String!) {
       repository(owner: $owner, name: $name) {
         ${queryBody}
       }
    }`,
    {
      owner: context.repo.owner,
      name: context.repo.repo,
      prNumbers: linkedPrNumbers
    }
  )
  return linkedPrNumbers
    .flatMap((number: number) => response.repository[`pr${number}`].files.nodes.map((node: any) => node.path))
    .some((path: string) => releaseNotesPaths.has(path))
}

async function run(github: GitHub, context: Context): Promise<void> {
  try {
    const issueNumber: number = context.payload.issue!.number // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const response: any = await github.graphql(
      `query($owner:String!, $name:String!, $issue: Int!) {
         repository(owner:$owner, name:$name){
           issue(number: $issue) {
             state, stateReason
             assignees(first: 100) {
               nodes {
                 login
               }
             }
             milestone { title }
             labels(first: 100) {
               nodes { name }
             }
             reactions{ totalCount }
           }
         }
       }`,
      {
        owner: context.repo.owner,
        name: context.repo.repo,
        issue: issueNumber
      }
    )

    const issue = response.repository.issue

    if (issue.state !== 'CLOSED' || !shouldHaveReleaseNotes(issue)) {
      return
    }

    if (await hasReleaseNotes(github, context, issue)) {
      await github.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        name: pendingDecisionLabel
      })
      await github.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        labels: [hasNotesLabel]
      })
    } else {
      await github.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        state: 'open',
        state_reason: 'reopened'
      })

      const assigneeMention = issue.assignees.nodes.map((assignee: any) => `@${assignee.login}`).join(', ')
      const commentBody = `${assigneeMention} This issue looks release-note worthy, but no PR with release-notes update has been found.
Please, do one of the following:

1. Attach a PR with the release notes update to this issue.
2. Add the \`${notReleaseNoteWorthyLabel}\` label to the issue if it's not release-note-worthy or it was fixed in an old release.

After that, close the issue.`
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        body: commentBody
      })
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
    throw error
  }
}

run(common.getGitHub(), common.getContext())
