import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBuildConfigurations, resolveIosShortVersion, type IosVersionResult } from './ios-version.js';

let tmp: string;

beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'capgo-ios-version-test-'));
});

afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
});

async function writeFileEnsuringDir(p: string, contents: string): Promise<void> {
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, contents);
}

function plistWithVersion(value: string): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0">',
        '<dict>',
        '  <key>CFBundleShortVersionString</key>',
        `  <string>${value}</string>`,
        '</dict>',
        '</plist>',
        ''
    ].join('\n');
}

/**
 * Build a minimal pbxproj fragment containing one or more XCBuildConfiguration
 * blocks. Tests assemble this around realistic build settings — we don't try
 * to model the rest of an Xcode project (target lists, file references, etc.)
 * because the resolver only walks XCBuildConfiguration entries.
 */
function pbxproj(configs: Array<{ name: string; settings: Record<string, string>; baseRefComment?: string }>): string {
    const blocks = configs
        .map((c, i) => {
            const id = `00000000000000000000000${i.toString().padStart(2, '0')}`;
            const settingsLines = Object.entries(c.settings)
                .map(([k, v]) => {
                    const needsQuotes = /[^A-Za-z0-9._-]/.test(v);
                    const safe = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    return `\t\t\t\t${k} = ${needsQuotes ? `"${safe}"` : v};`;
                })
                .join('\n');
            const baseRef = c.baseRefComment
                ? `\n\t\t\tbaseConfigurationReference = AAAA${i.toString().padStart(2, '0')} /* ${c.baseRefComment} */;`
                : '';
            return [
                `\t\t${id} /* ${c.name} */ = {`,
                `\t\t\tisa = XCBuildConfiguration;${baseRef}`,
                `\t\t\tbuildSettings = {`,
                settingsLines,
                `\t\t\t};`,
                `\t\t\tname = ${c.name};`,
                `\t\t};`
            ].join('\n');
        })
        .join('\n');
    return [
        '// !$*UTF8*$!',
        '{',
        '\tarchiveVersion = 1;',
        '\tobjects = {',
        '/* Begin XCBuildConfiguration section */',
        blocks,
        '/* End XCBuildConfiguration section */',
        '\t};',
        '}',
        ''
    ].join('\n');
}

async function scaffoldIos(opts: {
    plistVersion: string;
    pbxprojContent?: string;
    xcconfig?: { name: string; contents: string };
}): Promise<string> {
    const iosRoot = tmp;
    await writeFileEnsuringDir(path.join(iosRoot, 'App/App/Info.plist'), plistWithVersion(opts.plistVersion));
    if (opts.pbxprojContent) {
        await writeFileEnsuringDir(path.join(iosRoot, 'App/App.xcodeproj/project.pbxproj'), opts.pbxprojContent);
    }
    if (opts.xcconfig) {
        await writeFileEnsuringDir(path.join(iosRoot, 'App', opts.xcconfig.name), opts.xcconfig.contents);
    }
    return iosRoot;
}

const xcodebuildOff = { allowXcodebuild: false };

function ok(result: IosVersionResult | null): { version: string; layers: string[] } {
    if (!result) throw new Error('expected resolution, got null');
    if (!result.ok) {
        throw new Error(`expected ok, got partial="${result.partial}", reason="${result.reason}"`);
    }
    return { version: result.version, layers: result.trace.map((t) => t.layer) };
}

describe('resolveIosShortVersion · layer 1 (Info.plist literal)', () => {
    it('returns the literal version without touching pbxproj', async () => {
        const iosRoot = await scaffoldIos({ plistVersion: '1.4.0' });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(ok(result)).toEqual({ version: '1.4.0', layers: ['Info.plist'] });
    });

    it('returns null when Info.plist is missing entirely', async () => {
        expect(await resolveIosShortVersion(tmp, xcodebuildOff)).toBeNull();
    });
});

