import { Capacitor } from '@capacitor/core';
import { Purchases, LOG_LEVEL, PURCHASES_ERROR_CODE } from '@revenuecat/purchases-capacitor';
import { REVENUECAT_IOS_API_KEY } from './config.js';

export const PREMIUM_ENTITLEMENT_ID = 'premium';

let initialized = false;

const isEntitled = (info) => !!info.entitlements.active[PREMIUM_ENTITLEMENT_ID];

/**
 * Configure RevenueCat and start listening for entitlement changes.
 * `onPremiumChange` fires once with the cached status (if any) and again
 * whenever it changes — purchase, renewal, refund, or restore.
 */
export function initPurchases(onPremiumChange) {
  if (!Capacitor.isNativePlatform() || initialized || !REVENUECAT_IOS_API_KEY) return;
  initialized = true;

  Purchases.setLogLevel({ level: LOG_LEVEL.ERROR }).catch(() => {});
  Purchases.addCustomerInfoUpdateListener((info) => onPremiumChange(isEntitled(info))).catch(() => {});

  Purchases.configure({ apiKey: REVENUECAT_IOS_API_KEY })
    .then(() => Purchases.getCustomerInfo())
    .then(({ customerInfo }) => onPremiumChange(isEntitled(customerInfo)))
    .catch(() => {});
}

/** The premium lifetime-unlock package from the current offering, or null if unavailable. */
export async function getPremiumPackage() {
  if (!Capacitor.isNativePlatform() || !REVENUECAT_IOS_API_KEY) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current?.lifetime ?? offerings.current?.availablePackages[0] ?? null;
  } catch {
    return null;
  }
}

export async function purchasePremium(pkg) {
  try {
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    return isEntitled(customerInfo) ? 'success' : 'error';
  } catch (err) {
    return err?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR ? 'cancelled' : 'error';
  }
}

/** Restores prior purchases (required for App Store review). Returns true if premium is now active. */
export async function restorePurchases() {
  if (!Capacitor.isNativePlatform() || !REVENUECAT_IOS_API_KEY) return false;
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return isEntitled(customerInfo);
  } catch {
    return false;
  }
}
