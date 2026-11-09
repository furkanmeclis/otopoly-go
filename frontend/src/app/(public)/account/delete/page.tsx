import {
  AccountDeletionPage,
  accountDeletionMetadata,
} from "@/features/account/components/account-deletion-page";

export function generateMetadata() {
  return accountDeletionMetadata("tr");
}

export default function AccountDeletePage() {
  return <AccountDeletionPage locale="tr" />;
}
