import { AuthForm } from '@/components-form';

export const metadata = { title: 'Sign in · OpsFlow' };

export default function LoginPage() {
  return (
    <AuthForm
      title="Sign in"
      subtitle="Welcome back. Enter your details to continue."
      endpoint="/api/auth/login"
      submitLabel="Sign in"
      alt={{ href: '/register', text: 'New here? Create an organization' }}
      fields={[
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
      ]}
    />
  );
}
