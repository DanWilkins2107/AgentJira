# awaiting_agent_breakdown — project stage instructions

When considering a work split, consider a few things. 
1. How large is the resulting work going to be. PRs will generally be around 200-300 lines, anything larger than that and we should be considering splitting.
2. Does all of this need to be human reviewed, and to how much detail? Things like database migrations, security changes, configuration all need extensive human checking. Things like UI changes do not. Splitting these out make it obvious what PRs the user needs to deal with. 
3. Prefer oversplitting over undersplitting - too small bits of work is fine, too large is annoying to deal with. 

Be concise. I just need the overarching ideas, not detail about each one. The more you write the more effort it is to read.