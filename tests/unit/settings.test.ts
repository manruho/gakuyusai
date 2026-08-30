import { describe, expect, it } from 'vitest';
import { editableSettingsSchema, readStockThresholds, sanitizeSettings, validateThresholdOrder } from '../../worker/services/settingsService';

describe('admin settings', () => {
  it('credential hashes and unknown keys are not exposed', () => {
    expect(sanitizeSettings({
      sales_open: 'true',
      owner_password_hash: 'sensitive-hash',
      unknown: 'value',
    })).toEqual({ sales_open: 'true' });
  });

  it('rejects secret keys and invalid threshold values', () => {
    expect(editableSettingsSchema.safeParse({ owner_password_hash: 'hash' }).success).toBe(false);
    expect(editableSettingsSchema.safeParse({ threshold_low: 'NaN' }).success).toBe(false);
    expect(validateThresholdOrder({ threshold_low: '0.7' }, {
      threshold_mid: '0.35',
      threshold_high: '0.65',
    })).toEqual({ ok: false, message: 'しきい値は low < mid < high の順にしてください。' });
  });

  it('falls back to safe defaults for invalid persisted thresholds', () => {
    expect(readStockThresholds({ threshold_low: 'NaN', threshold_mid: '0.1', threshold_high: '0.2' }))
      .toEqual({ low: 0.15, mid: 0.35, high: 0.65 });
  });
});
