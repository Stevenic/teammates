# Branch Protection — Recommended Settings for `main`

These are the recommended GitHub branch protection rules for the `Stevenic/teammates` repository's `main` branch.

## Required Settings

### Require status checks to pass before merging

Enable **Require status checks to pass before merging** and add these required checks:

| Check name | Job | Why |
|------------|-----|-----|
| `Lint & Type-check` | `quality` | Prevents merging code with lint errors or type errors |
| `Build & Test (Node 20)` | `build-and-test` | Ensures compatibility with Node 20 LTS |
| `Build & Test (Node 22)` | `build-and-test` | Ensures compatibility with Node 22 |

Also enable:
- **Require branches to be up to date before merging** — Prevents merging stale branches that haven't incorporated latest `main` changes.

### Require a pull request before merging

- **Required number of approvals:** 1 (minimum)
- **Dismiss stale pull request approvals when new commits are pushed:** Yes
- **Require review from code owners:** Optional (enable if CODEOWNERS file is added)

## Recommended Settings

### Do not allow bypassing the above settings

Even admins should go through CI. Disable **Allow specified actors to bypass required pull requests** unless there's a specific operational need.

### Restrict force pushes

Enable **Do not allow force pushes** — protects commit history on `main`.

### Restrict deletions

Enable **Do not allow deletions** — prevents accidental branch deletion.

## How to Apply

1. Go to **Settings → Branches → Branch protection rules**
2. Click **Add rule** (or edit existing rule for `main`)
3. Set **Branch name pattern** to `main`
4. Configure the settings listed above
5. Click **Save changes**

## Notes

- The CI workflow (`.github/workflows/ci.yml`) runs on both `push` to `main` and `pull_request` targeting `main`, so status checks will be available for PRs automatically.
- The two-job structure (`quality` → `build-and-test`) means quality failures block the build matrix early — no wasted compute.
