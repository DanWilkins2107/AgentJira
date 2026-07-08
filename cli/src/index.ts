#!/usr/bin/env node
import { Command } from 'commander';
import { registerAddEdge } from './commands/add-edge.js';
import { registerClaim } from './commands/claim.js';
import { registerContext } from './commands/context.js';
import { registerCreateNode } from './commands/create-node.js';
import { registerGithubToken } from './commands/github-token.js';
import { registerInvalidate } from './commands/invalidate.js';
import { registerLinkPr } from './commands/link-pr.js';
import { registerPost } from './commands/post.js';
import { registerProjects } from './commands/projects.js';
import { registerProposeSplit } from './commands/propose-split.js';
import { registerSearch } from './commands/search.js';
import { registerSetStatus } from './commands/set-status.js';
import { registerSubmitSpec } from './commands/submit-spec.js';
import { registerTasks } from './commands/tasks.js';
import { registerWhoami } from './commands/whoami.js';

const program = new Command();
program
  .name('aj')
  .description('AgentJira agent CLI — work the task graph from the command line')
  .version('0.1.0');

registerWhoami(program);
registerProjects(program);
registerTasks(program);
registerContext(program);
registerClaim(program);
registerPost(program);
registerProposeSplit(program);
registerCreateNode(program);
registerAddEdge(program);
registerSubmitSpec(program);
registerSetStatus(program);
registerLinkPr(program);
registerGithubToken(program);
registerInvalidate(program);
registerSearch(program);

await program.parseAsync(process.argv);
