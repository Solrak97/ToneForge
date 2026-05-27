# Gitflow

ToneForge uses [Gitflow](https://nvie.com/posts/a-successful-git-branching-model/) for branch management.

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready releases only |
| `develop` | Integration branch for ongoing work |
| `feature/*` | New features and enhancements |
| `release/*` | Release preparation and stabilization |
| `hotfix/*` | Urgent fixes on top of `main` |

## Daily workflow

### Start a feature

```bash
git checkout develop
git pull origin develop
git checkout -b feature/my-feature
```

Work, commit, then push:

```bash
git push -u origin feature/my-feature
```

Open a pull request: **`feature/*` → `develop`**

### Finish a release

```bash
git checkout develop
git pull origin develop
git checkout -b release/0.2.0
```

- Bump version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`
- Run tests: `cargo test` and `npm run build`
- Open PR: **`release/*` → `main`**
- After merge to `main`, tag the release:

```bash
git checkout main
git pull origin main
git tag -a v0.2.0 -m "ToneForge v0.2.0"
git push origin v0.2.0
```

- Merge `main` back into `develop` so hotfixes and release fixes stay in sync:

```bash
git checkout develop
git merge main
git push origin develop
```

### Hotfix on production

```bash
git checkout main
git pull origin main
git checkout -b hotfix/critical-fix
```

Fix, test, then open PR: **`hotfix/*` → `main`**

After merge, tag if needed and merge `main` back into `develop`.

## Commit messages

Use clear, imperative subject lines:

- `Add Katana MkII device driver`
- `Fix SysEx checksum on chunked responses`
- `Update Gen 3 address map from BTS export`

## Branch protection (recommended on GitHub)

For `main` and `develop`:

- Require pull request before merging
- Require status checks when CI is added
- Disallow force pushes

## Quick reference

```bash
# Clone and start developing
git clone https://github.com/Solrak97/ToneForge.git
cd ToneForge
git checkout develop

# New feature
git checkout -b feature/connection-retry develop

# Sync feature with latest develop
git checkout feature/connection-retry
git fetch origin
git merge origin/develop
```
