import { AuthForm } from '@/components-form';
import { DemoButton } from '@/components/DemoButton';

export const metadata = { title: 'Sign in · OpsFlow' };

export default function LoginPage() {
  return (
    <AuthForm
      title="Welcome back"
      subtitle="Please enter your details to sign in to OpsFlow."
      endpoint="/api/auth/login"
      submitLabel="Sign in"
      alt={{ prefix: 'New to OpsFlow?', href: '/register', text: 'Create an organization' }}
      extra={<DemoButton />}
      fields={[
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
      ]}
    />
  );
}
