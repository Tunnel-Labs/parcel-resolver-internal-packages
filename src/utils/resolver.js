/* eslint-disable unicorn/prefer-node-protocol -- Parcel doesn't support node protocol imports */

const fs = require('fs');
const path = require('pathe');
const { Resolver } = require('@parcel/plugin');
const resolve = require('resolve.exports');
// @ts-expect-error: works
const { getMonorepoDirpath } = require('@tunnel/get-monorepo');

const monorepoDirpath = getMonorepoDirpath(__dirname);
if (monorepoDirpath === undefined) {
	throw new Error('Could not retrieve monorepo directory');
}

const packageCategories = {
	monorepo: ['monorepo'],
	...Object.fromEntries(
		JSON.parse(
			fs.readFileSync(path.join(monorepoDirpath, 'pnpm-workspace.yaml'), 'utf8')
		)
			.packages.map((/** @type {string} */ packagePattern) =>
				packagePattern.replace(/\/\*$/, '')
			)
			// Some package categories might not exist on Docker
			.filter((/** @type {string} */ packageCategory) =>
				fs.existsSync(path.join(monorepoDirpath, packageCategory))
			)
			.map((/** @type {string} */ packageCategory) => {
				const packageSlugs = fs
					.readdirSync(path.join(monorepoDirpath, packageCategory))
					.filter((dir) => !dir.startsWith('.'));

				const ghostPackageSlugs = new Set();
				// Remove ghost packages that have been renamed
				for (const packageSlug of packageSlugs) {
					if (
						!fs.existsSync(
							path.join(
								monorepoDirpath,
								packageCategory,
								packageSlug,
								'package.json'
							)
						)
					) {
						// eslint-disable-next-line no-console -- TODO
						console.error(
							`Package at path \`${monorepoDirpath}/${packageCategory}/${packageSlug}\` does not contain a \`package.json\` file, deleting it...`
						);
						ghostPackageSlugs.add(packageSlug);
						fs.rmSync(
							path.join(monorepoDirpath, packageCategory, packageSlug),
							{
								recursive: true,
								force: true
							}
						);
					}
				}

				return [
					packageCategory,
					packageSlugs.filter(
						(packageSlug) => !ghostPackageSlugs.has(packageSlug)
					)
				];
			})
	)
};

const packageSlugToCategory = Object.fromEntries(
	Object.entries(packageCategories).flatMap(([category, packageNames]) =>
		packageNames.map((packageName) => [packageName, category])
	)
);

module.exports = new Resolver({
	async resolve({ specifier }) {
		if (!specifier.startsWith('@t/')) {
			return null;
		}

		const packageSlug = specifier.match(/^@t\/([^/]+)/)[1];
		const packageCategory = packageSlugToCategory[packageSlug];
		const packageDirpath = path.join(
			monorepoDirpath,
			packageCategory,
			packageSlug
		);
		const packageJsonPath = path.join(packageDirpath, 'package.json');
		const packageJson = JSON.parse(
			await fs.promises.readFile(packageJsonPath, 'utf8')
		);

		const getFilePath = () => {
			const relativeImportPath = specifier.replace(`@t/${packageSlug}`, '.');
			const relativeFilePaths =
				resolve.exports(packageJson, relativeImportPath) ?? [];

			if (relativeFilePaths.length === 0) {
				throw new Error(`Could not resolve import ${specifier}`);
			}

			return path.join(
				packageDirpath,
				/** @type {string} */ (relativeFilePaths[0])
			);
		};

		if (typeof packageJson.publishable === 'object') {
			if (packageJson.publishable === null) {
				throw new Error(`Package "${specifier}" is not publishable`);
			}

			const subpath = specifier.replace(`@t/${packageSlug}`, '.');
			// @ts-expect-error: bruh
			if (packageJson.publishable[subpath] !== true) {
				throw new Error(`Package "${specifier}" is not publishable`);
			}

			return {
				filePath: getFilePath()
			};
		}

		if (packageJson.publishable !== true) {
			throw new Error(`Package "${specifier}" is not publishable`);
		}

		return {
			filePath: getFilePath()
		};
	}
});
