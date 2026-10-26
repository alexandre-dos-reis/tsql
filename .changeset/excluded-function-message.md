---
"@adr/tsql": patch
---

Tell a function that was never exported apart from one whose file was left out of the build. Both used
to be refused with "Only exported functions in this project can be called", which is advice the author
has already followed when the function *is* exported and only its file was not named — the common slip
when narrowing a build to one file. A project symbol whose declaration lies outside the compiled files
now says so, and points at naming that file or compiling the whole set. Nothing has to check whether it
was exported: the build type checks before translating, so a name that could be imported was exported.
