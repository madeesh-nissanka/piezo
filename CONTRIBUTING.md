# Contributing to Piezo

## Requirements

- Node.js 18 or higher
- Zero runtime dependencies policy: **do not add npm dependencies**

## Getting Started

```bash
git clone <repository-url>
cd piezo
npm test          # runs: node --test test/
npm run smoke     # optional smoke test against a local server
```

## Code Style

- ESM modules only (`import`/`export`)
- JSDoc type annotations for public APIs
- Header comment at the top of every source and test file:
  ```js
  /**
   * @fileoverview Brief description
   * @module module-name
   * @license MIT
   * @author Madeesh P. Nissanka
   */
  ```
- No new linting infrastructure; follow existing patterns

## Adding an Adapter

1. Create a JSON file under `adapters/` following the adapter schema
2. Validate it:
   ```bash
   node bin/piezo.js adapters validate adapters/your-adapter.json
   ```

## Testing

- Run the full test suite: `npm test` (runs `node --test test/`)
- Tests must pass offline (no network access)
- Coverage expectation: all public functions and error paths exercised

## Pull Request Checklist

- [ ] All tests pass (`npm test`)
- [ ] No machine-specific paths or personal data in committed files
- [ ] `CHANGELOG.md` updated under `## [Unreleased]` or next version section
- [ ] No new `package.json` dependencies added
- [ ] Header comments present on any new source/test files