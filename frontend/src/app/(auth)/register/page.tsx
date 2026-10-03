import { AuthForm } from '@/components-form';

export default function RegisterPage() {
  return (
    <AuthForm
      title="Create your organization"
      endpoint="/api/auth/register"
      submitLabel="Create account"
      alt={{ href: '/login', text: 'Already registered? Sign in' }}
      fields={[
        { name: 'name', label: 'Your name', autoComplete: 'name' },
        { name: 'organizationName', label: 'Organization name', autoComplete: 'organization' },
        { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
        {
          name: 'password',
          label: 'Password (min 8 characters)',
          type: 'password',
          autoComplete: 'new-password',
        },
      ]}
    />
  );
}
