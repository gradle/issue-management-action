import * as cheerio from 'cheerio'

// see https://github.com/orgs/community/discussions/24492
// and https://github.com/orgs/community/discussions/24367#discussioncomment-3243930
export async function getLinkedPrNumbers(repo: any, issue: any): Promise<number[]> {
  const issueUrl = `https://github.com/${repo.owner}/${repo.repo}/issues/${issue.number}`
  console.log(`issue url: ${issueUrl}`)

  const response = await fetch(issueUrl)
  if (response.status !== 200) {
    throw new Error(`Failed to fetch issue page from ${issueUrl}: ${response.statusText}`)
  }

  const html = await response.text()
  const document = cheerio.load(html)

  const container = document('div[data-testid=issue-metadata-fixed]')
  if (container.length === 0) {
    throw new Error(`No container for linked PRs found in issue page ${issueUrl}, please update the GH action`)
  }
  const urls = Array.from(container.find('a')).map(element => document(element).attr('href'))
  console.log(`urls: ${urls}`)

  const prNumbers = urls
    .filter(url => url != null && url.length > 0)
    .map(url => parseInt(url!.split('/').pop()!)) //eslint-disable-line @typescript-eslint/no-non-null-assertion
    .filter(id => !isNaN(id))
  console.log(`pr numbers: ${prNumbers}`)

  return Array.from(new Set(prNumbers))
}
