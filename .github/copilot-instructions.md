# Git Workflow Rules

When generating code or proposing changes in this project, you must enforce the following Git workflow:

1. **Branching**: Always assume work happens on a feature branch, not `main`.
2. **Review & Test**: Remind the user to review the diff and run tests (`npm test` / type checking) before committing generated code.
3. **Micro-Commits**: Encourage frequent, atomic commits (one logical change per commit).
4. **Commit Messages**: Write meaningful commit messages that explain *what* changed and *why*, following conventional commits (e.g., `feat:`, `fix:`, `test:`).
5. **Pushing**: Remind the user to push to the remote frequently.

Do not allow massive, unreviewed code dumps. Break tasks down and commit incrementally.
