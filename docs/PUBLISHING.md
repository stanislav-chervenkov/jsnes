# Publishing this fork to npm

This fork uses a **scoped package name** (`@stanislav-chervenkov/jsnes`) so it does not overwrite or conflict with the original [`jsnes`](https://www.npmjs.com/package/jsnes) package.

## Prerequisites

1. An [npm](https://www.npmjs.com/) account.
2. **Scoped packages** default to private on npm; this repo sets `"publishConfig": { "access": "public" }` so the first publish can be public.
3. If your **npm username** is not `stanislav-chervenkov`, change the `"name"` field in `package.json` to `@YOUR_NPM_USERNAME/jsnes` before publishing (keep the `@scope/package` form).

## One-time login

```bash
npm login
```

## Publish

From the repository root:

```bash
npm install
npm test
npm publish --access public
```

`prepublishOnly` runs `npm run build`, so `dist/` is built before the tarball is created.

## Version bumps

Use semver when releasing:

```bash
npm version patch   # or minor / major
git push --follow-tags
npm publish --access public
```

## Consumers

They install with:

```bash
npm install @stanislav-chervenkov/jsnes
```

and import:

```javascript
import { NES, Controller } from "@stanislav-chervenkov/jsnes";
```

The **browser UMD** bundle still exposes the global **`jsnes`** (see `webpack.config.js`), so script-tag examples keep `jsnes.NES`, `jsnes.Browser`, etc.
