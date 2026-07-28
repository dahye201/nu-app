import { Capacitor } from '@capacitor/core';
import { Purchases, LOG_LEVEL, PURCHASES_ERROR_CODE } from '@revenuecat/purchases-capacitor';
import { REVENUECAT_IOS_API_KEY } from './config.js';

export const PREMIUM_ENTITLEMENT_ID = 'premium';
export const PREMIUM_PRODUCT_ID = 'nu.premium.lifetime';

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

/**
 * The premium lifetime-unlock StoreKit product, or null if unavailable.
 * Fetched directly by product ID rather than via an Offering/Package, since
 * this app only ever sells the one product and doesn't need paywall variants.
 */
export async function getPremiumProduct() {
  if (!Capacitor.isNativePlatform() || !REVENUECAT_IOS_API_KEY) return null;
  try {
    const { products } = await Purchases.getProducts({ productIdentifiers: [PREMIUM_PRODUCT_ID] });
    return products[0] ?? null;
  } catch {
    return null;
  }
}

export async function purchasePremium(product) {
  try {
    const { customerInfo } = await Purchases.purchaseStoreProduct({ product });
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
