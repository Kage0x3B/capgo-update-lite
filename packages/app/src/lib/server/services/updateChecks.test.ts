import { describe, expect, it } from 'vitest';
import { countryOf, deviceContext } from './updateChecks.js';

describe('deviceContext', () => {
    it('reads the plugin body and lowercases the device id', () => {
        const ctx = deviceContext({
            app_id: 'com.example.app',
            device_id: 'ABCDEF00-0000-4000-8000-000000000001',
            version_name: '1.2.3',
            version_build: '2.0.0',
            platform: 'ios',
            plugin_version: '8.45.0',
            is_emulator: false,
            is_prod: true,
            custom_id: 'user-42'
        });
        expect(ctx).toMatchObject({
            appId: 'com.example.app',
            deviceId: 'abcdef00-0000-4000-8000-000000000001',
            channel: 'production',
            versionBuild: '2.0.0',
            customId: 'user-42',
            isEmulator: false
        });
    });

    it('tolerates garbage so refused requests can still be logged', () => {
        const ctx = deviceContext({ app_id: 42, device_id: 'x'.repeat(500), is_prod: 'yes' });
        expect(ctx.appId).toBeNull();
        expect(ctx.deviceId).toHaveLength(64);
        expect(ctx.isProd).toBeNull();
        expect(deviceContext(null).appId).toBeNull();
    });

    it('uses defaultChannel when given', () => {
        expect(deviceContext({ defaultChannel: 'beta' }).channel).toBe('beta');
    });
});

describe('countryOf', () => {
    it('reads the Cloudflare country code', () => {
        expect(countryOf({ cf: { country: 'DE' } })).toBe('DE');
        expect(countryOf({ cf: undefined })).toBeNull();
        expect(countryOf(undefined)).toBeNull();
    });
});