describe('resolveIosShortVersion · layer 2 (pbxproj)', () => {
    it('resolves $(MARKETING_VERSION) from a Release config', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([
                { name: 'Debug', settings: { MARKETING_VERSION: '0.0.1-debug' } },
                { name: 'Release', settings: { MARKETING_VERSION: '1.2.0' } }
            ])
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(ok(result)).toEqual({ version: '1.2.0', layers: ['Info.plist', 'pbxproj'] });
    });

    it('handles ${MARKETING_VERSION} brace syntax', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '${MARKETING_VERSION}',
            pbxprojContent: pbxproj([{ name: 'Release', settings: { MARKETING_VERSION: '2.0.0' } }])
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(ok(result).version).toBe('2.0.0');
    });

    it('reads quoted values like MARKETING_VERSION = "1.2.0"', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([{ name: 'Release', settings: { MARKETING_VERSION: '1.2.0 beta' } }])
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(ok(result).version).toBe('1.2.0 beta');
    });

    it('recursively expands $(BASE_VERSION) → 1.2.0', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([
                {
                    name: 'Release',
                    settings: { MARKETING_VERSION: '$(BASE_VERSION)', BASE_VERSION: '3.1.4' }
                }
            ])
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(ok(result).version).toBe('3.1.4');
    });

    it('does not infinite-loop on cyclic references', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([
                {
                    name: 'Release',
                    settings: { MARKETING_VERSION: '$(BASE_VERSION)', BASE_VERSION: '$(MARKETING_VERSION)' }
                }
            ])
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(result?.ok).toBe(false);
        // Should mention an unresolved variable in the reason.
        if (result && !result.ok) {
            expect(result.reason).toMatch(/unresolved/);
        }
    });

    it('merges project-level + target-level Release configs (target wins)', async () => {
        // pbxproj convention: project-level config block declared before
        // target-level. Project sets a default; target overrides it.
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([
                { name: 'Release', settings: { MARKETING_VERSION: '0.0.1-default' } },
                { name: 'Release', settings: { MARKETING_VERSION: '4.5.6' } }
            ])
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(ok(result).version).toBe('4.5.6');
    });

    it('prefers Release over Debug even when both define MARKETING_VERSION', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([
                { name: 'Debug', settings: { MARKETING_VERSION: '9.9.9-debug' } },
                { name: 'Release', settings: { MARKETING_VERSION: '1.0.0' } }
            ])
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(ok(result).version).toBe('1.0.0');
    });

    it('falls back to the last config when no Release exists', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([
                { name: 'Staging', settings: { MARKETING_VERSION: '1.0.0' } },
                { name: 'Production', settings: { MARKETING_VERSION: '2.0.0' } }
            ])
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        // Last config wins when no exact "Release" match.
        expect(ok(result).version).toBe('2.0.0');
    });

    it('returns ok:false with trace when MARKETING_VERSION is missing', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([{ name: 'Release', settings: { OTHER_SETTING: 'foo' } }])
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(result?.ok).toBe(false);
        if (result && !result.ok) {
            expect(result.partial).toBe('$(MARKETING_VERSION)');
            expect(result.trace.map((t) => t.layer)).toContain('pbxproj');
            expect(result.reason).toMatch(/MARKETING_VERSION/);
        }
    });
});

describe('resolveIosShortVersion · layer 3 (xcconfig)', () => {
    it('resolves a variable defined in the xcconfig referenced by baseConfigurationReference', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([
                {
                    name: 'Release',
                    settings: { MARKETING_VERSION: '$(SHIP_VERSION)' },
                    baseRefComment: 'App.xcconfig'
                }
            ]),
            xcconfig: { name: 'App.xcconfig', contents: 'SHIP_VERSION = 7.0.0\n' }
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(ok(result)).toMatchObject({
            version: '7.0.0',
            layers: ['Info.plist', 'pbxproj', 'xcconfig']
        });
    });

    it('follows #include chains in xcconfig files', async () => {
        const iosRoot = tmp;
        await writeFileEnsuringDir(path.join(iosRoot, 'App/App/Info.plist'), plistWithVersion('$(MARKETING_VERSION)'));
        await writeFileEnsuringDir(
            path.join(iosRoot, 'App/App.xcodeproj/project.pbxproj'),
            pbxproj([
                {
                    name: 'Release',
                    settings: { MARKETING_VERSION: '$(SHIP_VERSION)' },
                    baseRefComment: 'App.xcconfig'
                }
            ])
        );
        await writeFileEnsuringDir(path.join(iosRoot, 'App/Base.xcconfig'), 'SHIP_VERSION = 5.5.5\n');
        await writeFileEnsuringDir(path.join(iosRoot, 'App/App.xcconfig'), '#include "Base.xcconfig"\n');
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(ok(result).version).toBe('5.5.5');
    });

    it('strips // comments inside xcconfig files', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([
                {
                    name: 'Release',
                    settings: { MARKETING_VERSION: '$(SHIP_VERSION)' },
                    baseRefComment: 'App.xcconfig'
                }
            ]),
            xcconfig: {
                name: 'App.xcconfig',
                contents: '// production marketing version\nSHIP_VERSION = 9.9.9 // bumped for QA\n'
            }
        });
        const result = await resolveIosShortVersion(iosRoot, xcodebuildOff);
        expect(ok(result).version).toBe('9.9.9');
    });
});

