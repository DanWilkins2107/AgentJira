---
name: code-style-guide
description: Read when writing or planning any sort of code implementation.
---

# Code style guide

When writing code, follow the principles as instructed:

- YAGNI. Do not introduce unnecessary abstractions. Do not expand on scope.
  - If you think an additional scope would be helpful, raise this as a question instead.

- Commenting. Do not add comments to the top of functions, or to the top of files when they just describe the scope. Add comments only when necessary, a lot of the time the presence of a comment being necessary just suggests we should be breaking things up into functions further.

- Environment Variables. Use zod for environment variable validation. Do this at an early stage, i.e. before a function runs (preferably at startup), instead of a "fail when we hit an error".

- Documentation. Documentation should only cover anything not covered by the code. Having docs on top of code creates a layer of abstraction that can sometimes become out of date. Plans are fine to be in docs, but once implemented they should be removed. Similarly, anything that can be derived from code should not be in documentation.

- "Nothing words". Sometimes words are used that just don't really mean anything. Avoid the use of "canonical" for example.

- References. References to files are often flimsy. If adding file references, add two-way references only (or a note saying if X file is moved change Y).

- Barrel exports - do not use barrel export files.

- Do not pre-emptively do "fallback" or "in-case" methods. Stick to strict scope. This does not mean don't error handle when user facing, but for the most part for anything non-user-facing I'd rather things be surfaced to me.
