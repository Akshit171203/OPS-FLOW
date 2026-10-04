/**
 * Password rules for NEW passwords (registration). Length alone lets "password1" through, and people reuse
 * the same few hundred passwords everywhere, so a short list of the most common ones is rejected too, as are
 * passwords built from the person's own email or name. Existing accounts are never affected: sign-in does not
 * apply these rules.
 */

const COMMON = new Set(
  `password passw0rd p@ssword p@ssw0rd password1 password12 password123 password1234 password! pa55word pass1234
   12345678 123456789 1234567890 12345678910 123123123 1234qwer 1q2w3e4r 1q2w3e4r5t 1qaz2wsx 1qazxsw2 qwertyui
   qwerty12 qwerty123 qwerty1234 qwertyuiop qwertyuiop123 qazwsxedc asdfghjk asdfghjkl asdf1234 zxcvbnm1 zxcvbnm123
   iloveyou iloveyou1 iloveyou123 letmein1 letmein123 welcome1 welcome12 welcome123 admin123 admin1234 administrator
   adminadmin changeme changeme123 default123 abc12345 abcd1234 abcdefgh abcdefg1 abcdefghi trustno1 monkey123
   dragon123 football1 football123 baseball1 baseball123 superman1 master123 shadow123 sunshine1 sunshine123 princess1
   princess123 whatever1 whatever123 starwars1 michael123 jordan23 jennifer1 hunter123 charlie123 donald123 thomas123
   computer1 computer123 internet1 freedom1 batman123 secret123 mypassword mypassword1 mypassword123 testtest test1234
   test12345 testing123 guest1234 login123 passpass passw0rd1 qwer1234 zaq12wsx 11111111 00000000 88888888 12341234
   11223344 87654321 98765432 09876543 aaaaaaaa bbbbbbbb opsflow opsflow123 opsflow1234 incident123 welcome@123
   password@123 admin@123 india123 india@123 pakistan1 bismillah`
    .split(/\s+/)
    .filter(Boolean),
);

export interface PasswordContext {
  email?: string;
  name?: string;
}

export type PasswordProblem = 'TOO_COMMON' | 'CONTAINS_PERSONAL_INFO' | null;

const letters = (s: string) => s.replace(/[^a-z0-9@]/g, '');

/** What is wrong with a candidate password, or null when it is acceptable. */
export function passwordProblem(password: string, ctx: PasswordContext = {}): PasswordProblem {
  const lower = password.toLowerCase();
  const compact = letters(lower);
  // "Password123!" is the same password as "password": drop trailing digits and punctuation before comparing
  const stem = compact.replace(/[0-9@]+$/, '');

  if (COMMON.has(lower) || COMMON.has(compact) || (stem.length >= 4 && COMMON.has(stem))) {
    return 'TOO_COMMON';
  }
  if (/^(.)\1+$/.test(lower)) return 'TOO_COMMON'; // one repeated character
  if (/^\d+$/.test(lower) && lower.length < 12) return 'TOO_COMMON'; // short digits-only

  const email = (ctx.email ?? '').trim().toLowerCase();
  const local = email.split('@')[0] ?? '';
  if (email && (lower === email || (local.length >= 4 && compact.includes(letters(local))))) {
    return 'CONTAINS_PERSONAL_INFO';
  }
  const parts = (ctx.name ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map(letters)
    .filter((p) => p.length >= 4);
  if (parts.some((p) => compact.includes(p))) return 'CONTAINS_PERSONAL_INFO';
  return null;
}

export const passwordProblemMessage: Record<Exclude<PasswordProblem, null>, string> = {
  TOO_COMMON: 'That password is too common. Choose something less guessable.',
  CONTAINS_PERSONAL_INFO: 'The password should not contain your name or email address.',
};
