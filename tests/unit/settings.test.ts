import { describe, expect, it } from 'vitest';
import { editableSettingsSchema, getRegisterConfiguration, getRegisterSaleType, getRegisterStationId, readStockThresholds, sanitizeSettings, validateThresholdOrder } from '../../worker/services/settingsService';

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

  it('resolves independent register modes and keeps register 4 fixed to presale', () => {
    const settings = { register_1_presale_enabled: 'true', register_2_presale_enabled: 'false', register_3_presale_enabled: 'true' };
    expect(getRegisterSaleType(settings, 1)).toBe('presale_pickup');
    expect(getRegisterSaleType(settings, 2)).toBe('normal');
    expect(getRegisterSaleType(settings, 3)).toBe('presale_pickup');
    expect(getRegisterSaleType({ register_4_presale_enabled: 'false' }, 4)).toBe('presale_pickup');
    expect(getRegisterStationId(settings, 1)).toBe(4);
    expect(getRegisterStationId(settings, 2)).toBe(2);
    expect(getRegisterConfiguration(settings)).toEqual([
      { registerId: 1, saleType: 'presale_pickup', stationId: 4, configurable: true },
      { registerId: 2, saleType: 'normal', stationId: 2, configurable: true },
      { registerId: 3, saleType: 'presale_pickup', stationId: 4, configurable: true },
      { registerId: 4, saleType: 'presale_pickup', stationId: 4, configurable: false },
    ]);
  });
});
