# Publishing this fork to npm

This fork is published as **`@schervenkov/jsnes`**. The **`@schervenkov`** scope matches the maintainer’s **npm username** (`schervenkov`), which is required for npm to accept a scoped publish.

It does not replace the original [`jsnes`](https://www.npmjs.com/package/jsnes) package.

## If you fork this repo under another npm account

Change the `"name"` in `package.json` to **`@YOUR_NPM_USERNAME/jsnes`** (run `npm whoami` for the exact username). If you see **`Scope not found`**, the scope does not match your logged-in npm user.

## Prerequisites

1. `npm login` as the account that owns the scope (e.g. `schervenkov` for `@schervenkov/jsnes`).
2. Scoped packages default to private; this repo sets `"publishConfig": { "access": "public" }` so the first publish can be public.
3. `prepublishOnly` runs `npm run build` so `dist/` is included.

## Publish

```bash
npm install
npm test
npm publish --access public
```

## Version bumps

```bash
npm version patch   # or minor / major
git push --follow-tags
npm publish --access public
```

## Consumers

```bash
npm install @schervenkov/jsnes
```

```javascript
import { NES, Controller } from "@schervenkov/jsnes";
```

The **browser UMD** bundle still exposes the global **`jsnes`** (`webpack.config.js`).
