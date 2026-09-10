import { z } from 'zod';

const booleanSetting = z.enum(['true', 'false']);
const thresholdSetting = z.string().trim().refine((value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1;
}, 'しきい値は0以上1以下の数値で入力してください。');

export const editableSettingsSchema = z.object({
  public_status_enabled: booleanSetting.optional(),
  sales_open: booleanSetting.optional(),
  sales_day: z.enum(['all', 'day1', 'day2']).optional(),
  threshold_low: thresholdSetting.optional(),
  threshold_mid: thresholdSetting.optional(),
  threshold_high: thresholdSetting.optional(),
  shop_name: z.string().trim().min(1).max(100).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  staff_username: z.string().trim().min(1).max(100).optional(),
  admin_username: z.string().trim().min(1).max(100).optional(),
  owner_username: z.string().trim().min(1).max(100).optional(),
  pickup_1_username: z.string().trim().min(1).max(100).optional(),
  pickup_2_username: z.string().trim().min(1).max(100).optional(),
  pickup_3_username: z.string().trim().min(1).max(100).optional(),
  pickup_4_username: z.string().trim().min(1).max(100).optional(),
  register_1_presale_enabled: booleanSetting.optional(),
  register_2_presale_enabled: booleanSetting.optional(),
  register_3_presale_enabled: booleanSetting.optional(),
}).strict();

export type EditableSettings = z.infer<typeof editableSettingsSchema>;

export const EDITABLE_SETTING_NAMES = Object.freeze(Object.keys(editableSettingsSchema.shape));
const EDITABLE_SETTING_KEYS = new Set(EDITABLE_SETTING_NAMES);
const DEFAULT_THRESHOLDS = { low: 0.15, mid: 0.35, high: 0.65 } as const;

export type RegisterId = 1 | 2 | 3 | 4;
export type RegisterSaleType = 'normal' | 'presale_pickup';

export function getRegisterSaleType(
  settings: Record<string, string>,
  registerId: RegisterId,
): RegisterSaleType {
  if (registerId === 4) return 'presale_pickup';
  return settings[`register_${registerId}_presale_enabled`] === 'true'
    ? 'presale_pickup'
    : 'normal';
}

export function getRegisterStationId(
  settings: Record<string, string>,
  registerId: RegisterId,
): RegisterId {
  return getRegisterSaleType(settings, registerId) === 'presale_pickup' ? 4 : registerId;
}

export function getRegisterConfiguration(settings: Record<string, string>) {
  return ([1, 2, 3, 4] as const).map((registerId) => {
    const saleType = getRegisterSaleType(settings, registerId);
    return {
      registerId,
      saleType,
      stationId: getRegisterStationId(settings, registerId),
      configurable: registerId !== 4,
    };
  });
}

export function sanitizeSettings(settings: Record<string, string>): EditableSettings {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => EDITABLE_SETTING_KEYS.has(key)),
  ) as EditableSettings;
}

export function validateThresholdOrder(
  update: EditableSettings,
  current: Record<string, string>,
): { ok: true } | { ok: false; message: string } {
  const low = Number(update.threshold_low ?? current.threshold_low ?? DEFAULT_THRESHOLDS.low);
  const mid = Number(update.threshold_mid ?? current.threshold_mid ?? DEFAULT_THRESHOLDS.mid);
  const high = Number(update.threshold_high ?? current.threshold_high ?? DEFAULT_THRESHOLDS.high);
  if (![low, mid, high].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    return { ok: false, message: 'しきい値は0以上1以下の数値で入力してください。' };
  }
  if (!(low < mid && mid < high)) {
    return { ok: false, message: 'しきい値は low < mid < high の順にしてください。' };
  }
  return { ok: true };
}

export function readStockThresholds(settings: Record<string, string>): {
  low: number;
  mid: number;
  high: number;
} {
  const parsed = {
    low: Number(settings.threshold_low ?? DEFAULT_THRESHOLDS.low),
    mid: Number(settings.threshold_mid ?? DEFAULT_THRESHOLDS.mid),
    high: Number(settings.threshold_high ?? DEFAULT_THRESHOLDS.high),
  };
  const valid = validateThresholdOrder(
    {
      threshold_low: String(parsed.low),
      threshold_mid: String(parsed.mid),
      threshold_high: String(parsed.high),
    },
    {},
  );
  return valid.ok ? parsed : { ...DEFAULT_THRESHOLDS };
}
