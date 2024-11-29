import * as core from '@actions/core'
import * as common from './common'
import { getLinkedPrNumbers } from './linked-prs'
import { GitHub, Context } from './types'

const pendingDecisionLabel = 'pending:release-notes'
const hasNotesLabel = 'has:release-notes'
const notReleaseNoteWorthyLabel = 'has:release-notes-decision'

const worthyLabels = new Set<string>(['a:feature', 'a:regression', 'a:performance-improvement', 'a:epic'])
const highlyVotedIssueThreshold = 20

const releaseNotesPaths = /\/src\/docs\/(release\/notes\.md|userguide\/releases\/upgrading\/upgrading_version_.+\.adoc)/

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

  console.log(`shouldHaveReleaseNotes status: ${noteWorthy && !excluded}`)
  return noteWorthy && !excluded
}

async function hasReleaseNotes(github: GitHub, context: Context, issue: any): Promise<boolean> {
  const linkedPrNumbers = await getLinkedPrNumbers(context.repo, issue)
  console.log(`linked prs: ${linkedPrNumbers}`)
  if (linkedPrNumbers.length === 0) {
    return false
  }
  // prettier-ignore
  const queryBody: string = linkedPrNumbers.map((number: number) => `
    pr${number}: pullRequest(number: ${number}) {
      number, state
      files(first: 100) {
        nodes { path }
      }
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
  console.log(`prs response: ${JSON.stringify(response)}`)
  return linkedPrNumbers
    .map((number: number) => response.repository[`pr${number}`])
    .filter(pr => pr.state === 'MERGED')
    .flatMap(pr => pr.files.nodes.map((node: any) => node.path))
    .some((path: string) => releaseNotesPaths.test(path))
}

async function run(github: GitHub, context: Context): Promise<void> {
  try {
    const issueNumber: number = context.payload.issue!.number // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const response: any = await github.graphql(
      `query($owner:String!, $name:String!, $issue: Int!) {
         repository(owner:$owner, name:$name){
           issue(number: $issue) {
             state, stateReason, number
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

    if (issue.state !== 'CLOSED') {
      return
    }

    if (issue.stateReason !== 'COMPLETED' || !shouldHaveReleaseNotes(issue)) {
      if (issue.labels.nodes.some((label: any) => label.name === pendingDecisionLabel)) {
        await github.rest.issues.removeLabel({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issueNumber,
          name: pendingDecisionLabel
        })
      }
      return
    }

    if (await hasReleaseNotes(github, context, issue)) {
      if (issue.labels.nodes.some((label: any) => label.name === pendingDecisionLabel)) {
        await github.rest.issues.removeLabel({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issueNumber,
          name: pendingDecisionLabel
        })
      }
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
      const commentBody = `${assigneeMention} This issue was closed as completed and looks release-note worthy, but no PR with release-notes update has been found.
Please, do one of the following:

1. Attach a PR with the release notes or upgrade guide update to this issue.
2. Add the \`${notReleaseNoteWorthyLabel}\` label to the issue if it's not release-note-worthy or it was fixed in an old release and close the issue.
3. Close issue as "not planned".
`
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        body: commentBody
      })
      await github.rest.issues.addLabels({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        labels: [pendingDecisionLabel]
      })
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
    throw error
  }
}

run(common.getGitHub(), common.getContext())