describe('resolveIosShortVersion · layer 4 (xcodebuild)', () => {
    it('skips xcodebuild silently on non-darwin platforms', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([{ name: 'Release', settings: { OTHER_SETTING: 'x' } }])
        });
        const result = await resolveIosShortVersion(iosRoot, {
            allowXcodebuild: true,
            platform: 'linux'
        });
        expect(result?.ok).toBe(false);
        // No xcodebuild trace entry on linux, even with allowXcodebuild=true.
        if (result && !result.ok) {
            expect(result.trace.map((t) => t.layer)).not.toContain('xcodebuild');
        }
    });

    it('records skip reason when xcodebuild binary is not found (darwin sim)', async () => {
        const iosRoot = await scaffoldIos({
            plistVersion: '$(MARKETING_VERSION)',
            pbxprojContent: pbxproj([{ name: 'Release', settings: { OTHER_SETTING: 'x' } }])
        });
        const result = await resolveIosShortVersion(iosRoot, {
            allowXcodebuild: true,
            platform: 'darwin',
            xcodebuildPath: '/definitely/not/a/real/xcodebuild-' + Date.now()
        });
        expect(result?.ok).toBe(false);
        if (result && !result.ok) {
            const layers = result.trace.map((t) => t.layer);
            expect(layers).toContain('xcodebuild');
            const xcEntry = result.trace.find((t) => t.layer === 'xcodebuild');
            expect(xcEntry?.detail).toMatch(/skipped/);
        }
    });
});

describe('parseBuildConfigurations', () => {
    it('extracts name + buildSettings from each XCBuildConfiguration block', () => {
        const raw = pbxproj([
            { name: 'Debug', settings: { MARKETING_VERSION: '0.0.1', CURRENT_PROJECT_VERSION: '1' } },
            { name: 'Release', settings: { MARKETING_VERSION: '1.2.0', CURRENT_PROJECT_VERSION: '5' } }
        ]);
        const configs = parseBuildConfigurations(raw);
        expect(configs).toHaveLength(2);
        expect(configs[0].name).toBe('Debug');
        expect(configs[0].settings.MARKETING_VERSION).toBe('0.0.1');
        expect(configs[1].name).toBe('Release');
        expect(configs[1].settings.MARKETING_VERSION).toBe('1.2.0');
    });

    it('captures baseConfigurationReference comment as filename', () => {
        const raw = pbxproj([
            {
                name: 'Release',
                settings: { MARKETING_VERSION: '1.0.0' },
                baseRefComment: 'App.xcconfig'
            }
        ]);
        const configs = parseBuildConfigurations(raw);
        expect(configs[0].baseConfigurationReference).toBe('App.xcconfig');
    });

    it('skips array-valued settings without erroring', () => {
        // Hand-crafted because our pbxproj() helper doesn't model arrays.
        const raw = `
// !$*UTF8*$!
{
    objects = {
        AAAA000000 /* Release */ = {
            isa = XCBuildConfiguration;
            buildSettings = {
                MARKETING_VERSION = 1.2.0;
                FRAMEWORK_SEARCH_PATHS = (
                    "$(inherited)",
                    "$(PROJECT_DIR)/Frameworks",
                );
                OTHER_LDFLAGS = "-ObjC";
            };
            name = Release;
        };
    };
}
`;
        const configs = parseBuildConfigurations(raw);
        expect(configs).toHaveLength(1);
        expect(configs[0].settings.MARKETING_VERSION).toBe('1.2.0');
        expect(configs[0].settings.OTHER_LDFLAGS).toBe('-ObjC');
        // FRAMEWORK_SEARCH_PATHS (array) should be skipped, not crash.
        expect(configs[0].settings.FRAMEWORK_SEARCH_PATHS).toBeUndefined();
    });
});
