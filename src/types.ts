import { Context as Ctx } from '@actions/github/lib/context'
import { GitHub } from '@actions/github/lib/utils'
import { RequestParameters as ORP } from '@octokit/types' //eslint-disable-line import/no-unresolved

export type Context = Ctx
export type GitHub = InstanceType<typeof GitHub> //eslint-disable-line no-redeclare
export type RequestParameters = ORP
