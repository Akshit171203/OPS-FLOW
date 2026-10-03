import { AuthForm } from '@/components-form';

export default function LoginPage() {
  return (
    <AuthForm
      title="Sign in to OpsFlow"
      endpoint="/api/auth/login"
      submitLabel="Sign in"
      alt={{ href: '/register', text: 'Need an account? Register' }}
      fields={[
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
      ]}
    />
  );
}
