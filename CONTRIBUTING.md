# Contributing to Eco Meetly

Thank you for your interest in contributing to **Eco Meetly**! This project is open source and welcomes bug fixes, feature improvements, documentation updates, and tests.

---

## Development Setup

1. **Prerequisites:**
   - Node.js 20+ (LTS recommended)
   - `npm` 10+
   - `ffmpeg` installed on `PATH` (for importing non-WAV audio files)
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Run in development mode:**
   ```sh
   npm run dev
   ```
4. **Run checks before opening a PR:**
   ```sh
   npm test
   npm run typecheck
   npm run build
   ```

---

## Commit Rules (Conventional Commits + SemVer)

Eco Meetly uses **Conventional Commits** to automatically calculate **Semantic Versioning (`MAJOR.MINOR.PATCH`)** and generate GitHub Release changelogs.

### Format
```text
<type>[optional scope][!]: <short imperative description>

[optional body]

[optional footer(s)]
```

### Allowed Types & SemVer Impact

| Type | SemVer Bump | When to Use |
| --- | --- | --- |
| `feat` | **MINOR** (`0.X.0`) | A new user-facing feature (e.g., `feat(diarization): add speaker rename`) |
| `fix` | **PATCH** (`0.0.X`) | A bug fix (e.g., `fix(summary): handle empty token chunks`) |
| `perf` | **PATCH** (`0.0.X`) | Performance or precision improvement (e.g., `perf(vad): add 85Hz high-pass filter`) |
| `refactor` | **PATCH** (`0.0.X`) | Code restructuring without changing behavior |
| `docs` | No bump* | Documentation-only changes (`README.md`, `CONTRIBUTING.md`, `prds/`) |
| `test` | No bump* | Adding or updating unit/integration tests |
| `chore` | No bump* | Build scripts, CI, or dependency maintenance |
| `feat!` / `BREAKING CHANGE:` | **MAJOR** (`X.0.0`) | Breaking change to IPC contracts, storage schema, or CLI/config |

*\*Note: If a release batch only contains `docs`, `test`, or `chore` commits, no new release tag is created automatically.*

### Examples
```text
feat(ui): add inline speaker rename badge
fix(audio): prevent blank screen when screen recording permission is denied
perf(stt): add adaptive noise floor and 340ms pre-roll buffer
feat!: migrate local storage format to v2
```

---

## Pull Request Checklist

- [ ] Code passes `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] New behavior includes unit tests under `tests/`.
- [ ] Commit messages follow Conventional Commits.
- [ ] All user-facing UI copy is in clear, consistent English.
