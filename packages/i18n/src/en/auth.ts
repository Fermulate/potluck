export const auth = {
  signIn: {
    title: 'Welcome back',
    subtitle: 'Pull up a chair.',
    submit: 'Sign in',
    magicLink: 'Email me a sign-in link',
    noAccount: 'New here?',
    createAccount: 'Create an account',
  },
  signUp: {
    title: 'Join the table',
    subtitle: 'Shared tabs and plans, minus the awkward math.',
    submit: 'Create account',
    haveAccount: 'Already have an account?',
    terms: 'By continuing you agree to the terms and privacy policy.',
  },
  fields: {
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    passwordHint: 'At least 8 characters.',
    name: 'Your name',
    namePlaceholder: 'What do friends call you?',
  },
  checkEmail: {
    title: 'Check your inbox',
    body: 'We sent a link to {email}. Tap it and you are in.',
    resend: 'Send it again',
    resent: 'Sent. Give it a minute.',
  },
  forgotPassword: {
    link: 'Forgot password?',
    title: 'Reset your password',
    body: 'Tell us your email and we will send a reset link.',
    submit: 'Send reset link',
    sent: 'If that email has an account, a link is on its way.',
  },
  resetPassword: {
    title: 'Choose a new password',
    submit: 'Update password',
    done: 'Password updated. Carry on.',
  },
  signOut: 'Sign out',
  signedOut: 'Signed out. See you soon.',
  continueWithGoogle: 'Continue with Google',
  continueWithApple: 'Continue with Apple',
  or: 'or',
} as const

export const onboarding = {
  welcome: {
    title: 'Welcome to Potluck',
    body: 'Everyone brings something. We keep track of who.',
    start: "Let's go",
  },
  profile: {
    title: 'First, the basics',
    nameLabel: 'Display name',
    avatarLabel: 'Add a photo',
    timezoneLabel: 'Time zone',
    currencyLabel: 'Default currency',
  },
  firstGroup: {
    title: 'Start a group',
    body: 'Roommates, a trip, the Thursday dinner crew. Anyone you split things with.',
    create: 'Create a group',
    join: 'I have an invite link',
    skip: 'Maybe later',
  },
  notifications: {
    title: 'Want a heads up?',
    body: 'We will ping you when someone adds an expense or a plan needs your vote.',
    allow: 'Turn on notifications',
    skip: 'Not now',
  },
  done: "You're all set. Dig in.",
} as const
