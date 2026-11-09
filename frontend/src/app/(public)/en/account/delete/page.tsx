import {
  AccountDeletionPage,
  accountDeletionMetadata,
} from "@/features/account/components/account-deletion-page";

export function generateMetadata() {
  return accountDeletionMetadata("en");
}

export default function AccountDeletePageEn() {
  return <AccountDeletionPage locale="en" />;
}
