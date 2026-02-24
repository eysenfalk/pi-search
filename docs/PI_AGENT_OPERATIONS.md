# Pi Agent Operations: Extension Management, Versioning, and Migration

This guide documents a practical way to manage many pi extensions (including third-party ones), keep behavior reproducible, and migrate quickly across servers.

## 1) Prefer package-based extension management

Use pi packages (`pi install ...`) instead of ad-hoc symlinks in `~/.pi/agent/extensions`.

Why:
- Easy to audit with `pi list`
- Version pinning works (`@version` or git tag)
- Predictable installs on new machines

## 2) Keep settings declarative and under version control

Use one of these as the source of truth:
- **Project scope**: `.pi/settings.json` (best for team/project portability)
- **Global scope**: `~/.pi/agent/settings.json` (best for personal workstation profile)

For reproducible behavior, pin package versions.

Examples:

```json
{
  "packages": [
    "npm:@aemonculaba/pi-search@0.2.0",
    "git:github.com/org/pi-toolkit@v1.4.2"
  ]
}
```

## 3) Use project-local `.pi/settings.json` for server-to-server portability

Recommended for infra/dev servers:
1. Commit `.pi/settings.json` to the project repository
2. Pin versions/tags
3. On a new server, open the project and start `pi`

Pi will install missing packages from project settings automatically.

## 4) Filter big packages instead of forking them

If a package ships many resources, use package filtering in settings to load only what you need.

```json
{
  "packages": [
    {
      "source": "npm:@vendor/pi-toolbox@2.3.1",
      "extensions": ["extensions/web*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"]
    }
  ]
}
```

This keeps third-party updates possible while preserving control.

## 5) Extension lifecycle workflow (fast + safe)

### Local fast iteration

```bash
pi install /absolute/path/to/extension-repo
# edit code
/reload
```

No reinstall needed between edits; just `/reload`.

### Release workflow

1. `npm ci`
2. `npm test`
3. `npm run pack:check`
4. Bump version (`npm version ...`)
5. Tag + push (or publish, depending on your workflow)

## 6) Avoid symlink-based extension loading

Symlinks can point at stale worktrees/branches and cause confusing runtime behavior.

Preferred:
- install from a real path (`pi install /path/to/repo`)
- install from npm or git source with version pinning

## 7) Suggested operational checklist

- `pi list` to audit active package sources
- pin versions in settings
- keep `.pi/settings.json` in git for project-level portability
- keep `AGENTS.md` rules concise and explicit
- apply policy extensions for hard enforcement, not prompt text alone

## 8) pi-search policy knobs

`pi-search` includes an embedded web tool policy. Environment variables:

- `PI_SEARCH_ENFORCE_WEB_POLICY` (default: `true`)
  - Blocks known third-party web tools and injects system guidance.
- `PI_SEARCH_BLOCK_BASH_WEB` (default: `true`)
  - Blocks bash-based web fetching patterns (`curl`, `wget`, raw URLs, etc.).
- `PI_SEARCH_EXTRA_BLOCKED_TOOLS`
  - Comma-separated additional tool names to block.
- `PI_SEARCH_ALLOWED_WEB_TOOLS`
  - Comma-separated tool names to un-block from the default blocked set.

The tools `web_search` and `web_fetch` are always allowed by policy.
