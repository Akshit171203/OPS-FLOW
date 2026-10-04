import { AuthForm } from '@/components-form';

export const metadata = { title: 'Create your organization · OpsFlow' };

export default function RegisterPage() {
  return (
    <AuthForm
      title="Create your organization"
      subtitle="You will be its owner and can invite your team afterwards."
      endpoint="/api/auth/register"
      submitLabel="Create account"
      alt={{ prefix: 'Already registered?', href: '/login', text: 'Sign in' }}
      fields={[
        { name: 'name', label: 'Your name', autoComplete: 'name' },
        { name: 'organizationName', label: 'Organization name', autoComplete: 'organization' },
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        {
          name: 'password',
          label: 'Password',
          type: 'password',
          autoComplete: 'new-password',
          hint: 'At least 8 characters, and not a common password or one containing your name or email.',
        },
      ]}
    />
  );
}
