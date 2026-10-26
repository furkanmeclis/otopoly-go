import type { components } from '@/api/generated/api';

type Schemas = components['schemas'];

export type LoyaltyRef = Schemas['LoyaltyRef'];
export type RewardType = Schemas['LoyaltyRewardType'];
export type LoyaltyKind = Schemas['LoyaltyKind'];
export type PaymentMethod = Schemas['LoyaltyPaymentMethod'];
export type LoyaltyCampaign = Schemas['LoyaltyCampaign'];
export type CampaignInput = Schemas['LoyaltyCampaignInput'];
export type LoyaltyPackage = Schemas['LoyaltyPackage'];
export type PackageInput = Schemas['LoyaltyPackageInput'];
export type LoyaltyPlan = Schemas['LoyaltyPlan'];
export type PlanInput = Schemas['LoyaltyPlanInput'];
export type LoyaltyCredit = Schemas['LoyaltyCredit'];
export type CustomerPackage = Schemas['LoyaltyCustomerPackage'];
export type CustomerPackageDetail = Schemas['LoyaltyCustomerPackageDetail'];
export type CancelResult = Schemas['LoyaltyCancelResult'];
export type LoyaltyUsage = Schemas['LoyaltyUsage'];
export type LoyaltyPeriod = Schemas['LoyaltyPeriod'];
export type Subscription = Schemas['LoyaltySubscription'];
export type SubscriptionDetail = Schemas['LoyaltySubscriptionDetail'];
export type SubscriptionPayment = Schemas['LoyaltySubscriptionPayment'];
export type PaymentInput = Schemas['LoyaltyPaymentInput'];
export type SellPackageInput = Schemas['LoyaltySellPackageInput'];
export type StartSubscriptionInput = Schemas['LoyaltyStartSubscriptionInput'];
export type StampCard = Schemas['LoyaltyStampCard'];
export type CustomerLoyalty = Schemas['CustomerLoyalty'];
export type LoyaltyApplication = Schemas['LoyaltyApplication'];
export type LoyaltyOption = Schemas['LoyaltyOption'];
export type ApplyInput = Schemas['LoyaltyApplyInput'];
export type JobLoyalty = Schemas['JobLoyalty'];
export type LoyaltyOverview = Schemas['LoyaltyOverview'];

export type PackageState = CustomerPackage['state'];
export type SubscriptionState = Subscription['state'];
