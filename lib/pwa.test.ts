import { describe, expect, it } from 'vitest';
import { buyLaneManifest } from './pwa';

describe('buy-lane PWA manifest', () => {
  it('opens directly to the mobile buy lane with installable display settings', () => {
    const manifest = buyLaneManifest();

    expect(manifest.name).toBe('Predict Studio Buy');
    expect(manifest.start_url).toBe('/buy');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });
});
