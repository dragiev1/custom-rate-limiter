export default {
	verbose: true,
	preset: 'ts-jest/presets/default-esm',
	testTimeout: 30000,
	testMatch: ['**/test/stores.ts'],
	moduleFileExtensions: ['js', 'json', 'ts'],
	moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
}

