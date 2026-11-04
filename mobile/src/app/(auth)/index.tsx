import { Redirect } from 'expo-router';

import { useAuth } from '@/features/auth/auth-provider';

export default function AuthIndex() {
  const { introSeen } = useAuth();
  return <Redirect href={introSeen ? '/login' : '/welcome'} />;
}
